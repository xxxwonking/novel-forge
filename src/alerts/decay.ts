/**
 * 告警的 decay：**修复成本的增长速度**（§12.6.2、§12.6.4）。
 *
 * 这是首页排序的真正判据。首页告警的核心问题不是"多严重"，而是"再拖下去
 * 会不会更贵" —— 逾期 5 章的伏笔下一章顺手收掉，逾期 35 章的读者早忘了，
 * 想收好必须先重新提起；而"比喻偏多"拖一年也一样容易修。
 *
 * 三种曲线形状：
 *   ① 单调上升 —— 属性冲突（越晚改，连带修改的正文越多）
 *   ② 先升后降 —— 伏笔逾期、角色消失、情节线断线（拐点后转为建议废弃/确认退场）
 *   ③ 平坦     —— 比喻密度、感叹词、节奏偏软、锚点失效
 *
 * 全部系数来自 `rules.yaml` 的 `alerts.decay`。本模块只做算术。
 */

import type { AlertDecayRules } from "../rules/schema.js";

/**
 * ② 伏笔逾期。
 *
 * `overdue` 为负表示尚未到期 —— 这一段也要给分（临近截止值得提醒），
 * 但比逾期低。它随剩余章数减少而上升，到期时刚好接上 1.0。
 *
 * 拐点（`peakAt`）之后转下降，因为此时告警已迁移为「还打算收吗？还是废弃？」
 * （§12.6.2），催收的价值下降但不为零 —— 所以有 `floor` 兜底。
 */
export function decayForeshadowOverdue(overdue: number, rules: AlertDecayRules): number {
  const c = rules.foreshadowOverdue;

  if (overdue <= 0) {
    const remaining = -overdue;
    const nearness = 1 - Math.min(1, remaining / c.dueSoonWindow);
    return c.dueSoonFloor + nearness * c.dueSoonSpan;
  }

  const peak = 1 + c.peakAt / c.risePer;
  if (overdue <= c.peakAt) return 1 + overdue / c.risePer;
  return Math.max(c.floor, peak - (overdue - c.peakAt) / c.fallPer);
}

/**
 * ② 情节线断线。
 *
 * 横轴是 `gap / limit` 的**比值**而不是绝对章数 —— 主线断 3 章与细节线断
 * 20 章是等价的严重程度（阈值本身已按权重派生，§10.8）。用绝对章数会让
 * 细节线永远排在主线后面，那样权重就被计了两次（impact 里已经有了）。
 */
export function decayPlotlineGap(gap: number, limit: number, rules: AlertDecayRules): number {
  const c = rules.plotlineGap;
  if (limit <= 0) return c.base;
  const ratio = gap / limit;
  if (ratio <= 1) return c.base;
  return Math.min(c.cap, c.base + (ratio - 1) * c.slope);
}

/**
 * ② 角色消失。
 *
 * `lowGap` 以内是平的：一个角色隔十几章不出场在长篇里太常见，早早催回
 * 只会制造噪音。超过 `highGap` 后回落到 `afterExit` —— 此时告警已迁移为
 * 「这个角色是否已退场？」，那是个一次性确认动作，不需要反复顶在首页。
 */
export function decayCharacterMissing(gap: number, rules: AlertDecayRules): number {
  const c = rules.characterMissing;
  if (gap <= c.lowGap) return c.low;
  if (gap <= c.highGap) return c.low + (gap - c.lowGap) / c.risePer;
  return c.afterExit;
}

/**
 * ① 属性/设定冲突。单调上升，上限比其他类型高。
 *
 * `cap` 给到 4.0 是刻意的：这类告警是**后向修复**，会被 direction 打 0.4 折
 * （§12.6.4）。只有让它的 decay 能爬得足够高，"第 5 章说右手、第 30 章写左手"
 * 这种真正该修的问题才能在积累到一定程度后冒进首页
 * （4.0 × 3.0 × 0.4 = 4.8）。后向修复要被压制，但不能被完全埋掉。
 */
export function decayConflict(chaptersSince: number, rules: AlertDecayRules): number {
  const c = rules.settingConflict;
  return Math.min(c.cap, c.base + chaptersSince / c.per);
}

/**
 * ③ 平坦型。
 *
 * 用在节奏偏软、文风偏差（M4 产出）与锚点失效上。
 *
 * 锚点失效归这一类而非单调上升，理由是它的修复成本真的不随时间变化 ——
 * 锚点已经断了，重新定位一次的代价与拖了多久无关。它与属性冲突的区别在于
 * 后者会让**后续正文继续按错误的设定写下去**，那才是随时间累积的成本。
 */
export function decayFlat(rules: AlertDecayRules): number {
  return rules.flat;
}
