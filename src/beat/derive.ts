/**
 * V3 逐章派生预算（§10.2-10.6、§12.2）。纯代码，零成本。
 *
 * §10.2 的关键要求：**第 1 层必须在写作前算出来。** 事后补救的质量永远不如
 * 一开始给对预算 —— 模型知道自己有 5300 字空间，就不会写到 2400 字急着收尾。
 *
 * 本模块是 `Derived<T>` 品牌的唯一构造点之一（另一处是 store/project.ts 的
 * 投影器）。所以"把模型输出的字数当成预算存进去"在编译期就断掉。
 */

import type {
  ChapterBudget,
  ChapterPlan,
  ChapterType,
  DensityRange,
  DetectionThresholds,
  PipelineTier,
  SplitAdvice,
  WordBudget,
  WorkProfile,
} from "../types/beat.js";
import type { Derived, IsoTimestamp } from "../types/primitives.js";
import type { EventWeight } from "../types/events.js";
import type { Range, Rules } from "../rules/schema.js";

/** 派生值的唯一构造入口。除本模块与投影器外没有别处能造。 */
function derived<T>(value: T): Derived<T> {
  return value as Derived<T>;
}

/** §10.4 只有回收章与高潮章把伏笔收束成本计入预算。 */
function countsResolutions(type: ChapterType): boolean {
  return type === "payoff" || type === "climax";
}

function roundTo(value: number, unit: number): number {
  return Math.round(value / unit) * unit;
}

/**
 * 取规则表里的成本区间。
 *
 * 类型上权重是必填的，但节拍表是用户目录下的 JSON —— 手改过或损坏的文件可能
 * 缺字段。直接解构会抛 "undefined is not iterable"，用户只看到一个 500，不知道
 * 是哪一章的哪一项坏了。这里换成能指出位置的错误，与「坏文件要看得见」一致。
 */
function cost(table: Readonly<Record<string, Range>>, weight: string | number, what: string): Range {
  // 事件权重是 1|2|3，伏笔权重是 main|sub|detail —— 两种表都按同一个键查。
  const found = table[weight];
  if (found === undefined) throw new Error(`节拍表里的${what}无效：${String(weight)}（可选项：${Object.keys(table).join("、")}）`);
  return found;
}

// ── 字数预算（§10.4）────────────────────────────────────────────────────

/**
 * §10.4 字数预算。
 *
 * **平台 tolerance 只钳制事件驱动的增量，不钳制伏笔收束的增量**（§10.13 ①）。
 * §10.4 的伪代码把钳制放在全部增量之后，但那会让它自己给出的「高潮章收
 * 2 主线 + 1 支线 → 4250-6350」变成 4250-4700 —— 把 §10.1 立论的那个场景
 * （压缩即自毁）又压回去了。
 *
 * 分开处理才自洽：事件装不下的出口是拆章（§10.9 多事件 → split），所以
 * 事件增量该被钳住、让超载显形为拆章信号；收束需要的空间是内容要求，
 * 它的出口是 splitAdvice 的规划期提示，不是压缩。
 */
export function deriveWordBudget(
  plan: ChapterPlan,
  profile: WorkProfile,
  rules: Rules,
): Derived<WordBudget> {
  const { base, tolerance } = rules.platform[profile.platform];
  const [lo, hi] = rules.typeFactor[plan.chapterType];
  let min = base * lo;
  let max = base * hi;

  // 首个事件的成本已含在类型基线里，从第二个起计入。
  for (const e of plan.events.slice(1)) {
    const [eLo, eHi] = cost(rules.eventCost, e.weight, `计划事件「${e.summary}」的权重`);
    min += eLo;
    max += eHi;
  }

  // 事件增量的两端都受平台容忍度钳制。只钳上限会让重载事件章的区间被 min
  // 顶成零宽（min 追上 max），任何字数都算违规；两端同钳则区间保持正常宽度，
  // 而"装不下"这件事显形为超上限 → §10.9 的 split，这才是正确出口。
  min = Math.min(min, base * lo * (1 + tolerance));
  max = Math.min(max, base * hi * (1 + tolerance));

  if (countsResolutions(plan.chapterType)) {
    for (const r of plan.resolves) {
      const [cLo, cHi] = cost(rules.resolveCost, r.weight, `伏笔收束「${r.foreshadowId}」的权重`);
      const ratio = r.completeness === "partial" ? rules.partialRatio : 1;
      min += cLo * ratio;
      max += cHi * ratio;
    }
  }

  // 兜底：某组系数下（lo × (1+tolerance) > hi）钳制后的 min 会超过 max。
  // 让区间为空会导致该类章一律超标，把闸门变成纯噪音。
  if (max < min) max = min;

  const roundedMin = roundTo(min, rules.roundTo);
  const roundedMax = roundTo(max, rules.roundTo);
  return derived({
    min: roundedMin,
    max: roundedMax,
    sweet: roundTo((roundedMin + roundedMax) / 2, rules.roundTo),
  });
}

// ── 事件密度（§10.5）────────────────────────────────────────────────────

export function deriveDensity(plan: ChapterPlan, rules: Rules): Derived<DensityRange> {
  const [min, max] = rules.densityRange[plan.chapterType];
  return derived({ min, max });
}

/** §10.5 加权事件值：weighted = Σ(weight → eventWeightValue)。 */
export function weightedEventValue(
  weights: readonly EventWeight[],
  rules: Rules,
): number {
  return weights.reduce((sum, w) => sum + rules.eventWeightValue[w], 0);
}

/** 实测密度 = 加权值 / 千字。words 为 0 时返回 0 而非 Infinity。 */
export function measuredDensity(
  weights: readonly EventWeight[],
  words: number,
  rules: Rules,
): number {
  if (words <= 0) return 0;
  return weightedEventValue(weights, rules) / (words / 1000);
}

// ── 检测阈值（§10.6）────────────────────────────────────────────────────

/**
 * threshold = max(hardMin, round(per1k × 千字数 × 题材系数))
 *
 * 用哪个字数：**上限**（§10.13 ④）。阈值是"最多允许多少次"，按下限算会让
 * 写到区间上端的合规章节被误判 —— 4000 字的章按 3000 字的比喻上限查必然超标。
 */
export function deriveThresholds(
  words: WordBudget,
  profile: WorkProfile,
  rules: Rules,
): Derived<DetectionThresholds> {
  return derived(thresholdsForWords(words.max, profile, rules));
}

/**
 * 按实际字数重算阈值（C6 用）。
 *
 * 与 deriveThresholds 分开的理由：规划期只有预算，交稿后有实际字数。
 * 用实际字数复算能让"写得比预算短"的章不被过宽的阈值放过。
 */
export function thresholdsForWords(
  words: number,
  profile: WorkProfile,
  rules: Rules,
): DetectionThresholds {
  const mul = rules.genreMul[profile.genre];
  const out: Record<string, number> = {};
  for (const rule of rules.densityRules) {
    const scaled = rule.per1k * (words / 1000) * (mul[rule.key] ?? 1);
    out[rule.key] = Math.max(rule.hardMin, Math.round(scaled));
  }
  return Object.freeze(out);
}

// ── 流程档位（§12.8）────────────────────────────────────────────────────

export function deriveTier(plan: ChapterPlan, rules: Rules): Derived<PipelineTier> {
  return derived(rules.tier[plan.chapterType]);
}

// ── 拆章建议（§10.4 上限兜底）──────────────────────────────────────────

/**
 * 预算下限超过 base × splitAdviceFactor 时给出拆章建议。
 *
 * 断点规则（§10.4）：**放在两条主线伏笔之间，绝不放在一条主线的收束过程中间。**
 * 所以 suggestedBreakAfter 只在有 ≥2 条主线收束时给具体落点 —— 只收一条主线
 * 时任何断点都会切开那条收束，此时只报警不给位置。
 */
function adviseSplit(
  plan: ChapterPlan,
  words: WordBudget,
  profile: WorkProfile,
  rules: Rules,
): SplitAdvice | null {
  const { base } = rules.platform[profile.platform];
  // 比的是**上限**（§10.13 ②）：§10.11 的示例输出对 4250-6350 那一章给了
  // 拆分提示，而它的下限 4250 并未超过 base×2.5。规划期该看"最坏情况装不装得下"。
  if (words.max <= base * rules.splitAdviceFactor) return null;

  const mains = plan.resolves.filter((r) => r.weight === "main");
  const breakAfter = mains.length >= 2 ? (mains[0]?.foreshadowId ?? null) : null;
  const note =
    breakAfter !== null
      ? `预算 ${words.min}-${words.max} 超出平台单章常规（基准 ${base}）。若需拆分，断点放在 ${breakAfter} 收束之后 —— 不要切开任何一条主线伏笔的收束过程。`
      : `预算 ${words.min}-${words.max} 超出平台单章常规（基准 ${base}）。建议把部分支线伏笔挪到前一章预收；本章只收一条主线，不要在收束过程中间断开。`;

  return { reason: "budget_exceeds_platform_cap", suggestedBreakAfter: breakAfter, note };
}

// ── 入口 ────────────────────────────────────────────────────────────────

export interface DeriveOptions {
  readonly now?: IsoTimestamp;
}

/**
 * V3 的完整派生。规划阶段（§10.11）与 C1 装配都用它。
 *
 * `derivedFrom` 记下平台/题材/规则版本：改平台后要能解释旧章为何是旧预算，
 * 而不是让用户看到一个无法复现的数字。
 */
export function deriveBudget(
  plan: ChapterPlan,
  profile: WorkProfile,
  rules: Rules,
  options: DeriveOptions = {},
): ChapterBudget {
  const words = deriveWordBudget(plan, profile, rules);
  return {
    words,
    density: deriveDensity(plan, rules),
    thresholds: deriveThresholds(words, profile, rules),
    tier: deriveTier(plan, rules),
    splitAdvice: adviseSplit(plan, words, profile, rules),
    derivedFrom: {
      platform: profile.platform,
      genre: profile.genre,
      rulesVersion: rules.version,
    },
    derivedAt: options.now ?? new Date().toISOString(),
  };
}
