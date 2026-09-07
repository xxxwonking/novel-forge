/**
 * C6 代码通道（§12.3、§10.6-10.8）。零成本，即时。
 *
 * 这是产品差异化的落点（§15）：把 novel-engine 那类 prompt 约束从
 * "祈祷模型遵守"变成"代码强制执行"。所有阈值来自 rules.yaml 按实际字数
 * 与题材缩放，代码本身没有任何数字。
 *
 * 与 Haiku 通道（M4）的分工：这里只做能机械判定的 —— 计数、正则、区间比较。
 * 比喻计数、收束完整性、人物声音一致性、POV 合法性需要语义判断，归 Haiku。
 */

import type {
  ChapterBudget,
  ChapterPlan,
  GateFinding,
  WorkProfile,
} from "../types/beat.js";
import type { EventWeight } from "../types/events.js";
import type { Rules, ZeroToleranceRule } from "../rules/schema.js";
import { THRESHOLD_KEYS } from "../rules/schema.js";
import { measuredDensity, thresholdsForWords } from "../beat/derive.js";
import {
  countEach,
  countTotal,
  countWords,
  interjectionRepeats,
  lastParagraphs,
  parallelRuns,
  speechAndThought,
} from "../text/measure.js";

export interface ChapterGateInput {
  readonly chapterText: string;
  readonly plan: ChapterPlan;
  readonly budget: ChapterBudget;
  readonly profile: WorkProfile;
  /** C5 声明的事件权重。密度用声明值而非计划值 —— 校验的是写出来的东西。 */
  readonly declaredEventWeights: readonly EventWeight[];
}

export interface ChapterGateResult {
  readonly findings: readonly GateFinding[];
  readonly words: number;
  /** 按实际字数复算的阈值，进体检面板。 */
  readonly thresholds: Readonly<Record<string, number>>;
  readonly density: number;
}

/**
 * 章内校验全套。
 *
 * 顺序固定（字数 → 密度 → 词表 → 零容忍 → 复读），因为 findings 数组的
 * 顺序直接决定 UI 的展示顺序，而字数与密度是用户最先想看的。
 */
export function gateChapter(input: ChapterGateInput, rules: Rules): ChapterGateResult {
  const words = countWords(input.chapterText);
  const thresholds = thresholdsForWords(words, input.profile, rules);
  const density = measuredDensity(input.declaredEventWeights, words, rules);
  const findings: GateFinding[] = [
    ...checkWordCount(words, input.budget, findingsContext(input)),
    ...checkDensity(density, input.budget, words),
    ...checkFatigueWords(input.chapterText, thresholds, input.profile, rules),
    ...checkInterjections(input.chapterText, thresholds, rules),
    ...checkZeroTolerance(input.chapterText, rules),
    ...checkRepetition(input.chapterText, rules),
  ];
  return { findings, words, thresholds, density };
}

// ── 字数（§10.4 + §10.9 的 pass 语义）──────────────────────────────────

interface FindingsContext {
  readonly isPayoffLike: boolean;
  readonly promisedResolutionCount: number;
}

function findingsContext(input: ChapterGateInput): FindingsContext {
  const t = input.plan.chapterType;
  return {
    isPayoffLike: t === "payoff" || t === "climax",
    promisedResolutionCount: input.plan.resolves.length,
  };
}

/**
 * 字数 vs 预算。
 *
 * 低于下限一律 block（§10.10：字数低于下限是 block 级）—— 写短了是模型
 * 急着收尾，没有正当理由。
 *
 * 超上限只报 warn，**不在这里做放行判断** —— 放行需要知道"声明的收束是否
 * 真的完成"，那是 C7 的 routeOverflow 的职责（§10.9）。在这里就判 block
 * 会让高潮章拿到一个 C7 随后要撤销的结论。
 */
function checkWordCount(
  words: number,
  budget: ChapterBudget,
  ctx: FindingsContext,
): readonly GateFinding[] {
  const { min, max, sweet } = budget.words;
  if (words < min) {
    return [
      {
        rule: "word_count_under",
        level: "block",
        message: `${words} 字，低于预算下限 ${min}（目标 ${sweet}）—— 补写，不要用环境描写或心理活动凑数。`,
        measured: words,
        threshold: min,
      },
    ];
  }
  if (words > max) {
    const hint = ctx.isPayoffLike
      ? `本章承诺收束 ${ctx.promisedResolutionCount} 条伏笔，若收束尚未完成，C7 会放行超额。`
      : "考虑拆章或按删减优先级压缩。";
    return [
      {
        rule: "word_count_over",
        level: "warn",
        message: `${words} 字，超出预算上限 ${max}（目标 ${sweet}）—— ${hint}`,
        measured: words,
        threshold: max,
      },
    ];
  }
  return [];
}

// ── 密度（§10.5）────────────────────────────────────────────────────────

/**
 * 加权事件密度。
 *
 * 两个方向的越界含义不同（§10.5）：低于下限 = 拖沓（查内心复盘/背景说明/
 * 环境描写）；高于上限 = 太挤，读者跟不上。所以 message 必须分开写。
 */
function checkDensity(
  density: number,
  budget: ChapterBudget,
  words: number,
): readonly GateFinding[] {
  if (words === 0) return [];
  const { min, max } = budget.density;
  const shown = Math.round(density * 100) / 100;
  if (density < min) {
    return [
      {
        rule: "density_under",
        level: "warn",
        message: `加权事件密度 ${shown}，低于下限 ${min} —— 本章偏拖沓，查一遍内心复盘、背景说明和无功能环境描写。`,
        measured: shown,
        threshold: min,
      },
    ];
  }
  if (density > max) {
    return [
      {
        rule: "density_over",
        level: "warn",
        message: `加权事件密度 ${shown}，高于上限 ${max} —— 事件挤在一章里读者跟不上，考虑拆章或给关键事件补铺垫。`,
        measured: shown,
        threshold: max,
      },
    ];
  }
  return [];
}

// ── 词表（§10.6）────────────────────────────────────────────────────────

/**
 * 高疲劳词。**每个词各自计数**，不是总计 ——
 * "瞳孔骤缩"两次和四个不同疲劳词各一次不是一回事，前者是复读，后者是词穷，
 * 但只有前者需要立刻改。
 */
function checkFatigueWords(
  text: string,
  thresholds: Readonly<Record<string, number>>,
  profile: WorkProfile,
  rules: Rules,
): readonly GateFinding[] {
  const limit = thresholds[THRESHOLD_KEYS.fatigueWord] ?? 0;
  const words = [...rules.fatigueWords["common"] ?? [], ...(rules.fatigueWords[profile.genre] ?? [])];
  return countEach(text, words)
    .filter((x) => x.count > limit)
    .map<GateFinding>((x) => ({
      rule: "fatigue_word_over",
      level: "warn",
      message: `「${x.word}」出现 ${x.count} 次，超过上限 ${limit} —— 换具体的动作或反应，不要重复同一个套路表情。`,
      measured: x.count,
      threshold: limit,
    }));
}

/** 口头感叹词按**总计**算 —— 这一类的问题是整体过多，不是某一个词过多。 */
function checkInterjections(
  text: string,
  thresholds: Readonly<Record<string, number>>,
  rules: Rules,
): readonly GateFinding[] {
  const limit = thresholds[THRESHOLD_KEYS.interjection] ?? 0;
  const total = countTotal(text, rules.interjections);
  if (total <= limit) return [];
  return [
    {
      rule: "interjection_over",
      level: "warn",
      message: `口头感叹词共 ${total} 处，超过上限 ${limit} —— 删掉一半，让台词直接进入内容。`,
      measured: total,
      threshold: limit,
    },
  ];
}

// ── 零容忍（§10.7）──────────────────────────────────────────────────────

/**
 * 零容忍规则。**不按字数缩放** —— 元层穿帮出现一次就是一次。
 *
 * scope 是这一组的关键（§10.7，机械判定口径见 §10.13）：「作者」出现在叙述里可能是正常的（小说里
 * 的一个角色），出现在角色内心独白里才是穿帮。不限定范围就会大量误报，
 * 而用户面对一个消不掉的假警报只会关掉整个检查器（§10.10 同一逻辑）。
 */
function checkZeroTolerance(text: string, rules: Rules): readonly GateFinding[] {
  return [
    ...applyZeroTolerance(text, rules.zeroTolerance.metaLeak, "meta_leak"),
    ...applyZeroTolerance(text, rules.zeroTolerance.endingCliche, "ending_cliche"),
  ];
}

function applyZeroTolerance(
  text: string,
  rule: ZeroToleranceRule,
  ruleId: string,
): readonly GateFinding[] {
  const segments = scopeSegments(text, rule);
  const re = new RegExp(rule.pattern, "gu");
  const hits = new Set<string>();
  for (const seg of segments) {
    for (const m of seg.matchAll(re)) {
      const hit = m[0];
      if (hit !== undefined && hit !== "") hits.add(hit);
    }
  }
  if (hits.size === 0) return [];
  return [
    {
      rule: ruleId,
      level: rule.level,
      message: `${rule.message}（命中：${[...hits].join("、")}）`,
      measured: hits.size,
      threshold: 0,
    },
  ];
}

function scopeSegments(text: string, rule: ZeroToleranceRule): readonly string[] {
  switch (rule.scope) {
    case "speech_and_thought":
      return speechAndThought(text);
    case "last_paragraphs":
      return lastParagraphs(text, rule.lastParagraphs ?? 1);
    case "full_text":
      return [text];
  }
}

// ── 复读式结构（§10.7）──────────────────────────────────────────────────

function checkRepetition(text: string, rules: Rules): readonly GateFinding[] {
  const findings: GateFinding[] = [];
  const pr = rules.repetition.parallelRun;

  for (const run of parallelRuns(text, pr.minRun)) {
    findings.push({
      rule: "parallel_run",
      level: pr.level,
      message: `${pr.message} —— 第 ${run.start + 1} 段起连续 ${run.length} 行以「${run.subject}」开头加破折号。这是有意的排比修辞时可放行。`,
      measured: run.length,
      threshold: pr.minRun,
    });
  }

  const ir = rules.repetition.interjectionRepeat;
  for (const hit of interjectionRepeats(text, rules.interjections, ir.windowLines)) {
    findings.push({
      rule: "interjection_repeat",
      level: ir.level,
      message: `${ir.message} —— 「${hit.word}」在第 ${hit.line + 1} 段再次出现。`,
    });
  }

  return findings;
}
