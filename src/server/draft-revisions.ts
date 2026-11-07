/** 修订只交付新候选；采用和后台检查继续复用既有业务入口。 */
import type { DraftStore } from "../task/draft-store.js";
import type { ChapterDraft, DraftGeneration, DraftRevision } from "../task/types.js";
import { authoredSession, draftRevisionToken, stableFingerprint } from "../task/revision.js";
import { buildChapterRunInput, buildChapterReviewInput, chapterInputFingerprint, ChapterWriteError, validateChapterNumber } from "./chapter-input.js";
import type { ProjectSession } from "./state.js";
import type { ChapterWriter } from "./chapter-writer.js";
import { correctDeclaration, type StructureCorrection } from "../chapter/c5-correction.js";
import type { C5Declaration } from "../types/events.js";
import { prepareGeneration, validateRewriteOptions, type DraftRewriteOptions } from "./draft-rewrite.js";

export interface DraftReference {
  readonly chapter: number;
  readonly draftId: string;
  readonly revisionToken: string;
}
export interface DraftEditOptions extends DraftReference {
  readonly body: string;
  readonly summary?: string;
  readonly requestId?: string;
}
export interface DraftCheckOptions extends DraftReference {
  readonly adoptOnSuccess: boolean;
  readonly selectedProposals?: readonly number[];
}
export interface DraftCorrectionOptions extends DraftReference {
  readonly changes: readonly StructureCorrection[];
  readonly summary: string;
  readonly requestId?: string;
}

export function validateDraftReference(options: DraftReference): void {
  validateChapterNumber(options.chapter);
  if (typeof options.draftId !== "string" || !new RegExp(`^ch${options.chapter}d[1-9]\\d*$`, "u").test(options.draftId)) throw new ChapterWriteError(400, "draftId 必须是本章的草稿编号");
  if (typeof options.revisionToken !== "string" || !/^[a-f0-9]{64}$/u.test(options.revisionToken)) throw new ChapterWriteError(400, "缺少有效的源稿版本凭据，请重新打开结果页");
}

export class DraftRevisions {
  constructor(private readonly session: ProjectSession, private readonly store: DraftStore, private readonly writer: ChapterWriter) {}

  applyPassage(input: unknown): ChapterDraft {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ChapterWriteError(400, "请选择要替换的原文");
    const data = input as Record<string, unknown>;
    const chapter = data.chapter as number;
    validateChapterNumber(chapter);
    const { start, quote, replacement, sourceToken } = data;
    if (!Number.isSafeInteger(start) || (start as number) < 0 || typeof quote !== "string" || !quote.trim() || quote.length > 12000 ||
      typeof replacement !== "string" || !replacement.trim() || replacement.length > 24000 || typeof sourceToken !== "string" || !/^[a-f0-9]{64}$/u.test(sourceToken))
      throw new ChapterWriteError(400, "原文、来源凭据或替代文字无效");
    if (data.requestId === undefined) throw new ChapterWriteError(400, "保存新版本需要请求编号");
    const fingerprint = stableFingerprint(["passage", chapter, data.draftId ?? null, data.revisionToken ?? null, sourceToken, start, quote, replacement]);
    const previous = this.receipt(data.requestId as string, fingerprint);
    if (previous) return previous;
    return this.store.transaction(() => {
      let source: ChapterDraft | undefined;
      if (data.draftId !== undefined) {
        const ref = { chapter, draftId: data.draftId as string, revisionToken: data.revisionToken as string };
        validateDraftReference(ref);
        source = this.source(ref);
        this.writer.assertFresh(source);
      }
      const original = source?.body ?? this.session.readCurrentChapterText(chapter);
      if (original === undefined) throw new ChapterWriteError(404, "本章正文不存在");
      if (stableFingerprint(original) !== sourceToken || original.slice(start as number, (start as number) + quote.length) !== quote)
        throw new ChapterWriteError(409, "原文已变化，请重新选段；本次未保存新稿");
      if (source === undefined) {
        const id = this.session.currentAdoptedDraftId(chapter);
        source = id === undefined ? undefined : this.store.loadDraft(chapter, id);
        if (source !== undefined && source.body !== original) throw new ChapterWriteError(409, "正式正文与版本记录不一致，请重新读取后核对");
        if (source === undefined) {
          const now = new Date().toISOString();
          source = { chapter, draftId: this.store.nextDraftId(chapter), status: "adopted", body: original,
            declaration: this.session.revise.adoptedDeclaration(chapter), findings: [], acceptable: false, proposals: [], session: null, error: null,
            baseVersion: this.store.workVersion(), baseAdoptedThrough: this.session.currentChapter, createdAt: now, updatedAt: now };
          this.store.saveDraft(source);
        }
      }
      const next = this.create({ chapter, draftId: source.draftId, revisionToken: draftRevisionToken(source),
        body: original.slice(0, start as number) + replacement + original.slice((start as number) + quote.length), requestId: data.requestId as string },
      source, "应用段落候选（仅替换所选原文）", "manual", null, fingerprint);
      let occurrence = 0, position = original.indexOf(quote);
      while (position >= 0 && position < (start as number)) { occurrence++; position = original.indexOf(quote, position + 1); }
      const scoped: ChapterDraft = { ...next, revision: { ...next.revision!, scope: { start: start as number, end: (start as number) + quote.length, quote, occurrence } } };
      this.store.saveDraft(scoped);
      return scoped;
    });
  }

  edit(options: DraftEditOptions): ChapterDraft {
    validateDraftReference(options);
    if (typeof options.body !== "string" || options.body.trim() === "") throw new ChapterWriteError(400, "正文不能为空");
    if (options.summary !== undefined && typeof options.summary !== "string") throw new ChapterWriteError(400, "修改说明必须是文字");
    const summary = options.summary?.trim() || "作者手动编辑正文";
    const requestFingerprint = stableFingerprint([options.chapter, options.draftId, options.revisionToken, options.body, summary]);
    const previous = this.receipt(options.requestId, requestFingerprint);
    if (previous !== undefined) return previous;
    const source = this.source(options);
    return this.create(options, source, summary, "manual", null, requestFingerprint);
  }

  correct(options: DraftCorrectionOptions): ChapterDraft {
    validateDraftReference(options);
    if (typeof options.summary !== "string" || !options.summary.trim()) throw new ChapterWriteError(400, "请说明纠正哪处记录及原因");
    const requestFingerprint = stableFingerprint(["structure", options.chapter, options.draftId, options.revisionToken, options.changes, options.summary.trim()]);
    const previous = this.receipt(options.requestId, requestFingerprint);
    if (previous !== undefined) return previous;
    const source = this.source(options);
    if (source.declaration === null) throw new ChapterWriteError(409, "尚无结构记录，请先完成结构核对");
    const input = buildChapterReviewInput(this.session.chapterSource(source.status === "adopted" ? undefined : source.writeContext?.proposalId), source.chapter);
    const declaration = correctDeclaration(source.declaration, options.changes, { ...input.parseContextBase, chapterText: source.body });
    return this.create({ ...options, body: source.body }, source, options.summary.trim(), "structure", declaration, requestFingerprint);
  }

  rewrite(options: DraftRewriteOptions): ChapterDraft {
    validateDraftReference(options);
    validateRewriteOptions(options);
    const fingerprint = stableFingerprint([options.mode, options.chapter, options.draftId, options.revisionToken, options.instruction.trim(), options.scope]);
    const previous = this.receipt(options.requestId, fingerprint);
    if (previous !== undefined) return previous;
    const source = this.source(options);
    const generation = prepareGeneration(options, source);
    this.writer.prepareModelTask();
    const draft = this.create({ ...options, body: source.body }, source, generation.instruction, options.mode === "continue" ? "continuation" : "model", null, fingerprint, generation);
    return this.writer.start({ chapter: draft.chapter, draftId: draft.draftId });
  }

  private receipt(requestId: string | undefined, fingerprint: string): ChapterDraft | undefined {
    if (requestId === undefined) return undefined;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) throw new ChapterWriteError(400, "requestId 格式无效");
    const previous = this.session.allDrafts().find(draft => draft.revision?.requestId === requestId);
    if (previous !== undefined && previous.revision?.requestFingerprint !== fingerprint) throw new ChapterWriteError(409, "修改请求编号已用于其他内容，请查看原结果");
    return previous;
  }

  private create(options: DraftEditOptions, source: ChapterDraft, summary: string, kind: DraftRevision["kind"], declaration: C5Declaration | null, requestFingerprint?: string, generation?: DraftGeneration): ChapterDraft {
    const proposalId = source.status === "adopted" ? undefined : source.writeContext?.proposalId;
    const basis = this.session.chapterSource(proposalId);
    const maxOutputTokens = source.writeContext?.maxOutputTokens;
    const input = generation === undefined ? buildChapterReviewInput(basis, source.chapter) : buildChapterRunInput(basis, source.chapter, maxOutputTokens === undefined ? {} : { maxOutputTokens });
    const fingerprint = chapterInputFingerprint(basis, source.chapter);
    const now = new Date().toISOString();
    // 导入原文基线可能仍在同一文件事务中，目录扫描尚不可见。
    const nextId = this.store.nextDraftId(source.chapter);
    const draftId = nextId === source.draftId ? `ch${source.chapter}d${Number(source.draftId.split("d")[1]) + 1}` : nextId;
    const draft: ChapterDraft = {
      chapter: source.chapter, draftId, status: generation === undefined ? "pending_check" : "writing",
      body: options.body, declaration, findings: [], acceptable: false, error: null,
      proposals: source.proposals.filter((_, index) => !source.proposalAdoption?.selected.includes(index)), session: generation === undefined ? authoredSession(input) : null,
      ...(generation === undefined ? {} : { generation }),
      writeContext: { fingerprint,
        ...(this.session.readCurrentChapterText(source.chapter) === undefined ? {} : { formalSourceToken: stableFingerprint(this.session.readCurrentChapterText(source.chapter)) }),
        ...(proposalId === undefined ? {} : { proposalId }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) },
      revision: { kind, sourceDraftId: source.draftId, sourceToken: options.revisionToken, summary,
        rebased: source.status === "stale" || (source.status !== "adopted" && (source.baseVersion !== this.store.workVersion() || (source.writeContext !== undefined && source.writeContext.fingerprint !== fingerprint))),
        ...(generation === undefined ? {} : { scope: generation.range }),
        ...(options.requestId === undefined ? {} : { requestId: options.requestId }),
        ...(requestFingerprint === undefined ? {} : { requestFingerprint }) },
      baseVersion: this.store.workVersion(), baseAdoptedThrough: this.session.currentChapter,
      createdAt: now, updatedAt: now,
    };
    this.store.saveDraft(draft);
    return draft;
  }

  private source(options: DraftReference): ChapterDraft {
    const source = this.store.loadDraft(options.chapter, options.draftId);
    if (source === undefined) throw new ChapterWriteError(404, "源稿不存在");
    this.writer.assertNotRunning(options.chapter, options.draftId);
    if (source.status === "discarded") throw new ChapterWriteError(409, "此稿已丢弃，请从保留的当前版本继续");
    if (draftRevisionToken(source) !== options.revisionToken) throw new ChapterWriteError(409, "源稿已变化，请同步最新结果后重新提交修改");
    // 早章返修在「跨多章返修」这一批解锁：改完采用时会算出受影响的后续章并落清单，
    // 未处理的硬矛盾挡住连写。挡在这里反而让作者无从改起。
    if (source.chapter > this.session.nextChapter) throw new ChapterWriteError(409, "这一章还没写到，不能在它上面返修");
    if (source.status === "adopted" && this.session.currentAdoptedDraftId(source.chapter) !== source.draftId) throw new ChapterWriteError(409, "当前正式章节已采用其他版本，请先打开最新正式版本");
    return source;
  }
}
