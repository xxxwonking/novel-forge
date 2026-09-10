/**
 * 首页告警的候选计算（§12.6）。
 *
 * **与 gate/cross-chapter.ts 是两套东西**（§12.6.1 明写）：那里是 C6 闸门的
 * 一部分，对象是"当前这一章交稿前该清的债"，级别以 block 为主；这里的对象是
 * 累积的结构债，几乎全是 warn —— 所以级别这一维在首页不产生区分度，
 * `级别权重 × …` 的思路在这里失效。两边共用投影这个数据源，不共用排序逻辑，
 * 也刻意不互相 import（合并会把 block 语义带进首页）。
 *
 * score = impact × decay × direction × fatigue（§12.6.4）
 *
 * 本模块是 `Derived<T>` 品牌的第三个构造点（另两处是 beat/derive.ts 与
 * store/project.ts 的投影器）—— impact / decay / score 都是纯代码派生，
 * 模型和用户都不能填。
 */

import type {
  Alert,
  AlertCategory,
  AlertState,
  AlertSubject,
  CharacterArc,
  ForeshadowTimelineItem,
  PlotLineTrack,
  RepairDirection,
} from "../types/projections.js";
import type { AlertAction } from "../types/projections.js";
import type { AlertId, ChapterNo, Derived, IsoTimestamp } from "../types/primitives.js";
import type { AlertRules, Rules } from "../rules/schema.js";
import {
  decayCharacterMissing,
  decayForeshadowOverdue,
  decayPlotlineGap,
} from "./decay.js";

function derived<T>(value: T): Derived<T> {
  return value as Derived<T>;
}

export interface AlertComputeInput {
  readonly currentChapter: ChapterNo;
  /** 下一章的章号。一键动作的 targetChapter —— 前向修复全落在这里。 */
  readonly nextChapter: ChapterNo;
  readonly foreshadows: readonly ForeshadowTimelineItem[];
  readonly plotLines: readonly PlotLineTrack[];
  readonly arcs: readonly CharacterArc[];
  /** 用户侧状态，按 AlertId 索引。缺省视为从未忽略、未确认。 */
  readonly states: ReadonlyMap<AlertId, AlertState>;
  readonly now: IsoTimestamp;
}

/** 一条候选告警：Alert 本体 + 计算过程里得出的状态更新。 */
export interface AlertCandidate {
  readonly alert: Alert;
  /** 本轮该写回的状态。fatigue 重置与迁移记录都在这里。 */
  readonly nextState: AlertState;
}

export function computeAlerts(input: AlertComputeInput, rules: Rules): readonly AlertCandidate[] {
  const a = rules.alerts;
  const raw = [
    ...foreshadowAlerts(input, rules),
    ...plotLineAlerts(input, rules),
    ...characterAlerts(input, rules),
  ];

  return raw
    .map((r) => finalize(r, input, a))
    .filter((c) => c.alert.score >= a.minScore)
    .sort((x, y) => y.alert.score - x.alert.score || x.alert.id.localeCompare(y.alert.id));
}

// ── 各类别的候选构造 ────────────────────────────────────────────────────

/** finalize 之前的中间形态：score 三要素齐了，但 fatigue 还没乘。 */
interface Draft {
  readonly id: AlertId;
  readonly category: AlertCategory;
  readonly direction: RepairDirection;
  readonly impact: number;
  readonly decay: number;
  readonly title: string;
  readonly detail: string;
  readonly subject: AlertSubject;
  readonly migratedTo: Alert["migratedTo"];
  readonly actions: readonly AlertAction[];
}

function foreshadowAlerts(input: AlertComputeInput, rules: Rules): readonly Draft[] {
  const a = rules.alerts;
  const out: Draft[] = [];

  for (const f of input.foreshadows) {
    // planned 是作者规划、尚未埋设，没有"逾期"可言（§12.1 P4）。
    // resolved/abandoned 已经了结。
    if (f.status !== "open") continue;

    const overdue = input.currentChapter - f.expectedBy;
    const sincePlanted = input.currentChapter - f.plantedAt;
    const impact = a.impact[f.weight];

    // 逾期（含临近到期）。§12.6.2：拐点后类别迁移为「建议废弃」。
    const migrated = overdue > a.migration.foreshadowAbandonAfter;
    const category: AlertCategory = "foreshadow_overdue";
    const jump: AlertAction = { kind: "jump_to_anchor", anchor: f.plantedAnchor };

    if (overdue > 0 || -overdue <= rules.crossChapter.foreshadowDueSoon) {
      out.push({
        id: alertId(category, f.id),
        category,
        // 回收动作发生在**未来**，不在过去 —— 所以伏笔逾期虽然指向老章节
        // （ch5 埋的）却是高度可执行的前向修复（§12.6.3 末段）。
        direction: "forward",
        impact,
        decay: decayForeshadowOverdue(overdue, a.decay),
        title: migrated
          ? `「${f.label}」逾期 ${overdue} 章 —— 还打算收吗？`
          : overdue > 0
            ? `「${f.label}」逾期 ${overdue} 章（${weightLabel(f.weight)}）`
            : `「${f.label}」还有 ${-overdue} 章到期（${weightLabel(f.weight)}）`,
        detail: migrated
          ? `第 ${f.plantedAt} 章埋下，计划第 ${f.expectedBy} 章前收，现在第 ${input.currentChapter} 章。读者到这时已经忘了 —— 要收得先重新提起，或者废弃它。`
          : `第 ${f.plantedAt} 章埋下：${f.intent}　计划第 ${f.expectedBy} 章前收。`,
        subject: { kind: "foreshadow", id: f.id },
        migratedTo: migrated ? "suggest_abandon" : null,
        actions: migrated
          ? [
              { kind: "abandon", foreshadowId: f.id },
              resolveAction(input.nextChapter, f),
              { kind: "acknowledge" },
              jump,
            ]
          : [
              resolveAction(input.nextChapter, f),
              { kind: "reschedule", foreshadowId: f.id, expectedBy: f.expectedBy },
              { kind: "abandon", foreshadowId: f.id },
              jump,
            ],
      });
      continue;
    }

    // 未逾期但埋了很久没动静。与逾期分开的理由（同 gate/cross-chapter.ts）：
    // 逾期看的是承诺，这条看的是读者记忆 —— expectedBy 排得很远的伏笔
    // 也会被读者忘掉。两条同时命中时只报逾期那条，所以这里在 continue 之后。
    if (sincePlanted > rules.crossChapter.foreshadowStale) {
      const stale: AlertCategory = "foreshadow_stale";
      out.push({
        id: alertId(stale, f.id),
        category: stale,
        direction: "forward",
        impact,
        decay: decayForeshadowOverdue(sincePlanted - rules.crossChapter.foreshadowStale, a.decay),
        title: `「${f.label}」埋下已 ${sincePlanted} 章无动静`,
        detail: `第 ${f.plantedAt} 章埋下：${f.intent}　期限还在第 ${f.expectedBy} 章，但这么久没提读者已经忘了 —— 提前呼应一次，或者废弃。`,
        subject: { kind: "foreshadow", id: f.id },
        migratedTo: null,
        actions: [
          resolveAction(input.nextChapter, f),
          { kind: "abandon", foreshadowId: f.id },
          { kind: "acknowledge" },
          jump,
        ],
      });
    }
  }

  return out;
}

function resolveAction(target: ChapterNo, f: ForeshadowTimelineItem): AlertAction {
  return {
    kind: "add_resolution_to_beat",
    targetChapter: target,
    foreshadowId: f.id,
    weight: f.weight,
    // 一键动作默认排完全收束 —— 部分收束是个创作决定，不该由按钮替用户做。
    completeness: "full",
  };
}

function plotLineAlerts(input: AlertComputeInput, rules: Rules): readonly Draft[] {
  const a = rules.alerts;
  const out: Draft[] = [];

  for (const line of input.plotLines) {
    // 从未推进过的线：报"断线"是误导，它还没开始（同 gate/cross-chapter.ts）。
    if (line.lastAdvancedAt === 0) continue;

    const gap = input.currentChapter - line.lastAdvancedAt;
    const limit = line.gapLimit as number;
    if (gap <= limit) continue;

    const category: AlertCategory = "plotline_gap";
    out.push({
      id: alertId(category, line.id),
      category,
      direction: "forward",
      impact: a.impact[line.weight],
      decay: decayPlotlineGap(gap, limit, a.decay),
      title: `${line.label}断了 ${gap} 章未推进（${weightLabel(line.weight)}，上限 ${limit}）`,
      detail: `上次推进在第 ${line.lastAdvancedAt} 章，共 ${line.points.length} 个节点。安排一次推进，或确认这条线已收束。`,
      subject: { kind: "plotline", id: line.id },
      migratedTo: null,
      actions: [
        { kind: "add_advance_to_beat", targetChapter: input.nextChapter, plotLine: line.id },
        { kind: "open_view", view: "plotline" },
        { kind: "acknowledge" },
      ],
    });
  }

  return out;
}

function characterAlerts(input: AlertComputeInput, rules: Rules): readonly Draft[] {
  const a = rules.alerts;
  const out: Draft[] = [];

  for (const arc of input.arcs) {
    // 从未出场过的角色（筹备期建的卡）不报。
    if (arc.presence.length === 0) continue;

    const gap = input.currentChapter - arc.lastSeenAt;
    if (gap <= rules.crossChapter.characterAbsent[arc.tier]) continue;

    const migrated = gap > a.migration.characterExitAfter;
    const category: AlertCategory = "character_missing";
    const last = arc.presence[arc.presence.length - 1];

    out.push({
      id: alertId(category, arc.characterId),
      category,
      direction: "forward",
      impact: a.characterImpact[arc.tier],
      decay: decayCharacterMissing(gap, a.decay),
      title: migrated
        ? `${arc.name}消失 ${gap} 章 —— 这个角色已经退场了吗？`
        : `${arc.name}消失 ${gap} 章未出场`,
      detail: migrated
        ? `第 ${arc.introducedAt} 章登场，末次出场第 ${arc.lastSeenAt} 章，共出场 ${arc.presence.length} 章。确认退场后不再提醒。`
        : `第 ${arc.introducedAt} 章登场，末次出场第 ${arc.lastSeenAt} 章（${roleLabel(last?.role)}），共出场 ${arc.presence.length} 章。`,
      subject: { kind: "character", id: arc.characterId },
      migratedTo: migrated ? "confirm_exit" : null,
      actions: migrated
        ? [
            { kind: "confirm_exit", characterId: arc.characterId },
            { kind: "add_character_to_beat", targetChapter: input.nextChapter, characterId: arc.characterId },
            { kind: "acknowledge" },
          ]
        : [
            { kind: "add_character_to_beat", targetChapter: input.nextChapter, characterId: arc.characterId },
            { kind: "open_view", view: "arc" },
            { kind: "acknowledge" },
          ],
    });
  }

  return out;
}

// ── fatigue 与状态流转 ──────────────────────────────────────────────────

/**
 * 乘上 fatigue、定出最终 score，并算出该写回的状态。
 *
 * 两条流转规则：
 * 1. **decay 显著上升 ⇒ 重置 fatigue 重新入池**（§12.6.4 末条）。用户第一次
 *    忽略"感情线断了 12 章"，等它断到 25 章时问题的性质已经变了，应该重新
 *    提醒。判据是与 `lastDecay` 的差值 —— 所以 AlertState 必须存旧的 decay。
 * 2. **类别迁移也重置 fatigue**（§12.6.8）。"催收"和"建议废弃"是两个不同的
 *    问题，用户忽略了前者不代表不想回答后者。
 */
function finalize(draft: Draft, input: AlertComputeInput, a: AlertRules): AlertCandidate {
  const prev = input.states.get(draft.id);
  const migrationChanged = (prev?.migratedTo ?? null) !== draft.migratedTo;
  // lastDecay 为 null 表示这条状态是用户点忽略/静音时刚建的，还没经过评估。
  // 此时不能判"上升" —— 否则第一次忽略会被下一次计算立刻抹掉。
  const decayJumped =
    prev?.lastDecay != null && draft.decay - prev.lastDecay >= a.decayResetDelta;

  const fatigueCount = prev === undefined || migrationChanged || decayJumped ? 0 : prev.fatigueCount;
  // 忽略次数超出系数表长度时取末位（表已到最低档，再忽略不会更低）。
  const fatigue = a.fatigue[Math.min(fatigueCount, a.fatigue.length - 1)] ?? 1;
  const direction = a.direction[draft.direction];
  const score = draft.impact * draft.decay * direction * fatigue;

  const createdAt = prev?.createdAt ?? input.now;

  return {
    alert: {
      id: draft.id,
      category: draft.category,
      direction: draft.direction,
      impact: derived(draft.impact),
      decay: derived(draft.decay),
      score: derived(score),
      title: draft.title,
      detail: draft.detail,
      subject: draft.subject,
      fatigueCount,
      acknowledged: prev?.acknowledged ?? false,
      migratedTo: draft.migratedTo,
      actions: draft.actions,
      createdAt,
      lastEvaluatedAt: input.now,
    },
    nextState: {
      id: draft.id,
      fatigueCount,
      acknowledged: prev?.acknowledged ?? false,
      createdAt,
      lastDecay: draft.decay,
      migratedTo: draft.migratedTo,
    },
  };
}

// ── 小工具 ──────────────────────────────────────────────────────────────

/** §primitives：`<类别>:<对象 ID>`。同一问题永远同一 ID，重跑诊断天生幂等。 */
function alertId(category: AlertCategory, objectId: string): AlertId {
  return `${category}:${objectId}`;
}

function weightLabel(w: "main" | "sub" | "detail"): string {
  return w === "main" ? "主线" : w === "sub" ? "支线" : "细节";
}

function roleLabel(role: CharacterArc["presence"][number]["role"] | undefined): string {
  switch (role) {
    case "pov":
      return "视角人物";
    case "major":
      return "主要参与";
    case "minor":
      return "次要参与";
    case "mentioned":
      return "仅被提及";
    default:
      return "未知";
  }
}
