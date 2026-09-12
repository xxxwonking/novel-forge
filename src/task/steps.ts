/**
 * 章节任务的可复用步骤：write / declare / check / revise。
 *
 * 它们是 LangGraph 章节图（graph.ts）的节点主体。与 `chapter/pipeline.ts` 的
 * `runChapter` 的关系：
 *   - runChapter 是**遗留一次性路径**（缓存实测工装 + 21 个测试依赖），保持独立、
 *     内部自带缓存度量与 commitDeclaration。
 *   - 这里是**产品任务路径**：C4 带工具循环、C5 只产出声明**不入事件流**（草稿在
 *     事件流之外，见 types.ts），供图逐步落草稿、失败可恢复。
 * 两处对 C4/C5 调用形态有少量刻意重复；改 C5 协议时两边都要同步。
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions } from "../client/claude.js";
import type { ModelClient } from "../client/model.js";
import { assemble, type AssembledRequest } from "../context/assemble.js";
import { C5_TASK, C7_TASK, textOf, type ChapterRunInput } from "../chapter/pipeline.js";
import { C5_OUTPUT_SCHEMA, parseC5, type ParseResult } from "../chapter/c5-schema.js";
import { checkPromisedResolutions, crossCheckC5 } from "../chapter/c5-crosscheck.js";
import { gateChapter, type ChapterGateResult } from "../gate/code-channel.js";
import { canAccept, routeChapter, unresolvedFromFindings, type RouteResult } from "../gate/route.js";
import { runToolLoop, type ToolContext } from "./tool-exec.js";
import type { GateFinding } from "../types/beat.js";
import type { C5Declaration } from "../types/events.js";

/**
 * API 调用的输出规模 —— 是**管线常量**（等同 client.ts 的 STREAMING_THRESHOLD /
 * pipeline.ts 的 16_000/4_000），不是 §10.1 的派生阈值，故不进 rules.yaml。
 */
const C4_MAX_TOKENS = 16_000;
const C5_MAX_TOKENS = 4_000;

// ── C4：写正文（带工具循环）─────────────────────────────────────────────

export type WriteResult =
  | {
      readonly kind: "ok";
      readonly body: string;
      readonly req: AssembledRequest;
      /** 产出当前正文的那次响应。修订轮复用同一字段 —— 它的语义是「续接点」。 */
      readonly c4Response: Anthropic.Message;
      /** 传给最终 C4 调用的消息（含工具往返），C5 同会话第二轮据此续接。 */
      readonly sessionMessages: readonly Anthropic.MessageParam[];
      readonly hitToolCap: boolean;
    }
  | { readonly kind: "refused"; readonly userMessage: string }
  | { readonly kind: "failed"; readonly detail: string };

export async function writeChapterBody(
  client: ModelClient,
  input: ChapterRunInput,
  ctx: ToolContext,
  maxToolRounds: number,
): Promise<WriteResult> {
  const req = assemble(input.assembleInput);
  return runWriteTurn(client, callOptionsFor(input, req, req.messages), req, ctx, maxToolRounds, "C4");
}

// ── C7：按检查结果自动修订（同会话续轮）─────────────────────────────────

/**
 * 在写完正文的同一会话里追加一轮，让模型按 C6/C7 的问题清单改出新正文。
 *
 * 续接点是 **C4 之后而非 C5 之后**：正文一改，结构声明必然要重做，把旧声明
 * 带进上下文只会让模型照着已经不成立的事实修。缓存前缀也因此保持不变。
 */
export async function reviseChapterBody(
  client: ModelClient,
  input: ChapterRunInput,
  write: Extract<WriteResult, { kind: "ok" }>,
  findings: readonly GateFinding[],
  ctx: ToolContext,
  maxToolRounds: number,
): Promise<WriteResult> {
  const messages: Anthropic.MessageParam[] = [
    ...write.sessionMessages,
    { role: "assistant", content: write.c4Response.content },
    { role: "user", content: [{ type: "text", text: revisionTask(findings) }] },
  ];
  return runWriteTurn(client, callOptionsFor(input, write.req, messages), write.req, ctx, maxToolRounds, "C7");
}

/** 只带 block/warn：info 是提示、pass 是已主动放行，要求模型去改它们等于制造假工作。 */
function revisionTask(findings: readonly GateFinding[]): string {
  const items = findings
    .filter((f) => f.level === "block" || f.level === "warn")
    .map((f) => `- 【${f.level === "block" ? "必改" : "建议"}】${f.message}`);
  return [C7_TASK, "", "问题清单：", ...items, ...wordCountDirective(findings)].join("\n");
}

/**
 * 字数越界时给出**净增 / 净减**的硬指标。
 *
 * 模型按含标点的字符数估算篇幅，检查却按内容字数计，所以它总觉得"已经够了"：
 * 只说"补 113 字"，它会改写句子而不是增写，实测净增接近零（live 验收观察）。
 * 要求只增不减 / 只删不增，净变化量才等于新增 / 删除量。数字全部来自 finding。
 */
function wordCountDirective(findings: readonly GateFinding[]): readonly string[] {
  const patch = findings.find((f) => f.rule === "route_patch");
  if (patch?.measured !== undefined && patch.threshold !== undefined) {
    return [
      "",
      `字数硬指标：系统只计汉字与西文词、不计标点空白，本版实测 ${patch.measured} 字，下限 ${patch.threshold}。`,
      `这次只增不减 —— 不改写、不删任何现有句子，只在事件推进处插入新内容，新增合计不少于 ${patch.threshold - patch.measured} 字，宁多勿少。`,
    ];
  }
  const trim = findings.find((f) => f.rule === "route_trim");
  if (trim?.measured !== undefined && trim.threshold !== undefined) {
    return [
      "",
      `字数硬指标：系统只计汉字与西文词、不计标点空白，本版实测 ${trim.measured} 字，上限 ${trim.threshold}。`,
      `这次只删不增 —— 不新增任何句子，删减合计不少于 ${trim.measured - trim.threshold} 字。`,
    ];
  }
  return [];
}

function callOptionsFor(
  input: ChapterRunInput,
  req: AssembledRequest,
  messages: readonly Anthropic.MessageParam[],
): CallOptions {
  return {
    role: "creative",
    effort: "xhigh",
    thinking: true,
    maxTokens: input.maxOutputTokens ?? C4_MAX_TOKENS,
    tools: req.tools,
    system: req.system,
    messages,
  };
}

/** 一轮「带工具循环的产文调用」。C4 与 C7 只差 messages 与失败文案里的步骤名。 */
async function runWriteTurn(
  client: ModelClient,
  callOpts: CallOptions,
  req: AssembledRequest,
  ctx: ToolContext,
  maxToolRounds: number,
  step: "C4" | "C7",
): Promise<WriteResult> {
  const loop = await runToolLoop(client, callOpts, ctx, maxToolRounds);
  const r = loop.result;

  if (r.kind === "error") return { kind: "failed", detail: r.error.message };
  if (r.kind === "refusal") return { kind: "refused", userMessage: r.userMessage };

  const body = textOf(r.message);
  if (body.trim() === "") {
    return {
      kind: "failed",
      detail: loop.hitCap ? `${step} 工具调用达上限仍未产出正文` : `${step} 返回空正文`,
    };
  }
  return {
    kind: "ok",
    body,
    req,
    c4Response: r.message,
    sessionMessages: loop.messages,
    hitToolCap: loop.hitCap,
  };
}

// ── C5：结构声明（不入事件流）───────────────────────────────────────────

export type DeclareResult =
  | { readonly kind: "ok"; readonly parse: ParseResult; readonly c5Findings: readonly GateFinding[] }
  | { readonly kind: "failed"; readonly detail: string };

export async function declareStructure(
  client: ModelClient,
  input: ChapterRunInput,
  write: Extract<WriteResult, { kind: "ok" }>,
): Promise<DeclareResult> {
  // 同会话第二轮：追加**整个 C4 响应**（含 thinking/工具块），再问结构声明。
  const c5Messages: Anthropic.MessageParam[] = [
    ...write.sessionMessages,
    { role: "assistant", content: write.c4Response.content },
    { role: "user", content: [{ type: "text", text: C5_TASK }] },
  ];

  const c5 = await client.call({
    role: "creative",
    effort: "medium",
    maxTokens: C5_MAX_TOKENS,
    tools: write.req.tools,
    system: write.req.system,
    messages: c5Messages,
    outputSchema: C5_OUTPUT_SCHEMA,
  });

  if (c5.kind === "error") return { kind: "failed", detail: c5.error.message };
  if (c5.kind === "refusal") return { kind: "failed", detail: `C5 被拒：${c5.userMessage}` };

  const json = parseJson(textOf(c5.message));
  if (json === null) return { kind: "failed", detail: "C5 输出不是合法 JSON" };

  const parse = parseC5(json, { ...input.parseContextBase, chapterText: write.body });
  const c5Findings = [
    ...crossCheckC5({ declaration: parse.declaration, chapterText: write.body }),
    ...checkPromisedResolutions(parse.declaration, input.promisedResolutions),
  ];
  return { kind: "ok", parse, c5Findings };
}

// ── C6 → C7：质量闸门与分流 ─────────────────────────────────────────────

export interface CheckResult {
  readonly findings: readonly GateFinding[];
  readonly acceptable: boolean;
  readonly gate: ChapterGateResult | null;
  readonly route: RouteResult | null;
}

/**
 * C6 代码通道 + C7 分流。顺序与理由同 pipeline.ts：C7 依赖 C6 的实际字数，
 * 字数越界的最终级别由 C7 定。gate 未配置或预算未派生时只保留 C5 的 findings。
 *
 * 吃 `declaration` 而非 ParseResult —— resume 时只需从草稿恢复声明即可复算，
 * 不必重建完整解析结果。
 */
export function checkChapter(
  input: ChapterRunInput,
  chapterText: string,
  declaration: C5Declaration,
  c5Findings: readonly GateFinding[],
): CheckResult {
  const beat = input.assembleInput.volatile.beat;
  if (input.gate === undefined || beat.budget === null) {
    return { findings: c5Findings, acceptable: canAccept(c5Findings), gate: null, route: null };
  }

  const gate = gateChapter(
    {
      chapterText,
      plan: beat.plan,
      budget: beat.budget,
      profile: input.gate.profile,
      declaredEventWeights: declaration.events.map((e) => e.weight),
    },
    input.gate.rules,
  );
  const route = routeChapter(
    {
      words: gate.words,
      plan: beat.plan,
      budget: beat.budget,
      unresolvedPromises: unresolvedFromFindings(c5Findings),
    },
    input.gate.rules,
  );
  const findings = [
    ...c5Findings,
    ...gate.findings.filter((f) => f.rule !== "word_count_under" && f.rule !== "word_count_over"),
    ...route.findings,
  ];
  return { findings, acceptable: canAccept(findings), gate, route };
}

/** 结构化输出理论上是纯 JSON，模型偶尔包 markdown 围栏（同 pipeline.ts 的私有版）。 */
function parseJson(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gu, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
