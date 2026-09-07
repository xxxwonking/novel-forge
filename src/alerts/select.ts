/**
 * 首页三条的选择：可执行性 gate + MMR 式多样性（§12.6.5、§12.6.6）。
 *
 * 与 compute.ts 分开的理由：compute 是**纯投影**（同样的事件流必然得出同样的
 * 候选），而这里依赖"下一章节拍表现在长什么样"这个会随用户操作瞬间变化的输入。
 * 混在一起会让候选计算被迫在用户每次点按钮后整体重跑。
 *
 * §12.6.6 的第一条 gate 是全节最关键的一条：**用户在节拍表里安排了回收，
 * 告警必须立刻消失。** 不能等写完那一章才消 —— 否则用户的感受是
 * "我已经处理了它还在催"，而这正是让人关掉整套诊断的那类体验。
 */

import type { Alert, AlertCategory } from "../types/projections.js";
import type { ChapterPlan } from "../types/beat.js";
import type { AlertRules } from "../rules/schema.js";
import type { AlertCandidate } from "./compute.js";

export interface SelectInput {
  readonly candidates: readonly AlertCandidate[];
  /** 下一章的节拍表。null 表示还没排 —— 此时没有任何告警能被"已安排"消掉。 */
  readonly nextPlan: ChapterPlan | null;
}

/**
 * 三个分组，对应 §12.6.8 的生命周期图。
 *
 * `homepage` ⊂ `fullList`：首页是完整列表的一个截取，不是另一份数据。
 * 这样"另有 14 条提示"的计数不会与首页三条打架。
 */
export interface AlertSelection {
  /** 首页固定 N 条（§12.6.8：即使有 8 条也只显示 3 条）。 */
  readonly homepage: readonly Alert[];
  /** 完整列表：过了 gate 但没进首页的，加上首页那几条。 */
  readonly fullList: readonly Alert[];
  /** 待返修：后向修复且影响面不足的，用户主动进检修模式时批量处理。 */
  readonly repairQueue: readonly Alert[];
  /** 被 gate 挡掉的（已安排、已确认、疲劳退池），供调试与"为什么它不见了"。 */
  readonly suppressed: readonly { readonly alert: Alert; readonly reason: SuppressReason }[];
}

export type SuppressReason =
  /** 已在下一章节拍表里安排。§12.6.6 第一条。 */
  | "scheduled"
  /** 用户标了「有意为之」，永久静音。 */
  | "acknowledged"
  /** 忽略次数达上限，退出首页候选但仍在完整列表。 */
  | "fatigued";

export function selectAlerts(input: SelectInput, rules: AlertRules): AlertSelection {
  const homepage: Alert[] = [];
  const fullList: Alert[] = [];
  const repairQueue: Alert[] = [];
  const suppressed: { alert: Alert; reason: SuppressReason }[] = [];

  // 第一遍：gate。分流出待返修、静音与已安排。
  const pool: Alert[] = [];
  for (const { alert } of input.candidates) {
    if (alert.acknowledged) {
      suppressed.push({ alert, reason: "acknowledged" });
      continue;
    }
    if (isScheduled(alert, input.nextPlan)) {
      suppressed.push({ alert, reason: "scheduled" });
      continue;
    }
    // §12.6.3：后向修复进独立的「待返修」清单，用户主动检修时批量处理。
    // 理由很实际："第 5 章设定和第 30 章矛盾"放首页第一条，用户看到只会焦虑
    // —— 处理它要中断写作、回读两章、判断改哪边。
    if (alert.direction === "backward" && (alert.impact as number) < rules.backwardMinImpact) {
      repairQueue.push(alert);
      continue;
    }
    fullList.push(alert);
    if (alert.fatigueCount >= rules.fatigueDropAt) {
      suppressed.push({ alert, reason: "fatigued" });
      continue;
    }
    pool.push(alert);
  }

  // 第二遍：MMR 贪心，同类递减惩罚。
  const catCount = new Map<AlertCategory, number>();
  while (homepage.length < rules.homepageLimit && pool.length > 0) {
    let bestIdx = -1;
    let bestAdj = -Infinity;
    for (let i = 0; i < pool.length; i += 1) {
      const a = pool[i];
      if (a === undefined) continue;
      const seen = catCount.get(a.category) ?? 0;
      const adj = (a.score as number) * Math.pow(rules.diversityPenalty, seen);
      // 平手时取 id 小的，保证同一份数据每次选出同一批（截图与测试可复现）。
      if (adj > bestAdj || (adj === bestAdj && bestIdx >= 0 && a.id < (pool[bestIdx]?.id ?? ""))) {
        bestAdj = adj;
        bestIdx = i;
      }
    }
    if (bestIdx < 0) break;
    const picked = pool.splice(bestIdx, 1)[0];
    if (picked === undefined) break;
    homepage.push(picked);
    catCount.set(picked.category, (catCount.get(picked.category) ?? 0) + 1);
  }

  return { homepage, fullList, repairQueue, suppressed };
}

/**
 * 这条告警对应的处理**是否已经排进下一章的节拍表**。
 *
 * 三种主体各自的判据都在节拍表里有直接对应物 —— 这不是巧合，而是
 * §12.6.7 的设计要求：告警的一键动作就是往这三个字段里写东西，所以
 * "已安排"必然等价于"那个字段里已经有它"。
 */
function isScheduled(alert: Alert, plan: ChapterPlan | null): boolean {
  if (plan === null) return false;
  const s = alert.subject;
  switch (s.kind) {
    case "foreshadow":
      return plan.resolves.some((r) => r.foreshadowId === s.id);
    case "plotline":
      return plan.events.some((e) => e.plotLine === s.id);
    case "character":
      return plan.characters.includes(s.id);
    default:
      return false;
  }
}
