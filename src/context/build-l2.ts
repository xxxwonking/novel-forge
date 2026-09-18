/**
 * L2 快照构建（§13.4）。
 *
 * 这里承担全部排序、裁剪与格式化 —— 让 renderL2 退化成纯字符串拼接。
 * 分离的理由：排序与裁剪是有决策的（哪些角色该裁、梗概怎么衰减），
 * 而渲染必须无决策。混在一起时，任何一次裁剪规则的微调都会静默改变
 * 缓存前缀，且无法通过"渲染是纯函数"这条测试发现。
 */

import type {
  L2AppendEntry,
  L2CharacterRow,
  L2ForeshadowRow,
  L2PlotLineRow,
  L2RebuildState,
  L2Snapshot,
  L2SynopsisRow,
  SynopsisGranularity,
} from "../types/l2.js";
import { L2_REBUILD_LIMITS } from "../types/l2.js";
import type { ForeshadowWeight } from "../types/events.js";
import type { CharacterCard } from "../types/character.js";
import type { ChapterNo, ForeshadowId, PlotLineId } from "../types/primitives.js";
import type { ForeshadowTimelineItem, PlotLineTrack } from "../types/projections.js";

/** §13.4 裁剪规则：次要角色仅列最近 N 章出现过的。 */
export const MINOR_CHARACTER_WINDOW = 20;

/** §13.4 距离衰减的两个分界。 */
export const SYNOPSIS_DECAY = { recent: 8, mid: 30, midBucket: 5, farBucket: 15 } as const;


export interface L2BuildInput {
  /** 当前章号 —— 已写完的最后一章。裁剪与衰减都相对它计算。 */
  readonly currentChapter: ChapterNo;
  readonly characters: readonly CharacterCard[];
  /** 逐章梗概，一句话。索引即章号，缺章允许（用 null 占位）。 */
  readonly chapterSynopses: readonly { readonly chapter: ChapterNo; readonly text: string }[];
  /** 卷纲，31 章以外的远距离梗概靠它兜底。 */
  readonly volumeSummaries: readonly { readonly volume: number; readonly text: string }[];
  readonly foreshadows: readonly ForeshadowTimelineItem[];
  readonly plotLines: readonly PlotLineTrack[];
  readonly pendingAppend: readonly L2AppendEntry[];
  /**
   * 伏笔「临近截止」的提前量（章）。
   *
   * 由调用方从 `rules.crossChapter.foreshadowDueSoon` 传进来。**别在这里写死一个数** ——
   * 这里曾经是 `DUE_SOON_WINDOW = 5`，而 gate 与告警读的是 rules 里的 3，于是模型在
   * 索引里看到的「临近」比代码判的早两章，两边静默分歧了很久。
   */
  readonly dueSoonWindow: number;
}

// ── 人物名录 ────────────────────────────────────────────────────────────

/**
 * §13.4：主要角色全列，次要角色仅列最近 20 章出现过的。
 * 否则 200 章时名录本身 300 人、7500 token。被裁的仍在 L3，
 * 模型可用 load_character 取。
 */
function buildCharacterRows(
  characters: readonly CharacterCard[],
  currentChapter: ChapterNo,
): { rows: readonly L2CharacterRow[]; totalCount: number; majorCount: number } {
  const majorCount = characters.filter(
    (c) => c.tier === "protagonist" || c.tier === "major",
  ).length;

  const kept = characters.filter((c) => {
    if (c.tier === "protagonist" || c.tier === "major") return true;
    if (c.tier === "extra") return false;
    return currentChapter - c.state.lastSeenAt <= MINOR_CHARACTER_WINDOW;
  });

  // 显式按 id 排序 —— 绝不依赖数组的插入顺序（§13.7）。
  const rows = [...kept]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<L2CharacterRow>((c) => ({
      id: c.id,
      name: c.name,
      role: c.profile.role,
      condition: c.state.condition,
      lastSeen: `ch${c.state.lastSeenAt}`,
    }));

  return { rows, totalCount: characters.length, majorCount };
}

// ── 章节梗概：距离衰减压缩 ──────────────────────────────────────────────

/** 把一批章的梗概压成一句。取首句拼接，不调用模型 —— 这一步必须零成本。 */
function condense(texts: readonly string[]): string {
  return texts.map((t) => t.split(/[。！？]/)[0] ?? t).join("；");
}

function bucketRange(from: ChapterNo, to: ChapterNo): string {
  return from === to ? `ch${from}` : `ch${from}-${to}`;
}

/**
 * §13.4 三档粒度。200 章从 8000 tok 压到 ~1000 tok 的唯一办法。
 *
 * 分桶用**绝对章号**对齐（`floor(ch / bucket)`）而非相对当前章的偏移量 ——
 * 相对分桶会让每写一章所有桶边界都平移，整个梗概区重新排布，
 * bp2 前缀全变。绝对分桶下只有跨越边界的那一章会引起局部变化。
 */
function buildSynopsisRows(
  synopses: readonly { readonly chapter: ChapterNo; readonly text: string }[],
  volumeSummaries: readonly { readonly volume: number; readonly text: string }[],
  currentChapter: ChapterNo,
): readonly L2SynopsisRow[] {
  const sorted = [...synopses].sort((a, b) => a.chapter - b.chapter);
  const rows: L2SynopsisRow[] = [];

  const recentFrom = currentChapter - SYNOPSIS_DECAY.recent + 1;
  const midFrom = currentChapter - SYNOPSIS_DECAY.mid + 1;

  const far = sorted.filter((s) => s.chapter < midFrom);
  const mid = sorted.filter((s) => s.chapter >= midFrom && s.chapter < recentFrom);
  const recent = sorted.filter((s) => s.chapter >= recentFrom);

  // 远距离：卷纲优先，其次每 15 章一桶
  for (const v of volumeSummaries) {
    rows.push({ granularity: "per_15", range: `卷${v.volume}`, text: v.text });
  }
  rows.push(...bucketize(far, SYNOPSIS_DECAY.farBucket, "per_15"));
  rows.push(...bucketize(mid, SYNOPSIS_DECAY.midBucket, "per_5"));
  for (const s of recent) {
    rows.push({ granularity: "per_chapter", range: `ch${s.chapter}`, text: s.text });
  }
  return rows;
}

function bucketize(
  items: readonly { readonly chapter: ChapterNo; readonly text: string }[],
  size: number,
  granularity: SynopsisGranularity,
): L2SynopsisRow[] {
  const buckets = new Map<number, { readonly chapter: ChapterNo; readonly text: string }[]>();
  for (const item of items) {
    const key = Math.floor((item.chapter - 1) / size);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [item]);
    else bucket.push(item);
  }
  return [...buckets.keys()]
    .sort((a, b) => a - b)
    .map((key) => {
      const group = buckets.get(key) ?? [];
      const first = group[0];
      const last = group[group.length - 1];
      const from = first?.chapter ?? key * size + 1;
      const to = last?.chapter ?? from;
      return {
        granularity,
        range: bucketRange(from, to),
        text: condense(group.map((g) => g.text)),
      };
    });
}

// ── 未收伏笔 ────────────────────────────────────────────────────────────

function buildForeshadowRows(
  items: readonly ForeshadowTimelineItem[],
  currentChapter: ChapterNo,
  dueSoonWindow: number,
): {
  rows: readonly L2ForeshadowRow[];
  counts: Readonly<Record<ForeshadowWeight, number>>;
} {
  const open = items.filter((f) => f.status === "open" || f.status === "planned");
  const counts: Record<ForeshadowWeight, number> = { main: 0, sub: 0, detail: 0 };
  for (const f of open) counts[f.weight] += 1;

  const rows = [...open]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<L2ForeshadowRow>((f) => ({
      id: f.id,
      weight: f.weight,
      label: f.label,
      planted: `ch${f.plantedAt}埋`,
      expectation: `预期ch${f.expectedBy}`,
      flag: overdueFlag(f.expectedBy, currentChapter, dueSoonWindow),
    }));

  return { rows, counts };
}

function overdueFlag(expectedBy: ChapterNo, currentChapter: ChapterNo, dueSoonWindow: number): "overdue" | "due_soon" | null {
  if (currentChapter > expectedBy) return "overdue";
  if (expectedBy - currentChapter <= dueSoonWindow) return "due_soon";
  return null;
}

// ── 情节线 ──────────────────────────────────────────────────────────────

function buildPlotLineRows(tracks: readonly PlotLineTrack[]): readonly L2PlotLineRow[] {
  return [...tracks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<L2PlotLineRow>((t) => ({
      id: t.id,
      label: t.label,
      weight: t.weight,
      lastAdvanced: `ch${t.lastAdvancedAt}`,
    }));
}

// ── 入口 ────────────────────────────────────────────────────────────────

export function buildL2Snapshot(input: L2BuildInput): L2Snapshot {
  return {
    formatVersion: 1,
    characters: buildCharacterRows(input.characters, input.currentChapter),
    synopsis: buildSynopsisRows(input.chapterSynopses, input.volumeSummaries, input.currentChapter),
    foreshadows: buildForeshadowRows(input.foreshadows, input.currentChapter, input.dueSoonWindow),
    plotLines: buildPlotLineRows(input.plotLines),
    pendingAppend: input.pendingAppend,
  };
}

/**
 * §13.4 合并判定。后两个条件是**正确性优先于成本** —— weight-3 事件和
 * 伏笔状态变化影响后续判断，不能压 8 章才生效。
 */
export function shouldRebuildL2(s: L2RebuildState): boolean {
  return (
    s.pendingChapters >= L2_REBUILD_LIMITS.chapters ||
    s.pendingTokens >= L2_REBUILD_LIMITS.tokens ||
    s.majorEventPending ||
    s.foreshadowResolvedPending
  );
}

/** 供告警与视图复用的类型出口，避免调用方 import 内部结构。 */
export type { ForeshadowId, PlotLineId };
