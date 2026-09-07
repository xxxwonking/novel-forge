/**
 * 一键动作的闭环（§12.6.7）。
 *
 * **这一节比公式重要**（§12.6.7 原文）。告警若只是通知，用户看完还得自己记着
 * "下一章要收母亲的信"，规划时会忘。告警的价值不在提醒，在于能直接写进
 * 下一章的节拍表。
 *
 * 闭环：点按钮 → 改节拍表 → 触发 V3 重算该章预算（收一条主线伏笔 +600~900 字）
 * → 下次 selectAlerts 时该条被 isScheduled 挡掉 → 告警消失。**一次点击。**
 *
 * 本模块只做"改节拍表 + 重算预算"和"改告警状态"两件事，不碰事件流 ——
 * 废弃伏笔、确认退场要往事件流里追加事件，那是调用方（server 层）的事，
 * 因为它需要 EventStream 实例而这里是纯函数。
 */

import type { AlertAction, AlertState } from "../types/projections.js";
import type { ChapterBeat, ChapterPlan, WorkProfile } from "../types/beat.js";
import type { IsoTimestamp } from "../types/primitives.js";
import type { Rules } from "../rules/schema.js";
import { deriveBudget } from "../beat/derive.js";

export interface ApplyToBeatInput {
  readonly beat: ChapterBeat;
  readonly action: AlertAction;
  readonly profile: WorkProfile;
  readonly now: IsoTimestamp;
}

export interface ApplyToBeatResult {
  readonly beat: ChapterBeat;
  /** false 表示该动作对节拍表无影响（如 acknowledge / open_view），原对象返回。 */
  readonly changed: boolean;
}

/**
 * 把一个动作应用到节拍表上。
 *
 * 幂等：同一个动作重复应用不会产生重复条目（`changed` 返回 false）。
 * 这不是洁癖 —— 前端的按钮会被连点，而重复的 resolves 会让 V3 把同一条
 * 伏笔的收束成本算两次，预算凭空多出 600-900 字。
 */
export function applyActionToBeat(input: ApplyToBeatInput, rules: Rules): ApplyToBeatResult {
  const { beat, action } = input;
  const plan = beat.plan;

  const nextPlan = planAfter(plan, action);
  if (nextPlan === null) return { beat, changed: false };

  return {
    beat: {
      ...beat,
      plan: nextPlan,
      // 一键动作改的是节拍表，所以派生预算必须跟着重算 —— 这是闭环的
      // 第二步（§12.6.7），漏掉它会让用户按了按钮却拿到旧字数目标。
      budget: deriveBudget(nextPlan, input.profile, rules, { now: input.now }),
      // 用户点按钮产生的改动是 authored —— 它不是模型提议，不需要再裁决一次。
      provenance: "authored",
      updatedAt: input.now,
    },
    changed: true,
  };
}

/** 返回新 plan；动作与节拍表无关或已生效则返回 null。 */
function planAfter(plan: ChapterPlan, action: AlertAction): ChapterPlan | null {
  switch (action.kind) {
    case "add_resolution_to_beat": {
      if (plan.resolves.some((r) => r.foreshadowId === action.foreshadowId)) return null;
      return {
        ...plan,
        resolves: [
          ...plan.resolves,
          {
            foreshadowId: action.foreshadowId,
            weight: action.weight,
            completeness: action.completeness,
          },
        ],
      };
    }

    case "add_advance_to_beat": {
      if (plan.events.some((e) => e.plotLine === action.plotLine)) return null;
      return {
        ...plan,
        events: [
          ...plan.events,
          {
            kind: "action",
            // 占位文案。V2 的黑名单校验作用在 stageFeedback / hook / coreEvent 上，
            // 不查 event.summary，所以这里的占位不会被打回 —— 但用户必须改，
            // 因为 C4 会照着它写。文案本身说清了这件事。
            summary: `【待填】推进「${action.plotLine}」：这条线断得太久了，本章要有实际进展`,
            // 权重取最低档：一键动作不该替用户决定这次推进有多重 ——
            // 权重直接进字数预算与密度，猜高了会让模型被迫注水。
            weight: 1,
            plotLine: action.plotLine,
          },
        ],
      };
    }

    case "add_character_to_beat": {
      if (plan.characters.includes(action.characterId)) return null;
      return { ...plan, characters: [...plan.characters, action.characterId] };
    }

    // 改期/废弃/确认退场都要往事件流追加事件（foreshadow_rescheduled /
    // foreshadow_abandoned），不改节拍表。acknowledge 只改告警状态。
    default:
      return null;
  }
}

// ── 告警状态的三个用户动作 ──────────────────────────────────────────────

/**
 * 忽略一条告警：fatigue+1，退池。
 *
 * 注意这里**不封顶**：`fatigueCount` 可以超过 `fatigueDropAt`，compute.ts 取
 * 系数时会钳到表末位。保留真实次数是有用的 —— 它是 §12.6.9 校准方法 ①
 * （某类告警的动作按钮长期无人点）的原始数据。
 */
export function ignoreAlert(state: AlertState): AlertState {
  return { ...state, fatigueCount: state.fatigueCount + 1 };
}

/**
 * 标「有意为之」：永久静音。
 *
 * §12.6.8：这个出口必须有 —— 用户就是故意让配角消失 26 章的（后面有安排），
 * 系统得记住"别再提"。没有它，用户只能关掉整套诊断。
 */
export function acknowledgeAlert(state: AlertState): AlertState {
  return { ...state, acknowledged: true };
}

/** 撤销静音。用户改主意了（"其实那个配角我确实忘了"）。 */
export function unacknowledgeAlert(state: AlertState): AlertState {
  return { ...state, acknowledged: false, fatigueCount: 0 };
}

/** 新建一条状态记录。首次忽略/静音某条告警时用。 */
export function initialAlertState(id: AlertState["id"], now: IsoTimestamp): AlertState {
  return { id, fatigueCount: 0, acknowledged: false, createdAt: now, lastDecay: 0, migratedTo: null };
}
