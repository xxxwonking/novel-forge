/**
 * 跨章返修的**模型通道**：在一个后续章里，指出哪几段依赖了被改掉的事实。
 *
 * 代码通道（impact.ts）只判得了结构事实的对不上；正文里「上次在码头他答应过的事」
 * 这类牵连没有编号可查，只能读正文。所以这一通道的问题问得很窄：
 * **给定「第 N 章改了这些」，本章哪几句话因此不成立了？**
 *
 * 纪律与 `gate/semantics-channel.ts` 完全一致，不另立一套：
 *   - 本文件只负责拼提示与解析，**不碰模型客户端**，可直接单测；
 *   - **引文必须逐字出现在本章正文里**，否则丢弃并说清丢了几条 —— 作者核对不了的
 *     建议只会让他去改本来没问题的段落；
 *   - 输出不成形就如实说「这一轮没查成」，不编造空结果。
 */

import type { ChapterNo } from "../types/primitives.js";

/** 一处待返修的段落。三样缺一不可：改哪、为什么、怎么改。 */
export interface RevisionPassage {
  readonly quote: string;
  readonly why: string;
  readonly suggestion: string;
}

export interface LocateResult {
  readonly passages: readonly RevisionPassage[];
  /** 丢弃与降级的说明，原样给作者看。 */
  readonly notes: readonly string[];
}

export interface LocateTaskInput {
  /** 被改动的那一章。 */
  readonly source: ChapterNo;
  /** 正在核对的后续章。 */
  readonly chapter: ChapterNo;
  /** 第 N 章改了什么，人读的一句话一条。 */
  readonly changes: readonly string[];
  /** 代码已经判出的对不上之处，给模型当线索；可以为空。 */
  readonly reasons: readonly string[];
  readonly chapterText: string;
}

export const REVISION_PASSAGE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    passages: {
      type: "array",
      description: "只报确实因为那些改动而不成立的段落；没有就返回空数组",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          quote: { type: "string", description: "要改的原文片段，必须逐字复制自本章正文，连续且不改写" },
          why: { type: "string", description: "说明这一段依赖了哪一条被改掉的事实" },
          suggestion: { type: "string", description: "具体怎么改。给出可以直接落笔的改法，不要泛泛地说「注意一致性」" },
        },
        required: ["quote", "why", "suggestion"],
      },
    },
  },
  required: ["passages"],
} as const;

export const REVISION_LOCATE_SYSTEM =
  "你是小说编辑。作者改了前面某一章，你的任务是在后面的章节里找出因此不再成立的段落，并给出可以直接落笔的改法。只报确有牵连的地方，逐字引用原文。";

/** 正文放在最后、独占一段：它最长，也最需要模型逐字对着看。 */
export function buildLocateTask(input: LocateTaskInput): string {
  return [
    `作者修改了第 ${input.source} 章。下面是这次修改改掉的事实，以及第 ${input.chapter} 章的正文。`,
    `请找出第 ${input.chapter} 章里因为这些改动而不再成立、或需要跟着调整的段落。`,
    "",
    `【第 ${input.source} 章改了什么】`,
    ...input.changes.map((item) => `- ${item}`),
    ...(input.reasons.length === 0 ? [] : ["", "【已经核对出的对不上之处】", ...input.reasons.map((item) => `- ${item}`)]),
    "",
    "【要求】",
    "- quote 必须逐字复制自本章正文的连续片段，保留标点，不要改写、不要拼接。核对不上就等于没有依据。",
    "- suggestion 要具体到能照着改：写清这一句应该变成什么意思，或补上哪一句交代。",
    "- 只报有把握的地方。没有牵连就返回空数组 —— 误报会让作者去改本来没问题的段落。",
    "",
    `【第 ${input.chapter} 章正文】`,
    input.chapterText,
  ].join("\n");
}

export function parseLocateVerdict(json: unknown, chapterText: string): LocateResult {
  const raw = readPassages(json);
  if (raw === null) {
    return { passages: [], notes: ["模型没有按约定格式给出结果，这一章本轮未查。正文与其余检查不受影响。"] };
  }

  const passages: RevisionPassage[] = [];
  let dropped = 0;
  for (const item of raw) {
    // 引文核对不上 → 丢弃。无法核对的建议比没有建议更糟。
    if (item.quote === "" || !chapterText.includes(item.quote)) { dropped += 1; continue; }
    if (passages.some((p) => p.quote === item.quote)) continue;
    passages.push(item);
  }

  const notes = dropped === 0 ? [] : [`模型另给出 ${dropped} 条建议，但它引用的原文在本章里找不到，已丢弃。要看这几处请人工核对。`];
  return { passages, notes };
}

function readPassages(json: unknown): readonly RevisionPassage[] | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const raw = (json as Record<string, unknown>)["passages"];
  if (!Array.isArray(raw)) return null;
  const text = (record: Record<string, unknown>, key: string): string =>
    typeof record[key] === "string" ? (record[key] as string).trim() : "";
  return raw.flatMap((item) => {
    if (typeof item !== "object" || item === null || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    return [{ quote: text(record, "quote"), why: text(record, "why"), suggestion: text(record, "suggestion") }];
  });
}
