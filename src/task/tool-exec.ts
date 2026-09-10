/**
 * 写作工具的执行与工具循环（Stage 1，修复「无工具执行循环」）。
 *
 * §4.2：写小说 agent 只需读类工具 + 提议类工具，**不执行代码**。读工具从项目
 * 状态取数并回传；提议工具（propose_*）不直接改状态，只把提议收进「待确认区」
 * （§12.0），采用时再处理。
 *
 * `runToolLoop` 是围绕 `ModelClient.call` 的手写循环 —— 刻意不引 SDK 的
 * toolRunner，因为 `call` 里集中了拒绝/effort/thinking/streaming/错误五坑的处理
 * （claude.ts），toolRunner 会绕开它们。§3.1：循环步数是主成本，所以步数有硬上限。
 */

import type Anthropic from "@anthropic-ai/sdk";
import { appendTurn, type CallOptions, type CallResult } from "../client/claude.js";
import type { ModelClient } from "../client/model.js";
import type { ForeshadowWeight } from "../types/events.js";
import type { DraftProposal } from "./types.js";

export type ChapterExcerpt = "full" | "head" | "tail";
export type ForeshadowFilter = ForeshadowWeight | "all";

/**
 * 工具执行的上下文。读侧是纯函数（从 session 取数），提议侧是 sink 回调
 * （收进草稿）。刻意不直接依赖 ProjectSession —— 让工具执行可独立测试。
 */
export interface ToolContext {
  readonly loadCharacter: (name: string) => string | null;
  readonly loadSetting: (name: string) => string | null;
  readonly loadChapter: (chapter: number, excerpt: ChapterExcerpt) => string | null;
  readonly listOpenForeshadows: (weight: ForeshadowFilter) => string;
  readonly onPropose: (proposal: DraftProposal) => void;
}

const FORESHADOW_WEIGHTS: readonly ForeshadowWeight[] = ["main", "sub", "detail"];

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

/** 执行一次 tool_use，产出对应的 tool_result。未知工具或缺参回 is_error。 */
export function executeToolUse(
  block: Anthropic.ToolUseBlock,
  ctx: ToolContext,
): Anthropic.ToolResultBlockParam {
  const input = asRecord(block.input);
  const readStr = (k: string): string => (typeof input[k] === "string" ? (input[k] as string) : "");
  const readNum = (k: string): number =>
    typeof input[k] === "number" ? (input[k] as number) : Number(readStr(k));
  const ok = (text: string): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content: text,
  });
  const err = (text: string): Anthropic.ToolResultBlockParam => ({
    type: "tool_result",
    tool_use_id: block.id,
    content: text,
    is_error: true,
  });

  switch (block.name) {
    case "load_character": {
      const name = readStr("name");
      const detail = ctx.loadCharacter(name);
      return detail === null ? err(`未找到人物：${name || "(空)"}`) : ok(detail);
    }
    case "load_setting": {
      const name = readStr("name");
      const detail = ctx.loadSetting(name);
      return detail === null ? err(`未找到设定：${name || "(空)"}`) : ok(detail);
    }
    case "load_chapter": {
      const chapter = readNum("chapter");
      if (!Number.isInteger(chapter)) return err("chapter 必须是章号");
      const excerpt = asExcerpt(readStr("excerpt"));
      const body = ctx.loadChapter(chapter, excerpt);
      return body === null ? err(`第 ${chapter} 章还没有正文`) : ok(body);
    }
    case "list_open_foreshadows":
      return ok(ctx.listOpenForeshadows(asFilter(readStr("weight"))));
    case "propose_character_update": {
      ctx.onPropose({
        kind: "character_update",
        name: readStr("name"),
        field: readStr("field"),
        value: readStr("value"),
        reason: readStr("reason"),
      });
      return ok("已记录人物档案修改提议，进入待确认区。");
    }
    case "propose_foreshadow": {
      const weight = readStr("weight");
      if (!isForeshadowWeight(weight)) return err("weight 必须是 main/sub/detail");
      const expectedBy = readNum("expected_by");
      if (!Number.isInteger(expectedBy)) return err("expected_by 必须是章号");
      ctx.onPropose({
        kind: "foreshadow",
        label: readStr("label"),
        intent: readStr("intent"),
        weight,
        expectedBy,
      });
      return ok("已记录伏笔提议，进入待确认区。");
    }
    default:
      return err(`未知工具：${block.name}`);
  }
}

function asExcerpt(v: string): ChapterExcerpt {
  return v === "head" || v === "tail" ? v : "full";
}

function asFilter(v: string): ForeshadowFilter {
  return isForeshadowWeight(v) ? v : "all";
}

function isForeshadowWeight(v: string): v is ForeshadowWeight {
  return (FORESHADOW_WEIGHTS as readonly string[]).includes(v);
}

export interface ToolLoopResult {
  /** 最终一次非 tool_use 的调用结果（透传 refusal/error/max_tokens）。 */
  readonly result: CallResult;
  /** 完整会话（含工具往返），供 C5 同会话第二轮续用。 */
  readonly messages: readonly Anthropic.MessageParam[];
  readonly toolRounds: number;
  /** 达到步数上限时仍在请求工具 —— 结果里可能没有正文。 */
  readonly hitCap: boolean;
}

/**
 * 工具循环：`while stop_reason==='tool_use'` 执行工具 → appendTurn → 续调，
 * 执行轮数上限为 `maxToolRounds`（来自 rules.task.maxToolIterations）。
 *
 * 非 ok（拒绝/错误/max_tokens）立即透传，不进循环 —— 这些由调用方按 §2/§附录处理。
 */
export async function runToolLoop(
  client: ModelClient,
  callOpts: CallOptions,
  ctx: ToolContext,
  maxToolRounds: number,
): Promise<ToolLoopResult> {
  let messages: readonly Anthropic.MessageParam[] = callOpts.messages;
  let toolRounds = 0;

  for (;;) {
    const result = await client.call({ ...callOpts, messages });
    if (result.kind !== "ok" || result.message.stop_reason !== "tool_use") {
      return { result, messages, toolRounds, hitCap: false };
    }
    if (toolRounds >= maxToolRounds) {
      return { result, messages, toolRounds, hitCap: true };
    }
    toolRounds += 1;
    const toolResults = result.message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
      .map((b) => executeToolUse(b, ctx));
    messages = appendTurn(messages, result.message, toolResults);
  }
}
