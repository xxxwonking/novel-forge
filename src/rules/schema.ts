/**
 * `rules.yaml` 的类型契约（§10.15）。
 *
 * 这一层存在的唯一理由：**让代码里没有数字**。§10.1 的核心原则是
 * "没有硬编码常量，所有阈值都是 f(章节类型, 内容负载, 题材, 平台) 的输出"，
 * 而实现上的对应物就是所有系数都从这里读，代码只做算术。
 *
 * 与 beat.ts 的 ChapterBudget 的分工：这里是**输入系数**，那里是**派生产物**。
 * 产物带 Derived 品牌，系数不带 —— 系数是配置，用户和运营都能改（§10.15）。
 */

import type { ChapterType, Genre, Platform, PipelineTier } from "../types/beat.js";
import type { EventWeight, ForeshadowWeight } from "../types/events.js";
import type { CharacterTier } from "../types/character.js";
import type { GateLevel } from "../types/beat.js";

/** [下限, 上限] 区间。YAML 里一律用两元数组，比 {min,max} 短且不会写反。 */
export type Range = readonly [number, number];

export interface PlatformBase {
  /** 事件章的中位数字数。其他章节类型全部从它派生。 */
  readonly base: number;
  /** 上限的额外放宽比例，用于 max 的兜底钳制。 */
  readonly tolerance: number;
}

/** §10.6 一条密度规则。阈值 = max(hardMin, round(per1k × 千字数 × 题材系数))。 */
export interface DensityRule {
  readonly key: string;
  readonly per1k: number;
  /** 短章的保底上限 —— 2000 字给 1 次比给 0 次合理。 */
  readonly hardMin: number;
}

/** §10.7 零容忍规则的检测范围。 */
export type ZeroToleranceScope =
  /** 仅角色对白与内心活动。§10.7 那条最重要的 scope 限定。 */
  | "speech_and_thought"
  /** 仅章末最后 N 段。 */
  | "last_paragraphs"
  /** 全章。 */
  | "full_text";

export interface ZeroToleranceRule {
  readonly pattern: string;
  readonly scope: ZeroToleranceScope;
  readonly level: GateLevel;
  readonly message: string;
  /** scope 为 last_paragraphs 时生效。 */
  readonly lastParagraphs?: number;
}

export interface RepetitionRules {
  readonly parallelRun: {
    readonly minRun: number;
    readonly level: GateLevel;
    readonly message: string;
  };
  readonly interjectionRepeat: {
    readonly windowLines: number;
    readonly level: GateLevel;
    readonly message: string;
  };
}

export interface CrossChapterRules {
  readonly noStageFeedbackBlock: number;
  readonly noStageFeedbackPlanBlock: number;
  readonly noPayoffWarn: number;
  readonly plotLineGap: Readonly<Record<ForeshadowWeight, number>>;
  readonly foreshadowDueSoon: number;
  readonly foreshadowStale: number;
  readonly characterAbsent: Readonly<Record<CharacterTier, number>>;
}

export interface BeatValidationRules {
  readonly stageFeedbackBlacklist: readonly string[];
  readonly hookBlacklist: readonly string[];
  readonly coreEventConnectors: readonly string[];
  readonly coreEventConnectorLimit: number;
}

export interface PatchPriority {
  readonly patch: readonly string[];
  readonly forbidPatch: readonly string[];
  readonly trim: readonly string[];
  readonly forbidTrim: readonly string[];
}

/**
 * 规则集全貌。
 *
 * `version` 是 ChapterBudget.derivedFrom.rulesVersion 的来源 —— 改系数后
 * 已派生的预算不自动重算，但能被识别为旧版（用户写到 80 章时把前 79 章的
 * 预算悄悄改掉是更坏的行为）。
 */
export interface Rules {
  readonly version: string;
  readonly platform: Readonly<Record<Platform, PlatformBase>>;
  readonly typeFactor: Readonly<Record<ChapterType, Range>>;
  readonly resolveCost: Readonly<Record<ForeshadowWeight, Range>>;
  readonly partialRatio: number;
  readonly eventCost: Readonly<Record<EventWeight, Range>>;
  readonly splitAdviceFactor: number;
  readonly roundTo: number;
  readonly densityRange: Readonly<Record<ChapterType, Range>>;
  readonly eventWeightValue: Readonly<Record<EventWeight, number>>;
  readonly densityRules: readonly DensityRule[];
  /** 题材系数。内层 key 是 densityRules 的 key，缺省为 1.0。 */
  readonly genreMul: Readonly<Record<Genre, Readonly<Record<string, number>>>>;
  /** 高疲劳词表。`common` 加上当前题材那一档。 */
  readonly fatigueWords: Readonly<Record<string, readonly string[]>>;
  readonly interjections: readonly string[];
  readonly zeroTolerance: {
    readonly metaLeak: ZeroToleranceRule;
    readonly endingCliche: ZeroToleranceRule;
  };
  readonly repetition: RepetitionRules;
  readonly crossChapter: CrossChapterRules;
  readonly beatValidation: BeatValidationRules;
  readonly patchPriority: PatchPriority;
  readonly resolutionPatchWords: Range;
  readonly tier: Readonly<Record<ChapterType, PipelineTier>>;
}

/** densityRules 里各 key 的稳定引用。渲染顺序与 rules.yaml 的声明顺序一致。 */
export const THRESHOLD_KEYS = {
  fatigueWord: "高疲劳词_单词",
  interjection: "口头感叹词_总计",
  simile: "比喻",
  scenery: "环境描写段",
} as const;
