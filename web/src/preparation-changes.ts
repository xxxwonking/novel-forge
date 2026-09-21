/**
 * 资料编辑的**出站载荷**形状与裁剪函数。
 *
 * 为什么单独一层：`/api/preparation/author` 的 `changes` 按 ID 整体 upsert，
 * 服务端 schema 又是 `additionalProperties: false` —— 多送一个字段（比如人物卡上的
 * `provenance`）会直接 400「不允许字段 provenance」，少送一个必需字段（比如
 * `speech.sentenceLength`）会 400「缺少 sentenceLength」。也就是说：**送出去的每个
 * 对象都必须恰好是 schema 那个形状**，不能把服务端读回来的实体原样回传。
 *
 * 所以这里的每个 `*Input` 就是那份契约，每个裁剪函数只挑选 schema 认得的字段。
 * 新增字段时改这里一处；漏改会被根目录的 `test/preparation.test.ts` 契约测试拦住。
 *
 * 本模块刻意不依赖 DOM，也不 import `api.ts` —— 根目录 vitest 直接引入它做契约测试。
 */

export type CharacterTier = "protagonist" | "major" | "minor" | "extra";
export type Weight = "main" | "sub" | "detail";
export type SpeechRegister = "vulgar" | "colloquial" | "neutral" | "formal" | "literary" | "archaic";
export type EmotionalExpression = "suppressed" | "direct" | "ironic" | "explosive" | "oblique";
export type ChapterType = "transition" | "setup" | "event" | "payoff" | "climax";
export type EventKind = "action" | "info" | "relation" | "resource" | "decision";
export type NarrativePov = "first" | "third_limited" | "third_omniscient";
export type NarrativeTense = "past" | "present";
export type Genre = "xuanhuan" | "xianxia" | "urban" | "scifi" | "mystery" | "rulehorror";
export type Platform = "fanqie" | "feilu" | "qidian" | "unpublished";

/** 可比对属性。`establishedAt` / `immutable` 是 §5.4 属性冲突检测的依据，不能顺手丢掉。 */
export interface CharacterAttribute {
  key: string;
  value: string;
  establishedAt: number;
  immutable: boolean;
}

/** target 为 null 表示对所有人的默认称谓；condition 一律省略而不是给 undefined。 */
export interface AddressForm {
  target: string | null;
  form: string;
  condition?: string;
}

export interface SpeechProfile {
  sentenceLength: { min: number; max: number };
  verbalTics: readonly string[];
  signatureLexicon: readonly string[];
  forbiddenLexicon: readonly string[];
  addressForms: readonly AddressForm[];
  syntaxBias: { question: number; imperative: number; elliptical: number };
  register: SpeechRegister;
  emotionalExpression: EmotionalExpression;
  exemplars: readonly string[];
  counterExemplars: readonly string[];
}

/** 人物卡的**可编辑部分** —— 正好是服务端 `character` schema 的字段集合。 */
export interface CharacterInput {
  id: string;
  name: string;
  aliases: readonly string[];
  tier: CharacterTier;
  profile: {
    role: string;
    appearance: readonly CharacterAttribute[];
    traits: readonly string[];
    forbiddenBehaviors: readonly string[];
    wants: string;
    fears: string;
    background: string;
  };
  speech: SpeechProfile;
}

export interface SettingInput {
  id: string;
  name: string;
  kind: "location" | "organization";
  description: string;
  facts: readonly string[];
}

export interface PlotLineInput {
  id: string;
  label: string;
  weight: Weight;
}

export interface ChapterPlanInput {
  chapterType: ChapterType;
  coreEvent: string;
  secondaryThread: string | null;
  stageFeedback: string;
  hook: string;
  events: readonly { kind: EventKind; summary: string; weight: 1 | 2 | 3; plotLine: string | null }[];
  resolves: readonly { foreshadowId: string; weight: Weight; completeness: "full" | "partial" }[];
  plants: readonly { label: string; weight: Weight }[];
  characters: readonly string[];
  locations: readonly string[];
}

export interface BeatInput {
  chapter: number;
  volume: number;
  plan: ChapterPlanInput;
}

/**
 * 作者手改资料时能提交的改动。
 *
 * 数组一律按 `id` / `chapter` **整体替换**：给了谁就覆盖谁，没给的保持原样。
 * **不传某个 ID 只是「不动它」，不是「删掉它」** —— 删除要显式写进 `removals`。
 */
export interface PreparationChanges {
  setting?: Partial<{ title: string; genre: Genre; platform: Platform; premise: string; centralConflict: string; pov: NarrativePov; tense: NarrativeTense; protagonistTraits: string[]; protagonistForbidden: string[]; specialAbility: string; abilityLimits: string[]; worldRules: string[]; openingSituation: string; styleKeywords: string[]; romanceLine: string; taboos: string[] }>;
  profile?: Partial<{ genre: Genre; platform: Platform; targetWords: number }>;
  writingRules?: readonly string[];
  characters?: readonly CharacterInput[];
  settings?: readonly SettingInput[];
  plotLines?: readonly PlotLineInput[];
  volumes?: readonly VolumeInput[];
  beats?: readonly BeatInput[];
  /** 资料里声明的人物关系：没有正文出处，关系图上画虚线。 */
  relations?: readonly RelationClaim[];
  /** 删除单独说：其余字段一律是按 ID/章号的 upsert，少送一条不等于删。 */
  removals?: Removals;
}

export interface RelationClaim {
  from: string;
  to: string;
  fromKind: RelationKind | null;
  toKind: RelationKind;
  note: string;
}

export type RelationKind = "ally" | "hostile" | "kin" | "romantic" | "mentor" | "subordinate" | "acquaintance" | "unknown";

export interface Removals {
  characters?: readonly string[];
  settings?: readonly string[];
  plotLines?: readonly string[];
  volumes?: readonly number[];
  beats?: readonly number[];
}

/** 服务端读回的人物卡：比可编辑部分多三个只读字段。 */
export interface CharacterRecord extends CharacterInput {
  introducedAt: number;
  provenance: string;
  updatedAt: string;
}

export interface VolumeInput {
  volume: number;
  title: string;
  summary: string;
}

/** 服务端读回的节拍：比可编辑部分多一个派生预算。 */
export interface BeatRecord {
  chapter: number;
  volume: number;
  plan: ChapterPlanInput;
  budget: unknown;
}

/** `beatInput` 的入参：预算可有可无 —— 丢掉它正是这个函数的职责。 */
export type BeatLike = Omit<BeatRecord, "budget"> & { budget?: unknown };

const strings = (value: readonly string[]): string[] => value.map((line) => line.trim()).filter((line) => line.length > 0);

/** 裁剪人物卡。三个只读字段必须去掉，否则服务端以「不允许字段」拒绝整份方案。 */
export function characterInput(card: CharacterRecord): CharacterInput {
  return {
    id: card.id,
    name: card.name,
    aliases: strings(card.aliases),
    tier: card.tier,
    profile: {
      role: card.profile.role,
      appearance: card.profile.appearance.map((attribute) => ({ key: attribute.key, value: attribute.value, establishedAt: attribute.establishedAt, immutable: attribute.immutable })),
      traits: strings(card.profile.traits),
      forbiddenBehaviors: strings(card.profile.forbiddenBehaviors),
      wants: card.profile.wants,
      fears: card.profile.fears,
      background: card.profile.background,
    },
    speech: speechInput(card.speech),
  };
}

function speechInput(speech: SpeechProfile): SpeechProfile {
  return {
    sentenceLength: { min: speech.sentenceLength.min, max: speech.sentenceLength.max },
    verbalTics: strings(speech.verbalTics),
    signatureLexicon: strings(speech.signatureLexicon),
    forbiddenLexicon: strings(speech.forbiddenLexicon),
    // condition 可空：省略而不是给 undefined，`exactOptionalPropertyTypes` 下两者不同。
    addressForms: speech.addressForms.map((address) => ({ target: address.target, form: address.form, ...(address.condition === undefined ? {} : { condition: address.condition }) })),
    syntaxBias: { question: speech.syntaxBias.question, imperative: speech.syntaxBias.imperative, elliptical: speech.syntaxBias.elliptical },
    register: speech.register,
    emotionalExpression: speech.emotionalExpression,
    exemplars: strings(speech.exemplars),
    counterExemplars: strings(speech.counterExemplars),
  };
}

export function settingInput(card: SettingInput): SettingInput {
  return { id: card.id, name: card.name, kind: card.kind, description: card.description, facts: strings(card.facts) };
}

export function plotLineInput(def: PlotLineInput): PlotLineInput {
  return { id: def.id, label: def.label, weight: def.weight };
}

/** 裁剪卷：`updatedAt` 由服务端盖章，回传它会被当成不允许的字段。 */
export function volumeInput(card: VolumeInput): VolumeInput {
  return { volume: card.volume, title: card.title, summary: card.summary };
}

export function emptyVolume(volume: number): VolumeInput {
  return { volume, title: "", summary: "" };
}

/** 裁剪节拍：`budget` 是纯代码派生的产物，回传它等于让客户端伪造预算。 */
export function beatInput(beat: BeatLike): BeatInput {
  const p = beat.plan;
  return {
    chapter: beat.chapter,
    volume: beat.volume,
    plan: {
      chapterType: p.chapterType,
      coreEvent: p.coreEvent,
      secondaryThread: p.secondaryThread,
      stageFeedback: p.stageFeedback,
      hook: p.hook,
      events: p.events.map((event) => ({ kind: event.kind, summary: event.summary, weight: event.weight, plotLine: event.plotLine })),
      resolves: p.resolves.map((resolve) => ({ foreshadowId: resolve.foreshadowId, weight: resolve.weight, completeness: resolve.completeness })),
      plants: p.plants.map((plant) => ({ label: plant.label, weight: plant.weight })),
      characters: [...p.characters],
      locations: [...p.locations],
    },
  };
}

/**
 * 新增人物的空白底稿。ID 由作者填写 —— 后端按 `^C[A-Za-z0-9_-]+$` 校验。
 *
 * 句长区间给一个宽松默认：schema 要求 `max ≥ 1`（`max: 0` 会被拒），而收得太紧
 * 会让声音检查对这个还没写过台词的新角色一直报 warn。作者可以按角色再收紧。
 * `exemplars` 至少要一条（schema `minItems: 1`），空串会被裁剪函数滤掉，所以留空。
 */
export function emptyCharacter(): CharacterInput {
  return { id: "", name: "", aliases: [], tier: "major", profile: { role: "", appearance: [], traits: [], forbiddenBehaviors: [], wants: "", fears: "", background: "" },
    speech: { sentenceLength: { min: 0, max: 40 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [], syntaxBias: { question: 0, imperative: 0, elliptical: 0 }, register: "neutral", emotionalExpression: "direct", exemplars: [], counterExemplars: [] } };
}

export function emptySetting(): SettingInput {
  return { id: "", name: "", kind: "location", description: "", facts: [] };
}

export function emptyPlotLine(): PlotLineInput {
  return { id: "", label: "", weight: "sub" };
}

/**
 * 新增章节计划。出场人物与地点各留一个占位（schema 要求 `minItems: 1`，否则写章装配
 * 无从点名 L3），并预置一行空白事件 —— 不是因为它能直接提交，而是让作者一眼看到
 * "事件章要有事件"这个形状（`validatePlan` 对非过渡/布局章强制要求 ≥1 事件）。
 */
export function emptyBeat(chapter: number, volume: number, characters: string[], locations: string[]): BeatInput {
  return { chapter, volume, plan: { chapterType: "event", coreEvent: "", secondaryThread: null, stageFeedback: "", hook: "", events: [{ kind: "action", summary: "", weight: 1, plotLine: null }], resolves: [], plants: [], characters: [...characters], locations: [...locations] } };
}
