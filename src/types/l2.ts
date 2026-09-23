/**
 * L2 索引的渲染契约（§13.4、§13.7）。
 *
 * 这里定的不是"数据长什么样"，而是**纯函数的输入输出契约**：
 * 同一份输入必须产出逐字节相同的字符串，否则 bp2 缓存失效、§9.2 的成本
 * 模型不成立。所以：
 *
 * 1. 渲染输入是一个已排序、已裁剪的 **快照**（`L2Snapshot`），不是活的状态对象。
 *    排序和裁剪在构建快照时完成一次，渲染函数里不允许再有 filter/sort。
 * 2. 渲染函数签名禁止第二个参数 —— 没有 options，就没有"某次调用带了不同选项"
 *    这条失效路径。
 * 3. 快照里不允许出现时间戳、当前章号、计数（§13.3 三条硬禁令）。
 *    唯一例外是 header 里的统计数字，它们是 L2 的一部分（§13.4 样例含
 *    "共 47 人"），但**L2 本身每 5-8 章才重建**，所以这个变化是受控的；
 *    L1 里则绝对不许有。
 */

import type { ChapterNo, CharacterId, ForeshadowId, PlotLineId, VolumeNo } from "./primitives.js";
import type { ForeshadowWeight } from "./events.js";
import type { CharacterTier } from "./character.js";

// ── 人物名录 ────────────────────────────────────────────────────────────

/**
 * 名录一行，四字段定长（§13.4，每人 ≈25 tok）。
 * 全部预格式化为字符串 —— 数字到字符串的转换在建快照时做完，
 * 渲染函数不做任何格式化决策。
 */
export interface L2CharacterRow {
  readonly id: CharacterId;
  readonly name: string;
  readonly role: string;
  readonly condition: string;
  /** 预格式化，如 `ch52`。 */
  readonly lastSeen: string;
}

// ── 章节梗概（距离衰减压缩）─────────────────────────────────────────────

/** §13.4 三档粒度。200 章从 8000 tok 压到 ~1000 tok 的唯一办法。 */
export type SynopsisGranularity = "per_chapter" | "per_5" | "per_15";

export interface L2SynopsisRow {
  readonly granularity: SynopsisGranularity;
  /** 预格式化的章号范围，如 `ch52` 或 `ch31-35`。 */
  readonly range: string;
  readonly text: string;
}

// ── 未收伏笔 ────────────────────────────────────────────────────────────

/** §13.4：只给 label 不给 intent。intent 平均 30-50 tok，绝大多数本章用不到。 */
export interface L2ForeshadowRow {
  readonly id: ForeshadowId;
  readonly weight: ForeshadowWeight;
  readonly label: string;
  /** 预格式化，如 `ch5埋`。 */
  readonly planted: string;
  /** 预格式化，如 `预期3卷` / `20章内`。 */
  readonly expectation: string;
  /** 逾期/临近标记。null 表示正常。 */
  readonly flag: "overdue" | "due_soon" | null;
}

// ── 情节线 ──────────────────────────────────────────────────────────────

export interface L2PlotLineRow {
  readonly id: PlotLineId;
  readonly label: string;
  readonly weight: ForeshadowWeight;
  /** 预格式化，如 `ch48`。 */
  readonly lastAdvanced: string;
}

// ── 快照 ────────────────────────────────────────────────────────────────

/**
 * L2 渲染快照。**构建时已完成排序与裁剪，渲染函数只做字符串拼接。**
 *
 * 裁剪规则（§13.4）：主要角色全列，次要角色仅列最近 20 章出现过的。
 * 被裁的仍在 L3，模型可用 load_character 取。
 */
/**
 * 裁剪档位，从最无害到最狠。与 `selectL3` 的 `TrimStage` 同构。
 *
 * 走的都是「越远越模糊」这条既有主张 —— 变的只是桶大小，不是信息的种类。
 * 人物、伏笔、情节线一律不裁：它们是「要做的事」，裁了模型就漏了。
 */
export type L2TrimStage = "none" | "far_30" | "far_60" | "far_120" | "minor_window_8" | "overflow";

export interface L2Snapshot {
  /** 快照契约版本。格式变更必须递增，否则旧缓存与新渲染混用无法察觉。 */
  readonly formatVersion: 1;
  /** 实际用到哪一档。不参与渲染，供测试与度量读取。 */
  readonly trimStage: L2TrimStage;
  /** 裁到最后一档仍超预算时的说明。 */
  readonly overflowNote?: string;
  readonly characters: {
    /** 已按 id 升序排好。 */
    readonly rows: readonly L2CharacterRow[];
    readonly totalCount: number;
    readonly majorCount: number;
  };
  /** 已按章号升序，粒度从粗到细。 */
  readonly synopsis: readonly L2SynopsisRow[];
  readonly foreshadows: {
    /** 已按 id 升序。 */
    readonly rows: readonly L2ForeshadowRow[];
    readonly counts: Readonly<Record<ForeshadowWeight, number>>;
  };
  /** 已按 id 升序。 */
  readonly plotLines: readonly L2PlotLineRow[];
  /**
   * 增量附加区（§13.4）。写完一章不重建索引，把新内容附在**末尾**，
   * 前缀不变 → bp2 仍命中。合并发生在 shouldRebuildL2() 为真时。
   */
  readonly pendingAppend: readonly L2AppendEntry[];
}

export interface L2AppendEntry {
  readonly chapter: ChapterNo;
  readonly synopsis: string;
  /** 该章的伏笔状态变化，预格式化为一行。 */
  readonly foreshadowDelta: readonly string[];
  readonly characterDelta: readonly string[];
}

/**
 * 渲染函数契约。**必须是纯函数，且只接受一个参数。**
 *
 * 加第二个参数（哪怕是 options）就等于给自己开了一条"某次调用格式不同"
 * 的失效路径，而这种失效是静默的 —— 只能靠 cache_read_input_tokens 掉到 0
 * 才发现。所以宁可多几个专用渲染函数，也不要一个带 options 的通用函数。
 */
export type L2Renderer = (snapshot: L2Snapshot) => string;

/** §13.4 的合并判定条件。后两个条件是正确性优先于成本。 */
export interface L2RebuildState {
  readonly pendingChapters: number;
  readonly pendingTokens: number;
  /** weight-3 事件必须及时进索引，不能压 8 章。 */
  readonly majorEventPending: boolean;
  /** 伏笔状态变化影响后续判断，同上。 */
  readonly foreshadowResolvedPending: boolean;
}

export const L2_REBUILD_LIMITS = {
  chapters: 8,
  tokens: 800,
} as const;

// ── 装配与缓存度量 ──────────────────────────────────────────────────────

/** §13.1 四段布局。段序即缓存前缀序，不可调换。 */
export type ContextSegment = 0 | 1 | 2 | 3 | 4;

/** §13.8 每次请求都要记录。`invalidatedAt` 直接指出哪段冷了。 */
export interface CacheMetrics {
  readonly chapter: ChapterNo;
  readonly step: string;
  readonly cacheCreationInputTokens: number;
  readonly cacheReadInputTokens: number;
  /** 未命中部分。 */
  readonly inputTokens: number;
  /** read / (read + input)。 */
  readonly hitRatio: number;
  /** 按各段已知 tok 数推断出的失效起点。null 表示全命中。 */
  readonly invalidatedAt: Exclude<ContextSegment, 4> | null;
}

/** §13.8 M1 验收门槛。段 0/1 冷次数必须为 0（除用户主动改 L1）。 */
export const M1_CACHE_TARGETS = {
  averageHitRatio: 0.7,
  steadyStateHitRatio: 0.85,
  rebuildChapterHitRatio: 0.45,
  coldSegment01Count: 0,
} as const;

/** 卷级衔接信息，跨卷第一章的 L3 装配用（§13.5 第 ② 条）。 */
export interface VolumeBoundary {
  readonly volume: VolumeNo;
  readonly summary: string;
  readonly endState: string;
}
