/**
 * 章节任务的 LangGraph 编排。
 *
 * 图只负责**步骤流转**：write → declare → check →(未过且还有修订额度)→ revise → declare …
 * 任一步失败/被拒即经条件边到 END。事件流不在这里碰（草稿在事件流之外，见 types.ts）；
 * 模型调用使用最小 ModelClient，由原生 Claude SDK 或 chat 客户端实现，不引 LangChain
 * 模型抽象。
 *
 * 恢复：节点带幂等跳过 —— resume 时 service 用草稿预填 `write`/`declaration`，
 * 已完成的步骤直接返回空更新，因此「C5 失败重试从声明起、不重跑 C4」成立。
 * 跨重启的持久化靠草稿（DraftStore），MemorySaver 只提供进程内的线程态。
 *
 * 自动修订（rules.task.maxAutoRevisions）：修订改的是正文，所以改完必须**退回声明步**
 * 重算 C5/C6 —— 直接重检会拿旧声明判新正文。修订前的正文存进 `revisions` 快照，
 * 供作者看新旧对比。修订调用本身失败时**不把草稿降级为 failed**：作者手里那份
 * needs_revision 的稿子仍然可用，把它作废是更坏的结果。
 */

import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { ModelClient } from "../client/model.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import {
  checkChapter,
  declareStructure,
  reviseChapterBody,
  writeChapterBody,
  type WriteResult,
} from "./steps.js";
import type { ToolContext } from "./tool-exec.js";
import type { C5Declaration } from "../types/events.js";
import type { GateFinding } from "../types/beat.js";
import type { ChapterTaskOutcome, DraftError, DraftProposal, DraftRevision } from "./types.js";

export type WriteOk = Extract<WriteResult, { kind: "ok" }>;

export interface ChapterGraphDeps {
  readonly client: ModelClient;
  readonly ctx: ToolContext;
  /** 工具循环步数上限（rules.task.maxToolIterations）。 */
  readonly maxToolRounds: number;
  /** 自动修订次数上限（rules.task.maxAutoRevisions）。 */
  readonly maxRevisions: number;
  /** 取本轮已收集的 propose_* 提议快照。 */
  readonly collectedProposals: () => readonly DraftProposal[];
  readonly clock: () => string;
}

const StateSpec = Annotation.Root({
  runInput: Annotation<ChapterRunInput>,
  write: Annotation<WriteOk | null>,
  body: Annotation<string>,
  declaration: Annotation<C5Declaration | null>,
  c5Findings: Annotation<readonly GateFinding[]>,
  findings: Annotation<readonly GateFinding[]>,
  acceptable: Annotation<boolean>,
  /** C7 分流给出的处理动作，作为修订快照的 reason。 */
  routeAction: Annotation<string | null>,
  revisions: Annotation<readonly DraftRevision[]>,
  proposals: Annotation<readonly DraftProposal[]>,
  outcome: Annotation<ChapterTaskOutcome | null>,
  error: Annotation<DraftError | null>,
  refusalMessage: Annotation<string | null>,
});

export type ChapterGraphState = typeof StateSpec.State;

/** 全字段初始态。channel 无默认值，stream 前必须提供完整初始 state。 */
export function initialGraphState(runInput: ChapterRunInput): ChapterGraphState {
  return {
    runInput,
    write: null,
    body: "",
    declaration: null,
    c5Findings: [],
    findings: [],
    acceptable: false,
    routeAction: null,
    revisions: [],
    proposals: [],
    outcome: null,
    error: null,
    refusalMessage: null,
  };
}

export function buildChapterGraph(deps: ChapterGraphDeps) {
  const write = async (s: ChapterGraphState): Promise<Partial<ChapterGraphState>> => {
    if (s.write !== null) return {}; // resume：正文已在，跳过 C4，不重跑
    const r = await writeChapterBody(deps.client, s.runInput, deps.ctx, deps.maxToolRounds);
    if (r.kind === "refused") return { outcome: "refused", refusalMessage: r.userMessage };
    if (r.kind === "failed") return { outcome: "failed", error: { step: "C4", detail: r.detail } };
    return { write: r, body: r.body, proposals: deps.collectedProposals() };
  };

  const declare = async (s: ChapterGraphState): Promise<Partial<ChapterGraphState>> => {
    if (s.declaration !== null) return {}; // resume：声明已在，跳过 C5
    if (s.write === null) {
      return { outcome: "failed", error: { step: "C5", detail: "缺少 C4 会话，无法声明" } };
    }
    const r = await declareStructure(deps.client, s.runInput, s.write);
    if (r.kind === "failed") return { outcome: "failed", error: { step: "C5", detail: r.detail } };
    return {
      declaration: r.parse.declaration,
      c5Findings: r.c5Findings,
      // 同步进 findings：让声明后落盘的 draft.findings 承载 c5Findings，
      // resume 到 check 时可据此复原（check 会用它算出完整 findings）。
      findings: r.c5Findings,
      proposals: deps.collectedProposals(),
    };
  };

  const check = (s: ChapterGraphState): Partial<ChapterGraphState> => {
    if (s.declaration === null) {
      return { outcome: "failed", error: { step: "C6", detail: "缺少结构声明" } };
    }
    const r = checkChapter(s.runInput, s.body, s.declaration, s.c5Findings);
    return {
      findings: r.findings,
      acceptable: r.acceptable,
      routeAction: r.route?.action.action ?? null,
      outcome: r.acceptable ? "ready" : "needs_revision",
    };
  };

  const revise = async (s: ChapterGraphState): Promise<Partial<ChapterGraphState>> => {
    if (s.write === null) {
      return { outcome: "needs_revision", error: { step: "C7", detail: "缺少 C4 会话，无法自动修订" } };
    }
    const r = await reviseChapterBody(deps.client, s.runInput, s.write, s.findings, deps.ctx, deps.maxToolRounds);
    // 修订失败不动正文：停回 needs_revision，作者手里仍是那份可读可改的稿子。
    if (r.kind === "refused") {
      return { outcome: "needs_revision", error: { step: "C7", detail: `自动修订被拒：${r.userMessage}` } };
    }
    if (r.kind === "failed") {
      return { outcome: "needs_revision", error: { step: "C7", detail: `自动修订未完成：${r.detail}` } };
    }
    const snapshot: DraftRevision = {
      body: s.body,
      findings: s.findings,
      reason: REVISION_REASON[s.routeAction ?? ""] ?? "按检查结果修订",
      at: deps.clock(),
    };
    return {
      write: r,
      body: r.body,
      revisions: [...s.revisions, snapshot],
      // 正文变了：清掉声明与检查结论，逼 declare/check 重算（两处都有幂等跳过）。
      declaration: null,
      c5Findings: [],
      findings: [],
      acceptable: false,
      routeAction: null,
      outcome: null,
      error: null,
      proposals: deps.collectedProposals(),
    };
  };

  // outcome 非 null 即已终结（refused/failed/停在 needs_revision）→ END；否则进下一步。
  // 节点名刻意加前缀，避免与状态通道名（write 等）冲突 —— LangGraph 不允许同名。
  const gate =
    (next: "step_declare" | "step_check") =>
    (s: ChapterGraphState): "step_declare" | "step_check" | typeof END =>
      s.outcome === null ? next : END;

  /** 检查未过且还有修订额度才自动改（needs_revision 必含 block，问题清单不会为空）。 */
  const afterCheck = (s: ChapterGraphState): "step_revise" | typeof END =>
    s.outcome === "needs_revision" && s.revisions.length < deps.maxRevisions ? "step_revise" : END;

  return new StateGraph(StateSpec)
    .addNode("step_write", write)
    .addNode("step_declare", declare)
    .addNode("step_check", check)
    .addNode("step_revise", revise)
    .addEdge(START, "step_write")
    .addConditionalEdges("step_write", gate("step_declare"), ["step_declare", END])
    .addConditionalEdges("step_declare", gate("step_check"), ["step_check", END])
    .addConditionalEdges("step_check", afterCheck, ["step_revise", END])
    .addConditionalEdges("step_revise", gate("step_declare"), ["step_declare", END])
    .compile({ checkpointer: new MemorySaver() });
}

/** C7 分流动作 → 给作者看的一句话原因。 */
const REVISION_REASON: Record<string, string> = {
  patch: "字数不足，按优先级补写",
  trim: "超出上限，按优先级删减",
  split: "事件过多，建议拆章",
  pass: "主动放行后仍有待改项",
  ok: "字数合规，改的是其他检查项",
};
