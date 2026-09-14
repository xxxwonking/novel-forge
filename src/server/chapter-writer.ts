/** 一个作品会话内的写章协调：装配、去重、恢复和输入变化保护。 */
import { createModelClient } from "../client/create.js";
import type { ModelClient } from "../client/model.js";
import { ChapterTaskService } from "../task/service.js";
import type { DraftStore } from "../task/draft-store.js";
import type { ChapterDraft, ChapterTaskView, DraftId } from "../task/types.js";
import { taskView, type TaskControl } from "../task/execution.js";
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
  start(options: ChapterWriteOptions): ChapterDraft {
    const operation = this.write(options);
    // 失败步骤由服务写入草稿；启动端点不持有长连接，也不产生未处理的拒绝。
    void operation.catch(() => undefined);
    const draft = this.receipt(options) ?? (this.active === null ? this.findDraft({ ...options, newDraft: false })
      : this.drafts.loadDraft(this.active.request.chapter, this.active.draftId));
    if (draft === undefined) throw new ChapterWriteError(503, "任务未能保存，请检查作品目录后重试");
    return draft;
  }

  tasks(): readonly ChapterTaskView[] {
    return this.session.allDrafts().map((draft) => taskView(draft,
      this.active?.request.chapter === draft.chapter && this.active.draftId === draft.draftId));
  }

  control(chapter: ChapterNo, draftId: DraftId, action: "pause" | "end"): ChapterTaskView {
    validateChapterNumber(chapter);
    if (!new RegExp(`^ch${chapter}d[1-9]\\d*$`, "u").test(draftId)) throw new ChapterWriteError(400, "draftId 必须是本章的草稿编号");
    const draft = this.drafts.loadDraft(chapter, draftId);
    if (draft === undefined) throw new ChapterWriteError(404, "任务不存在");
    const active = this.active?.request.chapter === chapter && this.active.draftId === draftId ? this.active : null;
    const view = taskView(draft, active !== null);
    if (view.status === "completed" || view.status === "ended") return view;
    if (active !== null && active.control.requested !== "end") active.control.requested = action;
    const { chapter: _chapter, draftId: _id, draftStatus: _status, words: _words, detail: _detail, ...execution } = view;
    const status = active === null ? action === "pause" ? "paused" : "ended"
      : active.control.requested === "end" ? "ending" : "pausing";
    const next: ChapterDraft = { ...draft, execution: { ...execution, status, updatedAt: new Date().toISOString() } };
    this.drafts.saveDraft(next);
    return taskView(next, active !== null);
  }

  write(options: ChapterWriteOptions): Promise<ChapterDraft> {
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

    const receipt = this.receipt(options);
    if (receipt !== undefined) {
      return this.active?.draftId === receipt.draftId ? this.active.promise : Promise.resolve(receipt);
    }

    if (this.active !== null) {
      const running = this.active;
      const same = running.request.chapter === options.chapter &&
        (options.draftId === undefined || options.draftId === running.draftId) &&
        (options.newDraft !== true || running.request.newDraft === true) &&
        (options.newDraft !== true || options.requestId === undefined || options.requestId === running.request.requestId) &&
        (options.proposalId === undefined || options.proposalId === running.request.proposalId) &&
        (options.maxOutputTokens === undefined || options.maxOutputTokens === running.request.maxOutputTokens);
      if (same) return running.promise;
      throw new ChapterWriteError(409, `第 ${running.request.chapter} 章正在生成，请先等待当前任务完成`);
    }

    const draft = this.findDraft(options);
    if (draft !== undefined && options.proposalId !== undefined && options.proposalId !== draft.writeContext?.proposalId) {
      throw new ChapterWriteError(409, "当前草稿依赖另一份资料；切换方案时请明确另写一版");
    }
    if (draft?.status === "adopted" || draft?.status === "discarded") return Promise.resolve(draft);
    if (draft?.execution?.status === "ended") throw new ChapterWriteError(409, "本次任务已结束；已有结果仍保留，继续创作请明确另起任务");
    if (options.chapter !== this.session.nextChapter && options.chapter !== this.session.currentChapter) {
      throw new ChapterWriteError(409, `当前可写第 ${this.session.nextChapter} 章，或为最新已采用章另建版本；请先处理当前章节`);
    }
    if (draft !== undefined) {
      this.assertFresh(draft);
      if (draft.status === "ready" || draft.status === "needs_revision") return Promise.resolve(draft);
    }

    const maxOutputTokens = options.maxOutputTokens ?? draft?.writeContext?.maxOutputTokens;
    const proposalId = options.proposalId ?? draft?.writeContext?.proposalId;
    const source = this.session.chapterSource(proposalId);
    const input = buildChapterRunInput(source, options.chapter, maxOutputTokens === undefined ? {} : { maxOutputTokens });
    const fingerprint = chapterInputFingerprint(source, options.chapter);
    const readSource = buildChapterReadSource(source, options.chapter);
    if (this.client === undefined) {
      try { this.client = createModelClient(); }
      catch (error) {
        throw new ChapterWriteError(503, `写章模型尚未配置：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const control: TaskControl = { requested: null };
    const service = new ChapterTaskService({ client: this.client, draftStore: this.drafts, readSource, control, maxToolRounds: this.session.rules.task.maxToolIterations });
    const requestId = draft?.writeContext?.requestId ?? options.requestId;
    const context = { fingerprint, ...(requestId === undefined ? {} : { requestId }), ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }), ...(proposalId === undefined ? {} : { proposalId }) };
    const draftId = draft?.draftId ?? this.drafts.nextDraftId(options.chapter);
    const operation = draft === undefined ? service.run(input, context) : service.resume(input, draftId, context);
    const promise = operation.then((result) => {
      // 其他写接口在 await 期间可以修改作品；不要让图的末次保存覆盖过期标记。
      if (this.basisChanged(result)) {
        return this.markStale(result);
      }
      return result;
    }).finally(() => { this.active = null; });
    this.active = { request: { ...options, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }), ...(proposalId === undefined ? {} : { proposalId }) }, draftId, promise, control };
    return promise;
  }

  assertFresh(draft: ChapterDraft): void {
    if (draft.status === "adopted") return;
    const changed = this.basisChanged(draft);
    if (draft.status === "stale" || changed) {
      if (draft.status !== "stale") this.markStale(draft);
      throw new ChapterWriteError(409, "作品资料、节拍或已采用版本发生变化，请核对后另写一版草稿");
    }
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
    if (this.active?.request.chapter === chapter && this.active.draftId === draftId) {
      throw new ChapterWriteError(409, "草稿正在生成，请等待当前任务完成后再丢弃");
    }
  }

  private findDraft(options: ChapterWriteOptions): ChapterDraft | undefined {
    if (options.draftId !== undefined) {
      const draft = this.drafts.loadDraft(options.chapter, options.draftId);
      if (draft === undefined) throw new ChapterWriteError(404, `草稿不存在：ch${options.chapter}/${options.draftId}`);
      return draft;
    }
    if (options.newDraft === true) return undefined;
    const latest = this.drafts.latestDraft(options.chapter);
    return latest?.status === "discarded" ? undefined : latest;
  }

  private receipt(options: ChapterWriteOptions): ChapterDraft | undefined {
    if (options.requestId === undefined) return undefined;
    const prior = this.session.allDrafts().find((draft) => draft.writeContext?.requestId === options.requestId);
    if (prior !== undefined && (prior.chapter !== options.chapter ||
      (options.draftId !== undefined && options.draftId !== prior.draftId) ||
      (options.proposalId !== undefined && options.proposalId !== prior.writeContext?.proposalId) ||
      (options.maxOutputTokens !== undefined && options.maxOutputTokens !== prior.writeContext?.maxOutputTokens))) {
      throw new ChapterWriteError(409, "请求编号已用于另一组写章参数，请检查原任务");
    }
    return prior;
  }

  private markStale(draft: ChapterDraft): ChapterDraft {
    const stale: ChapterDraft = { ...draft, status: "stale", acceptable: false, updatedAt: new Date().toISOString() };
    this.drafts.saveDraft(stale);
    return stale;
  }
}
