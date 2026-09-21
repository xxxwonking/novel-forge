/**
 * 读模型：四张结构视图 + 首页告警（§12.3、§12.6）。
 *
 * 这些类型全部是 events.ts 那条事件流的**投影**，不反向写回。分开定义的理由：
 * 视图需要的形状（按时间轴分桶、按线聚合）和事件流需要的形状（append-only、
 * 按 seq 有序）是两回事，混用会让其中一方变形。
 *
 * §12.3 的产品前提是"作者不读正文"，所以这四张视图是主界面而非附属功能 ——
 * 它们缺字段的代价是 schema 迁移，不是少一个图表。
 */

import type {
  AlertId,
  ChapterNo,
  CharacterId,
  Derived,
  ForeshadowId,
  IsoTimestamp,
  PlotLineId,
  StructuralEventId,
  TextAnchor,
} from "./primitives.js";
import type {
  EventKind,
  EventWeight,
  ForeshadowVisibility,
  ForeshadowWeight,
  RelationKind,
} from "./events.js";
import type { CharacterTier } from "./character.js";

/** 伏笔三态（§6.1）。缺 abandoned 清单会被死条目污染。 */
export type ForeshadowStatus = "planned" | "open" | "resolved" | "abandoned";

// ── 视图一：伏笔时间线 ──────────────────────────────────────────────────

export interface ForeshadowTimelineItem {
  readonly id: ForeshadowId;
  readonly label: string;
  readonly intent: string;
  readonly weight: ForeshadowWeight;
  readonly visibility: ForeshadowVisibility;
  readonly status: ForeshadowStatus;
  readonly plantedAt: ChapterNo;
  readonly plantedAnchor: TextAnchor;
  readonly expectedBy: ChapterNo;
  /** 收束记录。部分收束会有多条。 */
  readonly resolutions: readonly {
    readonly chapter: ChapterNo;
    readonly completeness: "full" | "partial";
    readonly anchor: TextAnchor;
  }[];
  /** 逾期章数，负数表示尚未到期。告警 decay 的输入。 */
  readonly overdueBy: Derived<number>;
}

// ── 视图二：情节线 ──────────────────────────────────────────────────────

export interface PlotLineTrack {
  readonly id: PlotLineId;
  readonly label: string;
  readonly weight: ForeshadowWeight;
  /** 断线阈值，按权重派生：主线 3 / 支线 12 / 细节 20（§10.8）。 */
  readonly gapLimit: Derived<number>;
  readonly lastAdvancedAt: ChapterNo;
  readonly currentGap: Derived<number>;
  /** 规划态（V1 排了但还没写）用虚线渲染。 */
  readonly points: readonly PlotLinePoint[];
}

export interface PlotLinePoint {
  readonly chapter: ChapterNo;
  readonly eventId: StructuralEventId;
  readonly summary: string;
  readonly weight: EventWeight;
  readonly kind: EventKind;
  readonly anchor: TextAnchor;
  readonly planned: boolean;
}

// ── 视图三：人物弧线 ────────────────────────────────────────────────────

export interface CharacterArc {
  readonly characterId: CharacterId;
  readonly name: string;
  readonly tier: CharacterTier;
  readonly introducedAt: ChapterNo;
  readonly lastSeenAt: ChapterNo;
  /**
   * 出场分桶。**不是逐章数组** —— 300 章 × 200 人的稠密矩阵前端吃不下。
   * 只存有出场的章，空缺即未出场。
   */
  readonly presence: readonly {
    readonly chapter: ChapterNo;
    readonly role: "pov" | "major" | "minor" | "mentioned";
  }[];
  /** 状态变更节点，弧线上的关键点。 */
  readonly turningPoints: readonly {
    readonly chapter: ChapterNo;
    readonly field: string;
    readonly from: string | null;
    readonly to: string;
    readonly anchor: TextAnchor;
  }[];
}

// ── 视图四：关系图 ──────────────────────────────────────────────────────

export interface RelationEdge {
  readonly from: CharacterId;
  readonly to: CharacterId;
  readonly kind: RelationKind;
  readonly note: string;
  readonly changedAt: ChapterNo;
  /** 正文出处。null = 尚未写进正文（来自资料声明），图上画虚线。 */
  readonly anchor: TextAnchor | null;
  readonly declared: boolean;
  /** 历史沿革，供"这两人怎么走到这一步"的悬浮展开。 */
  readonly history: readonly {
    readonly chapter: ChapterNo;
    readonly kind: RelationKind;
    readonly note: string;
  }[];
}

// ── 首页告警（§12.6）────────────────────────────────────────────────────

export type AlertCategory =
  | "foreshadow_overdue"
  | "foreshadow_stale"
  | "plotline_gap"
  | "character_missing"
  | "setting_conflict"
  | "attribute_conflict"
  | "anchor_stale"
  | "pacing_soft"
  | "style_drift";

/** §12.6.3 修复动作的位置。首页只放前向修复，后向修复进「待返修」。 */
export type RepairDirection = "forward" | "backward";

/**
 * 一条首页告警。
 *
 * `id` 的构造规则（`<category>:<objectId>`）保证同一问题永远同一 ID ——
 * 每次诊断重跑不会产生重复条目，fatigueCount 和 acknowledged 也能稳定附着。
 */
export interface Alert {
  readonly id: AlertId;
  readonly category: AlertCategory;
  readonly direction: RepairDirection;
  /** §12.6.4 影响面：主线 3.0 / 支线 1.5 / 细节 0.5。 */
  readonly impact: Derived<number>;
  readonly decay: Derived<number>;
  readonly score: Derived<number>;
  /** 供 UI 直接显示的一句话。 */
  readonly title: string;
  readonly detail: string;
  /** 指向的对象。视图上的元素靠它高亮。 */
  readonly subject: AlertSubject;
  /** §12.6.8 生命周期：忽略 ≥3 次移出首页候选。 */
  readonly fatigueCount: number;
  /** 用户标「有意为之」→ 永久静音。没有这个出口用户只能关掉整套诊断。 */
  readonly acknowledged: boolean;
  /** §12.6.2 类别迁移后的形态。null 表示尚未到拐点。 */
  readonly migratedTo: "suggest_abandon" | "confirm_exit" | null;
  /** 可执行动作。§12.6.7：告警的价值在于能一键写进节拍表。 */
  readonly actions: readonly AlertAction[];
  readonly createdAt: IsoTimestamp;
  readonly lastEvaluatedAt: IsoTimestamp;
}

export type AlertSubject =
  | { readonly kind: "foreshadow"; readonly id: ForeshadowId }
  | { readonly kind: "plotline"; readonly id: PlotLineId }
  | { readonly kind: "character"; readonly id: CharacterId }
  | { readonly kind: "chapter"; readonly chapter: ChapterNo }
  | { readonly kind: "anchor"; readonly anchor: TextAnchor };

/**
 * 一键动作。**payload 必须自带改节拍表所需的全部信息** ——
 * §12.6.7 的闭环是「点按钮 → 改节拍表 → 触发 V3 重算预算 → 告警消失」，
 * 前端不应该为了拼这个 mutation 再去查一遍伏笔详情。
 */
export type AlertAction =
  | {
      readonly kind: "add_resolution_to_beat";
      readonly targetChapter: ChapterNo;
      readonly foreshadowId: ForeshadowId;
      readonly weight: ForeshadowWeight;
      readonly completeness: "full" | "partial";
    }
  | {
      readonly kind: "add_advance_to_beat";
      readonly targetChapter: ChapterNo;
      readonly plotLine: PlotLineId;
    }
  | {
      readonly kind: "add_character_to_beat";
      readonly targetChapter: ChapterNo;
      readonly characterId: CharacterId;
    }
  | { readonly kind: "reschedule"; readonly foreshadowId: ForeshadowId; readonly expectedBy: ChapterNo }
  | { readonly kind: "abandon"; readonly foreshadowId: ForeshadowId }
  | { readonly kind: "confirm_exit"; readonly characterId: CharacterId }
  | { readonly kind: "acknowledge" }
  | { readonly kind: "open_view"; readonly view: "foreshadow" | "plotline" | "arc" | "relation" }
  | { readonly kind: "jump_to_anchor"; readonly anchor: TextAnchor };

/**
 * 告警的用户侧状态。**与 Alert 分开存**：Alert 每次诊断全量重算（和四视图
 * 一样是投影），而 fatigueCount / acknowledged 是用户行为的累积，重算不能覆盖。
 *
 * 靠 AlertId 的 `<类别>:<对象 ID>` 规则附着 —— 同一问题永远同一 ID，
 * 所以重跑诊断后状态自动对上，不需要额外的关联表。
 *
 * ⚠ 首页条数上限、fatigue 系数、direction 系数曾经是本文件的三个常量，
 * 现已移入 `rules.yaml` 的 `alerts` 段（§10.1：代码里没有数字）。
 */
export interface AlertState {
  readonly id: AlertId;
  readonly fatigueCount: number;
  readonly acknowledged: boolean;
  /** 首次产生的时刻。Alert 每次重算，"这个问题存在多久了"只能存在这里。 */
  readonly createdAt: IsoTimestamp;
  /**
   * 上次评估时的 decay 值。**null 表示还没被评估过**。
   *
   * 文档没提这个字段，但 §12.6.4 末条要求"decay 显著上升时重置 fatigue 并
   * 重新入池"，而"上升"是与历史比较 —— 不存旧值就无法判断。
   * 用户第一次忽略"感情线断了 12 章"，等它断到 25 章时问题性质已变。
   *
   * 用 null 而不是 0 表示"未评估"：0 会被当成一个真实的旧值，于是"从 0 涨到
   * 1.8"看起来就是一次显著上升，把用户刚点下的忽略立刻重置掉 ——
   * 这个 bug 实际发生过，因为创建状态记录的时机正是用户第一次点忽略。
   */
  readonly lastDecay: number | null;
  /** 已迁移到的形态。迁移时要重置 fatigue，所以得记住迁过没有。 */
  readonly migratedTo: Alert["migratedTo"];
}
