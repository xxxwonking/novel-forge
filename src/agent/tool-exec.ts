/**
 * 主 Agent 的工具执行与对话循环（Stage 2·切片 1）。
 *
 * 结构与 `task/tool-exec.ts` 同源：围绕 `ModelClient.call` 的手写
 * `while stop_reason==='tool_use'` 循环，刻意不引 SDK toolRunner（`call` 里集中了
 * 拒绝/effort/thinking/streaming/错误五坑，claude.ts）。步数有硬上限（§3.1 成本）。
 *
 * 副作用边界（本模块的核心纪律）：
 *   - 读类工具是纯查询，从 ctx 取数即回传，**不产生 effect**。
 *   - 动作类工具经 ctx 走 ProjectSession 受控入口，各产出**恰好一个 effect**
 *     （成功或 action_failed）。Agent 永不直接写正式事实（§12.0）。
 *   - executeMainTool 层的输入校验错误（枚举非法/缺必填）回 is_error 但不产 effect
 *     —— 那是模型用错工具，会自我纠正，不该变成给用户的动作 chip。
 */

import type Anthropic from "@anthropic-ai/sdk";
import { appendTurn, type CallOptions } from "../client/claude.js";
import type { ModelClient } from "../client/model.js";
import type { ChapterExcerpt, ForeshadowFilter } from "../task/tool-exec.js";
import type { AgentEffect } from "./types.js";

/** 计划类工具的入参（三种 what 对应三类 AlertAction，具体构造在 ctx 里）。 */
export interface PlanAddInput {
  readonly what: "resolution" | "advance" | "character";
  readonly foreshadowId?: string;
  readonly weight?: string;
  readonly completeness?: string;
  readonly plotLine?: string;
  readonly characterId?: string;
}

/** 一次动作类工具的结果：回传给模型的文案 + 记给 UI 的 effect。 */
export interface AgentActionOutcome {
  readonly message: string;
  readonly effect: AgentEffect;
}

/**
 * 工具执行上下文。读侧纯函数，动作侧绑到 ProjectSession 的受控入口。
 * 刻意不直接依赖 ProjectSession —— 让工具执行可独立测试（假 ctx 即可）。
 */
export interface MainAgentToolContext {
  readonly getOverview: () => string;
  readonly listChapterDrafts: (chapter: number | null) => string;
  readonly getChapterText: (chapter: number, excerpt: ChapterExcerpt) => string | null;
  readonly getCharacter: (name: string) => string | null;
  readonly listOpenForeshadows: (weight: ForeshadowFilter) => string;
  readonly getNextPlan: () => string;
  readonly addToNextChapter: (input: PlanAddInput) => Promise<AgentActionOutcome>;
  readonly rescheduleForeshadow: (foreshadowId: string, expectedBy: number) => Promise<AgentActionOutcome>;
  readonly abandonForeshadow: (foreshadowId: string, reason: string) => Promise<AgentActionOutcome>;
  readonly recordIdea: (text: string) => Promise<AgentActionOutcome>;
  readonly writeNextChapter: () => Promise<AgentActionOutcome>;
  readonly adoptChapter: (draftId: string) => Promise<AgentActionOutcome>;
}

const FORESHADOW_FILTERS: readonly ForeshadowFilter[] = ["main", "sub", "detail", "all"];

function asRecord(input: unknown): Record<string, unknown> {
  return typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
}

/** 执行一次 tool_use。返回 tool_result（供续调）和可选 effect（记给 UI）。 */
export async function executeMainTool(
  block: Anthropic.ToolUseBlock,
  ctx: MainAgentToolContext,
): Promise<{ readonly result: Anthropic.ToolResultBlockParam; readonly effect?: AgentEffect }> {
  const input = asRecord(block.input);
  const readStr = (k: string): string => (typeof input[k] === "string" ? (input[k] as string) : "");
  const readNum = (k: string): number =>
    typeof input[k] === "number" ? (input[k] as number) : Number.NaN;
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
  /** 动作类工具的统一收尾：is_error 由 effect 是否为 action_failed 决定。 */
  const action = (o: AgentActionOutcome): { result: Anthropic.ToolResultBlockParam; effect: AgentEffect } => ({
    result: o.effect.kind === "action_failed" ? err(o.message) : ok(o.message),
    effect: o.effect,
  });

  switch (block.name) {
    // ── 读类：零副作用 ──────────────────────────────────────────────────
    case "get_overview":
      return { result: ok(ctx.getOverview()) };
    case "list_chapter_drafts": {
      const raw = input["chapter"];
      const chapter = typeof raw === "number" && Number.isInteger(raw) ? raw : null;
      return { result: ok(ctx.listChapterDrafts(chapter)) };
    }
    case "get_chapter_text": {
      const chapter = readNum("chapter");
      if (!Number.isInteger(chapter)) return { result: err("chapter 必须是章号") };
      const text = ctx.getChapterText(chapter, asExcerpt(readStr("excerpt")));
      return { result: text === null ? err(`第 ${chapter} 章还没有已采用的正文`) : ok(text) };
    }
    case "get_character": {
      const name = readStr("name");
      const detail = ctx.getCharacter(name);
      return { result: detail === null ? err(`未找到人物：${name || "(空)"}`) : ok(detail) };
    }
    case "list_open_foreshadows":
      return { result: ok(ctx.listOpenForeshadows(asFilter(readStr("weight")))) };
    case "get_next_plan":
      return { result: ok(ctx.getNextPlan()) };

    // ── 计划类：改节拍/伏笔安排（计划态）───────────────────────────────
    case "plan_add_to_next_chapter": {
      const what = readStr("what");
      if (what !== "resolution" && what !== "advance" && what !== "character") {
        return { result: err("what 必须是 resolution / advance / character") };
      }
      if (what === "resolution" && (readStr("foreshadowId") === "" || readStr("weight") === "" || readStr("completeness") === "")) {
        return { result: err("what=resolution 需要 foreshadowId、weight、completeness") };
      }
      if (what === "advance" && readStr("plotLine") === "") return { result: err("what=advance 需要 plotLine") };
      if (what === "character" && readStr("characterId") === "") return { result: err("what=character 需要 characterId") };
      return action(
        await ctx.addToNextChapter({
          what,
          ...(readStr("foreshadowId") === "" ? {} : { foreshadowId: readStr("foreshadowId") }),
          ...(readStr("weight") === "" ? {} : { weight: readStr("weight") }),
          ...(readStr("completeness") === "" ? {} : { completeness: readStr("completeness") }),
          ...(readStr("plotLine") === "" ? {} : { plotLine: readStr("plotLine") }),
          ...(readStr("characterId") === "" ? {} : { characterId: readStr("characterId") }),
        }),
      );
    }
    case "plan_reschedule_foreshadow": {
      const id = readStr("foreshadowId");
      const by = readNum("expectedBy");
      if (id === "") return { result: err("缺少 foreshadowId") };
      if (!Number.isInteger(by)) return { result: err("expectedBy 必须是章号") };
      return action(await ctx.rescheduleForeshadow(id, by));
    }
    case "plan_abandon_foreshadow": {
      const id = readStr("foreshadowId");
      if (id === "") return { result: err("缺少 foreshadowId") };
      return action(await ctx.abandonForeshadow(id, readStr("reason")));
    }

    // ── 备选想法 ────────────────────────────────────────────────────────
    case "record_alternative_idea": {
      const text = readStr("text");
      if (text === "") return { result: err("缺少 text") };
      return action(await ctx.recordIdea(text));
    }

    // ── 任务类：走受控入口 ──────────────────────────────────────────────
    case "write_next_chapter":
      return action(await ctx.writeNextChapter());
    case "adopt_chapter": {
      const draftId = readStr("draftId");
      if (draftId === "") return { result: err("缺少 draftId；先用 list_chapter_drafts 确认要采用哪一版") };
      return action(await ctx.adoptChapter(draftId));
    }

    default:
      return { result: err(`未知工具：${block.name}`) };
  }
}

function asExcerpt(v: string): ChapterExcerpt {
  return v === "head" || v === "tail" ? v : "full";
}

function asFilter(v: string): ForeshadowFilter {
  return (FORESHADOW_FILTERS as readonly string[]).includes(v) ? (v as ForeshadowFilter) : "all";
}

export interface AgentLoopResult {
  readonly text: string;
  readonly effects: readonly AgentEffect[];
  readonly toolRounds: number;
  /** 达到步数上限时仍在请求工具 —— 回复可能不完整。 */
  readonly hitCap: boolean;
}

/**
 * 对话循环：调用模型 → 执行工具 → appendTurn → 续调，直到模型给出非 tool_use 的
 * 文本回复或达到 `maxRounds`。拒绝/错误/超长都归一化为可展示文本（§2：空白最差），
 * 不抛异常。
 */
export async function runAgentLoop(
  client: ModelClient,
  callOpts: CallOptions,
  ctx: MainAgentToolContext,
  maxRounds: number,
): Promise<AgentLoopResult> {
  let messages: readonly Anthropic.MessageParam[] = callOpts.messages;
  let toolRounds = 0;
  const effects: AgentEffect[] = [];

  for (;;) {
    const result = await client.call({ ...callOpts, messages });

    if (result.kind === "error") {
      return { text: `（模型调用失败：${result.error.message}）`, effects, toolRounds, hitCap: false };
    }
    if (result.kind === "refusal") {
      return { text: result.userMessage, effects, toolRounds, hitCap: false };
    }
    if (result.kind === "max_tokens") {
      return { text: extractText(result.message) || "（回复超出长度上限，未完成）", effects, toolRounds, hitCap: false };
    }
    if (result.message.stop_reason !== "tool_use") {
      return { text: extractText(result.message), effects, toolRounds, hitCap: false };
    }
    if (toolRounds >= maxRounds) {
      return {
        text: extractText(result.message) || "（这一步涉及的操作较多，我先停下。请把要做的事说得更具体一点。）",
        effects,
        toolRounds,
        hitCap: true,
      };
    }
    toolRounds += 1;
    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const b of result.message.content) {
      if (b.type !== "tool_use") continue;
      const { result: tr, effect } = await executeMainTool(b, ctx);
      toolResults.push(tr);
      if (effect !== undefined) effects.push(effect);
    }
    messages = appendTurn(messages, result.message, toolResults);
  }
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}
