/**
 * C6 的跨章检测（§10.8）。纯代码，读四视图投影。
 *
 * 与 code-channel.ts 分开的理由：章内检测只需要正文，跨章检测需要投影 ——
 * 前者在 C4 每场写完就能跑（§12.3 的即时轻检测），后者只能在 C8 之后跑。
 * 混在一起会让轻检测被迫依赖投影。
 *
 * 断线阈值全部按权重/档位派生（§10.8）：主线断 3 章就该报警，细节线断 20 章
 * 无所谓。固定一个数会淹没在噪音里。
 */

import type { GateFinding } from "../types/beat.js";
import type {
  CharacterArc,
  ForeshadowTimelineItem,
  PlotLineTrack,
} from "../types/projections.js";
import type { ChapterNo } from "../types/primitives.js";
import type { Rules } from "../rules/schema.js";

export interface CrossChapterInput {
  readonly currentChapter: ChapterNo;
  readonly foreshadows: readonly ForeshadowTimelineItem[];
  readonly plotLines: readonly PlotLineTrack[];
  readonly arcs: readonly CharacterArc[];
}

/**
 * 全部跨章规则。
 *
 * 这些 finding 与首页告警（§12.6）是**两套东西**：这里是 C6 闸门的一部分，
 * 对象是"交稿前该知道的结构债"，级别全是 warn；首页告警要按修复成本增长率
 * 排序并做类别迁移，那是 M3 的事。共用一个数据源但不共用排序逻辑。
 */
export function gateCrossChapter(input: CrossChapterInput, rules: Rules): readonly GateFinding[] {
  return [
    ...checkForeshadows(input, rules),
    ...checkPlotLines(input),
    ...checkCharacterAbsence(input, rules),
  ];
}

// ── 伏笔（§10.8 第 4、5 条）─────────────────────────────────────────────

function checkForeshadows(input: CrossChapterInput, rules: Rules): readonly GateFinding[] {
  const cc = rules.crossChapter;
  const findings: GateFinding[] = [];

  for (const f of input.foreshadows) {
    // planned 态是作者规划、尚未埋设，没有"逾期"可言（§12.1 P4）。
    if (f.status !== "open") continue;

    const overdue = input.currentChapter - f.expectedBy;
    const sinceP = input.currentChapter - f.plantedAt;

    if (overdue > 0) {
      findings.push({
        rule: "foreshadow_overdue",
        level: "warn",
        message: `伏笔「${f.label}」(${f.id}·${weightLabel(f.weight)}) 已逾期 ${overdue} 章（计划第 ${f.expectedBy} 章前收）—— 安排进下一章，或改期/废弃。`,
        measured: overdue,
        threshold: 0,
      });
    } else if (-overdue <= cc.foreshadowDueSoon) {
      findings.push({
        rule: "foreshadow_due_soon",
        level: "info",
        message: `伏笔「${f.label}」(${f.id}) 还有 ${-overdue} 章到期（第 ${f.expectedBy} 章）—— 该排进节拍表了。`,
        measured: -overdue,
        threshold: cc.foreshadowDueSoon,
      });
    }

    // 与逾期分开的一条：埋了很久一直没动静。逾期看的是承诺，这条看的是
    // 读者记忆 —— 一条 expectedBy 排在很远的伏笔也会被读者忘掉。
    if (sinceP > cc.foreshadowStale && overdue <= 0) {
      findings.push({
        rule: "foreshadow_stale",
        level: "warn",
        message: `伏笔「${f.label}」(${f.id}) 埋下已 ${sinceP} 章无任何动静 —— 还打算收吗？读者到这时已经忘了，要收得先重新提起。`,
        measured: sinceP,
        threshold: cc.foreshadowStale,
      });
    }
  }

  return findings;
}

function weightLabel(w: "main" | "sub" | "detail"): string {
  return w === "main" ? "主线" : w === "sub" ? "支线" : "细节";
}

// ── 情节线（§10.8 第 3 条）──────────────────────────────────────────────

/**
 * 情节线断线。阈值取投影已算好的 `gapLimit`（§10.8 的 plotLineGap）——
 * 投影的入参就是同一份 rules，这里再算一次等于开一条两处可能分歧的路。
 */
function checkPlotLines(input: CrossChapterInput): readonly GateFinding[] {
  const findings: GateFinding[] = [];

  for (const line of input.plotLines) {
    // 从未推进过的线：lastAdvancedAt 为 0，此时 currentGap 等于当前章号，
    // 报"断线"是误导 —— 它还没开始。
    if (line.lastAdvancedAt === 0) continue;

    const limit = line.gapLimit;
    const gap = input.currentChapter - line.lastAdvancedAt;
    if (gap <= limit) continue;

    findings.push({
      rule: "plotline_gap",
      level: "warn",
      message: `情节线「${line.label}」(${line.id}·${weightLabel(line.weight)}) 已 ${gap} 章没有推进（上次第 ${line.lastAdvancedAt} 章，阈值 ${limit}）—— 安排一次推进，或确认这条线已收束。`,
      measured: gap,
      threshold: limit,
    });
  }

  return findings;
}

// ── 角色消失（§10.8 第 6 条）────────────────────────────────────────────

/**
 * 角色 presence 断裂。阈值按档位派生 —— 主角消失 2 章就该问，龙套消失
 * 三十章是正常的。
 *
 * 死亡与失踪的角色不报：他们的"消失"是剧情。这需要人物卡的 state，
 * 而 CharacterArc 没有该字段，所以由调用方通过 `excluded` 传入。
 */
function checkCharacterAbsence(input: CrossChapterInput, rules: Rules): readonly GateFinding[] {
  const findings: GateFinding[] = [];

  for (const arc of input.arcs) {
    const limit = rules.crossChapter.characterAbsent[arc.tier];
    const gap = input.currentChapter - arc.lastSeenAt;
    if (gap <= limit) continue;

    findings.push({
      rule: "character_missing",
      level: "warn",
      message: `${arc.name}(${arc.characterId}·${arc.tier}) 已 ${gap} 章未出场（上次第 ${arc.lastSeenAt} 章，阈值 ${limit}）—— 安排出场，或确认已退场。`,
      measured: gap,
      threshold: limit,
    });
  }

  return findings;
}

/**
 * 连续 N 章无阶段反馈（§10.8 第 1 条）。
 *
 * 与 validate.ts 的卷级同名检查的区别：那条看**节拍表**（规划期，阈值 3），
 * 这条看**已写完的章**（交稿期，阈值 2，更严）。写完的章没兑现是既成事实，
 * 比规划里少排一章严重。
 */
export function checkStageFeedbackRun(
  deliveredByChapter: readonly { readonly chapter: ChapterNo; readonly delivered: boolean }[],
  rules: Rules,
): readonly GateFinding[] {
  const limit = rules.crossChapter.noStageFeedbackBlock;
  const sorted = [...deliveredByChapter].sort((a, b) => a.chapter - b.chapter);

  let run = 0;
  for (const c of sorted) {
    run = c.delivered ? 0 : run + 1;
  }
  if (run < limit) return [];

  const last = sorted[sorted.length - 1];
  return [
    {
      rule: "no_stage_feedback_run",
      level: "block",
      message: `到第 ${last?.chapter ?? 0} 章已连续 ${run} 章没有任何兑现 —— 本章必须兑现或升级某条线，不允许再推迟。`,
      measured: run,
      threshold: limit,
    },
  ];
}
