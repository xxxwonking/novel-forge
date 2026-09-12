/**
 * 筹备类工具的入参解析与领域合并（Stage 2·切片 2）。
 *
 * 两层分工：
 *   parse*（给 tool-exec）—— 只看形状与枚举，非法即返回错误串，模型会自纠，不产 effect。
 *   merge*（给 ProjectSession 的受控入口）—— 把"部分字段"落成完整领域对象，authored 可信度。
 *
 * ID 一律由 nextId 分配（§5.8）：模型只能引用已存在的编号，不能自造。
 * 本目录不在 rules.test.ts 的魔法数字扫描范围内，DEFAULT_SPEECH 的缺省区间放这里。
 */

import type { ChapterPlan, ChapterType, PlannedEvent } from "../types/beat.js";
import type {
  AddressForm,
  CharacterAttribute,
  CharacterCard,
  CharacterProfile,
  CharacterTier,
  EmotionalExpression,
  SpeechProfile,
  SpeechRegister,
} from "../types/character.js";
import type { EventKind, EventWeight, ForeshadowWeight, ResolutionCompleteness } from "../types/events.js";
import type { CharacterId, IsoTimestamp, PlotLineId, SettingId } from "../types/primitives.js";
import type { NarrativePov, NarrativeTense, WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import type { PlotLineDef } from "../store/persist.js";

type Raw = Record<string, unknown>;

// ── 入参形状 ─────────────────────────────────────────────────────────────

/** 作品方向：书名/题材/平台在新建作品时定，对话里不改。 */
export type DirectionInput = Partial<Omit<WorkSetting, "title" | "genre" | "platform">>;

export interface CharacterInput {
  readonly id?: CharacterId;
  readonly name?: string;
  readonly aliases?: readonly string[];
  readonly tier?: CharacterTier;
  readonly profile: Partial<CharacterProfile>;
  readonly speech: Partial<SpeechProfile>;
}

export interface LocationInput {
  readonly id?: SettingId;
  readonly name?: string;
  readonly kind?: SettingCard["kind"];
  readonly description?: string;
  readonly facts?: readonly string[];
}

export interface PlotLineInput {
  readonly id?: PlotLineId;
  readonly label?: string;
  readonly weight?: ForeshadowWeight;
}

export interface PlanChapterInput {
  /** null = 下一章。 */
  readonly chapter: number | null;
  readonly plan: ChapterPlan;
}

// ── 校验原语 ─────────────────────────────────────────────────────────────

const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);
const isRecord = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[]): v is T =>
  isStr(v) && (allowed as readonly string[]).includes(v);

const POVS: readonly NarrativePov[] = ["first", "third_limited", "third_omniscient"];
const TENSES: readonly NarrativeTense[] = ["past", "present"];
const TIERS: readonly CharacterTier[] = ["protagonist", "major", "minor", "extra"];
const REGISTERS: readonly SpeechRegister[] = ["vulgar", "colloquial", "neutral", "formal", "literary", "archaic"];
const EMOTIONS: readonly EmotionalExpression[] = ["suppressed", "direct", "ironic", "explosive", "oblique"];
const LOCATION_KINDS: readonly SettingCard["kind"][] = ["location", "organization"];
const FORESHADOW_WEIGHTS: readonly ForeshadowWeight[] = ["main", "sub", "detail"];
const CHAPTER_TYPES: readonly ChapterType[] = ["transition", "setup", "event", "payoff", "climax"];
const EVENT_KINDS: readonly EventKind[] = ["action", "info", "relation", "resource", "decision"];
const COMPLETENESS: readonly ResolutionCompleteness[] = ["full", "partial"];

const ID_PATTERNS = { C: /^C\d+$/u, S: /^S\d+$/u, P: /^P\d+$/u } as const;

/** 逐字段收集：出现即校验，缺席即跳过。返回错误串表示某字段形状不对。 */
class FieldReader {
  readonly out: Record<string, unknown> = {};
  constructor(private readonly raw: Raw) {}

  str(key: string): string | undefined {
    const v = this.raw[key];
    if (v === undefined) return undefined;
    if (!isStr(v)) return `${key} 必须是字符串`;
    this.out[key] = v;
    return undefined;
  }

  strArr(key: string): string | undefined {
    const v = this.raw[key];
    if (v === undefined) return undefined;
    if (!isStrArr(v)) return `${key} 必须是字符串数组`;
    this.out[key] = v;
    return undefined;
  }

  enumOf<T extends string>(key: string, allowed: readonly T[]): string | undefined {
    const v = this.raw[key];
    if (v === undefined) return undefined;
    if (!oneOf(v, allowed)) return `${key} 必须是 ${allowed.join("/")}`;
    this.out[key] = v;
    return undefined;
  }

  id(key: string, prefix: keyof typeof ID_PATTERNS): string | undefined {
    const v = this.raw[key];
    if (v === undefined) return undefined;
    if (!isStr(v) || !ID_PATTERNS[prefix].test(v)) return `${key} 不是合法编号（形如 ${prefix}01）`;
    this.out[key] = v;
    return undefined;
  }

  /** 依次执行，遇到第一个错误即返回。 */
  static run(steps: readonly (() => string | undefined)[]): string | undefined {
    for (const step of steps) {
      const e = step();
      if (e !== undefined) return e;
    }
    return undefined;
  }
}

// ── 解析 ────────────────────────────────────────────────────────────────

export function parseDirection(raw: Raw): DirectionInput | string {
  const r = new FieldReader(raw);
  const err = FieldReader.run([
    () => r.str("premise"),
    () => r.str("centralConflict"),
    () => r.enumOf("pov", POVS),
    () => r.enumOf("tense", TENSES),
    () => r.strArr("protagonistTraits"),
    () => r.strArr("protagonistForbidden"),
    () => r.str("specialAbility"),
    () => r.strArr("abilityLimits"),
    () => r.strArr("worldRules"),
    () => r.str("openingSituation"),
    () => r.strArr("styleKeywords"),
    () => r.str("romanceLine"),
    () => r.strArr("taboos"),
  ]);
  if (err !== undefined) return err;
  if (Object.keys(r.out).length === 0) return "至少提供一个要修改的字段";
  return r.out as DirectionInput;
}

export function parseCharacter(raw: Raw): CharacterInput | string {
  const r = new FieldReader(raw);
  const err = FieldReader.run([
    () => r.id("id", "C"),
    () => r.str("name"),
    () => r.strArr("aliases"),
    () => r.enumOf("tier", TIERS),
  ]);
  if (err !== undefined) return err;
  if (r.out["id"] === undefined && r.out["name"] === undefined) return "id 与 name 至少给一个";

  const p = new FieldReader(raw);
  const perr = FieldReader.run([
    () => p.str("role"),
    () => p.strArr("traits"),
    () => p.strArr("forbiddenBehaviors"),
    () => p.str("wants"),
    () => p.str("fears"),
    () => p.str("background"),
  ]);
  if (perr !== undefined) return perr;
  if (raw["appearance"] !== undefined) {
    const appearance = parseAppearance(raw["appearance"]);
    if (isStr(appearance)) return appearance;
    p.out["appearance"] = appearance;
  }

  const speech = raw["speech"] === undefined ? {} : parseSpeech(raw["speech"]);
  if (isStr(speech)) return speech;

  return { ...(r.out as Omit<CharacterInput, "profile" | "speech">), profile: p.out as Partial<CharacterProfile>, speech };
}

function parseAppearance(v: unknown): readonly CharacterAttribute[] | string {
  if (!Array.isArray(v)) return "appearance 必须是 {key, value, immutable?} 数组";
  const out: CharacterAttribute[] = [];
  for (const item of v) {
    if (!isRecord(item) || !isStr(item["key"]) || !isStr(item["value"])) return "appearance 每项需要 key 与 value";
    if (item["immutable"] !== undefined && typeof item["immutable"] !== "boolean") return "appearance.immutable 必须是布尔";
    // establishedAt=0：筹备期设定，尚未在任何章确立。immutable 缺省 true —— 筹备时描述的多是瞳色/身高这类恒定属性。
    out.push({ key: item["key"], value: item["value"], establishedAt: 0, immutable: item["immutable"] ?? true });
  }
  return out;
}

function parseSpeech(v: unknown): Partial<SpeechProfile> | string {
  if (!isRecord(v)) return "speech 必须是对象";
  const r = new FieldReader(v);
  const err = FieldReader.run([
    () => r.strArr("verbalTics"),
    () => r.strArr("signatureLexicon"),
    () => r.strArr("forbiddenLexicon"),
    () => r.enumOf("register", REGISTERS),
    () => r.enumOf("emotionalExpression", EMOTIONS),
    () => r.strArr("exemplars"),
    () => r.strArr("counterExemplars"),
  ]);
  if (err !== undefined) return err;

  const sl = v["sentenceLength"];
  if (sl !== undefined) {
    if (!isRecord(sl) || !isPositiveInt(sl["min"]) || !isPositiveInt(sl["max"]) || sl["min"] > sl["max"]) {
      return "speech.sentenceLength 需要正整数 min ≤ max";
    }
    r.out["sentenceLength"] = { min: sl["min"], max: sl["max"] };
  }
  const sb = v["syntaxBias"];
  if (sb !== undefined) {
    if (!isRecord(sb) || !isRatio(sb["question"]) || !isRatio(sb["imperative"]) || !isRatio(sb["elliptical"])) {
      return "speech.syntaxBias 的 question/imperative/elliptical 必须是 0-1 的数";
    }
    r.out["syntaxBias"] = { question: sb["question"], imperative: sb["imperative"], elliptical: sb["elliptical"] };
  }
  const af = v["addressForms"];
  if (af !== undefined) {
    if (!Array.isArray(af)) return "speech.addressForms 必须是数组";
    const forms: AddressForm[] = [];
    for (const item of af) {
      if (!isRecord(item) || !isStr(item["form"])) return "addressForms 每项需要 form";
      const target = item["target"] ?? null;
      if (target !== null && (!isStr(target) || !ID_PATTERNS.C.test(target))) return "addressForms.target 必须是人物编号或 null";
      if (item["condition"] !== undefined && !isStr(item["condition"])) return "addressForms.condition 必须是字符串";
      forms.push({
        target: target as CharacterId | null,
        form: item["form"],
        ...(isStr(item["condition"]) ? { condition: item["condition"] } : {}),
      });
    }
    r.out["addressForms"] = forms;
  }
  return r.out as Partial<SpeechProfile>;
}

const isPositiveInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isRatio = (v: unknown): v is number => typeof v === "number" && v >= 0 && v <= 1;

export function parseLocation(raw: Raw): LocationInput | string {
  const r = new FieldReader(raw);
  const err = FieldReader.run([
    () => r.id("id", "S"),
    () => r.str("name"),
    () => r.enumOf("kind", LOCATION_KINDS),
    () => r.str("description"),
    () => r.strArr("facts"),
  ]);
  if (err !== undefined) return err;
  if (r.out["id"] === undefined && r.out["name"] === undefined) return "id 与 name 至少给一个";
  return r.out as LocationInput;
}

export function parsePlotLine(raw: Raw): PlotLineInput | string {
  const r = new FieldReader(raw);
  const err = FieldReader.run([
    () => r.id("id", "P"),
    () => r.str("label"),
    () => r.enumOf("weight", FORESHADOW_WEIGHTS),
  ]);
  if (err !== undefined) return err;
  if (r.out["id"] === undefined && r.out["label"] === undefined) return "id 与 label 至少给一个";
  return r.out as PlotLineInput;
}

export function parseDisciplineRules(raw: Raw): readonly string[] | string {
  const rules = raw["rules"];
  if (!isStrArr(rules) || rules.length === 0 || rules.some((s) => s.trim() === "")) {
    return "rules 必须是非空的字符串数组，且每条非空";
  }
  return rules;
}

export function parsePlan(raw: Raw): PlanChapterInput | string {
  const chapterRaw = raw["chapter"];
  if (chapterRaw !== undefined && !isPositiveInt(chapterRaw)) return "chapter 必须是正整数章号";
  const r = new FieldReader(raw);
  const err = FieldReader.run([
    () => r.enumOf("chapterType", CHAPTER_TYPES),
    () => r.str("coreEvent"),
    () => r.str("secondaryThread"),
    () => r.str("stageFeedback"),
    () => r.str("hook"),
    () => r.strArr("characters"),
    () => r.strArr("locations"),
  ]);
  if (err !== undefined) return err;
  const o = r.out;
  for (const k of ["chapterType", "coreEvent", "stageFeedback", "hook"]) {
    if (!isStr(o[k]) || o[k].trim() === "") return `缺少 ${k}`;
  }
  const events = parseEvents(raw["events"] ?? []);
  if (isStr(events)) return events;
  const resolves = parseResolves(raw["resolves"] ?? []);
  if (isStr(resolves)) return resolves;
  const plants = parsePlants(raw["plants"] ?? []);
  if (isStr(plants)) return plants;
  const characters = (o["characters"] ?? []) as string[];
  const locations = (o["locations"] ?? []) as string[];
  const badChar = characters.find((c) => !ID_PATTERNS.C.test(c));
  if (badChar !== undefined) return `characters 含非法人物编号：${badChar}`;
  const badLoc = locations.find((s) => !ID_PATTERNS.S.test(s));
  if (badLoc !== undefined) return `locations 含非法场景编号：${badLoc}`;

  return {
    chapter: chapterRaw === undefined ? null : chapterRaw,
    plan: {
      chapterType: o["chapterType"] as ChapterType,
      coreEvent: o["coreEvent"] as string,
      secondaryThread: isStr(o["secondaryThread"]) && o["secondaryThread"] !== "" ? o["secondaryThread"] : null,
      stageFeedback: o["stageFeedback"] as string,
      hook: o["hook"] as string,
      events,
      resolves,
      plants,
      characters: characters as CharacterId[],
      locations: locations as SettingId[],
    },
  };
}

function parseEvents(v: unknown): readonly PlannedEvent[] | string {
  if (!Array.isArray(v)) return "events 必须是数组";
  const out: PlannedEvent[] = [];
  for (const item of v) {
    if (!isRecord(item) || !oneOf(item["kind"], EVENT_KINDS)) return `events.kind 必须是 ${EVENT_KINDS.join("/")}`;
    if (!isStr(item["summary"]) || item["summary"].trim() === "") return "events 每项需要 summary";
    const w = item["weight"];
    if (w !== 1 && w !== 2 && w !== 3) return "events.weight 必须是 1/2/3";
    const pl = item["plotLine"] ?? null;
    if (pl !== null && (!isStr(pl) || !ID_PATTERNS.P.test(pl))) return "events.plotLine 必须是情节线编号或 null";
    out.push({ kind: item["kind"], summary: item["summary"], weight: w as EventWeight, plotLine: pl as PlotLineId | null });
  }
  return out;
}

function parseResolves(v: unknown): ChapterPlan["resolves"] | string {
  if (!Array.isArray(v)) return "resolves 必须是数组";
  const out: { foreshadowId: `F${string}`; weight: ForeshadowWeight; completeness: ResolutionCompleteness }[] = [];
  for (const item of v) {
    if (!isRecord(item) || !isStr(item["foreshadowId"]) || !/^F\d+$/u.test(item["foreshadowId"])) {
      return "resolves 每项需要伏笔编号 foreshadowId";
    }
    if (!oneOf(item["weight"], FORESHADOW_WEIGHTS)) return "resolves.weight 必须是 main/sub/detail";
    if (!oneOf(item["completeness"], COMPLETENESS)) return "resolves.completeness 必须是 full/partial";
    out.push({ foreshadowId: item["foreshadowId"] as `F${string}`, weight: item["weight"], completeness: item["completeness"] });
  }
  return out;
}

function parsePlants(v: unknown): ChapterPlan["plants"] | string {
  if (!Array.isArray(v)) return "plants 必须是数组";
  const out: { label: string; weight: ForeshadowWeight }[] = [];
  for (const item of v) {
    if (!isRecord(item) || !isStr(item["label"]) || item["label"].trim() === "") return "plants 每项需要 label";
    if (!oneOf(item["weight"], FORESHADOW_WEIGHTS)) return "plants.weight 必须是 main/sub/detail";
    out.push({ label: item["label"], weight: item["weight"] });
  }
  return out;
}

// ── 合并 ────────────────────────────────────────────────────────────────

/** 新建人物卡的说话方式缺省：中性语域、直给、中等句长。作者随后按人物细化。 */
export const DEFAULT_SPEECH: SpeechProfile = {
  sentenceLength: { min: 4, max: 24 },
  verbalTics: [],
  signatureLexicon: [],
  forbiddenLexicon: [],
  addressForms: [],
  syntaxBias: { question: 0.2, imperative: 0.2, elliptical: 0.2 },
  register: "neutral",
  emotionalExpression: "direct",
  exemplars: [],
  counterExemplars: [],
};

const EMPTY_PROFILE: CharacterProfile = {
  role: "",
  appearance: [],
  traits: [],
  forbiddenBehaviors: [],
  wants: "",
  fears: "",
  background: "",
};

/** 分配下一个编号：取同前缀的最大序号 +1，两位补零（与伏笔分配同规则）。 */
export function nextId<P extends "C" | "S" | "P">(prefix: P, existing: readonly string[]): `${P}${string}` {
  let last = 0;
  for (const id of existing) {
    const m = ID_PATTERNS[prefix].exec(id);
    if (m !== null) last = Math.max(last, Number(id.slice(1)));
  }
  return `${prefix}${String(last + 1).padStart(2, "0")}`;
}

export function mergeCharacter(
  existing: Omit<CharacterCard, "state"> | undefined,
  input: CharacterInput,
  id: CharacterId,
  now: IsoTimestamp,
): Omit<CharacterCard, "state"> {
  const base: Omit<CharacterCard, "state"> = existing ?? {
    id,
    name: input.name ?? "",
    aliases: [],
    tier: "minor",
    introducedAt: 0,
    profile: EMPTY_PROFILE,
    speech: DEFAULT_SPEECH,
    provenance: "authored",
    updatedAt: now,
  };
  return {
    ...base,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.aliases === undefined ? {} : { aliases: input.aliases }),
    ...(input.tier === undefined ? {} : { tier: input.tier }),
    profile: { ...base.profile, ...input.profile },
    speech: { ...base.speech, ...input.speech },
    provenance: "authored",
    updatedAt: now,
  };
}

export function mergeLocation(existing: SettingCard | undefined, input: LocationInput, id: SettingId): SettingCard {
  const base: SettingCard = existing ?? { id, name: input.name ?? "", kind: "location", description: "", facts: [] };
  return {
    ...base,
    ...(input.name === undefined ? {} : { name: input.name }),
    ...(input.kind === undefined ? {} : { kind: input.kind }),
    ...(input.description === undefined ? {} : { description: input.description }),
    ...(input.facts === undefined ? {} : { facts: input.facts }),
  };
}

export function mergePlotLine(existing: PlotLineDef | undefined, input: PlotLineInput, id: PlotLineId): PlotLineDef {
  const base: PlotLineDef = existing ?? { id, label: input.label ?? "", weight: "sub" };
  return {
    ...base,
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.weight === undefined ? {} : { weight: input.weight }),
  };
}

/** 作者定制的纪律版本号 a1、a2…；平台缺省版（d1）被首次覆盖时从 a1 起。版本变即缓存前缀冷一次。 */
export function bumpDisciplineVersion(current: WritingDiscipline["version"]): string {
  const m = /^a(\d+)$/u.exec(current);
  return `a${m?.[1] === undefined ? 1 : Number(m[1]) + 1}`;
}

/** 作品方向字段的中文名，供回传文案与 UI chip。 */
export const DIRECTION_LABELS: Readonly<Record<keyof DirectionInput, string>> = {
  premise: "前提",
  centralConflict: "核心冲突",
  pov: "视角",
  tense: "时态",
  protagonistTraits: "主角性格",
  protagonistForbidden: "主角禁忌",
  specialAbility: "金手指",
  abilityLimits: "能力限制",
  worldRules: "世界观",
  openingSituation: "开局情境",
  styleKeywords: "风格关键词",
  romanceLine: "感情线",
  taboos: "禁忌",
};
