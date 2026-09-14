/** 修订只交付新候选；采用和后台检查继续复用既有业务入口。 */
import { createHash } from "node:crypto";
import type { DraftStore } from "../task/draft-store.js";
import type { ChapterDraft } from "../task/types.js";
import { authoredSession, draftRevisionToken } from "../task/revision.js";
import { buildChapterRunInput, chapterInputFingerprint, ChapterWriteError, validateChapterNumber } from "./chapter-input.js";
import type { ProjectSession } from "./state.js";
import type { ChapterWriter } from "./chapter-writer.js";
import { correctDeclaration, type StructureCorrection } from "../chapter/c5-correction.js";
import type { C5Declaration } from "../types/events.js";

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

  edit(options: DraftEditOptions): ChapterDraft {
    validateDraftReference(options);
    if (typeof options.body !== "string" || options.body.trim() === "") throw new ChapterWriteError(400, "正文不能为空");
    if (options.summary !== undefined && typeof options.summary !== "string") throw new ChapterWriteError(400, "修改说明必须是文字");
    const summary = options.summary?.trim() || "作者手动编辑正文";
    const requestFingerprint = createHash("sha256").update(JSON.stringify([options.chapter, options.draftId, options.revisionToken, options.body, summary])).digest("hex");
    const previous = this.receipt(options.requestId, requestFingerprint);
    if (previous !== undefined) return previous;
    const source = this.source(options);
    return this.create(options, source, summary, "manual", null, requestFingerprint);
  }

  correct(options: DraftCorrectionOptions): ChapterDraft {
    validateDraftReference(options);
    if (typeof options.summary !== "string" || !options.summary.trim()) throw new ChapterWriteError(400, "请说明纠正哪处记录及原因");
    const requestFingerprint = createHash("sha256").update(JSON.stringify(["structure", options.chapter, options.draftId, options.revisionToken, options.changes, options.summary.trim()])).digest("hex");
    const previous = this.receipt(options.requestId, requestFingerprint);
    if (previous !== undefined) return previous;
    const source = this.source(options);
    if (source.declaration === null) throw new ChapterWriteError(409, "尚无结构记录，请先完成结构核对");
    const input = buildChapterRunInput(this.session.chapterSource(source.status === "adopted" ? undefined : source.writeContext?.proposalId), source.chapter);
    const declaration = correctDeclaration(source.declaration, options.changes, { ...input.parseContextBase, chapterText: source.body });
    return this.create({ ...options, body: source.body }, source, options.summary.trim(), "structure", declaration, requestFingerprint);
  }

  private receipt(requestId: string | undefined, fingerprint: string): ChapterDraft | undefined {
    if (requestId === undefined) return undefined;
    if (typeof requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(requestId)) throw new ChapterWriteError(400, "requestId 格式无效");
    const previous = this.session.allDrafts().find(draft => draft.revision?.requestId === requestId);
    if (previous !== undefined && previous.revision?.requestFingerprint !== fingerprint) throw new ChapterWriteError(409, "修改请求编号已用于其他内容，请查看原结果");
    return previous;
  }

  private create(options: DraftEditOptions, source: ChapterDraft, summary: string, kind: "manual" | "structure", declaration: C5Declaration | null, requestFingerprint?: string): ChapterDraft {
    const proposalId = source.status === "adopted" ? undefined : source.writeContext?.proposalId;
    const basis = this.session.chapterSource(proposalId);
    const maxOutputTokens = source.writeContext?.maxOutputTokens;
    const input = buildChapterRunInput(basis, source.chapter, maxOutputTokens === undefined ? {} : { maxOutputTokens });
    const now = new Date().toISOString();
    const draft: ChapterDraft = {
      chapter: source.chapter, draftId: this.store.nextDraftId(source.chapter), status: "pending_check",
      body: options.body, declaration, findings: [], acceptable: false, error: null,
      proposals: source.proposals, session: authoredSession(input),
      writeContext: { fingerprint: chapterInputFingerprint(basis, source.chapter),
        ...(proposalId === undefined ? {} : { proposalId }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) },
      revision: { kind, sourceDraftId: source.draftId, sourceToken: options.revisionToken, summary,
        rebased: source.status === "stale" || (source.status !== "adopted" && source.baseVersion !== this.store.workVersion()),
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
    if (source.chapter !== this.session.currentChapter && source.chapter !== this.session.nextChapter) throw new ChapterWriteError(409, "首版支持当前未采用稿和最新已采用章；更早章节需先分析后续影响，不能直接返修");
    if (source.status === "adopted" && this.session.currentAdoptedDraftId(source.chapter) !== source.draftId) throw new ChapterWriteError(409, "当前正式章节已采用其他版本，请先打开最新正式版本");
    return source;
  }
}
