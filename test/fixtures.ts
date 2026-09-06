/**
 * 测试 fixture。
 *
 * 刻意用真实感的中文内容而非 `foo`/`bar` —— 缓存稳定性测试要测的是
 * 中文文本的渲染与 token 估算，占位符测不出来。
 */

import type { CharacterCard, SpeechProfile } from "../src/types/character.js";
import type { ChapterBeat, ChapterBudget, WorkProfile } from "../src/types/beat.js";
import type { WorkSetting } from "../src/types/work.js";
import type { ForeshadowTimelineItem, PlotLineTrack } from "../src/types/projections.js";
import type { Derived, TextAnchor } from "../src/types/primitives.js";
import type { SettingCard } from "../src/context/select-l3.js";

/** 测试内部构造 Derived 值的辅助。生产代码里只有 derive* 函数能这么做。 */
export function asDerived<T>(value: T): Derived<T> {
  return value as Derived<T>;
}

export const workSetting: WorkSetting = {
  title: "青州旧事",
  genre: "xuanhuan",
  platform: "fanqie",
  premise: "一个被逐出师门的少年靠一把断剑重回宗门顶点。",
  centralConflict: "主角要为师父之死复仇，但真凶是抚养他长大的三叔。",
  pov: "third_limited",
  tense: "past",
  protagonistTraits: ["记仇", "谨慎", "对弱者护短"],
  protagonistForbidden: ["绝不主动求人", "不在人前示弱", "不对同门下杀手"],
  specialAbility: "断剑能吸收对手的一式招法，但只能存一式。",
  abilityLimits: ["存新招即覆盖旧招", "吸收时会受同等反伤", "对超出自身境界两层的招法无效"],
  worldRules: [
    "修行分炼气、筑基、金丹、元婴四境，每境三层。",
    "宗门之间以试剑会定次序，试剑会每十年一次。",
    "灵石是唯一通用货币，一枚灵石可换十日灵米。",
  ],
  openingSituation: "青州城外的破庙，主角被逐出师门第三日。",
  styleKeywords: ["冷硬", "克制", "重动作轻抒情"],
  romanceLine: "与苏晚晴是同门旧识，全书不明写，只写并肩。",
  taboos: ["不写师徒恋", "不写主角滥杀无辜"],
};

export const workProfile: WorkProfile = {
  platform: "fanqie",
  genre: "xuanhuan",
  targetWords: 1_000_000,
};

const terseSpeech: SpeechProfile = {
  sentenceLength: { min: 4, max: 14 },
  verbalTics: [],
  signatureLexicon: ["断剑", "一式"],
  forbiddenLexicon: ["OK", "没问题", "宝宝"],
  addressForms: [
    { target: "C02", form: "血刀客" },
    { target: null, form: "阁下", condition: "对陌生人" },
  ],
  syntaxBias: { question: 0.1, imperative: 0.2, elliptical: 0.4 },
  register: "colloquial",
  emotionalExpression: "suppressed",
  exemplars: ["剑在我手里。", "你不配问。", "三叔知道这事。"],
  counterExemplars: ["哎呀，这可真是让人不知道该怎么说才好呢。"],
};

const florid: SpeechProfile = {
  sentenceLength: { min: 10, max: 40 },
  verbalTics: ["有意思"],
  signatureLexicon: ["血债", "刀口"],
  forbiddenLexicon: ["请", "劳驾"],
  addressForms: [{ target: "C01", form: "小畜生" }],
  syntaxBias: { question: 0.3, imperative: 0.3, elliptical: 0.1 },
  register: "vulgar",
  emotionalExpression: "ironic",
  exemplars: ["有意思，断了剑还敢站在我面前。", "血债这东西，从来只认刀口不认理。"],
  counterExemplars: [],
};

export const characters: readonly CharacterCard[] = [
  {
    id: "C01",
    name: "李长风",
    aliases: ["断剑少年"],
    tier: "protagonist",
    introducedAt: 1,
    profile: {
      role: "主角",
      appearance: [
        { key: "眼睛颜色", value: "浅褐", establishedAt: 1, immutable: true },
        { key: "惯用手", value: "右手", establishedAt: 5, immutable: true },
        { key: "伤势", value: "左肩旧伤未愈", establishedAt: 48, immutable: false },
      ],
      traits: ["记仇", "谨慎", "护短"],
      forbiddenBehaviors: ["绝不主动求人", "不在人前示弱"],
      wants: "重回宗门并查清师父死因",
      fears: "查到底之后发现自己也是帮凶",
      background: "自幼被三叔抚养，十二岁入青云门，十七岁被逐。",
    },
    speech: terseSpeech,
    state: {
      vital: asDerived("alive" as const),
      location: asDerived("S01" as const),
      condition: asDerived("现居青州·养伤中"),
      lastSeenAt: asDerived(52),
      appearanceCount: asDerived(48),
    },
    provenance: "committed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "C02",
    name: "血刀客",
    aliases: [],
    tier: "major",
    introducedAt: 9,
    profile: {
      role: "主要反派",
      appearance: [{ key: "刀疤", value: "自左眉至下颌", establishedAt: 9, immutable: true }],
      traits: ["狠", "耐心", "重承诺"],
      forbiddenBehaviors: ["不杀已放下武器的人"],
      wants: "拿回被青云门夺走的家传刀谱",
      fears: "自己成为当年灭门者那样的人",
      background: "十年前家族被青云门所灭，只余他一人。",
    },
    speech: florid,
    state: {
      vital: asDerived("alive" as const),
      location: asDerived(null),
      condition: asDerived("下落不明·记恨主角"),
      lastSeenAt: asDerived(48),
      appearanceCount: asDerived(14),
    },
    provenance: "committed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "C03",
    name: "苏晚晴",
    aliases: [],
    tier: "major",
    introducedAt: 3,
    profile: {
      role: "同门旧识",
      appearance: [{ key: "眼睛颜色", value: "黑", establishedAt: 3, immutable: true }],
      traits: ["直率", "记性好"],
      forbiddenBehaviors: ["不替人隐瞒"],
      wants: "证明师门内有内应",
      fears: "内应是自己师兄",
      background: "青云门内门弟子，与主角同期入门。",
    },
    speech: {
      ...terseSpeech,
      sentenceLength: { min: 8, max: 24 },
      register: "neutral",
      emotionalExpression: "direct",
      addressForms: [{ target: "C01", form: "长风" }],
      exemplars: ["你别绕，我问的是三叔那晚在哪。", "我记得清楚，那天他没回山。"],
      signatureLexicon: [],
      forbiddenLexicon: [],
    },
    state: {
      vital: asDerived("alive" as const),
      location: asDerived("S02" as const),
      condition: asDerived("在青云门内查探"),
      lastSeenAt: asDerived(26),
      appearanceCount: asDerived(19),
    },
    provenance: "committed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "C04",
    name: "茶摊老丈",
    aliases: [],
    tier: "minor",
    introducedAt: 50,
    profile: {
      role: "青州城消息贩子",
      appearance: [],
      traits: ["贪财", "嘴松"],
      forbiddenBehaviors: [],
      wants: "多赚几枚灵石",
      fears: "被当成通风报信的",
      background: "在青州城西门摆茶摊二十年。",
    },
    speech: {
      ...terseSpeech,
      register: "colloquial",
      emotionalExpression: "direct",
      addressForms: [{ target: null, form: "客官" }],
      exemplars: ["客官要打听人，先添两文茶钱。"],
      signatureLexicon: [],
      forbiddenLexicon: [],
      verbalTics: ["嘿"],
    },
    state: {
      vital: asDerived("alive" as const),
      location: asDerived("S01" as const),
      condition: asDerived("在西门摆摊"),
      lastSeenAt: asDerived(51),
      appearanceCount: asDerived(2),
    },
    provenance: "committed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
  {
    id: "C05",
    name: "玄机子",
    aliases: [],
    tier: "minor",
    introducedAt: 4,
    profile: {
      role: "云游术士",
      appearance: [],
      traits: ["神秘", "话少"],
      forbiddenBehaviors: [],
      wants: "不明",
      fears: "不明",
      background: "曾在主角被逐当日出现过一次。",
    },
    speech: {
      ...terseSpeech,
      register: "archaic",
      emotionalExpression: "oblique",
      addressForms: [],
      exemplars: ["剑断而心不断，尚可为。"],
      signatureLexicon: [],
      forbiddenLexicon: [],
    },
    state: {
      vital: asDerived("unknown" as const),
      location: asDerived(null),
      condition: asDerived("久未出现"),
      lastSeenAt: asDerived(4),
      appearanceCount: asDerived(1),
    },
    provenance: "committed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  },
];

export const settings: readonly SettingCard[] = [
  {
    id: "S01",
    name: "青州城",
    kind: "location",
    description: "三州交界的商埠，宗门势力交错，城内不许动武。",
    facts: ["西门有茶摊聚集的消息市", "城主与青云门有旧约", "夜间闭城，卯时开"],
  },
  {
    id: "S02",
    name: "青云门",
    kind: "organization",
    description: "青州最大宗门，掌门为玄阳真人，内门弟子三百。",
    facts: ["十年前灭过血刀客家族", "试剑会由它主办"],
  },
];

const anchor = (chapter: number, quote: string, offsetHint: number): TextAnchor => ({
  chapter,
  quote,
  offsetHint,
  occurrence: 0,
});

export const foreshadows: readonly ForeshadowTimelineItem[] = [
  {
    id: "F03",
    label: "生锈的钥匙",
    intent: "这把钥匙开的是第三卷里三叔藏账本的密室，账本上有师父死那晚的记录。",
    weight: "main",
    visibility: "overt",
    status: "open",
    plantedAt: 5,
    plantedAnchor: anchor(5, "他把那把生锈的钥匙塞回怀里", 1840),
    expectedBy: 55,
    resolutions: [],
    overdueBy: asDerived(-3),
  },
  {
    id: "F07",
    label: "母亲的信",
    intent: "信里写明主角并非三叔亲侄，这是三叔动手的真正动机。",
    weight: "main",
    visibility: "covert",
    status: "open",
    plantedAt: 12,
    plantedAnchor: anchor(12, "信纸边角被烧去一块", 640),
    expectedBy: 50,
    resolutions: [],
    overdueBy: asDerived(2),
  },
  {
    id: "F11",
    label: "村口老树",
    intent: "老树下埋着当年灭门时的兵器，用来证明青云门参与其中。",
    weight: "sub",
    visibility: "overt",
    status: "open",
    plantedAt: 18,
    plantedAnchor: anchor(18, "老树的根盘出地面半尺", 2200),
    expectedBy: 38,
    resolutions: [],
    overdueBy: asDerived(14),
  },
  {
    id: "F02",
    label: "断剑的裂纹",
    intent: "裂纹会在吸收第九式时崩开，这是全书武力上限的解释。",
    weight: "detail",
    visibility: "covert",
    status: "resolved",
    plantedAt: 2,
    plantedAnchor: anchor(2, "剑脊上那道细纹", 900),
    expectedBy: 40,
    resolutions: [{ chapter: 40, completeness: "full", anchor: anchor(40, "裂纹自剑脊崩开", 3100) }],
    overdueBy: asDerived(0),
  },
];

export const plotLines: readonly PlotLineTrack[] = [
  {
    id: "P01",
    label: "复仇主线",
    weight: "main",
    gapLimit: asDerived(3),
    lastAdvancedAt: 52,
    currentGap: asDerived(0),
    points: [],
  },
  {
    id: "P02",
    label: "师门内应",
    weight: "sub",
    gapLimit: asDerived(12),
    lastAdvancedAt: 48,
    currentGap: asDerived(4),
    points: [],
  },
  {
    id: "P03",
    label: "血刀客的刀谱",
    weight: "sub",
    gapLimit: asDerived(12),
    lastAdvancedAt: 30,
    currentGap: asDerived(22),
    points: [],
  },
];

export const chapterSynopses: readonly { chapter: number; text: string }[] = Array.from(
  { length: 52 },
  (_, i) => ({
    chapter: i + 1,
    text: `第${i + 1}章的事：李长风在青州一线追查三叔的旧事，又与人交手一场。`,
  }),
);

export const volumeSummaries = [
  { volume: 1, text: "被逐出师门到查明师父死于内应之手。" },
  { volume: 2, text: "结识血刀客，得知青云门灭门旧案。" },
] as const;

const budget: ChapterBudget = {
  words: asDerived({ min: 4250, max: 6350, sweet: 5300 }),
  density: asDerived({ min: 0.4, max: 0.8 }),
  thresholds: asDerived({ 比喻: 21, 口头感叹词: 6, 高疲劳词: 2, 环境描写段: 5 }),
  tier: asDerived("strict" as const),
  splitAdvice: null,
  derivedFrom: { platform: "fanqie", genre: "xuanhuan", rulesVersion: "r1" },
  derivedAt: "2026-09-06T00:00:00.000Z",
};

export const beat: ChapterBeat = {
  chapter: 53,
  volume: 3,
  plan: {
    chapterType: "climax",
    coreEvent: "血刀客围杀，李长风身份揭破",
    secondaryThread: "苏晚晴察觉师门内应",
    stageFeedback: "李长风拿到账本，确认三叔当晚在山",
    hook: "三叔推门进来，手里拿着那把钥匙",
    events: [
      { kind: "action", summary: "血刀客率人围住破庙，李长风以断剑接下第九式", weight: 3, plotLine: "P01" },
      { kind: "info", summary: "账本上出现三叔的名字", weight: 2, plotLine: "P01" },
      { kind: "resource", summary: "断剑崩裂，只余半截", weight: 2, plotLine: "P01" },
    ],
    resolves: [
      { foreshadowId: "F03", weight: "main", completeness: "full" },
      { foreshadowId: "F07", weight: "main", completeness: "full" },
      { foreshadowId: "F11", weight: "sub", completeness: "partial" },
    ],
    plants: [{ label: "三叔袖口的灰", weight: "sub" }],
    characters: ["C01", "C02", "C03"],
    locations: ["S01"],
  },
  budget,
  provenance: "committed",
  updatedAt: "2026-09-06T00:00:00.000Z",
};

export const previousChapterText = [
  "破庙的门板早烂了，风从缺口里灌进来，把地上的草屑吹得贴着墙走。",
  "李长风把断剑横在膝上，指腹一寸寸沿着剑脊摸过去。裂纹比昨日又长了半分。",
  "外面传来脚步，两人，一轻一重。他没抬头。",
  "「客官要打听人，」茶摊老丈的声音在门外压得很低，「先添两文茶钱。」",
  "他从怀里摸出一枚灵石，扔了出去。",
  "「三叔那晚在哪。」",
  "老丈捡了石头，掂了掂，嘿了一声：「在山上。有人看见他从后山下来，天没亮。」",
  "李长风的手停在剑脊上。他记得那晚三叔说自己在城里。",
].join("\n");
