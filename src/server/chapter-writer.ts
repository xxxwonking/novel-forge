/** 一个作品会话内的写章协调：装配、去重、恢复和输入变化保护。 */
import { createModelClient } from "../client/create.js";
import type { ModelClient } from "../client/model.js";
import { ChapterTaskService } from "../task/service.js";
import type { DraftStore } from "../task/draft-store.js";
import type { ChapterDraft, ChapterTaskView, DraftId } from "../task/types.js";
import { taskView, type TaskControl } from "../task/execution.js";
import { authoredSession, draftRevisionToken } from "../task/revision.js";
import { automaticRevisionLimit } from "../task/automatic-revision.js";
import { selectedProposalIndices } from "../task/proposals.js";
import { validateDraftReference, type DraftCheckOptions } from "./draft-revisions.js";
import type { ChapterNo } from "../types/primitives.js";
import type { ProjectSession } from "./state.js";
import {
  buildChapterRunInput, buildChapterReadSource, chapterInputFingerprint,
  ChapterWriteError, validateChapterNumber, type ChapterInputOptions,
} from "./chapter-input.js";

export interface ChapterWriteOptions extends ChapterInputOptions {
  readonly chapter: ChapterNo;
  readonly requestId?: string;
  readonly draftId?: DraftId;
  readonly newDraft?: boolean;
  readonly proposalId?: string;
}

export interface ChapterWriterOptions {
  /** 测试/嵌入时注入；生产环境在首次写章时读取环境变量。 */
  readonly client?: ModelClient;
}

interface ActiveWrite {
  readonly request: ChapterWriteOptions;
  readonly draftId: DraftId;
  readonly rootDraftId: DraftId;
  readonly promise: Promise<ChapterDraft>;
  readonly control: TaskControl;
}

export class ChapterWriter {
  private active: ActiveWrite | null = null;
  private client: ModelClient | undefined;

  constructor(
    private readonly session: ProjectSession,
    private readonly drafts: DraftStore,
    options: ChapterWriterOptions = {},
  ) {
    this.client = options.client;
  }

  /** 后台执行；同步准备和持久化已完成，调用方可立即跳到同一结果页。 */
  start(options: ChapterWriteOptions, followAutomatic = true): ChapterDraft {
    const operation = this.write(options, followAutomatic);
    // 失败步骤由服务写入草稿；启动端点不持有长连接，也不产生未处理的拒绝。
    void operation.catch(() => undefined);
    const draft = this.receipt(options, followAutomatic) ?? (this.active === null ? this.findDraft({ ...options, newDraft: false }, followAutomatic)
      : this.drafts.loadDraft(this.active.request.chapter, this.active.draftId));
    if (draft === undefined) throw new ChapterWriteError(503, "任务未能保存，请检查作品目录后重试");
    return draft;
  }

  tasks(): readonly ChapterTaskView[] {
    const drafts = this.session.allDrafts();
    const latest = new Map(drafts.filter(draft => draft.status !== "discarded").map(draft => [draft.chapter, draft.draftId]));
    return drafts.map((draft) => {
      const active = this.active?.request.chapter === draft.chapter && this.active.draftId === draft.draftId;
      return taskView(draft, active, !active && latest.get(draft.chapter) !== draft.draftId);
    });
  }

  /** 新的模型修订与写章共用活动任务及客户端，失败时不先创建另一份稿。 */
  prepareModelTask(): void {
    if (this.active !== null) throw new ChapterWriteError(409, "已有稿件正在执行，请先等待或暂停当前任务");
    this.ensureClient();
  }

  private ensureClient(): void {
    if (this.client !== undefined) return;
    try { this.client = createModelClient(); }
    catch (error) { throw new ChapterWriteError(503, `写章模型尚未配置：${error instanceof Error ? error.message : String(error)}`); }
  }

  /** 显式检查才启动执行；保存正文不会顺带调用模型。 */
  check(options: DraftCheckOptions): ChapterDraft {
    validateDraftReference(options);
    if (typeof options.adoptOnSuccess !== "boolean") throw new ChapterWriteError(400, "adoptOnSuccess 必须明确为 true 或 false");
    if (this.active !== null && (this.active.request.chapter !== options.chapter || this.active.draftId !== options.draftId)) {
      throw new ChapterWriteError(409, "已有其他稿件正在执行，请先等待或暂停该任务，再检查本稿");
    }
    const draft = this.drafts.loadDraft(options.chapter, options.draftId);
    if (draft === undefined) throw new ChapterWriteError(404, "草稿不存在");
    const selected = selectedProposalIndices(options.selectedProposals, draft.proposals.length);
    if (!options.adoptOnSuccess && selected.length > 0) throw new ChapterWriteError(400, "只检查不应用建议；请在明确采用时选择");
    if (draft.revision?.scopeAdvice) throw new ChapterWriteError(409, "这份结果仅包含修改范围建议，正文尚未修改；请先明确范围并生成新修订");
    if (draft.review?.requestToken === options.revisionToken && draft.review.adoptOnSuccess === options.adoptOnSuccess && JSON.stringify(draft.review.selectedProposals ?? []) === JSON.stringify(selected)) {
      return this.start({ chapter: options.chapter, draftId: options.draftId }, false);
    }
    this.assertNotRunning(options.chapter, options.draftId);
    if (draftRevisionToken(draft) !== options.revisionToken) throw new ChapterWriteError(409, "稿件已变化，请重新打开结果后检查");
    if (draft.status === "adopted" || draft.status === "discarded") throw new ChapterWriteError(409, "请先保存一份候选修订，再检查该版本");
    this.assertFresh(draft);
    if (!draft.body.trim()) throw new ChapterWriteError(409, "正文尚未完成，不能开始检查");
    if (draft.error?.step === "C4") throw new ChapterWriteError(409, "正文还不完整，请先继续完成或手动补全并保存新版本");
    const source = this.session.chapterSource(draft.writeContext?.proposalId);
    const input = buildChapterRunInput(source, draft.chapter);
    this.drafts.saveDraft({
      ...draft, status: "pending_check", error: null, acceptable: false, findings: [],
      session: draft.session ?? authoredSession(input),
      review: { adoptOnSuccess: options.adoptOnSuccess, requestToken: options.revisionToken, selectedProposals: selected },
      ...(draft.execution === undefined ? {} : { execution: { ...draft.execution, status: "waiting" } }),
      updatedAt: new Date().toISOString(),
    });
    return this.start({ chapter: options.chapter, draftId: options.draftId }, false);
  }

  control(chapter: ChapterNo, draftId: DraftId, action: "pause" | "end"): ChapterTaskView {
    validateChapterNumber(chapter);
    if (!new RegExp(`^ch${chapter}d[1-9]\\d*$`, "u").test(draftId)) throw new ChapterWriteError(400, "draftId 必须是本章的草稿编号");
    const saved = this.drafts.loadDraft(chapter, draftId);
    if (saved === undefined) throw new ChapterWriteError(404, "任务不存在");
    const draft = this.active?.draftId === draftId ? saved : this.followAutomatic(saved);
    draftId = draft.draftId;
    const active = this.active?.request.chapter === chapter && this.active.draftId === draftId ? this.active : null;
    const view = taskView(draft, active !== null);
    if (view.status === "completed" || view.status === "ended") return view;
    if (active !== null && active.control.requested !== "end") active.control.requested = action;
    const { chapter: _chapter, draftId: _id, draftStatus: _status, words: _words, detail: _detail, isHistory: _history,
      autoRevisionLimit: _limit, autoRevisionsUsed: _used, automaticResultDraftId: _result, ...execution } = view;
    const status = active === null ? action === "pause" ? "paused" : "ended"
      : active.control.requested === "end" ? "ending" : "pausing";
    const next: ChapterDraft = { ...draft, execution: { ...execution, status, updatedAt: new Date().toISOString() } };
    this.drafts.saveDraft(next);
    return taskView(next, active !== null);
  }

  write(options: ChapterWriteOptions, followAutomatic = true): Promise<ChapterDraft> {
    validateChapterNumber(options.chapter);
    if (options.requestId !== undefined && !/^[A-Za-z0-9_-]{1,128}$/u.test(options.requestId)) throw new ChapterWriteError(400, "requestId 格式无效");
    if (options.draftId !== undefined && !new RegExp(`^ch${options.chapter}d[1-9]\\d*$`, "u").test(options.draftId)) {
      throw new ChapterWriteError(400, "draftId 必须是本章的草稿编号");
    }
    if (options.draftId !== undefined && options.newDraft === true) {
      throw new ChapterWriteError(400, "恢复草稿与另建版本不能同时请求");
    }
    if (options.maxOutputTokens !== undefined && (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1)) {
      throw new ChapterWriteError(400, "maxOutputTokens 必须是正整数");
    }
    if (options.authorRequest !== undefined && (typeof options.authorRequest !== "string" || !options.authorRequest.trim())) {
      throw new ChapterWriteError(400, "authorRequest 必须是非空文本");
    }

    const receipt = this.receipt(options, followAutomatic);
    if (receipt !== undefined) {
      return this.active?.draftId === receipt.draftId ? this.active.promise : Promise.resolve(receipt);
    }

    if (this.active !== null) {
      const running = this.active;
      const same = running.request.chapter === options.chapter &&
        (options.draftId === undefined || options.draftId === running.draftId || (followAutomatic && options.draftId === running.rootDraftId)) &&
        (options.newDraft !== true || running.request.newDraft === true) &&
        (options.newDraft !== true || options.requestId === undefined || options.requestId === running.request.requestId) &&
        (options.proposalId === undefined || options.proposalId === running.request.proposalId) &&
        (options.maxOutputTokens === undefined || options.maxOutputTokens === running.request.maxOutputTokens) &&
        (options.authorRequest === undefined || options.authorRequest === running.request.authorRequest);
      if (same) return running.promise;
      throw new ChapterWriteError(409, `第 ${running.request.chapter} 章正在生成，请先等待当前任务完成`);
    }

    const draft = this.findDraft(options, followAutomatic);
    if (draft !== undefined && options.proposalId !== undefined && options.proposalId !== draft.writeContext?.proposalId) {
      throw new ChapterWriteError(409, "当前草稿依赖另一份资料；切换方案时请明确另写一版");
    }
    if (draft !== undefined && options.authorRequest !== undefined && options.authorRequest !== draft.writeContext?.authorRequest) {
      throw new ChapterWriteError(409, "已有稿件的写作要求已固定，本轮要求未覆盖原任务；请针对该稿修订或明确另写一版");
    }
    if (draft?.status === "adopted" || draft?.status === "discarded") return Promise.resolve(draft);
    if (draft?.execution?.status === "ended") throw new ChapterWriteError(409, "本次任务已结束；已有结果仍保留，继续创作请明确另起任务");
    if (options.chapter !== this.session.nextChapter && options.chapter !== this.session.currentChapter) {
      throw new ChapterWriteError(409, `当前可写第 ${this.session.nextChapter} 章，或为最新已采用章另建版本；请先处理当前章节`);
    }
    if (draft !== undefined) {
      this.assertFresh(draft);
      if (draft.status === "ready" || draft.status === "needs_revision") return Promise.resolve(this.finishAdoption(draft));
    }

    const maxOutputTokens = options.maxOutputTokens ?? draft?.writeContext?.maxOutputTokens;
    const proposalId = options.proposalId ?? draft?.writeContext?.proposalId;
    const authorRequest = draft?.writeContext?.authorRequest ?? options.authorRequest;
    const source = this.session.chapterSource(proposalId);
    const input = buildChapterRunInput(source, options.chapter, {
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
      ...(authorRequest === undefined ? {} : { authorRequest }),
    });
    const fingerprint = chapterInputFingerprint(source, options.chapter);
    const readSource = buildChapterReadSource(source, options.chapter);
    const needsModel = draft === undefined || draft.session === null || draft.declaration === null;
    if (needsModel) this.ensureClient();
    const control: TaskControl = { requested: null };
    const service = new ChapterTaskService({ ...(this.client === undefined ? {} : { client: this.client }), draftStore: this.drafts, readSource, control, maxToolRounds: this.session.rules.task.maxToolIterations,
      canBeginAutomaticRevision: saved => !this.basisChanged(saved),
      onDraftChanged: id => { if (this.active !== null) this.active = { ...this.active, draftId: id }; },
    });
    const requestId = draft?.writeContext?.requestId ?? options.requestId;
    const autoRevisionLimit = draft === undefined ? automaticRevisionLimit(this.session.rules.task.maxAutoRevisions)
      : draft.writeContext?.autoRevisionLimit ?? 0;
    const context = { fingerprint, autoRevisionLimit, ...(requestId === undefined ? {} : { requestId }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }), ...(proposalId === undefined ? {} : { proposalId }), ...(authorRequest === undefined ? {} : { authorRequest }) };
    const draftId = draft?.draftId ?? this.drafts.nextDraftId(options.chapter);
    const operation = draft === undefined ? service.run(input, context) : service.resume(input, draftId, context);
    const promise = operation.then((result) => {
      // 其他写接口在 await 期间可以修改作品；不要让图的末次保存覆盖过期标记。
      if (this.basisChanged(result)) {
        return this.markStale(result);
      }
      return result;
    }).finally(() => { this.active = null; }).then((result) => this.finishAdoption(result));
    this.active = { request: { ...options, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }), ...(proposalId === undefined ? {} : { proposalId }), ...(authorRequest === undefined ? {} : { authorRequest }) }, draftId,
      rootDraftId: draft?.revision?.kind === "automatic" ? draft.revision.sourceDraftId : draftId, promise, control };
    return promise;
  }

  assertFresh(draft: ChapterDraft): void {
    if (draft.status === "adopted") return;
    if (this.markStaleIfChanged(draft) !== null) {
      throw new ChapterWriteError(409, "作品资料、节拍或已采用版本发生变化，请核对后另写一版草稿");
    }
  }

  /** 依据已变（或早已标过）则落 stale 并返回该稿，否则返回 null。判据只此一处。 */
  markStaleIfChanged(draft: ChapterDraft): ChapterDraft | null {
    if (draft.status === "stale") return draft;
    if (!this.basisChanged(draft)) return null;
    return this.markStale(draft);
  }

  private basisChanged(draft: ChapterDraft): boolean {
    if (draft.baseVersion !== this.drafts.workVersion()) return true;
    if (draft.writeContext === undefined) return false;
    try {
      return draft.writeContext.fingerprint !== chapterInputFingerprint(this.session.chapterSource(draft.writeContext.proposalId), draft.chapter);
    } catch (error) {
      if (error instanceof ChapterWriteError && (error.status === 409 || error.status === 404)) return true;
      throw error;
    }
  }

  assertNotRunning(chapter: ChapterNo, draftId: DraftId): void {
    if (this.active?.request.chapter === chapter && (this.active.draftId === draftId || this.active.rootDraftId === draftId)) {
      throw new ChapterWriteError(409, "草稿正在执行，请先暂停并等待当前步骤保存后再修改或丢弃");
    }
  }

  private finishAdoption(draft: ChapterDraft): ChapterDraft {
    if (draft.status !== "ready" || draft.review?.adoptOnSuccess !== true) return draft;
    try {
      this.session.adopt(draft.chapter, draft.draftId, { revisionToken: draftRevisionToken(draft), selectedProposals: draft.review.selectedProposals ?? [] });
      return this.drafts.loadDraft(draft.chapter, draft.draftId)!;
    } catch (error) {
      // 采用入口可能已持久化过期状态；只能在最新版本上追加失败说明。
      const current = this.drafts.loadDraft(draft.chapter, draft.draftId) ?? draft;
      const retained: ChapterDraft = { ...current, review: { ...draft.review, ...current.review, adoptionError: error instanceof Error ? error.message : String(error) }, updatedAt: new Date().toISOString() };
      this.drafts.saveDraft(retained);
      return retained;
    }
  }

  private findDraft(options: ChapterWriteOptions, followAutomatic = true): ChapterDraft | undefined {
    if (options.draftId !== undefined) {
      const draft = this.drafts.loadDraft(options.chapter, options.draftId);
      if (draft === undefined) throw new ChapterWriteError(404, `草稿不存在：ch${options.chapter}/${options.draftId}`);
      return followAutomatic ? this.followAutomatic(draft) : draft;
    }
    if (options.newDraft === true) return undefined;
    const latest = this.drafts.latestDraft(options.chapter);
    return latest?.status === "discarded" ? undefined : latest;
  }

  private receipt(options: ChapterWriteOptions, followAutomatic = true): ChapterDraft | undefined {
    if (options.requestId === undefined) return undefined;
    const prior = this.session.allDrafts().find((draft) => draft.writeContext?.requestId === options.requestId);
    const result = prior === undefined || !followAutomatic ? prior : this.followAutomatic(prior);
    if (prior !== undefined && (prior.chapter !== options.chapter ||
      (options.draftId !== undefined && options.draftId !== prior.draftId && options.draftId !== result?.draftId) ||
      (options.proposalId !== undefined && options.proposalId !== prior.writeContext?.proposalId) ||
      (options.authorRequest !== undefined && options.authorRequest !== prior.writeContext?.authorRequest) ||
      (options.maxOutputTokens !== undefined && options.maxOutputTokens !== prior.writeContext?.maxOutputTokens))) {
      throw new ChapterWriteError(409, "请求编号已用于另一组写章参数，请检查原任务");
    }
    return result;
  }

  private followAutomatic(draft: ChapterDraft): ChapterDraft {
    const id = draft.automaticResultDraftId;
    if (id === undefined) return draft;
    if (!new RegExp(`^ch${draft.chapter}d[1-9]\\d*$`, "u").test(id)) throw new ChapterWriteError(409, "自动修订版本链接无效，原稿已保留");
    const result = this.drafts.loadDraft(draft.chapter, id);
    if (result === undefined || result.revision?.kind !== "automatic" || result.revision.sourceDraftId !== draft.draftId || result.automaticResultDraftId !== undefined) {
      throw new ChapterWriteError(409, "自动修订版本缺失或来源不符，请先核对保存结果");
    }
    return result;
  }

  private markStale(draft: ChapterDraft): ChapterDraft {
    const stale: ChapterDraft = { ...draft, status: "stale", acceptable: false, updatedAt: new Date().toISOString() };
    this.drafts.saveDraft(stale);
    return stale;
  }
}
