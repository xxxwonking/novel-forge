/**
 * L1 常驻层的数据形状（§13.3）。
 *
 * 这一层同时是缓存前缀的第一段，所以它的类型设计目标不是表达力，而是
 * **稳定性**：字段少、全部由 P2 交互式问答一次填定、之后极少改。
 * 三条硬禁令（§13.3）对应到类型上就是：这里没有任何字段可以承载
 * 时间戳、章号、计数或用户标识。
 */

import type { Genre, Platform } from "./beat.js";
import type { IsoTimestamp, VolumeNo } from "./primitives.js";

/** 叙事视角。POV 纪律是 L1 里最重要的一条约束。 */
export type NarrativePov = "first" | "third_limited" | "third_omniscient";

export type NarrativeTense = "past" | "present";

/**
 * 作品设定 —— L1 的可编辑部分，由 P2 产出。
 *
 * 每个字段都是"整本书恒定"的。任何随写作进展而变的东西都不属于这里，
 * 它们在 L2（索引）或 L3（详情）。
 */
export interface WorkSetting {
  readonly title: string;
  readonly genre: Genre;
  readonly platform: Platform;
  /** 全书要讲的一句话。 */
  readonly premise: string;
  /** 核心冲突。 */
  readonly centralConflict: string;
  readonly pov: NarrativePov;
  readonly tense: NarrativeTense;
  /** 主角性格标签。C2 动机六问会比对它。 */
  readonly protagonistTraits: readonly string[];
  /** 主角明确禁止的行为。比正面标签更能约束模型。 */
  readonly protagonistForbidden: readonly string[];
  /** 金手指/特殊能力，以及它的限制。限制比能力更重要 —— 无限制即无冲突。 */
  readonly specialAbility: string;
  readonly abilityLimits: readonly string[];
  /** 世界观要点，每条一句。 */
  readonly worldRules: readonly string[];
  /** 故事起点的时间与地点。注意：是故事内时间，不是现实日期。 */
  readonly openingSituation: string;
  /** 风格关键词。 */
  readonly styleKeywords: readonly string[];
  /** 感情线定位。 */
  readonly romanceLine: string;
  /** 特殊禁忌 —— 这本书绝对不写的东西。 */
  readonly taboos: readonly string[];
}

/**
 * 写作纪律 —— L1 的另一半，全平台共用，不随作品变。
 *
 * 独立成型的理由：它是平台资产（§15 把 prompt 约束变成系统保证的那部分），
 * 会随平台迭代升级，而 WorkSetting 是用户资产。两者混在一个字符串里，
 * 平台升级纪律就会污染所有用户的缓存前缀 —— 分开后可以做到只在
 * disciplineVersion 变更时才冷一次。
 */
export interface WritingDiscipline {
  /** 纪律文本的版本号。变更即全体缓存冷一次，所以要攒着一起发。 */
  readonly version: string;
  readonly rules: readonly string[];
}

/**
 * 一卷的名目与卷纲。
 *
 * **卷的边界不存在这里** —— 哪一章属于哪一卷由 `Beat.volume` 说了算，这里只有
 * 名目与摘要。存两份边界必然分歧，而节拍表本来就是按章排的，它才是那份真相。
 * 卷的章号范围由节拍表推出（见 `volumeRanges`）。
 *
 * 卷纲的用处是**给 L2 止血**：远距离梗概原本每 15 章一桶，桶内只是把各章第一句
 * 拼起来，字数一点没少 —— 章数一多 L2 就无上限地涨，而 L2 是最大的可缓存前缀。
 * 有卷纲的章段改用一句卷纲顶替，那一段才真的被压下去。
 */
export interface VolumeCard {
  readonly volume: VolumeNo;
  readonly title: string;
  /** 卷纲：这一卷发生了什么，一到三句。空串表示还没写，L2 不会用它顶替。 */
  readonly summary: string;
  readonly updatedAt: IsoTimestamp;
}
