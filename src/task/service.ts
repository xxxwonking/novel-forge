/**
 * 章节任务服务（Stage 1）：驱动 LangGraph 章节图、把每步产物落成草稿、支持恢复。
 *
 * 恢复模型（见计划「集成原则」③④）：
 *   - runInput 含函数（allocateForeshadowId）与 Set，不可 JSON 化 ⇒ **不持久化**，
 *     run/resume 都由调用方传入（项目状态确定，可重建）。
 *   - C4 会话另存进 `draft.session`（可 JSON），resume 据此重建 C5 同会话第二轮。
 *   - 跨重启恢复靠草稿这份领域产物：状态机在哪一步，从草稿字段即可判定并从缺步重入。
 */

import type { ModelClient } from "../client/model.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import type { ChapterNo } from "../types/primitives.js";
import { DraftStore } from "./draft-store.js";
import {
  buildChapterGraph,
  initialGraphState,
  type ChapterGraphState,
  type WriteOk,
} from "./graph.js";
import type { ToolContext } from "./tool-exec.js";
import { draftStage, emptyUsage, type TaskControl } from "./execution.js";
import { checkPromisedResolutions, crossCheckC5 } from "../chapter/c5-crosscheck.js";
import type {
  ChapterDraft,
  ChapterDraftStatus,
  DraftId,
  DraftProposal,
  DraftWriteContext,
} from "./types.js";

/** 工具的读侧来源（= ToolContext 去掉 onPropose）。服务按草稿注入 onPropose。 */
export type ToolReadSource = Omit<ToolContext, "onPropose">;

export interface ChapterTaskServiceDeps {
  /** 已有声明的纯代码重检不依赖模型。 */
  readonly client?: ModelClient;
  readonly draftStore: DraftStore;
  readonly readSource: ToolReadSource;
  /** rules.task.maxToolIterations。 */
  readonly maxToolRounds: number;
  readonly clock?: () => string;
  readonly control?: TaskControl;
}

interface DraftIdentity {
  readonly chapter: ChapterNo;
  readonly draftId: DraftId;
  readonly baseVersion: number;
  readonly baseAdoptedThrough: ChapterNo;
  readonly createdAt: string;
  readonly writeContext?: DraftWriteContext;
  readonly execution?: ChapterDraft["execution"];
  readonly revision?: ChapterDraft["revision"];
  readonly review?: ChapterDraft["review"];
}

export class ChapterTaskService {
  constructor(private readonly deps: ChapterTaskServiceDeps) {}

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))();
  }

  private makeCtx(seed: readonly DraftProposal[]): { ctx: ToolContext; proposals: DraftProposal[] } {
    const proposals: DraftProposal[] = [...seed];
    const ctx: ToolContext = { ...this.deps.readSource, onPropose: (p) => proposals.push(p) };
    return { ctx, proposals };
  }

  /** 新起一章任务：跑 write→declare→check，每步落草稿，返回最终草稿。 */
  async run(runInput: ChapterRunInput, writeContext?: DraftWriteContext): Promise<ChapterDraft> {
    const { chapter } = runInput;
    const draftId = this.deps.draftStore.nextDraftId(chapter);
    const identity: DraftIdentity = {
      chapter,
      draftId,
      baseVersion: this.deps.draftStore.workVersion(),
      baseAdoptedThrough: Math.max(0, chapter - 1),
      createdAt: this.now(),
      ...(writeContext === undefined ? {} : { writeContext }),
    };
    return this.drive(initialGraphState(runInput), identity, []);
  }

  /**
   * 恢复一份未完成草稿：从草稿重建初始态，图内节点自动跳过已完成的步骤。
   * `runInput` 由调用方按当前项目重建；C4 会话则从 `draft.session` 恢复。
   */
  async resume(runInput: ChapterRunInput, draftId: DraftId, writeContext?: DraftWriteContext): Promise<ChapterDraft> {
    const { chapter } = runInput;
    const draft = this.deps.draftStore.loadDraft(chapter, draftId);
    if (draft === undefined) throw new Error(`草稿不存在：ch${chapter}/${draftId}`);
    if (draft.status === "adopted" || draft.status === "discarded") return draft;

    const context = writeContext ?? draft.writeContext;
    const identity: DraftIdentity = {
      chapter,
      draftId,
      baseVersion: draft.baseVersion,
      baseAdoptedThrough: draft.baseAdoptedThrough,
      createdAt: draft.createdAt,
      ...(draft.execution === undefined ? {} : { execution: draft.execution }),
      ...(draft.revision === undefined ? {} : { revision: draft.revision }),
      ...(draft.review === undefined ? {} : { review: draft.review }),
      ...(context === undefined ? {} : { writeContext: context }),
    };
    return this.drive(stateFromDraft(draft, runInput), identity, draft.proposals);
  }

  listDrafts(chapter: ChapterNo): readonly ChapterDraft[] {
    return this.deps.draftStore.listDrafts(chapter);
  }

  getDraft(chapter: ChapterNo, draftId: DraftId): ChapterDraft | undefined {
    return this.deps.draftStore.loadDraft(chapter, draftId);
  }

  private async drive(
    initial: ChapterGraphState,
    identity: DraftIdentity,
    seedProposals: readonly DraftProposal[],
  ): Promise<ChapterDraft> {
    const { ctx, proposals } = this.makeCtx(seedProposals);
    const usage = { ...emptyUsage(), ...identity.execution?.usage };
    usage.unmeasuredCalls += usage.pendingCalls;
    usage.pendingCalls = 0;
    let last = this.draftFromState(identity, initial);
    const save = (draft: ChapterDraft): ChapterDraft => {
      const request = this.deps.control?.requested;
      const status = draft.status === "ready" || draft.status === "needs_revision" ? "completed"
        : draft.status === "failed" ? "failed" : request === "pause" ? "pausing" : request === "end" ? "ending" : "running";
      last = { ...draft, execution: {
        status, stage: draftStage(draft), startedAt: identity.execution?.startedAt ?? identity.createdAt,
        updatedAt: this.now(), usage: { ...usage },
      } };
      this.deps.draftStore.saveDraft(last);
      return last;
    };
    // 启动响应返回前先落初始任务，页面刷新可以立即找到相同 draftId。
    save(last);
    const client: ModelClient = {
      official: this.deps.client?.official ?? false,
      ...(this.deps.client?.conversationKey === undefined ? {} : { conversationKey: this.deps.client.conversationKey }),
      call: async (options) => {
        if (this.deps.control?.requested != null) throw new Error("任务已请求停止，不再发起新的模型请求");
        if (this.deps.client === undefined) throw new Error("当前步骤需要模型，请先配置写作模型再恢复任务");
        usage.calls++;
        usage.pendingCalls++;
        save(last);
        let result: Awaited<ReturnType<ModelClient["call"]>>;
        try {
          result = await this.deps.client.call(options);
        } catch (error) { usage.pendingCalls--; usage.unmeasuredCalls++; throw error; }
        usage.pendingCalls--;
        if (result.kind === "error") usage.unmeasuredCalls++;
        else {
          const measured = result.message.usage;
          usage.inputTokens += measured.input_tokens + (measured.cache_read_input_tokens ?? 0) + (measured.cache_creation_input_tokens ?? 0);
          usage.outputTokens += measured.output_tokens;
        }
        save(last);
        return result;
      },
    };
    const graph = buildChapterGraph({
      client,
      ctx,
      maxToolRounds: this.deps.maxToolRounds,
      collectedProposals: () => [...proposals],
      stopRequested: () => this.deps.control?.requested ?? null,
      onState: (state) => { save(this.draftFromState(identity, state)); },
    });

    try {
      await graph.invoke(initial, { configurable: { thread_id: identity.draftId } });
    } catch (error) {
      if (this.deps.control?.requested == null) {
        const step = draftStage(last) === "writing" ? "C4" : draftStage(last) === "declaring" ? "C5" : "C6";
        save({ ...last, status: "failed", acceptable: false, error: { step, detail: error instanceof Error ? error.message : String(error) } });
      }
    }
    const request = this.deps.control?.requested;
    if (request != null && last.execution?.status !== "completed") {
      last = { ...last, execution: { ...last.execution!, status: request === "pause" ? "paused" : "ended", usage: { ...usage }, updatedAt: this.now() } };
      this.deps.draftStore.saveDraft(last);
    }
    return last;
  }

  private draftFromState(identity: DraftIdentity, state: ChapterGraphState): ChapterDraft {
    return {
      chapter: identity.chapter,
      draftId: identity.draftId,
      status: statusFromState(state),
      body: state.body,
      declaration: state.declaration,
      findings: state.findings,
      acceptable: state.acceptable,
      proposals: state.proposals,
      session: sessionFromWrite(state.write),
      ...(identity.writeContext === undefined ? {} : { writeContext: identity.writeContext }),
      ...(identity.revision === undefined ? {} : { revision: identity.revision }),
      ...(identity.review === undefined ? {} : { review: identity.review }),
      baseVersion: identity.baseVersion,
      baseAdoptedThrough: identity.baseAdoptedThrough,
      error: refusalOrError(state),
      createdAt: identity.createdAt,
      updatedAt: this.now(),
    };
  }
}

// ── 状态映射 ──────────────────────────────────────────────────────────────

function statusFromState(state: ChapterGraphState): ChapterDraftStatus {
  switch (state.outcome) {
    case "ready":
      return "ready";
    case "needs_revision":
      return "needs_revision";
    case "failed":
    case "refused":
      return "failed";
    case "paused":
    case "ended":
    case null:
      if (state.declaration !== null) return "checking";
      return state.write === null ? "writing" : "declaring";
  }
}

function refusalOrError(state: ChapterGraphState): ChapterDraft["error"] {
  if (state.error !== null) return state.error;
  if (state.outcome === "refused" && state.refusalMessage !== null) {
    return { step: "C4", detail: state.refusalMessage };
  }
  return null;
}

function sessionFromWrite(write: WriteOk | null): ChapterDraft["session"] {
  if (write === null) return null;
  return {
    system: write.req.system,
    tools: write.req.tools,
    messages: write.sessionMessages,
    c4Response: write.c4Response,
  };
}

/**
 * 从草稿重建图初始态。`write` 由 `draft.session` 还原（req.messages/segmentTokens
 * 对声明步无用，填占位）；`c5Findings` 基于当前正文、声明和承诺重新计算。
 * outcome 归零让节点从缺步继续。
 */
function stateFromDraft(draft: ChapterDraft, runInput: ChapterRunInput): ChapterGraphState {
  const write: WriteOk | null =
    draft.session === null
      ? null
      : {
          kind: "ok",
          body: draft.body,
          req: {
            tools: draft.session.tools,
            system: draft.session.system,
            messages: [],
            segmentTokens: [0, 0, 0, 0, 0],
          },
          c4Response: draft.session.c4Response,
          sessionMessages: draft.session.messages,
          hitToolCap: false,
        };
  return {
    runInput,
    write,
    body: draft.body,
    declaration: draft.declaration,
    c5Findings: draft.declaration === null ? [] : [
      ...crossCheckC5({ declaration: draft.declaration, chapterText: draft.body }),
      ...checkPromisedResolutions(draft.declaration, runInput.promisedResolutions),
    ],
    findings: draft.findings,
    acceptable: draft.acceptable,
    proposals: draft.proposals,
    outcome: null,
    error: null,
    refusalMessage: null,
  };
}
