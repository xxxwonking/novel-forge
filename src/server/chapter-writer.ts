/** 一个作品会话内的写章协调：装配、去重、恢复和输入变化保护。 */
import { createModelClient } from "../client/create.js";
import type { ModelClient } from "../client/model.js";
import { ChapterTaskService } from "../task/service.js";
import type { DraftStore } from "../task/draft-store.js";
import type { ChapterDraft, DraftId } from "../task/types.js";
import type { ChapterNo } from "../types/primitives.js";
import type { ProjectSession } from "./state.js";
import {
  buildChapterRunInput, buildChapterReadSource, chapterInputFingerprint,
  ChapterWriteError, validateChapterNumber, type ChapterInputOptions,
} from "./chapter-input.js";

export interface ChapterWriteOptions extends ChapterInputOptions {
  readonly chapter: ChapterNo;
  readonly draftId?: DraftId;
  readonly newDraft?: boolean;
}

export interface ChapterWriterOptions {
  /** 测试/嵌入时注入；生产环境在首次写章时读取环境变量。 */
  readonly client?: ModelClient;
}

interface ActiveWrite {
  readonly request: ChapterWriteOptions;
  readonly draftId: DraftId;
  readonly promise: Promise<ChapterDraft>;
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

  write(options: ChapterWriteOptions): Promise<ChapterDraft> {
    validateChapterNumber(options.chapter);
    if (options.draftId !== undefined && !new RegExp(`^ch${options.chapter}d[1-9]\\d*$`, "u").test(options.draftId)) {
      throw new ChapterWriteError(400, "draftId 必须是本章的草稿编号");
    }
    if (options.draftId !== undefined && options.newDraft === true) {
      throw new ChapterWriteError(400, "恢复草稿与另建版本不能同时请求");
    }
    if (options.maxOutputTokens !== undefined && (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1)) {
      throw new ChapterWriteError(400, "maxOutputTokens 必须是正整数");
    }

    if (this.active !== null) {
      const running = this.active;
      const same = running.request.chapter === options.chapter &&
        (options.draftId === undefined || options.draftId === running.draftId) &&
        (options.newDraft !== true || running.request.newDraft === true) &&
        (options.maxOutputTokens === undefined || options.maxOutputTokens === running.request.maxOutputTokens);
      if (same) return running.promise;
      throw new ChapterWriteError(409, `第 ${running.request.chapter} 章正在生成，请先等待当前任务完成`);
    }

    const draft = this.findDraft(options);
    if (draft?.status === "adopted" || draft?.status === "discarded") return Promise.resolve(draft);
    if (options.chapter !== this.session.nextChapter && options.chapter !== this.session.currentChapter) {
      throw new ChapterWriteError(409, `当前可写第 ${this.session.nextChapter} 章，或为最新已采用章另建版本；请先处理当前章节`);
    }
    if (draft !== undefined) {
      this.assertFresh(draft);
      if (draft.status === "ready" || draft.status === "needs_revision") return Promise.resolve(draft);
    }

    const maxOutputTokens = options.maxOutputTokens ?? draft?.writeContext?.maxOutputTokens;
    const input = buildChapterRunInput(this.session, options.chapter, maxOutputTokens === undefined ? {} : { maxOutputTokens });
    const fingerprint = chapterInputFingerprint(this.session, options.chapter);
    const readSource = buildChapterReadSource(this.session, options.chapter);
    if (this.client === undefined) {
      try { this.client = createModelClient(); }
      catch (error) {
        throw new ChapterWriteError(503, `写章模型尚未配置：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const service = new ChapterTaskService({ client: this.client, draftStore: this.drafts, readSource, maxToolRounds: this.session.rules.task.maxToolIterations });
    const context = { fingerprint, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) };
    const draftId = draft?.draftId ?? this.drafts.nextDraftId(options.chapter);
    const operation = draft === undefined ? service.run(input, context) : service.resume(input, draftId, context);
    const promise = operation.then((result) => {
      // 其他写接口在 await 期间可以修改作品；不要让图的末次保存覆盖过期标记。
      if (result.baseVersion !== this.drafts.workVersion() || fingerprint !== chapterInputFingerprint(this.session, options.chapter)) {
        return this.markStale(result);
      }
      return result;
    }).finally(() => { this.active = null; });
    this.active = { request: { ...options, ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }) }, draftId, promise };
    return promise;
  }

  assertFresh(draft: ChapterDraft): void {
    if (draft.status === "adopted") return;
    const changed = draft.baseVersion !== this.drafts.workVersion() ||
      (draft.writeContext !== undefined && draft.writeContext.fingerprint !== chapterInputFingerprint(this.session, draft.chapter));
    if (draft.status === "stale" || changed) {
      if (draft.status !== "stale") this.markStale(draft);
      throw new ChapterWriteError(409, "作品资料、节拍或已采用版本发生变化，请核对后另写一版草稿");
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

  private markStale(draft: ChapterDraft): ChapterDraft {
    const stale: ChapterDraft = { ...draft, status: "stale", acceptable: false, updatedAt: new Date().toISOString() };
    this.drafts.saveDraft(stale);
    return stale;
  }
}
