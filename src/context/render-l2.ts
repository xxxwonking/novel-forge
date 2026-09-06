/**
 * 段 2 渲染：L2 索引层（§13.4）。
 *
 * 单参数纯函数，签名由 `L2Renderer` 契约固定 —— 不接受 options，
 * 因为多一个参数就多一条"某次调用格式不同"的静默失效路径。
 *
 * 快照必须**已排序、已裁剪、已预格式化**。本模块不做任何 filter/sort/
 * 数字格式化 —— 那些都在 buildL2Snapshot() 里一次做完。
 *
 * 关于计数：§13.4 的样例含「共 47 人」，L2 允许有计数，因为 L2 每 5-8 章
 * 才重建一次，这个变化是受控的。L1 里则绝对不许（§13.3）。
 */

import type {
  L2AppendEntry,
  L2CharacterRow,
  L2ForeshadowRow,
  L2PlotLineRow,
  L2Renderer,
  L2Snapshot,
  L2SynopsisRow,
} from "../types/l2.js";
import type { ForeshadowWeight } from "../types/events.js";

const WEIGHT_LABEL: Readonly<Record<ForeshadowWeight, string>> = {
  main: "主线",
  sub: "支线",
  detail: "细节",
};

const FLAG_LABEL = { overdue: " | ⚠逾期", due_soon: " | ⚠临近" } as const;

function characterRow(c: L2CharacterRow): string {
  return `${c.name} | ${c.role} | ${c.condition} | 最近 ${c.lastSeen}`;
}

function synopsisRow(s: L2SynopsisRow): string {
  return `${s.range} ${s.text}`;
}

function foreshadowRow(f: L2ForeshadowRow): string {
  const flag = f.flag === null ? "" : FLAG_LABEL[f.flag];
  return `${f.id} | ${WEIGHT_LABEL[f.weight]} | ${f.label} | ${f.planted} | ${f.expectation}${flag}`;
}

function plotLineRow(p: L2PlotLineRow): string {
  return `${p.id} | ${WEIGHT_LABEL[p.weight]} | ${p.label} | 最近推进 ${p.lastAdvanced}`;
}

function appendEntry(a: L2AppendEntry): string {
  const parts = [`ch${a.chapter} ${a.synopsis}`];
  for (const d of a.foreshadowDelta) parts.push(`  伏笔：${d}`);
  for (const d of a.characterDelta) parts.push(`  人物：${d}`);
  return parts.join("\n");
}

/**
 * 渲染 L2。
 *
 * 段落顺序固定且**增量区永远在最后** —— 这是 §13.4 增量附加能命中 bp2
 * 的前提：写完一章只往尾部追加，前缀逐字节不变。
 */
export const renderL2: L2Renderer = (s: L2Snapshot): string => {
  const lines: string[] = [];

  lines.push(`[人物名录] 共 ${s.characters.totalCount} 人，主要 ${s.characters.majorCount} 人`);
  for (const c of s.characters.rows) lines.push(characterRow(c));

  lines.push("");
  lines.push("[章节梗概]");
  for (const row of s.synopsis) lines.push(synopsisRow(row));

  lines.push("");
  const c = s.foreshadows.counts;
  lines.push(
    `[未收伏笔] ${s.foreshadows.rows.length} 条（主线 ${c.main} / 支线 ${c.sub} / 细节 ${c.detail}）`,
  );
  for (const f of s.foreshadows.rows) lines.push(foreshadowRow(f));

  lines.push("");
  lines.push("[情节线]");
  for (const p of s.plotLines) lines.push(plotLineRow(p));

  // 增量区必须最后，且为空时不输出任何内容 —— 否则空标题本身就会成为
  // 前缀的一部分，第一次追加时反而破坏了前缀不变性。
  if (s.pendingAppend.length > 0) {
    lines.push("");
    lines.push("[最新进展]");
    for (const a of s.pendingAppend) lines.push(appendEntry(a));
  }

  return lines.join("\n");
};
