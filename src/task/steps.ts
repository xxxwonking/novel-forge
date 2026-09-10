/**
 * 章节任务的三个可复用步骤（Stage 1）：write / declare / check。
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
import type { CallOptions, ClaudeClient } from "../client/claude.js";
import { assemble, type AssembledRequest } from "../context/assemble.js";
import { C5_TASK, textOf, type ChapterRunInput } from "../chapter/pipeline.js";
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
      readonly c4Response: Anthropic.Message;
      /** 传给最终 C4 调用的消息（含工具往返），C5 同会话第二轮据此续接。 */
      readonly sessionMessages: readonly Anthropic.MessageParam[];
      readonly hitToolCap: boolean;
    }
  | { readonly kind: "refused"; readonly userMessage: string }
  | { readonly kind: "failed"; readonly detail: string };

export async function writeChapterBody(
  client: ClaudeClient,
  input: ChapterRunInput,
  ctx: ToolContext,
  maxToolRounds: number,
): Promise<WriteResult> {
  const req = assemble(input.assembleInput);
  const callOpts: CallOptions = {
    role: "creative",
    effort: "xhigh",
    thinking: true,
    maxTokens: input.maxOutputTokens ?? C4_MAX_TOKENS,
    tools: req.tools,
    system: req.system,
    messages: req.messages,
  };
  const loop = await runToolLoop(client, callOpts, ctx, maxToolRounds);
  const r = loop.result;

  if (r.kind === "error") return { kind: "failed", detail: r.error.message };
  if (r.kind === "refusal") return { kind: "refused", userMessage: r.userMessage };

  const body = textOf(r.message);
  if (body.trim() === "") {
    return {
      kind: "failed",
      detail: loop.hitCap ? "C4 工具调用达上限仍未产出正文" : "C4 返回空正文",
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
  client: ClaudeClient,
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
