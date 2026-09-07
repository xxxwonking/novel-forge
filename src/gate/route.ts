/**
 * C7 分流处理（§10.9、§12.3）。
 *
 * 核心是对"高于上限优先拆章"这个直觉的修正：**回收章与高潮章的收束未完成时
 * 主动放行超额**（§10.9）。没有这条，用户面对一个无法消除的红色警告只能
 * 关掉整个检查器 —— `pass` 级的存在意义就在这里（§10.10）。
 *
 * 另一条：补写与删减的优先级必须写进 prompt（§10.9）。不约束的话模型补字数
 * 一定加环境描写，越补越水。所以 routeChapter 的产物包含 target 清单，
 * 由调用方原样注入补写/删减的指令。
 */

import type {
  ChapterBudget,
  ChapterPlan,
  GateFinding,
  OverflowAction,
} from "../types/beat.js";
import type { Rules } from "../rules/schema.js";

export interface RouteInput {
  readonly words: number;
  readonly plan: ChapterPlan;
  readonly budget: ChapterBudget;
  /**
   * 节拍表承诺要收、但结构声明里缺失或降级的伏笔。
   * 由 c5-crosscheck 的 checkPromisedResolutions 产出的 finding 折算而来。
   */
  readonly unresolvedPromises: readonly string[];
}

export interface RouteResult {
  readonly action: OverflowAction;
  /** 放行/分流的解释，进 GateFinding。 */
  readonly findings: readonly GateFinding[];
}

/**
 * 按字数与章节类型分流（§10.9 的 handleOverflow）。
 *
 * 分支取向：
 * - 字数不足 → patch，带补写优先级（这一支 §10.9 的伪代码没写，但 §12.3 C7
 *   明确要"字数不足 → 补写（带 PATCH_PRIORITY）"）
 * - 回收/高潮章超额且收束未完成 → **pass**，主动放行并记录原因
 * - 回收/高潮章超额但收束已完成 → trim
 * - 事件章多事件超额 → split；单事件超额 → trim
 */
export function routeChapter(input: RouteInput, rules: Rules): RouteResult {
  const { words, plan, budget } = input;
  const pp = rules.patchPriority;

  if (words < budget.words.min) {
    const [lo, hi] = rules.resolutionPatchWords;
    const gap = budget.words.min - words;
    return {
      action: { action: "patch", targets: pp.patch },
      findings: [
        {
          rule: "route_patch",
          level: "block",
          message: [
            `还差 ${gap} 字（下限 ${budget.words.min}）。按优先级补写：${pp.patch.join("、")}。`,
            `禁止用来补字数的东西：${pp.forbidPatch.join("、")}。`,
            input.unresolvedPromises.length > 0
              ? `其中未完成的收束优先补，每条 ${lo}-${hi} 字：${input.unresolvedPromises.join("、")}。`
              : "",
          ]
            .filter((s) => s !== "")
            .join("\n"),
          measured: words,
          threshold: budget.words.min,
        },
      ],
    };
  }

  if (words <= budget.words.max) {
    return { action: { action: "ok" }, findings: [] };
  }

  const isPayoffLike = plan.chapterType === "payoff" || plan.chapterType === "climax";

  if (isPayoffLike && input.unresolvedPromises.length > 0) {
    const note = `${plan.chapterType === "climax" ? "高潮章" : "回收章"}承诺的收束尚未完成（${input.unresolvedPromises.join("、")}），压缩会毁掉收束的爆发力，放行 ${words - budget.words.max} 字超额。`;
    return {
      action: { action: "pass", note },
      findings: [
        {
          rule: "route_pass_overflow",
          level: "pass",
          message: note,
          passReason: note,
          measured: words,
          threshold: budget.words.max,
        },
      ],
    };
  }

  if (isPayoffLike) {
    return trim(words, budget, rules, "收束已完成，超额部分按删减优先级压缩。");
  }

  // 事件章及以下：多事件 → 拆，单事件 → 删水
  if (plan.events.length > 1) {
    const at = plan.events[1]?.summary ?? "次级事件起点";
    return {
      action: { action: "split", at },
      findings: [
        {
          rule: "route_split",
          level: "warn",
          message: `${words} 字超出上限 ${budget.words.max}，本章有 ${plan.events.length} 个事件 —— 建议在「${at}」处拆章，两章各自有完整的兑现。`,
          measured: words,
          threshold: budget.words.max,
        },
      ],
    };
  }

  return trim(words, budget, rules, "本章只有一个事件，超额的是水分。");
}

function trim(
  words: number,
  budget: ChapterBudget,
  rules: Rules,
  reason: string,
): RouteResult {
  const pp = rules.patchPriority;
  return {
    action: { action: "trim", targets: pp.trim },
    findings: [
      {
        rule: "route_trim",
        level: "warn",
        message: [
          `${words} 字超出上限 ${budget.words.max}。${reason}`,
          `按优先级删减：${pp.trim.join("、")}。`,
          `绝不能删：${pp.forbidTrim.join("、")}。`,
        ].join("\n"),
        measured: words,
        threshold: budget.words.max,
      },
    ],
  };
}

/**
 * 从 findings 里提取未完成的收束（§12.3 C7 的输入）。
 *
 * 与直接比对声明的区别：这里认的是 c5-crosscheck 已经判定过的结论，
 * 避免同一逻辑在两处实现后分歧。`resolution_missing` 是缺失，
 * `resolution_downgraded` 是降级为部分 —— 两者都算"承诺未完全兑现"。
 */
export function unresolvedFromFindings(findings: readonly GateFinding[]): readonly string[] {
  const ids: string[] = [];
  for (const f of findings) {
    if (f.rule !== "resolution_missing" && f.rule !== "resolution_downgraded") continue;
    const m = f.message.match(/F\d+/u);
    if (m !== null) ids.push(m[0]);
  }
  return [...new Set(ids)];
}

/** §12.3 C7 末条：block 未清不允许接受。 */
export function canAccept(findings: readonly GateFinding[]): boolean {
  return !findings.some((f) => f.level === "block");
}
