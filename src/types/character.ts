/**
 * 人物卡（§5.8、§13.5）。
 *
 * 两条硬约束决定了这个结构的形状：
 * 1. 用户会手工维护它，所以字段必须扁平、可读、能渲染成表单（§5.8）。
 * 2. `speech` 字段永不被裁剪（§13.5），因为 C6 声音一致性检查依赖它 ——
 *    所以它必须是可被代码/正则直接消费的结构，不能是一段散文描述。
 */

import type {
  CharacterId,
  ChapterNo,
  Derived,
  IsoTimestamp,
  Provenance,
  SettingId,
} from "./primitives.js";

/** 出场权重。决定 L2 名录裁剪、告警 IMPACT 与弧线视图取舍（§12.6.4）。 */
export type CharacterTier = "protagonist" | "major" | "minor" | "extra";

/** 生死状态。§5.4 属性冲突检测中"已死角色行动了"靠它做纯代码判定。 */
export type VitalStatus = "alive" | "dead" | "missing" | "unknown";

// ── 说话方式：C6 可机械消费的结构 ───────────────────────────────────────

/**
 * 说话方式。**每个字段都对应一种可执行的检查**，不允许出现无法检查的散文字段。
 *
 * 检查手段分两类：
 * - `code`：纯代码/正则，零成本，每场生成后即时跑（C4 内联轻检测）
 * - `model`：需要 Haiku 语义判断，在 C6 的模型通道批量跑
 */
export interface SpeechProfile {
  /**
   * 句长区间（字）。code 检查：该人物台词的中位句长落在区间外则 warn。
   * 这是最有效的单一指标 —— 话少的角色一旦开始长篇大论，读者立刻出戏。
   */
  readonly sentenceLength: { readonly min: number; readonly max: number };

  /**
   * 口头习惯语。code 检查：全章该人物台词中至少命中一次（长台词场景）。
   * 空数组表示这个角色没有口头禅，检查跳过。
   */
  readonly verbalTics: readonly string[];

  /**
   * 专属词汇/术语。code 检查：这些词只应出现在该人物台词里；
   * 出现在其他人物台词中则 warn（串味）。
   */
  readonly signatureLexicon: readonly string[];

  /**
   * 禁用词。code 检查：命中即 block。
   * 用途极实际 —— 古代角色说"OK"、文盲角色用书面成语、粗人说文雅词。
   */
  readonly forbiddenLexicon: readonly string[];

  /** 称谓表。code 检查：该人物提到目标人物时用的称呼必须在此表内。 */
  readonly addressForms: readonly AddressForm[];

  /**
   * 句式偏好。code 检查：按 ratio 统计该人物台词的句式分布，
   * 偏离超过 ±0.25 则 warn。
   */
  readonly syntaxBias: {
    /** 疑问句占比目标。审问型角色高，寡言型角色低。 */
    readonly question: number;
    /** 命令/祈使句占比目标。上位者高。 */
    readonly imperative: number;
    /** 省略/短促句占比目标。 */
    readonly elliptical: number;
  };

  /**
   * 语域。model 检查：Haiku 判断台词整体语域是否匹配。
   * 这是唯一无法用正则覆盖的维度，所以它是枚举而非自由文本 ——
   * 枚举值直接进 Haiku 的判定 prompt，判定结果可比对。
   */
  readonly register: SpeechRegister;

  /**
   * 情绪表达方式。model 检查：角色在压力下的反应方式是否一致。
   * 同样是枚举，理由同上。
   */
  readonly emotionalExpression: EmotionalExpression;

  /**
   * 正例台词，2-5 条。model 检查的 few-shot 输入，也是 UI 里给用户的直观锚。
   * **这是整个结构里性价比最高的字段** —— Haiku 拿真实台词做对比，
   * 比拿一堆枚举做抽象判断准得多。
   */
  readonly exemplars: readonly string[];

  /** 反例台词，0-3 条。用户看到模型写崩时可以直接把那句话粘到这里。 */
  readonly counterExemplars: readonly string[];
}

export interface AddressForm {
  /** 目标人物。null 表示对所有人的默认称谓。 */
  readonly target: CharacterId | null;
  /** 该人物称呼目标时用的词，如"苏姑娘"。 */
  readonly form: string;
  /** 仅在特定情境下使用，如"仅在人前"。可空。 */
  readonly condition?: string;
}

export type SpeechRegister =
  | "vulgar"
  | "colloquial"
  | "neutral"
  | "formal"
  | "literary"
  | "archaic";

export type EmotionalExpression =
  /** 藏 —— 越激动越沉默。 */
  | "suppressed"
  /** 直给 —— 情绪写在脸上和话里。 */
  | "direct"
  /** 反讽 —— 用玩笑掩饰。 */
  | "ironic"
  /** 爆发 —— 平静到失控之间没有中间态。 */
  | "explosive"
  /** 迂回 —— 从不直说重点。 */
  | "oblique";

/** 声音检查项的注册表形态，供 C6 遍历。 */
export type VoiceCheckChannel = "code" | "model";

export interface VoiceCheckSpec {
  readonly field: keyof SpeechProfile;
  readonly channel: VoiceCheckChannel;
  readonly action: "block" | "warn";
}

/** §12.3 C6 的声音一致性检查清单。顺序固定，便于快照测试。 */
export const VOICE_CHECKS: readonly VoiceCheckSpec[] = [
  { field: "forbiddenLexicon", channel: "code", action: "block" },
  // addressForms 原被标成 code，但「该人物提到目标时用的称呼必须在此表内」
  // 是语义判断：第三句里提到某人名字未必是当面称呼。机械判会大量误报，
  // 所以改判 model 通道（见 src/gate/voice-channel.ts 头的说明）。
  { field: "addressForms", channel: "model", action: "warn" },
  { field: "sentenceLength", channel: "code", action: "warn" },
  { field: "signatureLexicon", channel: "code", action: "warn" },
  { field: "verbalTics", channel: "code", action: "warn" },
  { field: "syntaxBias", channel: "code", action: "warn" },
  { field: "register", channel: "model", action: "warn" },
  { field: "emotionalExpression", channel: "model", action: "warn" },
] as const;

// ── 人物卡 ──────────────────────────────────────────────────────────────

/**
 * 人物卡。分三块：
 * - 作者/模型可编辑的设定（identity + speech + traits）
 * - 由事件流投影出的当前状态（`state`，UI 只读）
 * - 元数据
 *
 * 编辑权限的区分不靠约定，靠类型：`state` 里的字段都带 Derived 标记，
 * 只有投影器能构造它们。
 */
export interface CharacterCard {
  readonly id: CharacterId;
  /** 显示名，也是 L2 名录的第一列。改名要走专门的迁移（会影响所有 anchor）。 */
  readonly name: string;
  readonly aliases: readonly string[];
  readonly tier: CharacterTier;

  /** 首次出场章。0 表示筹备期建卡、尚未出场。 */
  readonly introducedAt: ChapterNo;

  // 设定块 —— 用户可编辑
  readonly profile: CharacterProfile;
  readonly speech: SpeechProfile;

  // 派生块 —— 投影器写入，UI 只读
  readonly state: CharacterState;

  readonly provenance: Provenance;
  readonly updatedAt: IsoTimestamp;
}

export interface CharacterProfile {
  /** 一句话定位，进 L2 名录第二列。 */
  readonly role: string;
  /** 外貌要点。属性冲突检测（§5.4）的比对对象，所以是键值对而非散文。 */
  readonly appearance: readonly CharacterAttribute[];
  /** 性格标签。C2 动机六问的输入之一。 */
  readonly traits: readonly string[];
  /** 明确禁止的行为。比正面标签更能约束模型（"绝不主动求人"）。 */
  readonly forbiddenBehaviors: readonly string[];
  /** 动机层级：表层诉求 / 深层恐惧。C2 第三问要它。 */
  readonly wants: string;
  readonly fears: string;
  readonly background: string;
}

/**
 * 可比对属性。§5.4 的属性冲突（眼睛颜色变了、左右手换了）靠这个做纯代码检测。
 * 散文式的外貌描述无法比对，所以强制拆成键值。
 */
export interface CharacterAttribute {
  /** 属性名，如 `眼睛颜色` / `惯用手` / `身高`。 */
  readonly key: string;
  readonly value: string;
  /** 该属性首次确立于哪章。冲突提示要能说"第 5 章设定是右手"。 */
  readonly establishedAt: ChapterNo;
  /** true 表示这条不可变（瞳色）；false 表示可以合理变化（伤势、发型）。 */
  readonly immutable: boolean;
}

/** 由事件流投影得出的当前状态。全部 Derived，UI 只读（§5.8 的例外）。 */
export interface CharacterState {
  readonly vital: Derived<VitalStatus>;
  /** 当前所在地。null 表示下落不明。 */
  readonly location: Derived<SettingId | null>;
  /** 一句话现状，进 L2 名录第三列，如"现居青州·养伤中"。 */
  readonly condition: Derived<string>;
  /** 最近出场章。L2 名录第四列，也是"角色消失"告警的输入。 */
  readonly lastSeenAt: Derived<ChapterNo>;
  /** 累计出场章数。弧线视图与 tier 校准用。 */
  readonly appearanceCount: Derived<number>;
}

// ── 模型提议 vs 用户编辑的冲突 ──────────────────────────────────────────

/**
 * 人物卡的字段级修改提议。
 *
 * 为什么需要它：C5 声明的 character_state_changed 只覆盖 `state`（派生块），
 * 但模型也会想改设定块（"他这章表明自己其实是左撇子"）。设定块是用户资产，
 * 不能被模型直接改，所以走提议队列。
 *
 * `baseUpdatedAt` 是乐观锁：提议生成后用户又手改了这张卡，则提议标为
 * stale 并要求用户重新裁决，避免静默覆盖用户的编辑。
 */
export interface CardChangeProposal {
  readonly characterId: CharacterId;
  /** 点分路径，如 `profile.appearance.眼睛颜色`。 */
  readonly field: string;
  readonly from: string | null;
  readonly to: string;
  readonly reason: string;
  readonly sourceChapter: ChapterNo;
  /** 提议生成时人物卡的 updatedAt。与当前值不符即 stale。 */
  readonly baseUpdatedAt: IsoTimestamp;
  readonly provenance: Extract<Provenance, "proposed" | "committed" | "rejected">;
}
