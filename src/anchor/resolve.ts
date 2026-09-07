/**
 * 文本锚点的重定位（§6.3）。
 *
 * 这是 M3「点击图上元素跳读原文」的地基 —— 四张视图上每个元素都带 TextAnchor，
 * 没有这一层它们只是不能点的标签。
 *
 * 核心判断（§6.3 原文）：**quote 是主键，offset 只是提示。** 作者会回头改
 * 早期章节，一次插入就让后面所有 offset 全错，而 quote 在文本被改动后仍可
 * 重新定位。所以这里的算法是"拿 quote 搜，用 offsetHint 挑最近的那个"，
 * 不是"从 offsetHint 读 length 个字符"。
 *
 * stale 是一等状态而非错误：作者改写了那一段是完全正常的行为，UI 要能渲染
 * 降级态（"原文已变动"+ 所在章的入口），而不是弹错误。
 */

import type { AnchorResolution, ChapterNo, TextAnchor } from "../types/primitives.js";
import type { AnchorRules } from "../rules/schema.js";

/** 章节正文的来源。Map 与函数两种形态都常见，所以取最小接口。 */
export type ChapterTextSource = (chapter: ChapterNo) => string | undefined;

/** 从 Map 造一个取文源。 */
export function textSourceOf(texts: ReadonlyMap<ChapterNo, string>): ChapterTextSource {
  return (chapter) => texts.get(chapter);
}

/**
 * 解析一个锚点。
 *
 * `occurrence` 的处理：quote 在该章命中多次时取第几次（0 起）。但**命中次数
 * 变了以后不硬认序号** —— 作者删掉了前面那处重复，原本的 occurrence=1 就该
 * 落到现在的第 0 处。所以策略是：先按 occurrence 取，取不到则退化为"离
 * offsetHint 最近的那处"。硬认序号会把一次无害的编辑变成 stale。
 */
export function resolveAnchor(
  anchor: TextAnchor,
  source: ChapterTextSource,
  rules: AnchorRules,
): AnchorResolution {
  const text = source(anchor.chapter);
  if (text === undefined) return { status: "stale", reason: "chapter_missing" };

  const quote = anchor.quote;
  if (quote === "") return { status: "stale", reason: "quote_not_found" };

  const hits = findAll(text, quote);
  if (hits.length === 0) return { status: "stale", reason: "quote_not_found" };

  const offset = hits[anchor.occurrence] ?? nearestTo(hits, anchor.offsetHint);
  const length = quote.length;
  const shiftedBy = offset - anchor.offsetHint;

  if (Math.abs(shiftedBy) <= rules.shiftTolerance) {
    return { status: "exact", offset, length };
  }
  return { status: "shifted", offset, length, shiftedBy };
}

/**
 * 批量解析。视图渲染一次要解析几十上百个锚点，逐个调用会把同一章的正文
 * 反复取出来 —— 这里按章分组，每章只搜一次。
 */
export function resolveAnchors<T>(
  items: readonly T[],
  anchorOf: (item: T) => TextAnchor,
  source: ChapterTextSource,
  rules: AnchorRules,
): readonly { readonly item: T; readonly resolution: AnchorResolution }[] {
  const cache = new Map<ChapterNo, string | undefined>();
  const cached: ChapterTextSource = (chapter) => {
    if (!cache.has(chapter)) cache.set(chapter, source(chapter));
    return cache.get(chapter);
  };
  return items.map((item) => ({ item, resolution: resolveAnchor(anchorOf(item), cached, rules) }));
}

/**
 * quote 的全部命中位置。
 *
 * 用 indexOf 而非正则：quote 是正文片段，里面的 `(` `.` `*` 会被当成元字符。
 * 这也是 text/measure.ts 的 countOccurrences 用同一手法的理由。
 */
function findAll(text: string, quote: string): readonly number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const idx = text.indexOf(quote, from);
    if (idx === -1) return out;
    out.push(idx);
    from = idx + quote.length;
  }
}

function nearestTo(hits: readonly number[], target: number): number {
  let best = hits[0] ?? 0;
  let bestDist = Math.abs(best - target);
  for (const h of hits) {
    const d = Math.abs(h - target);
    if (d < bestDist) {
      best = h;
      bestDist = d;
    }
  }
  return best;
}

/**
 * 锚点的可读上下文。UI 在跳读页高亮时要显示锚点前后各若干字。
 *
 * 窗口大小由调用方给（它是布局参数而非规则常量，所以不进 rules.yaml），
 * 但截断边界在这里算 —— 前端做字符切分容易在代理对上切坏。
 */
export function anchorContext(
  text: string,
  resolution: AnchorResolution,
  window: number,
): { readonly before: string; readonly hit: string; readonly after: string } | null {
  if (resolution.status === "stale") return null;
  const start = resolution.offset;
  const end = start + resolution.length;
  return {
    before: text.slice(Math.max(0, start - window), start),
    hit: text.slice(start, end),
    after: text.slice(end, end + window),
  };
}
