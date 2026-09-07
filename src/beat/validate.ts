/**
 * V2 节拍表校验（§12.2）。**全是纯代码，零成本。**
 *
 * 价值在于把"祈祷模型遵守"变成"不合规就打回" —— 节拍表「阶段反馈」写了
 * "继续铺垫"直接拒绝，让模型重填。这是 §15 说的那种差异化：把 prompt 约束
 * 变成代码强制执行。
 *
 * 作用在规划阶段（V1 之后、V3 之前），所以只看 ChapterPlan，不看正文。
 */

import type { ChapterBeat, ChapterPlan, GateFinding } from "../types/beat.js";
import type { ChapterNo, ForeshadowId } from "../types/primitives.js";
import type { Rules } from "../rules/schema.js";

/** 命中黑名单的词。返回全部命中项而非第一个 —— 让模型一次改完。 */
function hits(text: string, blacklist: readonly string[]): readonly string[] {
  return blacklist.filter((w) => text.includes(w));
}

// ── 单章规则 ────────────────────────────────────────────────────────────

/**
 * 单章节拍校验。
 *
 * 三条规则的取向不同：
 * - 阶段反馈/章末钩子黑名单 → block，因为它们是"没想清楚"的确证信号
 * - 核心事件的连接词过多 → warn，因为一个长句里有两个"然后"也可能是叙述习惯，
 *   拆章是建议不是命令（§12.2 原文就是"提示拆章"）
 */
export function validatePlan(plan: ChapterPlan, rules: Rules): readonly GateFinding[] {
  const v = rules.beatValidation;
  const findings: GateFinding[] = [];

  const feedbackHits = hits(plan.stageFeedback, v.stageFeedbackBlacklist);
  if (feedbackHits.length > 0) {
    findings.push({
      rule: "beat_stage_feedback_vague",
      level: "block",
      message: `阶段反馈里出现「${feedbackHits.join("、")}」—— 这一栏必须写本章给读者的具体兑现或升级，不能是"继续铺垫"这类推迟。重填。`,
    });
  }

  const hookHits = hits(plan.hook, v.hookBlacklist);
  if (hookHits.length > 0) {
    findings.push({
      rule: "beat_hook_cliche",
      level: "block",
      message: `章末钩子里出现「${hookHits.join("、")}」—— 换成具体的动作、信息或抉择落点，不要用"更大的风暴"这类空钩。重填。`,
    });
  }

  const connectors = hits(plan.coreEvent, v.coreEventConnectors);
  if (connectors.length > v.coreEventConnectorLimit) {
    findings.push({
      rule: "beat_core_event_multi_step",
      level: "warn",
      message: `核心事件用了 ${connectors.length} 个连接词（${connectors.join("、")}）才说清 —— 这通常意味着本章装了两件事，考虑拆章。`,
      measured: connectors.length,
      threshold: v.coreEventConnectorLimit,
    });
  }

  // 事件章以上必须有事件。没有事件的"事件章"是排章时的低级错误，但模型会犯。
  if (plan.events.length === 0 && plan.chapterType !== "transition" && plan.chapterType !== "setup") {
    findings.push({
      rule: "beat_no_events",
      level: "block",
      message: `${plan.chapterType} 章没有计划任何事件 —— 要么补上事件，要么把章节类型改为过渡/布局。`,
    });
  }

  // 回收章/高潮章必须有收束安排，否则字数预算会按普通章派生，写到一半才发现不够。
  if ((plan.chapterType === "payoff" || plan.chapterType === "climax") && plan.resolves.length === 0) {
    findings.push({
      rule: "beat_payoff_without_resolution",
      level: "block",
      message: `${plan.chapterType} 章没有安排任何伏笔收束 —— 收束是这两类章的定义，补上或改章节类型。`,
    });
  }

  return findings;
}

// ── 跨章规则（§12.2 后三条 + §10.8）────────────────────────────────────

export interface VolumeValidationInput {
  /** 本卷的节拍表，按章号升序。 */
  readonly beats: readonly ChapterBeat[];
  /** 本卷开始前已连续多少章无阶段反馈。跨卷时从上卷末带过来。 */
  readonly priorNoFeedbackRun?: number;
  /** 本卷开始前已多少章无读者回报。 */
  readonly priorNoPayoffGap?: number;
  /**
   * 期望在本卷内收束的伏笔。§12.2 最后一条：expected_by 落在本卷但未安排 → warn。
   */
  readonly dueInVolume: readonly {
    readonly foreshadowId: ForeshadowId;
    readonly label: string;
    readonly expectedBy: ChapterNo;
  }[];
}

/**
 * 卷级节拍校验。
 *
 * 「阶段反馈」这一栏在这里的判定不是看有没有填（V1 一定会填），而是看
 * **有没有真兑现** —— 判据是该章有 ≥1 个事件或 ≥1 条收束。空口的阶段反馈
 * 已被 validatePlan 的黑名单挡掉，这里挡的是"填了具体话但节拍表里没有
 * 任何事发生"。
 */
export function validateVolume(input: VolumeValidationInput, rules: Rules): readonly GateFinding[] {
  const cc = rules.crossChapter;
  const findings: GateFinding[] = [];
  const beats = [...input.beats].sort((a, b) => a.chapter - b.chapter);

  let noFeedbackRun = input.priorNoFeedbackRun ?? 0;
  let noPayoffGap = input.priorNoPayoffGap ?? 0;

  for (const beat of beats) {
    const delivers = beat.plan.events.length > 0 || beat.plan.resolves.length > 0;
    noFeedbackRun = delivers ? 0 : noFeedbackRun + 1;
    if (noFeedbackRun >= cc.noStageFeedbackPlanBlock) {
      findings.push({
        rule: "beat_no_stage_feedback_run",
        level: "block",
        message: `到第 ${beat.chapter} 章已连续 ${noFeedbackRun} 章既无事件也无收束 —— 本章必须兑现或升级某条线，重排。`,
        measured: noFeedbackRun,
        threshold: cc.noStageFeedbackPlanBlock,
      });
      // 报一次就重置，否则后面每章都报同一件事，淹没其他 finding。
      noFeedbackRun = 0;
    }

    // 读者回报 = 有伏笔收束。事件推进不算 —— 推进是过程，回报是兑现。
    noPayoffGap = beat.plan.resolves.length > 0 ? 0 : noPayoffGap + 1;
    if (noPayoffGap >= cc.noPayoffWarn) {
      findings.push({
        rule: "beat_no_payoff_gap",
        level: "warn",
        message: `到第 ${beat.chapter} 章已 ${noPayoffGap} 章没有任何伏笔收束 —— 读者需要阶段性回报，考虑在本卷内安排一条支线收束。`,
        measured: noPayoffGap,
        threshold: cc.noPayoffWarn,
      });
      noPayoffGap = 0;
    }
  }

  // expected_by 落在本卷但节拍表没安排
  const firstChapter = beats[0]?.chapter ?? 0;
  const lastChapter = beats[beats.length - 1]?.chapter ?? 0;
  const scheduled = new Set(
    beats.flatMap((b) => b.plan.resolves.map((r) => r.foreshadowId as string)),
  );
  for (const due of input.dueInVolume) {
    if (due.expectedBy < firstChapter || due.expectedBy > lastChapter) continue;
    if (scheduled.has(due.foreshadowId as string)) continue;
    findings.push({
      rule: "beat_due_foreshadow_unscheduled",
      level: "warn",
      message: `伏笔「${due.label}」(${due.foreshadowId}) 计划在第 ${due.expectedBy} 章前收，但本卷节拍表没有安排 —— 排进某一章，或改期/废弃。`,
    });
  }

  return findings;
}

/** 有 block 就该回 V1 重排（§12.2）。 */
export function hasBlock(findings: readonly GateFinding[]): boolean {
  return findings.some((f) => f.level === "block");
}
