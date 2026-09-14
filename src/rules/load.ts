/**
 * `rules.yaml` 的加载与校验。
 *
 * 一条原则：**启动即校验，缺一个 key 就抛**。配置错误在第 80 章派生预算时
 * 才暴露成 NaN 是最坏的失败方式 —— NaN 会安静地通过所有比较（NaN > x 恒假），
 * 结果是字数检查全体失效而没有任何报错。所以这里对每个字段做存在性与类型
 * 检查，路径写进错误消息。
 *
 * 加载后冻结并缓存：规则在一次进程生命周期内不变，而 deriveBudget 会被
 * 每章调用，重复解析 YAML 没有意义。
 */

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import type {
  AlertRules,
  BeatValidationRules,
  CrossChapterRules,
  DensityRule,
  PatchPriority,
  PlatformBase,
  Range,
  RepetitionRules,
  Rules,
  ZeroToleranceRule,
  ZeroToleranceScope,
} from "./schema.js";
import type { ChapterType, Genre, GateLevel, PipelineTier, Platform } from "../types/beat.js";
import type { EventWeight, ForeshadowWeight } from "../types/events.js";
import type { CharacterTier } from "../types/character.js";

const CHAPTER_TYPES = ["transition", "setup", "event", "payoff", "climax"] as const;
const PLATFORMS = ["fanqie", "feilu", "qidian", "unpublished"] as const;
const GENRES = ["xuanhuan", "xianxia", "urban", "scifi", "mystery", "rulehorror"] as const;
const FORESHADOW_WEIGHTS = ["main", "sub", "detail"] as const;
const CHARACTER_TIERS = ["protagonist", "major", "minor", "extra"] as const;
const EVENT_WEIGHTS = [1, 2, 3] as const;
const TIERS = ["fast", "standard", "strict"] as const;
const LEVELS = ["block", "warn", "info", "pass"] as const;
const SCOPES = ["speech_and_thought", "last_paragraphs", "full_text"] as const;

export class RulesError extends Error {
  constructor(path: string, detail: string) {
    super(`rules.yaml: ${path} ${detail}`);
    this.name = "RulesError";
  }
}

// ── 取值原语 ────────────────────────────────────────────────────────────

function at(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const seg of path.split(".")) {
    if (typeof cur !== "object" || cur === null) return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function num(root: unknown, path: string): number {
  const v = at(root, path);
  if (typeof v !== "number" || !Number.isFinite(v)) {
    throw new RulesError(path, `必须是有限数字，实际是 ${JSON.stringify(v)}`);
  }
  return v;
}

function str(root: unknown, path: string): string {
  const v = at(root, path);
  if (typeof v !== "string" || v === "") {
    throw new RulesError(path, `必须是非空字符串，实际是 ${JSON.stringify(v)}`);
  }
  return v;
}

function strList(root: unknown, path: string): readonly string[] {
  const v = at(root, path);
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string")) {
    throw new RulesError(path, "必须是字符串数组");
  }
  return Object.freeze([...(v as string[])]);
}

/** 区间必须 lo ≤ hi —— 写反了会让预算区间为空，所有章一律超标。 */
function range(root: unknown, path: string): Range {
  const v = at(root, path);
  if (!Array.isArray(v) || v.length !== 2) {
    throw new RulesError(path, "必须是 [下限, 上限] 两元数组");
  }
  const [lo, hi] = v as unknown[];
  if (typeof lo !== "number" || typeof hi !== "number" || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    throw new RulesError(path, "区间的两端必须都是有限数字");
  }
  if (lo > hi) throw new RulesError(path, `下限 ${lo} 大于上限 ${hi}`);
  return [lo, hi];
}

function oneOf<T extends string>(root: unknown, path: string, allowed: readonly T[]): T {
  const v = str(root, path);
  if (!(allowed as readonly string[]).includes(v)) {
    throw new RulesError(path, `必须是 ${allowed.join(" | ")} 之一，实际是 ${v}`);
  }
  return v as T;
}

/** 按固定 key 集合建表。缺 key 即抛 —— 少一个章节类型会让那类章无预算。 */
function table<K extends string | number, V>(
  keys: readonly K[],
  read: (key: K) => V,
): Readonly<Record<K, V>> {
  const out = {} as Record<K, V>;
  for (const k of keys) out[k] = read(k);
  return Object.freeze(out);
}

// ── 分块解析 ────────────────────────────────────────────────────────────

function readDensityRules(root: unknown): readonly DensityRule[] {
  const raw = at(root, "densityRules");
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new RulesError("densityRules", "必须是非空数组");
  }
  const seen = new Set<string>();
  const rules = raw.map((_, i): DensityRule => {
    const p = `densityRules.${i}`;
    const key = str(root, `${p}.key`);
    if (seen.has(key)) throw new RulesError(p, `key 重复：${key}`);
    seen.add(key);
    return Object.freeze({
      key,
      per1k: num(root, `${p}.per1k`),
      hardMin: num(root, `${p}.hardMin`),
    });
  });
  return Object.freeze(rules);
}

function readZeroTolerance(root: unknown, path: string): ZeroToleranceRule {
  const pattern = str(root, `${path}.pattern`);
  try {
    new RegExp(pattern);
  } catch (e) {
    throw new RulesError(`${path}.pattern`, `不是合法正则：${(e as Error).message}`);
  }
  const scope = oneOf<ZeroToleranceScope>(root, `${path}.scope`, SCOPES);
  const rule = {
    pattern,
    scope,
    level: oneOf<GateLevel>(root, `${path}.level`, LEVELS),
    message: str(root, `${path}.message`),
  };
  if (scope !== "last_paragraphs") return Object.freeze(rule);
  return Object.freeze({ ...rule, lastParagraphs: num(root, `${path}.lastParagraphs`) });
}

function readRepetition(root: unknown): RepetitionRules {
  return Object.freeze({
    parallelRun: Object.freeze({
      minRun: num(root, "repetition.parallelRun.minRun"),
      level: oneOf<GateLevel>(root, "repetition.parallelRun.level", LEVELS),
      message: str(root, "repetition.parallelRun.message"),
    }),
    interjectionRepeat: Object.freeze({
      windowLines: num(root, "repetition.interjectionRepeat.windowLines"),
      level: oneOf<GateLevel>(root, "repetition.interjectionRepeat.level", LEVELS),
      message: str(root, "repetition.interjectionRepeat.message"),
    }),
  });
}

function readCrossChapter(root: unknown): CrossChapterRules {
  return Object.freeze({
    noStageFeedbackBlock: num(root, "crossChapter.noStageFeedbackBlock"),
    noStageFeedbackPlanBlock: num(root, "crossChapter.noStageFeedbackPlanBlock"),
    noPayoffWarn: num(root, "crossChapter.noPayoffWarn"),
    plotLineGap: table<ForeshadowWeight, number>(FORESHADOW_WEIGHTS, (w) =>
      num(root, `crossChapter.plotLineGap.${w}`),
    ),
    foreshadowDueSoon: num(root, "crossChapter.foreshadowDueSoon"),
    foreshadowStale: num(root, "crossChapter.foreshadowStale"),
    characterAbsent: table<CharacterTier, number>(CHARACTER_TIERS, (t) =>
      num(root, `crossChapter.characterAbsent.${t}`),
    ),
  });
}

function readBeatValidation(root: unknown): BeatValidationRules {
  return Object.freeze({
    stageFeedbackBlacklist: strList(root, "beatValidation.stageFeedbackBlacklist"),
    hookBlacklist: strList(root, "beatValidation.hookBlacklist"),
    coreEventConnectors: strList(root, "beatValidation.coreEventConnectors"),
    coreEventConnectorLimit: num(root, "beatValidation.coreEventConnectorLimit"),
  });
}

/** 数字列表。fatigue 那种"索引即语义"的数组用它。 */
function numList(root: unknown, path: string): readonly number[] {
  const v = at(root, path);
  if (!Array.isArray(v) || v.length === 0) {
    throw new RulesError(path, "必须是非空数字数组");
  }
  v.forEach((x, i) => {
    if (typeof x !== "number" || !Number.isFinite(x)) {
      throw new RulesError(`${path}.${i}`, `必须是有限数字，实际是 ${JSON.stringify(x)}`);
    }
  });
  return Object.freeze([...(v as number[])]);
}

/** 一组同层数字字段。decay 的四条曲线各自的系数用它，路径全部进错误消息。 */
function numGroup<K extends string>(
  root: unknown,
  path: string,
  keys: readonly K[],
): Readonly<Record<K, number>> {
  return table<K, number>(keys, (k) => num(root, `${path}.${k}`));
}

function readAlerts(root: unknown): AlertRules {
  const d = "alerts.decay";
  return Object.freeze({
    impact: numGroup(root, "alerts.impact", FORESHADOW_WEIGHTS),
    characterImpact: numGroup(root, "alerts.characterImpact", CHARACTER_TIERS),
    minScore: num(root, "alerts.minScore"),
    decay: Object.freeze({
      foreshadowOverdue: numGroup(root, `${d}.foreshadowOverdue`, [
        "dueSoonFloor",
        "dueSoonSpan",
        "dueSoonWindow",
        "risePer",
        "peakAt",
        "fallPer",
        "floor",
      ] as const),
      plotlineGap: numGroup(root, `${d}.plotlineGap`, ["base", "slope", "cap"] as const),
      characterMissing: numGroup(root, `${d}.characterMissing`, [
        "lowGap",
        "low",
        "highGap",
        "risePer",
        "afterExit",
      ] as const),
      settingConflict: numGroup(root, `${d}.settingConflict`, ["base", "per", "cap"] as const),
      flat: num(root, `${d}.flat`),
    }),
    direction: numGroup(root, "alerts.direction", ["forward", "backward"] as const),
    backwardMinImpact: num(root, "alerts.backwardMinImpact"),
    fatigue: numList(root, "alerts.fatigue"),
    fatigueDropAt: num(root, "alerts.fatigueDropAt"),
    decayResetDelta: num(root, "alerts.decayResetDelta"),
    diversityPenalty: num(root, "alerts.diversityPenalty"),
    homepageLimit: num(root, "alerts.homepageLimit"),
    migration: numGroup(root, "alerts.migration", [
      "foreshadowAbandonAfter",
      "characterExitAfter",
    ] as const),
  });
}

function readPatchPriority(root: unknown): PatchPriority {
  return Object.freeze({
    patch: strList(root, "patchPriority.patch"),
    forbidPatch: strList(root, "patchPriority.forbidPatch"),
    trim: strList(root, "patchPriority.trim"),
    forbidTrim: strList(root, "patchPriority.forbidTrim"),
  });
}

/** 题材系数表。内层是自由 key（对应 densityRules 的 key），缺省 1.0。 */
function readGenreMul(root: unknown, ruleKeys: readonly string[]): Rules["genreMul"] {
  return table<Genre, Readonly<Record<string, number>>>(GENRES, (g) => {
    const raw = at(root, `genreMul.${g}`);
    if (raw === undefined || raw === null) return Object.freeze({});
    if (typeof raw !== "object" || Array.isArray(raw)) {
      throw new RulesError(`genreMul.${g}`, "必须是 key→系数 的映射");
    }
    const out: Record<string, number> = {};
    for (const k of Object.keys(raw as Record<string, unknown>)) {
      // 拼错的 key 会静默失效（永远取不到系数），所以这里直接抛。
      if (!ruleKeys.includes(k)) {
        throw new RulesError(`genreMul.${g}.${k}`, `不是任何 densityRules 的 key`);
      }
      out[k] = num(root, `genreMul.${g}.${k}`);
    }
    return Object.freeze(out);
  });
}

/** 疲劳词表：common 必有，题材档可缺（缺即只用 common）。 */
function readFatigueWords(root: unknown): Rules["fatigueWords"] {
  const out: Record<string, readonly string[]> = { common: strList(root, "fatigueWords.common") };
  for (const g of GENRES) {
    if (at(root, `fatigueWords.${g}`) !== undefined) {
      out[g] = strList(root, `fatigueWords.${g}`);
    }
  }
  return Object.freeze(out);
}

// ── 入口 ────────────────────────────────────────────────────────────────

/** 从已解析的对象构造规则集。测试用它注入变体，不必写临时文件。 */
export function buildRules(root: unknown): Rules {
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    throw new RulesError("<root>", "YAML 根节点必须是映射");
  }
  const densityRules = readDensityRules(root);
  const ruleKeys = densityRules.map((r) => r.key);

  return Object.freeze({
    version: str(root, "version"),
    platform: table<Platform, PlatformBase>(PLATFORMS, (p) =>
      Object.freeze({
        base: num(root, `platform.${p}.base`),
        tolerance: num(root, `platform.${p}.tolerance`),
      }),
    ),
    typeFactor: table<ChapterType, Range>(CHAPTER_TYPES, (t) => range(root, `typeFactor.${t}`)),
    resolveCost: table<ForeshadowWeight, Range>(FORESHADOW_WEIGHTS, (w) =>
      range(root, `resolveCost.${w}`),
    ),
    partialRatio: num(root, "partialRatio"),
    eventCost: table<EventWeight, Range>(EVENT_WEIGHTS, (w) => range(root, `eventCost.${w}`)),
    splitAdviceFactor: num(root, "splitAdviceFactor"),
    roundTo: num(root, "roundTo"),
    densityRange: table<ChapterType, Range>(CHAPTER_TYPES, (t) => range(root, `densityRange.${t}`)),
    eventWeightValue: table<EventWeight, number>(EVENT_WEIGHTS, (w) =>
      num(root, `eventWeightValue.${w}`),
    ),
    densityRules,
    genreMul: readGenreMul(root, ruleKeys),
    fatigueWords: readFatigueWords(root),
    interjections: strList(root, "interjections"),
    zeroTolerance: Object.freeze({
      metaLeak: readZeroTolerance(root, "zeroTolerance.metaLeak"),
      endingCliche: readZeroTolerance(root, "zeroTolerance.endingCliche"),
    }),
    repetition: readRepetition(root),
    crossChapter: readCrossChapter(root),
    beatValidation: readBeatValidation(root),
    patchPriority: readPatchPriority(root),
    resolutionPatchWords: range(root, "resolutionPatchWords"),
    alerts: readAlerts(root),
    anchor: Object.freeze({ shiftTolerance: num(root, "anchor.shiftTolerance") }),
    tier: table<ChapterType, PipelineTier>(CHAPTER_TYPES, (t) =>
      oneOf<PipelineTier>(root, `tier.${t}`, TIERS),
    ),
    task: Object.freeze({
      maxToolIterations: num(root, "task.maxToolIterations"),
      maxAutoRevisions: num(root, "task.maxAutoRevisions"),
    }),
    agent: Object.freeze({
      maxConversationRounds: num(root, "agent.maxConversationRounds"),
      maxPlanningRounds: num(root, "agent.maxPlanningRounds"),
      maxProposalItems: num(root, "agent.maxProposalItems"),
    }),
  });
}

export function parseRules(yamlText: string): Rules {
  return buildRules(parse(yamlText));
}

let cached: Rules | null = null;

/** 默认规则集。仓库根的 rules.yaml，进程内只读一次。 */
export function loadRules(path = new URL("../../rules.yaml", import.meta.url)): Rules {
  cached ??= parseRules(readFileSync(path, "utf8"));
  return cached;
}
