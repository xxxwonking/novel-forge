/**
 * 结构事件流（§11、§12.0、§12.7）—— 系统的写模型。
 *
 * 设计判断：**单一事件流，不拆多流。**
 * C5 一次调用同时产出 events / foreshadow_planted / foreshadow_resolved /
 * relations_changed / character_states / character_presence 六类声明，它们
 * 共享同一个 (章号, 提交事务, 可信度) 三元组，且 §11.5 的代码交叉验证需要
 * 在同一章内跨类别比对（声明「资源」事件必须有对应 character_state 变更）。
 * 拆成多流后每次校验都要做流间 join，而 append-only 单流天然按 seq 有序，
 * 投影器一次扫描即可重建全部四张视图。
 *
 * 四张视图（伏笔时间线/情节线/人物弧线/关系图）全部是这条流的投影（读模型，
 * 见 projections.ts），不反向写回。
 */

import type {
  CharacterId,
  ChapterNo,
  Derived,
  EventSeq,
  ForeshadowId,
  IsoTimestamp,
  PlotLineId,
  Provenance,
  StructuralEventId,
  TextAnchor,
} from "./primitives.js";

// ── 信封 ────────────────────────────────────────────────────────────────

/**
 * 事件信封：所有结构事件共享的元数据。
 *
 * 划分原则：**信封装"这条声明是怎么来的"，载荷装"声明了什么"。**
 * 判据是可变性 —— 信封字段在 proposed→committed 的流转中会变
 * （provenance、decidedAt），载荷一旦写入就不可变。
 */
export interface EventEnvelope {
  readonly id: StructuralEventId;
  /** 存储层分配，全作品单调递增。投影器依赖它保证重放顺序。 */
  readonly seq: EventSeq;
  readonly chapter: ChapterNo;
  /** 产出这条声明的流程步骤。用于归因和模型准确率统计。 */
  readonly origin: EventOrigin;
  readonly provenance: Provenance;
  readonly createdAt: IsoTimestamp;
  /** 用户接受/否决的时刻。provenance 为 proposed 时不存在。 */
  readonly decidedAt?: IsoTimestamp;
  /**
   * 用户否决或修改的原因，可空。
   * 这是校准 C5 prompt 的唯一数据来源（§11.5 第三道防线）。
   */
  readonly reviewNote?: string;
}

export type EventOrigin =
  /** P4 作者规划伏笔（status: planned）。 */
  | "P4_outline"
  /** C5 同会话第二轮结构声明 —— 绝大多数事件的来源。 */
  | "C5_declaration"
  /** 异步伏笔候选抽取（§12.5），永远是 proposed，不进主清单。 */
  | "async_candidate"
  /** 旧稿反推：读作者导入的正文补出的结构声明，作者确认后才成为事实。 */
  | "import_inference"
  /** 用户在 UI 里手动标注/修正。 */
  | "user_edit";

// ── 载荷：五类事件 ──────────────────────────────────────────────────────

/** §11.2 的五类，穷举。不在此列即不算事件。 */
export type EventKind = "action" | "info" | "relation" | "resource" | "decision";

/** §11.4 权重。3=改变全书格局，2=改变本卷局面，1=局部推进。 */
export type EventWeight = 1 | 2 | 3;

/**
 * 剧情事件载荷。
 *
 * `summary` 必须含具体变化（§11.2 的"变化落地"要求）—— "他握紧了拳头"
 * 不算事件，"他打断了对方的手"才算。这一条只能靠 prompt + 人工抽查约束，
 * 无法在类型层强制。
 */
export interface PlotEventPayload {
  readonly type: "plot_event";
  readonly kind: EventKind;
  readonly summary: string;
  readonly weight: EventWeight;
  /** 归属情节线。§11.6：plot_advances 从这里派生，不让模型另填。 */
  readonly plotLine: PlotLineId | null;
  /** 涉及的人物，用于人物弧线视图。 */
  readonly participants: readonly CharacterId[];
  readonly anchor: TextAnchor;
}

// ── 载荷：伏笔 ──────────────────────────────────────────────────────────

/** §6.3。主线/支线/细节，决定 IMPACT 权重与断线阈值。 */
export type ForeshadowWeight = "main" | "sub" | "detail";

/** §6.3。明线=读者能察觉在埋，暗线=读者不该察觉（影响写作时的注入方式）。 */
export type ForeshadowVisibility = "overt" | "covert";

export interface ForeshadowPlantedPayload {
  readonly type: "foreshadow_planted";
  readonly foreshadowId: ForeshadowId;
  /** 从作者已确认规划进入正文时，沿用该规划的编号并保留关联。 */
  readonly plannedForeshadowId?: ForeshadowId;
  /** 短标签，进 L2 索引（§13.4 只给 label 不给 intent）。 */
  readonly label: string;
  /**
   * 作者意图。§6.3 最重要的字段 —— 它决定了什么算"收"。
   * 有它之后"这条收了吗"从模糊判断变成可判定问题。
   */
  readonly intent: string;
  readonly weight: ForeshadowWeight;
  readonly visibility: ForeshadowVisibility;
  /** 打算在哪章之前收。缺它就做不了"临近截止"提醒，C5 必填。 */
  readonly expectedBy: ChapterNo;
  readonly anchor: TextAnchor;
}

/** §12.3 C5：收束分完全/部分，部分收束按 60% 计入字数预算。 */
export type ResolutionCompleteness = "full" | "partial";

export interface ForeshadowResolvedPayload {
  readonly type: "foreshadow_resolved";
  readonly foreshadowId: ForeshadowId;
  readonly completeness: ResolutionCompleteness;
  /** 收束依据的原文片段。C6 收束完整性检查的输入。 */
  readonly anchor: TextAnchor;
}

/** §6.6 废弃态。没有它，几十章后清单一半是死条目。 */
export interface ForeshadowAbandonedPayload {
  readonly type: "foreshadow_abandoned";
  readonly foreshadowId: ForeshadowId;
  readonly reason: string;
}

/** 改期。§12.6.7 首页告警的 [改期] 按钮落到这里。 */
export interface ForeshadowRescheduledPayload {
  readonly type: "foreshadow_rescheduled";
  readonly foreshadowId: ForeshadowId;
  readonly expectedBy: ChapterNo;
}

// ── 载荷：人物与关系 ────────────────────────────────────────────────────

/**
 * 人物状态变更。§11.5 第二道防线：声明「资源」事件必须有对应的 state 变更，
 * 否则判为虚报。
 */
export interface CharacterStateChangedPayload {
  readonly type: "character_state_changed";
  readonly characterId: CharacterId;
  /** 当前支持 condition / location / vital；旧版额外字段仅作为历史记录保留。 */
  readonly field: string;
  /** 变更前的值。null 表示该字段此前未设置。 */
  readonly from: string | null;
  readonly to: string;
  readonly anchor: TextAnchor;
}

/** §11.5：声明「关系」事件必须有对应的 relation 变更。 */
export type RelationKind =
  | "ally"
  | "hostile"
  | "kin"
  | "romantic"
  | "mentor"
  | "subordinate"
  | "acquaintance"
  | "unknown";

export interface RelationChangedPayload {
  readonly type: "relation_changed";
  /** 有向：from 对 to 的态度。双向关系写两条。 */
  readonly from: CharacterId;
  readonly to: CharacterId;
  readonly fromKind: RelationKind | null;
  readonly toKind: RelationKind;
  /** 一句话说明这次转变。关系图的边悬浮提示用它。 */
  readonly note: string;
  readonly anchor: TextAnchor;
}

/**
 * 出场记录。驱动"角色消失 N 章"告警与人物弧线视图的横轴。
 *
 * 每章每人最多一条 —— 一章内多次出场不产生多条，presence 是章级布尔而非计数。
 */
export interface CharacterPresencePayload {
  readonly type: "character_presence";
  readonly characterId: CharacterId;
  /** 本章的角色定位，用于弧线视图的点大小。 */
  readonly role: "pov" | "major" | "minor" | "mentioned";
}

// ── 载荷：情节线 ────────────────────────────────────────────────────────

/**
 * 情节线推进。§11.6 明确这是从 PlotEventPayload.plotLine 派生的，
 * 因此它带 Derived 标记，投影器写入，C5 不得声明。
 */
export interface PlotAdvancePayload {
  readonly type: "plot_advance";
  readonly plotLine: PlotLineId;
  /** 由本章该情节线上的事件汇总而来。 */
  readonly weightSum: Derived<number>;
  readonly derivedFrom: readonly StructuralEventId[];
}

// ── 联合 ────────────────────────────────────────────────────────────────

export type StructuralEventPayload =
  | PlotEventPayload
  | ForeshadowPlantedPayload
  | ForeshadowResolvedPayload
  | ForeshadowAbandonedPayload
  | ForeshadowRescheduledPayload
  | CharacterStateChangedPayload
  | RelationChangedPayload
  | CharacterPresencePayload
  | PlotAdvancePayload;

export type StructuralEventType = StructuralEventPayload["type"];

/** 事件流的一条记录。信封 + 载荷，写入后 payload 不可变。 */
export interface StructuralEvent<P extends StructuralEventPayload = StructuralEventPayload> {
  readonly envelope: EventEnvelope;
  readonly payload: P;
}

/** 按 type 取出对应的事件类型，供投影器的窄化分支使用。 */
export type StructuralEventOf<T extends StructuralEventType> = StructuralEvent<
  Extract<StructuralEventPayload, { type: T }>
>;

// ── C5 的原始输出契约 ───────────────────────────────────────────────────

/**
 * C5 结构声明的模型输出 schema（§12.3）。
 *
 * 与 StructuralEvent 刻意分离：模型只填载荷里它有资格填的部分，
 * 信封（id/seq/时间戳/provenance）由代码补齐，plot_advance 由代码派生。
 * 这样"模型伪造 seq"或"模型自己填 plot_advances"在类型层就不可能。
 *
 * 数量上限来自 §12.3，超限即判为过度抽取，代码直接截断并记 warn。
 */
export interface C5Declaration {
  /** ≤4 条。超过先怀疑把描写当成了事件（§11.5）。 */
  readonly events: readonly PlotEventPayload[];
  /** ≤3 条，expectedBy 必填。 */
  readonly foreshadowPlanted: readonly ForeshadowPlantedPayload[];
  readonly foreshadowResolved: readonly ForeshadowResolvedPayload[];
  readonly relationsChanged: readonly RelationChangedPayload[];
  readonly characterStates: readonly CharacterStateChangedPayload[];
  readonly characterPresence: readonly CharacterPresencePayload[];
}

export const C5_LIMITS = {
  events: 4,
  foreshadowPlanted: 3,
} as const;
