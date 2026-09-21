/**
 * 逐章反推结构：从旧稿正文得出结构声明（差距第 2 项下半场）。
 *
 * 与 C5 的关系：**同一件事，方向相反**。C5 是"刚写完的这一章声明了什么"，靠同会话
 * 第二轮拿到创作意图；反推是"作者早就写好的这一章里有什么"，意图已经不在场，只能
 * 从字面读出来。所以解析侧一字不改（`parseC5` 的丢弃与报错纪律照用），换掉的只有
 * 上下文的来源和任务说明。
 *
 * 不复用 `buildChapterRunInput`：它要求该章有已采用的节拍表，而旧稿没有节拍表，
 * 也不该为了反推伪造一份 —— 伪造出来的预算和计划会流进闸门，报一堆与旧稿无关的问题。
 *
 * 两条反推特有的纪律写在提示词里，另有两道代码闸门兜底：
 *   - 只能引用已登记的人物/地点/情节线 ID（`parseC5` 报错，本章整章不落）。
 *   - 引文必须逐字在本章正文里（`crossCheckC5` 的 block 级锚点检查）。
 *     旧稿反推最常见的失败就是复述而不是引用，那种记录采用后锚点全是死的。
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { ModelClient } from "../client/model.js";
import { idConstraints } from "../chapter/pipeline.js";
import { C5_OUTPUT_SCHEMA, parseC5, type ParseContext } from "../chapter/c5-schema.js";
import { c5OutputIssue } from "../chapter/c5-validation.js";
import { crossCheckC5 } from "../chapter/c5-crosscheck.js";
import type { C5Declaration } from "../types/events.js";
import type { ChapterNo } from "../types/primitives.js";

/**
 * 输出规模与档位照抄 C5（steps.ts 的 `C5_MAX_TOKENS` / `effort: medium`）——
 * 反推的输出形状与 C5 完全相同，没有理由另定一套。是管线常量，不是派生阈值。
 */
const INFER_MAX_TOKENS = 4_000;

/** 带进提示词的前情梗概章数。上下文预算，不是规则阈值 —— 整本书装不下。 */
export const SYNOPSIS_WINDOW = 10;

export interface PendingForeshadow {
  readonly id: string;
  readonly label: string;
  readonly intent: string;
  readonly expectedBy: ChapterNo;
}

export interface InferenceInput {
  readonly chapter: ChapterNo;
  readonly chapterText: string;
  readonly parseContextBase: Omit<ParseContext, "chapterText">;
  /** 已埋设未兑现的伏笔：模型只能从这张表里挑要兑现的编号。 */
  readonly openForeshadows: readonly PendingForeshadow[];
  /** 前情梗概，按章。让模型知道这一章之前发生过什么，不必读全书。 */
  readonly synopses: readonly { readonly chapter: ChapterNo; readonly text: string }[];
  /** 作品名与题材，给判断定个调。 */
  readonly title: string;
}

export type InferenceOutcome =
  | { readonly kind: "ok"; readonly declaration: C5Declaration; readonly warnings: readonly string[] }
  /** 记录本身有毛病（引用了不存在的人物、引文不在正文里），作者处理后重跑。 */
  | { readonly kind: "problem"; readonly problems: readonly string[]; readonly warnings: readonly string[] }
  /** 这一轮没拿到可用输出：调用失败、被拒、截断、不是 JSON。 */
  | { readonly kind: "failed"; readonly detail: string };

const INFER_TASK = [
  "这是作者早就写好的一章旧稿。你的任务是读完它，把其中已经发生的事实整理成结构记录。",
  "",
  "**只依据这一章的正文**。不要补充你猜测的前因后果，不要把下一章可能发生的事写进来。",
  "看不出来的就不声明 —— 空着比编一条准确。",
  "",
  "事件的判定标准：一个事件 = 造成不可逆状态变化的一次动作或信息披露。",
  "对每个候选事件问一遍：把这段删掉，后面的章节需要改吗？不需要改就不是事件。",
  "内心活动、反应、氛围、铺垫一律不算。每章通常 1-3 个，超过 4 个先检查是不是把描写当成了事件。",
  "",
  "伏笔分两种，都要如实记：",
  "- 这一章**埋下**的（写出来了、但这一章没有交代结果）→ foreshadow_planted。",
  "  intent 写清它将来要兑现什么，expected_by 按你的判断填一个未来章号。",
  "- 这一章**兑现**的旧伏笔 → foreshadow_resolved，只能引用下面列出的编号。",
  "  没有列在下面的就不是待兑现伏笔，不要自己造编号。",
  "",
  "每条声明的 quote 必须从本章正文**逐字复制**一个连续片段，8-40 字。",
  "保留原标点，不要改写、不要顺手修一个字、不要拼接不同位置的句子 —— 这个片段是用来在正文里定位的，改一个字就定位不到。",
].join("\n");

/** 反推用的提示词。ID 约束与 C5 同源，区别只在任务说明与随附的待兑现清单。 */
export function buildInferenceTask(input: InferenceInput): string {
  return [
    INFER_TASK,
    "",
    ...idConstraints(input.parseContextBase),
    "",
    input.openForeshadows.length === 0
      ? "目前没有待兑现的旧伏笔，foreshadow_resolved 留空。"
      : ["已埋设、尚未兑现的伏笔（foreshadow_resolved 只能引用这些编号）：",
        ...input.openForeshadows.map((f) => `- ${f.id} 「${f.label}」：${f.intent}（原计划第 ${f.expectedBy} 章前兑现）`)].join("\n"),
    "",
    input.synopses.length === 0
      ? "这是有记录的第一章，没有前情。"
      : ["前情（已整理出的前面章节）：", ...input.synopses.map((s) => `- 第 ${s.chapter} 章：${s.text}`)].join("\n"),
    "",
    `# 第 ${input.chapter} 章正文`,
    input.chapterText,
  ].join("\n");
}

function systemBlocks(input: InferenceInput): readonly Anthropic.TextBlockParam[] {
  return [{
    type: "text",
    text: [
      `你在读《${input.title}》的旧稿，为它补一份结构记录。`,
      "作者已经写完了这些章节，你不创作、不改写、不评价，只把正文里已经发生的事整理成记录。",
      "宁可少报不要多报：漏一条事件只是清单不全，编一条不存在的事实会让后面所有章节的判断都偏掉。",
    ].join("\n"),
  }];
}

/**
 * 反推一章。
 *
 * 模型档位与 C5 相同（creative / medium）：这是同一个任务，输出形状也相同。
 * 不挂 `cache_control` —— 每章正文都不一样，前缀里的伏笔清单也随章增长，
 * 缓存写入价高于读取价（§13.4 的同一条理由）。
 */
export async function inferChapterStructure(client: ModelClient, input: InferenceInput): Promise<InferenceOutcome> {
  const call = await client.call({
    purpose: "inference",
    role: "creative",
    effort: "medium",
    maxTokens: INFER_MAX_TOKENS,
    system: systemBlocks(input),
    messages: [{ role: "user", content: [{ type: "text", text: buildInferenceTask(input) }] }],
    outputSchema: C5_OUTPUT_SCHEMA,
  });

  if (call.kind === "error") return { kind: "failed", detail: call.error.message };
  if (call.kind === "refusal") return { kind: "failed", detail: `模型拒绝整理这一章：${call.userMessage}` };
  if (call.kind === "max_tokens") return { kind: "failed", detail: "输出达到上限，这一章的记录没整理完" };
  if (call.message.stop_reason !== "end_turn" && call.message.stop_reason !== "stop_sequence") {
    return { kind: "failed", detail: "模型响应没有正常结束，这一章的记录没整理完" };
  }

  const json = parseJson(textOf(call.message));
  if (json === null) return { kind: "failed", detail: "模型输出不是合法 JSON" };
  const issue = c5OutputIssue(json);
  if (issue !== null) return { kind: "failed", detail: `模型输出的结构不完整或字段无效：${issue}` };

  const parse = parseC5(json, { ...input.parseContextBase, chapterText: input.chapterText });
  const findings = crossCheckC5({ declaration: parse.declaration, chapterText: input.chapterText });
  // 只有引文定位是反推的硬闸门。其余 block 级规则（如一章一个视角）是**写作纪律**，
  // 旧稿的写法已成事实，按纪律拦住等于让作者没法把自己的书导进来。
  const blocking = findings.filter((f) => f.level === "block" && f.rule === "c5_anchor_unresolvable");
  const warnings = [...parse.warnings, ...findings.filter((f) => !blocking.includes(f)).map((f) => f.message)];
  const problems = [...parse.errors, ...blocking.map((f) => f.message)];
  return problems.length > 0 ? { kind: "problem", problems, warnings } : { kind: "ok", declaration: parse.declaration, warnings };
}

/** 取响应里的文本；结构化输出偶尔会被 markdown 围栏包住。 */
function textOf(message: Anthropic.Message): string {
  return message.content.filter((b): b is Anthropic.TextBlock => b.type === "text").map((b) => b.text).join("");
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")); } catch { return null; }
}
