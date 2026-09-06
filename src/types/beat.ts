/**
 * 节拍表与派生预算（§10、§12.2）。
 *
 * 核心约束（§10.1）：**没有硬编码常量，所有阈值都是派生的。**
 * 类型层的体现是 `ChapterBeat` 被切成两半：
 * - `plan`：V1 模型排出、用户可改的规划输入
 * - `budget`：V3 纯代码派生的产物，全部带 Derived 标记
 *
 * 因为 Derived<T> 的品牌字段只有 deriveWordBudget() 之类的函数能构造，
 * "把模型输出的字数直接塞进预算"这个错误在编译期就被挡住。
 */

import type {
  ChapterNo,
  CharacterId,
  Derived,
  ForeshadowId,
  IsoTimestamp,
  PlotLineId,
  Provenance,
  SettingId,
  VolumeNo,
} from "./primitives.js";
import type {
  EventKind,
  EventWeight,
  ForeshadowWeight,
  ResolutionCompleteness,
} from "./events.js";

/** §10.4 章节类型。字数因子与密度区间都由它派生。 */
export type ChapterType = "transition" | "setup" | "event" | "payoff" | "climax";

/** §10.3 发布平台。决定字数基准。 */
export type Platform = "fanqie" | "feilu" | "qidian" | "unpublished";

/** §10.6 题材。决定词表与各项检测阈值的系数。 */
export type Genre = "xuanhuan" | "xianxia" | "urban" | "scifi" | "mystery" | "rulehorror";

/** §12.8 流程三档，按章节类型自动选，不让用户选。 */
export type PipelineTier = "fast" | "standard" | "strict";

// ── 作品级配置（第 0 层）────────────────────────────────────────────────

/** §10.3。base 是"事件章的中位数"，其他类型从它派生。 */
export interface WorkProfile {
  readonly platform: Platform;
  readonly genre: Genre;
  /** 全书目标字数，用于进度显示。不参与任何阈值派生。 */
  readonly targetWords: number;
}

// ── 规划输入（V1 产出，用户可改）────────────────────────────────────────

/** 节拍表里计划要收的伏笔。完整度是规划意图，实际完成度由 C6 校验。 */
export interface PlannedResolution {
  readonly foreshadowId: ForeshadowId;
  readonly weight: ForeshadowWeight;
  readonly completeness: ResolutionCompleteness;
}

/** 节拍表里计划发生的事件。这是预算派生的主要输入。 */
export interface PlannedEvent {
  readonly kind: EventKind;
  readonly summary: string;
  readonly weight: EventWeight;
  readonly plotLine: PlotLineId | null;
}

/**
 * 章节规划。V1 模型排出，V2 纯代码校验，用户可编辑。
 *
 * §12.2 V2 的 block 规则作用在这里：`stageFeedback` 含"铺垫/等待/后续/继续"
 * 直接打回，`hook` 含"风暴/开始/不平静/更大"直接打回。
 */
export interface ChapterPlan {
  readonly chapterType: ChapterType;
  /** 核心事件一句话。§12.2：需要两个"然后"才说清 → 提示拆章。 */
  readonly coreEvent: string;
  /** 次级推进，可空。 */
  readonly secondaryThread: string | null;
  /**
   * 阶段反馈 —— 本章给读者的实际兑现。
   * V2 校验的第一条：写"继续铺垫"一律打回，必须是具体兑现或升级。
   */
  readonly stageFeedback: string;
  /** 章末钩子。V2 校验黑名单同上。 */
  readonly hook: string;
  readonly events: readonly PlannedEvent[];
  readonly resolves: readonly PlannedResolution[];
  /** 本章计划要埋的伏笔（仅 label + 权重，intent 由 C5 写作时给出）。 */
  readonly plants: readonly { readonly label: string; readonly weight: ForeshadowWeight }[];
  /** 点名出场的人物。C1 的 L3 装配靠它（§13.5 显式声明路径）。 */
  readonly characters: readonly CharacterId[];
  readonly locations: readonly SettingId[];
}

// ── 派生预算（V3 产出，纯代码）──────────────────────────────────────────

/** §10.4 派生字数预算。 */
export interface WordBudget {
  readonly min: number;
  readonly max: number;
  /** 甜点值 = (min+max)/2。写进 prompt 让模型有目标。 */
  readonly sweet: number;
}

/** §10.5 加权事件密度区间。 */
export interface DensityRange {
  readonly min: number;
  readonly max: number;
}

/**
 * §10.6 第 2 层检测阈值。按字数与题材缩放，所以必须随预算一起派生。
 * key 与 rules.yaml 里的规则 key 一一对应。
 */
export type DetectionThresholds = Readonly<Record<string, number>>;

/** §10.4 上限兜底触发的拆章建议。 */
export interface SplitAdvice {
  readonly reason: "budget_exceeds_platform_cap";
  /** 建议断点。§10.4：绝不放在一条主线伏笔的收束过程中间。 */
  readonly suggestedBreakAfter: ForeshadowId | null;
  readonly note: string;
}

/**
 * 派生预算包。整体被 Derived 包住 —— 只有 deriveBudget() 能造出它。
 *
 * §10.2：第 1 层必须在**写作前**算出来。模型知道自己有 5300 字空间，
 * 就不会写到 2400 字急着收尾。
 */
export interface ChapterBudget {
  readonly words: Derived<WordBudget>;
  readonly density: Derived<DensityRange>;
  readonly thresholds: Derived<DetectionThresholds>;
  /** 流程档位也是派生的（§12.8 按章节类型自动选）。 */
  readonly tier: Derived<PipelineTier>;
  readonly splitAdvice: SplitAdvice | null;
  /** 派生时用的作品配置快照。改平台后要能解释旧章为何是旧预算。 */
  readonly derivedFrom: {
    readonly platform: Platform;
    readonly genre: Genre;
    readonly rulesVersion: string;
  };
  readonly derivedAt: IsoTimestamp;
}

// ── 节拍表 ──────────────────────────────────────────────────────────────

/**
 * 一章的节拍表。
 *
 * `budget` 可空的唯一原因：V1 刚排完、V3 还没跑。一旦 V3 跑过就永久存在，
 * 且重算会生成新的 budget 对象（§12.6.7 一键改节拍 → 触发 V3 重算）。
 */
export interface ChapterBeat {
  readonly chapter: ChapterNo;
  readonly volume: VolumeNo;
  readonly plan: ChapterPlan;
  readonly budget: ChapterBudget | null;
  readonly provenance: Provenance;
  readonly updatedAt: IsoTimestamp;
}

// ── V2 校验结果 ─────────────────────────────────────────────────────────

/** §10.10 动作分级。 */
export type GateLevel = "block" | "warn" | "info" | "pass";

/**
 * 一条校验结果。
 *
 * `pass` 是 §10.10 里容易被忽略但很重要的一级：它让"违规但正确"的情况
 * （高潮章超额但收束未完成）有正当出口并留下记录。没有它，用户面对一个
 * 无法消除的红色警告只能关掉整个检查器。
 */
export interface GateFinding {
  readonly rule: string;
  readonly level: GateLevel;
  readonly message: string;
  /** level 为 pass 时必填 —— 放行必须留下理由。 */
  readonly passReason?: string;
  /** 实测值 vs 阈值，供体检面板显示。 */
  readonly measured?: number;
  readonly threshold?: number;
}

/** §10.9 超字数分流的处理动作。 */
export type OverflowAction =
  | { readonly action: "ok" }
  | { readonly action: "trim"; readonly targets: readonly string[] }
  | { readonly action: "patch"; readonly targets: readonly string[] }
  | { readonly action: "split"; readonly at: string }
  | { readonly action: "pass"; readonly note: string };
