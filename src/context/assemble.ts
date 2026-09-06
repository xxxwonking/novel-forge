/**
 * C1 上下文装配（§13.7）—— M1 的核心。
 *
 * 四段布局，4 个 breakpoint 用满（上限 4）：
 *   段 0 tools    永不变
 *   段 1 system   L1 常驻层        ← bp1
 *   段 2 messages L2 索引          ← bp2
 *   段 3 messages L3 详情          ← bp3
 *   段 4 messages 易变区            无 bp（每次都变，缓存它没意义还浪费额度）
 *
 * `system` 必须用**数组形式的 text block** 才能挂 cache_control，
 * 字符串形式挂不上。
 */

import type Anthropic from "@anthropic-ai/sdk";
import { WRITING_TOOLS } from "./tools.js";
import { renderL1, type L1Input } from "./render-l1.js";
import { renderL2, renderL2Append } from "./render-l2.js";
import { renderL3, estimateTokens, type L3Selection } from "./select-l3.js";
import { renderVolatile, type VolatileInput } from "./render-volatile.js";
import type { L2Snapshot } from "../types/l2.js";

export interface AssembleInput {
  readonly l1: L1Input;
  readonly l2: L2Snapshot;
  readonly l3: L3Selection;
  readonly volatile: VolatileInput;
}

/** 装配产物。带 segments 是为了让 CacheMetrics 能推断哪一段冷了（§13.8）。 */
export interface AssembledRequest {
  readonly tools: readonly Anthropic.Tool[];
  readonly system: readonly Anthropic.TextBlockParam[];
  readonly messages: readonly Anthropic.MessageParam[];
  /** 各段的估算 token 数，按段序。用于 invalidatedAt 推断。 */
  readonly segmentTokens: readonly [number, number, number, number, number];
}

const CACHE: Anthropic.CacheControlEphemeral = { type: "ephemeral" };

/**
 * §13.9：最小可缓存前缀因模型而异（512-4096 token），更短的**静默不缓存**。
 * 新作品只有 3 个人物时段 2/3 可能低于这个门槛，所以要检测并合并。
 */
export const MIN_CACHEABLE_TOKENS = 1024;

/**
 * 装配请求。
 *
 * 段 2/3 过短时合并为一个 block 并只挂一个 breakpoint —— 分开挂会浪费一个
 * breakpoint 额度在一个根本不会被缓存的段上，而 breakpoint 只有 4 个。
 */
export function assemble(input: AssembleInput): AssembledRequest {
  const l1Text = renderL1(input.l1);
  const l2Text = renderL2(input.l2);
  const l2AppendText = renderL2Append(input.l2);
  const l3Text = renderL3(input.l3);
  const volatileText = renderVolatile(input.volatile);

  const toolsTokens = estimateTokens(JSON.stringify(WRITING_TOOLS));
  const l1Tokens = estimateTokens(l1Text);
  const l2Tokens = estimateTokens(l2Text);
  const l3Tokens = estimateTokens(l3Text);
  const volatileTokens = estimateTokens(volatileText) + estimateTokens(l2AppendText);

  const content: Anthropic.ContentBlockParam[] = [];

  if (l3Tokens > 0 && l2Tokens + l3Tokens >= MIN_CACHEABLE_TOKENS && l3Tokens < MIN_CACHEABLE_TOKENS) {
    // 段 3 太短，单独缓存会静默失败。合并进段 2 共用 bp2。
    content.push({ type: "text", text: `${l2Text}\n\n${l3Text}`, cache_control: CACHE });
  } else {
    content.push({ type: "text", text: l2Text, cache_control: CACHE });
    if (l3Tokens > 0) {
      content.push({ type: "text", text: l3Text, cache_control: CACHE });
    }
  }

  // 增量区在 bp2/bp3 之后、不带 cache_control —— 它每章都变，放在
  // breakpoint 之前会让 bp2 每章重新创建（写入价高于读取价，比不缓存更贵）。
  if (l2AppendText !== "") {
    content.push({ type: "text", text: l2AppendText });
  }

  content.push({ type: "text", text: volatileText });

  return {
    tools: WRITING_TOOLS,
    system: [{ type: "text", text: l1Text, cache_control: CACHE }],
    messages: [{ role: "user", content }],
    segmentTokens: [toolsTokens, l1Tokens, l2Tokens, l3Tokens, volatileTokens],
  };
}
