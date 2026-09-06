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
 * 渲染 L2 的**稳定部分**（不含增量区）。这一段之后才是 bp2。
 *
 * 增量区刻意不在这里 —— 见 `renderL2Append` 的说明。
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

  return lines.join("\n");
};

/**
 * 渲染增量附加区（§13.4）。
 *
 * **必须与 renderL2 分成两个 block，bp2 挂在稳定部分之后。**
 *
 * §13.4 说"把新内容附在段 2 末尾，前缀不变 → bp2 仍命中"，但这只在
 * breakpoint 位于追加点**之前**时成立。如果增量区和稳定部分拼成同一个
 * 带 cache_control 的 block，那么每写一章 block 内容就变，bp2 每章都要
 * 重新创建 —— 缓存写入价是读取价的数倍，反而比不缓存更贵。
 *
 * 分开后：稳定部分挂 bp2 命中，增量区跟在后面不缓存（它只有几十 token）。
 * 空时返回空串，调用方不产生 block。
 */
export function renderL2Append(s: L2Snapshot): string {
  if (s.pendingAppend.length === 0) return "";
  const lines = ["[最新进展]"];
  for (const a of s.pendingAppend) lines.push(appendEntry(a));
  return lines.join("\n");
}
