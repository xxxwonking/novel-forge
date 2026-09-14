/**
 * 段 4：易变区（§13.6）。不缓存，但顺序影响注意力 —— 从远到近排，
 * 任务指令放最后，紧贴生成位置。
 *
 * 伏笔按三档注入（§6.5）：
 *   ▸ 该收的 → intent 全文 + "本章要收这条"
 *   ▸ 暗线   → 仅一句"不要在此章直接提及"
 *   ▸ 其余   → 不带
 * 不分档全带上，模型会试图在这一章收掉好几条，写出来急躁生硬。
 */

import type { ChapterBeat, ChapterBudget, ChapterType } from "../types/beat.js";
import type { ForeshadowId } from "../types/primitives.js";

const TYPE_LABEL: Readonly<Record<ChapterType, string>> = {
  transition: "过渡章",
  setup: "布局章",
  event: "事件章",
  payoff: "回收章",
  climax: "高潮章",
};

/** 上一章正文的处理形态（§13.6）。结尾必须是全文，因为要接得上。 */
export interface PreviousChapter {
  readonly chapter: number;
  /** 前半摘要，仅当上一章过长时非空。 */
  readonly headSummary: string | null;
  /** 后半全文。同一场戏跨章时不摘要，整章都在这里。 */
  readonly tailText: string;
}

/** 该收的伏笔 —— 带 intent 全文。 */
export interface ResolveInstruction {
  readonly id: ForeshadowId;
  readonly label: string;
  readonly intent: string;
  readonly weight: "main" | "sub" | "detail";
  readonly completeness: "full" | "partial";
}

/** 暗线伏笔 —— 只给一句避免提及。 */
export interface AvoidInstruction {
  readonly id: ForeshadowId;
  readonly label: string;
}

export interface VolatileInput {
  readonly previous: PreviousChapter | null;
  readonly beat: ChapterBeat;
  readonly resolves: readonly ResolveInstruction[];
  readonly avoid: readonly AvoidInstruction[];
  /** 仅本章要埋设的作者规划，不是已发生事实或本章要兑现的承诺。 */
  readonly plannedForeshadows?: readonly { readonly id: ForeshadowId; readonly label: string; readonly intent: string; readonly weight: "main" | "sub" | "detail"; readonly expectedBy: number }[];
  readonly fulfilledResolutions?: readonly { readonly id: ForeshadowId; readonly label: string; readonly chapter: number }[];
  readonly fulfilledPlants?: readonly { readonly id: ForeshadowId; readonly label: string; readonly chapter: number }[];
  /** 本章的任务指令。C3/C4/C5 各不相同，由调用方给出。 */
  readonly task: string;
}

const WEIGHT_LABEL = { main: "主线", sub: "支线", detail: "细节" } as const;

function renderBudget(b: ChapterBudget): string {
  const lines = [
    `字数区间：${b.words.min}-${b.words.max}（目标 ${b.words.sweet}）`,
    `加权事件密度：${b.density.min}-${b.density.max}`,
  ];
  // 阈值按 key 排序输出 —— Object.entries 的顺序虽然对字符串键是插入序，
  // 但依赖它等于把渲染稳定性押在上游构造顺序上（§13.7）。
  const keys = Object.keys(b.thresholds).sort();
  for (const k of keys) {
    lines.push(`${k}上限：${b.thresholds[k] ?? 0}`);
  }
  if (b.splitAdvice !== null) lines.push(`⚠ ${b.splitAdvice.note}`);
  return lines.join("\n");
}

function renderPlan(beat: ChapterBeat): string {
  const p = beat.plan;
  const lines = [
    `第 ${beat.chapter} 章｜${TYPE_LABEL[p.chapterType]}`,
    `核心事件：${p.coreEvent}`,
  ];
  if (p.secondaryThread !== null) lines.push(`次级推进：${p.secondaryThread}`);
  lines.push(`本章必须兑现：${p.stageFeedback}`);
  lines.push(`章末落点：${p.hook}`);
  if (p.events.length > 0) {
    lines.push("计划事件：");
    for (const e of p.events) lines.push(`  - [权重${e.weight}] ${e.summary}`);
  }
  if (p.plants.length > 0) {
    const plants = p.plants.map((x) => `${x.label}（${WEIGHT_LABEL[x.weight]}）`);
    lines.push(`本章要埋：${plants.join("、")}`);
  }
  return lines.join("\n");
}

/**
 * 渲染段 4。**顺序固定：上一章全文 → 节拍 → 要收伏笔 → 暗线 → 预算 → 任务。**
 * 任务指令必须最后，它离生成位置最近，注意力权重最高。
 */
export function renderVolatile(input: VolatileInput): string {
  const lines: string[] = [];

  if (input.previous !== null) {
    lines.push(`# 上一章（第 ${input.previous.chapter} 章）`);
    if (input.previous.headSummary !== null) {
      lines.push(`【前半摘要】${input.previous.headSummary}`);
      lines.push("【后半原文】");
    }
    lines.push(input.previous.tailText);
    lines.push("");
  }

  lines.push("# 本章节拍");
  lines.push(renderPlan(input.beat));

  if ((input.fulfilledResolutions?.length ?? 0) > 0) {
    lines.push("", "# 原计划中已提前完成的回收");
    for (const item of input.fulfilledResolutions!) lines.push(`- ${item.id}「${item.label}」已在第 ${item.chapter} 章的正式正文中完整兑现。`);
    lines.push("这些目标已从本次回收要求和预算中扣除。保持既有事实，推进尚未完成的事件；不要重复上演揭晓或再次声明兑现。");
  }
  if ((input.fulfilledPlants?.length ?? 0) > 0) {
    lines.push("", "# 原计划中已提前埋设的伏笔");
    for (const item of input.fulfilledPlants!) lines.push(`- ${item.id}「${item.label}」已在第 ${item.chapter} 章埋设，不要再次创建同一条伏笔。`);
  }

  if ((input.plannedForeshadows?.length ?? 0) > 0) {
    lines.push("", "# 本章要埋设的已确认规划（此前尚未写成正文）");
    for (const plan of input.plannedForeshadows!) {
      lines.push(`- ${plan.id}「${plan.label}」：${plan.intent}；${WEIGHT_LABEL[plan.weight]}，预期第 ${plan.expectedBy} 章前兑现。`);
    }
    lines.push("这些只是作者规划。本章若确实写出埋设，结构声明用 planned_foreshadow_id 关联原编号并引用原文；不要当成此前已发生，也不要提前兑现。");
  }

  if (input.resolves.length > 0) {
    lines.push("");
    lines.push("# 本章要收的伏笔");
    for (const r of input.resolves) {
      const scope = r.completeness === "full" ? "完全收束" : "部分收束";
      lines.push(`【${r.label}】${WEIGHT_LABEL[r.weight]}·${scope}`);
      lines.push(`  埋设意图：${r.intent}`);
    }
    lines.push("要求：上述伏笔必须在本章兑现其意图，且收束要与埋设处的写法呼应。");
  }

  if (input.avoid.length > 0) {
    lines.push("");
    lines.push("# 暗线伏笔（不要在本章直接提及）");
    for (const a of input.avoid) lines.push(`- ${a.label}`);
    lines.push("这些是读者不该察觉的暗线，本章不要点明，也不要让角色讨论。");
  }

  if (input.beat.budget !== null) {
    lines.push("");
    lines.push("# 本章预算");
    lines.push(renderBudget(input.beat.budget));
  }

  lines.push("");
  lines.push("# 任务");
  lines.push(input.task);

  return lines.join("\n");
}
