/**
 * 章节任务的 LangGraph 编排（Stage 1）。
 *
 * 图只负责**步骤流转**：write → declare → check，任一步失败/被拒即经条件边到 END。
 * 事件流不在这里碰（草稿在事件流之外，见 types.ts）；模型调用使用最小 ModelClient，
 * 由原生 Claude SDK 或 chat 客户端实现，不引 LangChain 模型抽象。
 *
 * 恢复：节点带幂等跳过 —— resume 时 service 用草稿预填 `write`/`declaration`，
 * 已完成的步骤直接返回空更新，因此「C5 失败重试从声明起、不重跑 C4」成立。
 * 跨重启的持久化靠草稿（DraftStore），MemorySaver 只提供进程内的线程态。
 *
 * 检查后的自动修订受冻结额度限制；保存初稿及新版本后重新走同一组节点，
 * 失败、超出范围或再次未通过即停下，不放宽原检查。
 */

import { Annotation, END, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import type { ModelClient } from "../client/model.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import { checkChapter, declareStructure, writeChapterBody, type WriteResult } from "./steps.js";
import { rewriteChapterBody } from "./rewrite.js";
import { automaticRevisionLimit, canAutomaticallyRevise } from "./automatic-revision.js";
import type { ToolContext } from "./tool-exec.js";
import type { C5Declaration } from "../types/events.js";
import type { GateFinding } from "../types/beat.js";
import type { ChapterTaskOutcome, DraftError, DraftProposal, DraftGeneration, DraftRevision } from "./types.js";

export type WriteOk = Extract<WriteResult, { kind: "ok" }>;

export interface ChapterGraphDeps {
  readonly client: ModelClient;
  readonly ctx: ToolContext;
  /** 工具循环步数上限（rules.task.maxToolIterations）。 */
  readonly maxToolRounds: number;
  /** 取本轮已收集的 propose_* 提议快照。 */
  readonly collectedProposals: () => readonly DraftProposal[];
  readonly stopRequested?: () => "pause" | "end" | null;
  /** 节点完成后同步保存，再允许下一节点执行；不能依赖流消费者的调度速度。 */
  readonly onState?: (state: ChapterGraphState) => void;
  readonly maxAutoRevisions?: number;
  /** 在开始修订前原子保存版本关系及冻结输入，返回新版本的图状态。 */
  readonly beginAutomaticRevision?: (state: ChapterGraphState) => Partial<ChapterGraphState> | null;
}

const StateSpec = Annotation.Root({
  runInput: Annotation<ChapterRunInput>,
  write: Annotation<WriteOk | null>,
  body: Annotation<string>,
  declaration: Annotation<C5Declaration | null>,
  c5Findings: Annotation<readonly GateFinding[]>,
  findings: Annotation<readonly GateFinding[]>,
  acceptable: Annotation<boolean>,
  proposals: Annotation<readonly DraftProposal[]>,
  generation: Annotation<DraftGeneration | null>,
  revision: Annotation<DraftRevision | null>,
  autoRevisionsUsed: Annotation<number>,
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
    proposals: [],
    generation: null,
    revision: null,
    autoRevisionsUsed: 0,
    outcome: null,
    error: null,
    refusalMessage: null,
  };
}

export function buildChapterGraph(deps: ChapterGraphDeps) {
  const stopped = (): Partial<ChapterGraphState> | null => {
    const request = deps.stopRequested?.();
    return request == null ? null : { outcome: request === "pause" ? "paused" : "ended" };
  };
  const write = async (s: ChapterGraphState): Promise<Partial<ChapterGraphState>> => {
    const stop = stopped(); if (stop !== null) return stop;
    if (s.write !== null) return {}; // resume：正文已在，跳过 C4，不重跑
    const r = s.generation === null ? await writeChapterBody(deps.client, s.runInput, deps.ctx, deps.maxToolRounds)
      : await rewriteChapterBody(deps.client, s.runInput, deps.ctx, deps.maxToolRounds, s.generation);
    if (r.kind === "refused") return { outcome: "refused", refusalMessage: r.userMessage };
    if (r.kind === "failed") return { outcome: "failed", error: { step: "C4", detail: r.detail } };
    if (r.kind === "incomplete") return { body: r.body, outcome: "failed", error: { step: "C4", detail: r.detail } };
    if (r.kind === "scope_change") return { outcome: "needs_revision", acceptable: false,
      revision: s.revision === null ? null : { ...s.revision, resultSummary: r.summary, scopeAdvice: r.advice },
      findings: [{ rule: "revision_scope", level: "warn", message: r.advice }], proposals: deps.collectedProposals() };
    return { write: r, body: r.body, proposals: deps.collectedProposals(),
      revision: s.revision === null || r.summary === undefined ? s.revision : { ...s.revision, resultSummary: r.summary } };
  };

  const declare = async (s: ChapterGraphState): Promise<Partial<ChapterGraphState>> => {
    const stop = stopped(); if (stop !== null) return stop;
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
    const stop = stopped(); if (stop !== null) return stop;
    if (s.declaration === null) {
      return { outcome: "failed", error: { step: "C6", detail: "缺少结构声明" } };
    }
    const r = checkChapter(s.runInput, s.body, s.declaration, s.c5Findings);
    return {
      findings: r.findings,
      acceptable: r.acceptable,
      outcome: r.acceptable ? "ready" : "needs_revision",
    };
  };

  const shouldRevise = (s: ChapterGraphState): boolean => s.outcome === "needs_revision" &&
    s.autoRevisionsUsed < automaticRevisionLimit(deps.maxAutoRevisions) &&
    s.revision === null && s.generation === null && canAutomaticallyRevise(s.findings) &&
    deps.beginAutomaticRevision !== undefined;
  const revise = (s: ChapterGraphState): Partial<ChapterGraphState> => {
    const stop = stopped(); if (stop !== null) return stop;
    return shouldRevise(s) ? deps.beginAutomaticRevision?.(s) ?? {} : {};
  };

  // outcome 非 null 即已终结（refused/failed）→ END；否则进下一步。
  // 节点名刻意加前缀，避免与状态通道名（write 等）冲突 —— LangGraph 不允许同名。
  const gate =
    (next: "step_declare" | "step_check") =>
    (s: ChapterGraphState): "step_declare" | "step_check" | typeof END =>
      s.outcome === null ? next : END;

  const persist = (node: (s: ChapterGraphState) => Partial<ChapterGraphState> | Promise<Partial<ChapterGraphState>>) =>
    async (s: ChapterGraphState): Promise<Partial<ChapterGraphState>> => {
      const update = await node(s);
      deps.onState?.({ ...s, ...update });
      return update;
    };

  return new StateGraph(StateSpec)
    .addNode("step_write", persist(write))
    .addNode("step_declare", persist(declare))
    .addNode("step_check", persist(check))
    .addNode("step_revise", persist(revise))
    .addEdge(START, "step_write")
    .addConditionalEdges("step_write", gate("step_declare"), ["step_declare", END])
    .addConditionalEdges("step_declare", gate("step_check"), ["step_check", END])
    .addConditionalEdges("step_check", s => shouldRevise(s) ? "step_revise" : END, ["step_revise", END])
    .addConditionalEdges("step_revise", s => s.outcome === null ? "step_write" : END, ["step_write", END])
    .compile({ checkpointer: new MemorySaver() });
}
