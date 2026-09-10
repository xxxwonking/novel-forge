/**
 * 生成验收样本项目：`npm run seed [目录]`
 *
 * M3 的验收标准是「**用户不读正文能说出这书哪里有问题**」（§12.9）。要能验
 * 就得有一本"确实有问题"的书 —— 所以这里造 52 章、5 条伏笔、3 条情节线、
 * 6 个人物，其中埋进四种真实的结构债：
 *
 *   F07「母亲的信」  主线，逾期 8 章  → 首页第一条（decay 上升段）
 *   F11「村口老树」  支线，逾期 35 章 → 已过拐点，迁移为「建议废弃」
 *   P03「血刀客刀谱」支线，断 22 章   → 上限 12，超了近一倍
 *   C05 苏晚晴       主要角色，消失 26 章
 *   F03「生锈的钥匙」主线，还有 3 章到期 → 临近提醒
 *
 * 排序若正确，首页给的是 F07 与 P03 这类**能在下一章顺手修掉**的，而不是
 * 逾期最久的 F11 —— 那正是 §12.6.2 立论的地方。
 *
 * 不打任何 API：正文是模板生成的，够长到能过字数闸门，但不假装是好文章。
 * 这个脚本的产物是**结构**，不是内容。
 */

import { resolve } from "node:path";
import { EventStream } from "../store/event-stream.js";
import { ProjectStore, type PlotLineDef } from "../store/persist.js";
import { deriveBudget } from "../beat/derive.js";
import { loadRules } from "../rules/load.js";
import type { StructuralEventPayload } from "../types/events.js";
import type { ChapterBeat, ChapterPlan, WorkProfile } from "../types/beat.js";
import type { CharacterCard, SpeechProfile } from "../types/character.js";
import type { WorkSetting } from "../types/work.js";
import type { CharacterId, ChapterNo, ForeshadowId, PlotLineId, TextAnchor } from "../types/primitives.js";

const rules = loadRules();
const LAST_CHAPTER = 52;
const NOW = "2026-09-07T00:00:00.000Z";

// ── 作品设定 ────────────────────────────────────────────────────────────

const setting: WorkSetting = {
  title: "青州旧事",
  genre: "xuanhuan",
  platform: "fanqie",
  premise: "被逐出师门的少年靠一把断剑查清师父死因。",
  centralConflict: "真凶是抚养他长大的三叔。",
  pov: "third_limited",
  tense: "past",
  protagonistTraits: ["记仇", "谨慎", "护短"],
  protagonistForbidden: ["绝不主动求人", "不在人前示弱"],
  specialAbility: "断剑能存一式对手的招法。",
  abilityLimits: ["存新招覆盖旧招", "吸收时受同等反伤"],
  worldRules: ["修行分炼气、筑基、金丹、元婴四境", "宗门以试剑会定次序", "灵石是通用货币"],
  openingSituation: "青州城外破庙，被逐第三日。",
  styleKeywords: ["冷硬", "克制", "重动作轻抒情"],
  romanceLine: "与苏晚晴不明写，只写并肩。",
  taboos: ["不写师徒恋", "不写主角滥杀无辜"],
};

const profile: WorkProfile = { platform: "fanqie", genre: "xuanhuan", targetWords: 1_000_000 };

const plotLines: readonly PlotLineDef[] = [
  { id: "P01", label: "复仇主线", weight: "main" },
  { id: "P02", label: "师门内应", weight: "sub" },
  { id: "P03", label: "血刀客的刀谱", weight: "sub" },
];

// ── 人物 ────────────────────────────────────────────────────────────────

function speech(over: Partial<SpeechProfile> = {}): SpeechProfile {
  return {
    sentenceLength: { min: 4, max: 16 },
    verbalTics: [],
    signatureLexicon: [],
    forbiddenLexicon: ["OK", "没问题"],
    addressForms: [{ target: null, form: "阁下", condition: "对陌生人" }],
    syntaxBias: { question: 0.15, imperative: 0.2, elliptical: 0.35 },
    register: "colloquial",
    emotionalExpression: "suppressed",
    exemplars: ["三叔那晚在哪。", "我只问一次。"],
    counterExemplars: [],
    ...over,
  };
}

function card(
  id: CharacterId,
  name: string,
  tier: CharacterCard["tier"],
  role: string,
  introducedAt: ChapterNo,
): Omit<CharacterCard, "state"> {
  return {
    id,
    name,
    aliases: [],
    tier,
    introducedAt,
    profile: {
      role,
      appearance: [{ key: "眼睛颜色", value: "浅褐", establishedAt: introducedAt, immutable: true }],
      traits: ["记仇", "谨慎"],
      forbiddenBehaviors: ["不在人前示弱"],
      wants: "查清师父死因",
      fears: "自己也是帮凶",
      background: "自幼被三叔抚养。",
    },
    speech: speech(),
    provenance: "authored",
    updatedAt: NOW,
  };
}

const characters: readonly Omit<CharacterCard, "state">[] = [
  card("C01", "李长风", "protagonist", "主角，被逐出师门的少年", 1),
  card("C02", "血刀客", "major", "刀谱线的对手", 8),
  card("C03", "三叔", "major", "抚养主角长大的人，真凶", 1),
  card("C05", "苏晚晴", "major", "同门旧识，并肩者", 3),
  card("C06", "茶摊老丈", "minor", "青州城的消息来源", 6),
  card("C09", "守山弟子", "extra", "山门口的龙套", 20),
];

// ── 伏笔与事件 ──────────────────────────────────────────────────────────

function anchor(chapter: ChapterNo, quote: string, offsetHint: number): TextAnchor {
  return { chapter, quote, offsetHint, occurrence: 0 };
}

interface PlantSpec {
  readonly id: ForeshadowId;
  readonly label: string;
  readonly intent: string;
  readonly weight: "main" | "sub" | "detail";
  readonly visibility: "overt" | "covert";
  readonly plantedAt: ChapterNo;
  readonly expectedBy: ChapterNo;
  readonly quote: string;
  /** 已收束的话，在哪章收。 */
  readonly resolvedAt?: ChapterNo;
  readonly resolvedQuote?: string;
}

const PLANTS: readonly PlantSpec[] = [
  {
    id: "F03",
    label: "生锈的钥匙",
    intent: "这把钥匙开的是三叔藏账本的密室，账本上有师父死那晚的记录。",
    weight: "main",
    visibility: "overt",
    plantedAt: 5,
    // 当前 52 章，还有 3 章到期 —— 命中 foreshadowDueSoon 的临近提醒。
    expectedBy: LAST_CHAPTER + rules.crossChapter.foreshadowDueSoon,
    quote: "他把那把生锈的钥匙塞回怀里",
  },
  {
    id: "F07",
    label: "母亲的信",
    intent: "信里写明主角并非三叔亲侄，这是三叔动手的真正动机。",
    weight: "main",
    visibility: "covert",
    plantedAt: 12,
    // 逾期 8 章：decay 的上升段，且是主线 —— 该排首页第一条。
    expectedBy: LAST_CHAPTER - 8,
    quote: "信纸边角被烧去一块",
  },
  {
    id: "F11",
    label: "村口老树",
    intent: "老树下埋着当年灭门时的兵器，用来证明青云门参与其中。",
    weight: "sub",
    visibility: "overt",
    plantedAt: 14,
    // 逾期 35 章：已过 migration 拐点，迁移为「建议废弃」，decay 回落。
    expectedBy: LAST_CHAPTER - 35,
    quote: "老树的根盘出地面半尺",
  },
  {
    id: "F02",
    label: "断剑的裂纹",
    intent: "裂纹会在吸收第九式时崩开，这是全书武力上限的解释。",
    weight: "detail",
    visibility: "covert",
    plantedAt: 2,
    expectedBy: 40,
    quote: "剑脊上那道细纹",
    resolvedAt: 40,
    resolvedQuote: "裂纹自剑脊崩开",
  },
  {
    id: "F15",
    label: "三叔袖口的灰",
    intent: "灰是后山特有的，证明他那晚上过山。",
    weight: "sub",
    visibility: "covert",
    plantedAt: 44,
    expectedBy: 70,
    quote: "袖口沾着一层灰",
  },
];

/** 每章的正文。够长过字数闸门，但不假装是好文章 —— 产物是结构不是内容。 */
function chapterText(n: ChapterNo, spec: readonly string[]): string {
  const body = [
    `第${n}章`,
    "",
    ...spec,
    "",
    "破庙的门板早烂了，风从缺口里灌进来，把地上的草屑吹得贴着墙走。",
    "李长风把断剑横在膝上，指腹一寸寸沿着剑脊摸过去。",
    "外面传来脚步，两人，一轻一重。他没抬头。",
    "「客官要打听人，」茶摊老丈的声音压得很低，「先添两文茶钱。」",
    "他从怀里摸出一枚灵石，扔了出去。",
    "老丈捡了石头，掂了掂，报了个地名，又报了个时辰。",
    "李长风记下，把剑收进鞘里。鞘口有个缺，是上次崩的。",
    "他走出破庙的时候天还没亮，路上没有别人。",
    "青州城的城门要等到卯时才开，他在墙根下等了半个时辰。",
    "守门的换了人，不认得他，收了两文钱就让他进去了。",
  ];
  // 重复几遍垫到字数下限之上。这不是好文章，但字数闸门要的是可数的量。
  const filler = [
    "他沿着长街往东走，两边的铺子还没上板。",
    "巷口有人在挑水，扁担压得吱呀响。",
    "他绕开了主街，走的是后巷。后巷窄，但没人认得他。",
    "那处院子的墙比记忆里矮了一截。",
    "他翻墙进去的时候，院里的狗没叫——狗认得他。",
  ];
  return [...body, ...filler, ...filler, ...filler].join("\n");
}

/** 该章的正文特有段落，用来承载锚点。 */
function chapterSpec(n: ChapterNo): readonly string[] {
  const lines: string[] = [];
  for (const p of PLANTS) {
    if (p.plantedAt === n) lines.push(`${p.quote}，没有再看第二眼。`);
    if (p.resolvedAt === n && p.resolvedQuote !== undefined) lines.push(`${p.resolvedQuote}，剩下的半截还在他手里。`);
  }
  if (n === 26) lines.push("苏晚晴在山道上回了头，之后再没有出现在他面前。");
  if (n === 30) lines.push("血刀客把刀谱的最后一页撕了下来，塞进袖子里。");
  if (n === 48) lines.push("师门里递出来一张纸条，字迹他认得。");
  if (n === LAST_CHAPTER) lines.push("账本就在那间密室里，他只差一把钥匙。");
  return lines;
}

// ── 事件流 ──────────────────────────────────────────────────────────────

interface EventSpec {
  readonly chapter: ChapterNo;
  readonly payload: StructuralEventPayload;
}

function buildEvents(): readonly EventSpec[] {
  const out: EventSpec[] = [];

  for (const p of PLANTS) {
    out.push({
      chapter: p.plantedAt,
      payload: {
        type: "foreshadow_planted",
        foreshadowId: p.id,
        label: p.label,
        intent: p.intent,
        weight: p.weight,
        visibility: p.visibility,
        expectedBy: p.expectedBy,
        anchor: anchor(p.plantedAt, p.quote, 40),
      },
    });
    if (p.resolvedAt !== undefined && p.resolvedQuote !== undefined) {
      out.push({
        chapter: p.resolvedAt,
        payload: {
          type: "foreshadow_resolved",
          foreshadowId: p.id,
          completeness: "full",
          anchor: anchor(p.resolvedAt, p.resolvedQuote, 40),
        },
      });
    }
  }

  // 情节线推进。P03 停在 30 章（断 22 > 上限 12），P01 推到 52，P02 停在 48。
  const advances: readonly { chapter: ChapterNo; line: PlotLineId; summary: string; weight: 1 | 2 | 3 }[] = [
    { chapter: 4, line: "P01", summary: "李长风查到师父死那晚有人上过后山", weight: 2 },
    { chapter: 12, line: "P01", summary: "拿到母亲留下的信，看出三叔的动机", weight: 3 },
    { chapter: 20, line: "P02", summary: "确认师门里有人递消息给外面", weight: 2 },
    { chapter: 24, line: "P03", summary: "血刀客现身，第一次交手", weight: 2 },
    { chapter: 30, line: "P03", summary: "血刀客撕走刀谱最后一页", weight: 2 },
    { chapter: 40, line: "P01", summary: "断剑崩裂，第九式的代价显形", weight: 3 },
    { chapter: 48, line: "P02", summary: "内应递出纸条，字迹指向三叔身边的人", weight: 2 },
    { chapter: LAST_CHAPTER, line: "P01", summary: "查明账本所在，只差钥匙", weight: 2 },
  ];
  for (const a of advances) {
    out.push({
      chapter: a.chapter,
      payload: {
        type: "plot_event",
        kind: "info",
        summary: a.summary,
        weight: a.weight,
        plotLine: a.line,
        participants: ["C01"],
        anchor: anchor(a.chapter, "李长风把断剑横在膝上", 60),
      },
    });
  }

  // 出场记录。苏晚晴停在 26 章（消失 26 > major 阈值 15）。
  const presence: readonly { chapter: ChapterNo; id: CharacterId; role: "pov" | "major" | "minor" | "mentioned" }[] = [
    ...range(1, LAST_CHAPTER).map((c) => ({ chapter: c, id: "C01" as CharacterId, role: "pov" as const })),
    ...[3, 8, 14, 20, 26].map((c) => ({ chapter: c, id: "C05" as CharacterId, role: "major" as const })),
    ...[8, 24, 30].map((c) => ({ chapter: c, id: "C02" as CharacterId, role: "major" as const })),
    ...[1, 12, 44, LAST_CHAPTER].map((c) => ({ chapter: c, id: "C03" as CharacterId, role: "minor" as const })),
    ...[6, 18, 33, 50].map((c) => ({ chapter: c, id: "C06" as CharacterId, role: "minor" as const })),
    { chapter: 20, id: "C09" as CharacterId, role: "mentioned" as const },
  ];
  for (const p of presence) {
    out.push({ chapter: p.chapter, payload: { type: "character_presence", characterId: p.id, role: p.role } });
  }

  // 关系变化，供关系图。
  const relations: readonly {
    chapter: ChapterNo;
    from: CharacterId;
    to: CharacterId;
    fromKind: "acquaintance" | null;
    toKind: "ally" | "hostile" | "kin" | "acquaintance";
    note: string;
  }[] = [
    { chapter: 3, from: "C01", to: "C05", fromKind: null, toKind: "acquaintance", note: "同门旧识" },
    { chapter: 14, from: "C01", to: "C05", fromKind: "acquaintance", toKind: "ally", note: "山道上并肩挡下追兵" },
    { chapter: 1, from: "C01", to: "C03", fromKind: null, toKind: "kin", note: "自幼被他抚养" },
    { chapter: 44, from: "C01", to: "C03", fromKind: null, toKind: "hostile", note: "袖口的灰让他起了疑" },
    { chapter: 8, from: "C01", to: "C02", fromKind: null, toKind: "hostile", note: "为刀谱交手" },
  ];
  for (const r of relations) {
    out.push({
      chapter: r.chapter,
      payload: {
        type: "relation_changed",
        from: r.from,
        to: r.to,
        fromKind: r.fromKind,
        toKind: r.toKind,
        note: r.note,
        anchor: anchor(r.chapter, "李长风把断剑横在膝上", 60),
      },
    });
  }

  // 状态变更，供人物弧线的转折点。
  out.push({
    chapter: 40,
    payload: {
      type: "character_state_changed",
      characterId: "C01",
      field: "condition",
      from: "断剑完好",
      to: "断剑只余半截，第九式再用一次即毁",
      anchor: anchor(40, "裂纹自剑脊崩开", 40),
    },
  });

  return out.sort((x, y) => x.chapter - y.chapter);
}

function range(from: number, to: number): readonly number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

// ── 节拍表 ──────────────────────────────────────────────────────────────

/**
 * 第 53 章的节拍表（下一章，还没写）。
 *
 * **刻意留空 resolves 与 characters** —— 首页告警的一键动作要往这里写东西，
 * 提前排好就没什么可演示的了。事件也只排一个 P01 的，让 P03 的断线告警成立。
 */
function nextPlan(): ChapterPlan {
  return {
    chapterType: "event",
    coreEvent: "李长风摸进密室，账本不在原处",
    secondaryThread: "三叔在院外等他",
    stageFeedback: "李长风确认账本被人先取走，且取走的人认得密室",
    hook: "院门口站着的人手里也有一把钥匙",
    events: [
      {
        kind: "action",
        summary: "李长风撬开密室，发现账本已被取走",
        weight: 2,
        plotLine: "P01",
      },
    ],
    resolves: [],
    plants: [],
    characters: ["C01", "C03"],
    locations: ["S01"],
  };
}

function buildBeats(): readonly ChapterBeat[] {
  const beats: ChapterBeat[] = [];

  // 已写完的章：只给最近几章造节拍表（体检面板要用），更早的省掉 ——
  // 真实项目里它们都在，但样本不需要 52 份。
  for (const n of [50, 51, LAST_CHAPTER]) {
    const plan: ChapterPlan = {
      chapterType: "event",
      coreEvent: `第${n}章：李长风在青州追查三叔的旧事`,
      secondaryThread: null,
      stageFeedback: `李长风拿到一条能核实的线索`,
      hook: "巷口有人跟了他一段路",
      events: [
        { kind: "info", summary: "问出三叔那晚的去向", weight: 2, plotLine: "P01" },
      ],
      resolves: [],
      plants: [],
      characters: ["C01", "C06"],
      locations: ["S01"],
    };
    beats.push({
      chapter: n,
      volume: 3,
      plan,
      budget: deriveBudget(plan, profile, rules, { now: NOW }),
      provenance: "committed",
      updatedAt: NOW,
    });
  }

  const plan = nextPlan();
  beats.push({
    chapter: LAST_CHAPTER + 1,
    volume: 3,
    plan,
    budget: deriveBudget(plan, profile, rules, { now: NOW }),
    provenance: "proposed",
    updatedAt: NOW,
  });

  return beats;
}

// ── 入口 ────────────────────────────────────────────────────────────────

function main(): void {
  const root = resolve(process.argv[2] ?? "data/demo");
  const store = new ProjectStore(root);

  const stream = new EventStream(() => NOW);
  for (const spec of buildEvents()) {
    stream.append({
      chapter: spec.chapter,
      origin: "C5_declaration",
      provenance: "proposed",
      payload: spec.payload,
    });
  }
  // 全部接受 —— 样本要的是"已经写了 52 章"的状态。
  for (const n of range(1, LAST_CHAPTER)) stream.decideChapter(n, "committed");

  const chapters = new Map<ChapterNo, string>();
  for (const n of range(1, LAST_CHAPTER)) chapters.set(n, chapterText(n, chapterSpec(n)));

  store.save({
    setting,
    profile,
    characters,
    plotLines,
    beats: buildBeats(),
    alertStates: [],
    events: stream.all(),
    chapters,
  });

  process.stdout.write(
    [
      `样本项目已生成：${root}`,
      `  ${LAST_CHAPTER} 章正文 · ${stream.all().length} 条结构事件 · ${characters.length} 个人物 · ${plotLines.length} 条情节线`,
      "",
      "埋进去的结构债（首页告警应当认出这些）：",
      "  F07「母亲的信」  主线，逾期 8 章   → 上升段，该排第一",
      "  F11「村口老树」  支线，逾期 35 章  → 过拐点，迁移为「建议废弃」",
      "  P03「血刀客刀谱」支线，断 22 章    → 上限 12",
      "  C05 苏晚晴       主要角色，消失 26 章",
      "  F03「生锈的钥匙」主线，还有 3 章到期 → 临近提醒",
      "",
      "起服务：npm run serve",
      "",
    ].join("\n"),
  );
}

main();
