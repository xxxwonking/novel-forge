/**
 * V3 预算派生（§10.4-10.6）。
 *
 * 最重要的一组断言是「派生结果示例」那张表（§10.4）—— 它是设计文档里唯一
 * 给出具体数字的地方，实现与它对不上就说明系数读错或算错了。尤其是最后一行
 * 高潮章 4250-6350：**那正是硬字数约束下必然写崩的情况**，也是整个派生
 * 机制存在的理由。
 */

import { describe, expect, it } from "vitest";
import { loadRules } from "../src/rules/load.js";
import {
  deriveBudget,
  deriveThresholds,
  deriveWordBudget,
  measuredDensity,
  thresholdsForWords,
  weightedEventValue,
} from "../src/beat/derive.js";
import type { ChapterPlan, WorkProfile } from "../src/types/beat.js";
import type { ForeshadowId } from "../src/types/primitives.js";
import { workProfile } from "./fixtures.js";

const rules = loadRules();
const NOW = "2026-09-06T00:00:00.000Z";

/** 最小节拍。各测试只覆盖它关心的字段。 */
function plan(over: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterType: "event",
    coreEvent: "李长风在西门茶摊问出三叔当晚不在城里",
    secondaryThread: null,
    stageFeedback: "确认三叔说了谎",
    hook: "三叔的马车停在巷口",
    events: [],
    resolves: [],
    plants: [],
    characters: ["C01"],
    locations: ["S01"],
    ...over,
  };
}

const ev = (weight: 1 | 2 | 3) => ({
  kind: "action" as const,
  summary: `权重 ${weight} 的事件`,
  weight,
  plotLine: null,
});

const res = (id: string, weight: "main" | "sub" | "detail", completeness: "full" | "partial") => ({
  foreshadowId: id as ForeshadowId,
  weight,
  completeness,
});

describe("§10.4 字数预算 —— 对齐设计文档的派生结果示例（番茄 base 2200）", () => {
  it("过渡章 → 1750-2200", () => {
    const w = deriveWordBudget(plan({ chapterType: "transition" }), workProfile, rules);
    expect([w.min, w.max]).toEqual([1750, 2200]);
  });

  it("事件章单事件 → 2100-2650", () => {
    const w = deriveWordBudget(plan({ events: [ev(2)] }), workProfile, rules);
    expect([w.min, w.max]).toEqual([2100, 2650]);
  });

  /**
   * 文档表格写的是 3050-4000，但它跟文档自己的伪代码算不出同一个数：
   * 2200×1.10 + 600 = 3020 → 取整 3000；2200×1.45 + 900 = 4090 → 取整 4100。
   * 同一张表的高潮章那一行（4250-6350）与伪代码逐位吻合，所以判定这一行
   * 是手写估算而非算出来的。以伪代码为准。
   */
  it("回收章收 1 条主线 → 3000-4100（文档表格此行与其伪代码不一致，以伪代码为准）", () => {
    const w = deriveWordBudget(
      plan({ chapterType: "payoff", resolves: [res("F03", "main", "full")] }),
      workProfile,
      rules,
    );
    expect([w.min, w.max]).toEqual([3000, 4100]);
  });

  it("高潮章收 2 主线 + 1 支线 → 4250-6350（硬字数下必然写崩的那一行）", () => {
    const w = deriveWordBudget(
      plan({
        chapterType: "climax",
        resolves: [res("F03", "main", "full"), res("F07", "main", "full"), res("F11", "sub", "full")],
      }),
      workProfile,
      rules,
    );
    expect([w.min, w.max]).toEqual([4250, 6350]);
    expect(w.sweet).toBe(5300);
  });
});

describe("§10.4 派生规则的边界", () => {
  it("首个事件不加成本 —— 它已含在类型基线里", () => {
    const one = deriveWordBudget(plan({ events: [ev(3)] }), workProfile, rules);
    const none = deriveWordBudget(plan({ events: [] }), workProfile, rules);
    expect(one).toEqual(none);
  });

  it("从第二个事件起按权重累加", () => {
    const two = deriveWordBudget(plan({ events: [ev(1), ev(1)] }), workProfile, rules);
    const one = deriveWordBudget(plan({ events: [ev(1)] }), workProfile, rules);
    expect(two.min - one.min).toBe(250);
    expect(two.max - one.max).toBe(400);
  });

  it("部分收束按 60% 计入", () => {
    const full = deriveWordBudget(
      plan({ chapterType: "payoff", resolves: [res("F03", "main", "full")] }),
      workProfile,
      rules,
    );
    const partial = deriveWordBudget(
      plan({ chapterType: "payoff", resolves: [res("F03", "main", "partial")] }),
      workProfile,
      rules,
    );
    // 主线 [600,900]：完全收束 +600/+900，部分收束 ×0.6 = +360/+540
    // min 差 240 → 取整后 3000 vs 2800 = 200；max 差 360 → 4100 vs 3750 = 350
    expect(full.min - partial.min).toBe(200);
    expect(full.max - partial.max).toBe(350);
  });

  it("非回收/高潮章的收束不计入字数 —— 只有那两类章把收束成本算进预算", () => {
    const withRes = deriveWordBudget(
      plan({ chapterType: "event", resolves: [res("F03", "main", "full")] }),
      workProfile,
      rules,
    );
    const without = deriveWordBudget(plan({ chapterType: "event" }), workProfile, rules);
    expect(withRes).toEqual(without);
  });

  it("上限被 tolerance 钳制 —— 事件堆再多也不会无限放宽", () => {
    const many = deriveWordBudget(
      plan({ events: [ev(3), ev(3), ev(3), ev(3)] }),
      workProfile,
      rules,
    );
    // base 2200 × 1.20 × 1.15 = 3036 → 取整 3050
    expect(many.max).toBe(3050);
  });

  it("钳制后 max 不会低于 min —— 区间为空会让所有章一律超标", () => {
    const heavy = deriveWordBudget(
      plan({
        chapterType: "climax",
        events: [ev(3), ev(3), ev(3), ev(3)],
        resolves: [res("F01", "main", "full"), res("F02", "main", "full"), res("F03", "main", "full")],
      }),
      workProfile,
      rules,
    );
    expect(heavy.max).toBeGreaterThanOrEqual(heavy.min);
  });

  it("换平台只改一个数 —— 起点 base 3000 全线抬高", () => {
    const qidian: WorkProfile = { ...workProfile, platform: "qidian" };
    const a = deriveWordBudget(plan({ chapterType: "transition" }), workProfile, rules);
    const b = deriveWordBudget(plan({ chapterType: "transition" }), qidian, rules);
    expect(b.min).toBeGreaterThan(a.min);
    expect(b.min).toBe(2400); // 3000 × 0.80
  });

  it("字数一律取整到 50", () => {
    for (const t of ["transition", "setup", "event", "payoff", "climax"] as const) {
      const w = deriveWordBudget(plan({ chapterType: t, resolves: [res("F03", "sub", "partial")] }), workProfile, rules);
      expect(w.min % 50).toBe(0);
      expect(w.max % 50).toBe(0);
      expect(w.sweet % 50).toBe(0);
    }
  });
});

describe("§10.4 上限兜底与拆章建议", () => {
  it("预算未超 base × 2.5 时不给建议", () => {
    const b = deriveBudget(
      plan({ chapterType: "payoff", resolves: [res("F03", "main", "full")] }),
      workProfile,
      rules,
      { now: NOW },
    );
    expect(b.splitAdvice).toBeNull();
  });

  it("收 2 条主线 → 给建议，断点落在第一条主线收束之后", () => {
    const b = deriveBudget(
      plan({
        chapterType: "climax",
        resolves: [res("F03", "main", "full"), res("F07", "main", "full"), res("F11", "sub", "full")],
      }),
      workProfile,
      rules,
      { now: NOW },
    );
    expect(b.splitAdvice?.reason).toBe("budget_exceeds_platform_cap");
    expect(b.splitAdvice?.suggestedBreakAfter).toBe("F03");
    expect(b.splitAdvice?.note).toContain("F03");
  });

  it("只收 1 条主线时不给断点位置 —— 任何断点都会切开那条收束", () => {
    const b = deriveBudget(
      plan({
        chapterType: "climax",
        resolves: [res("F03", "main", "full"), res("F11", "detail", "full")],
        events: [ev(3), ev(3), ev(2)],
      }),
      workProfile,
      rules,
      { now: NOW },
    );
    expect(b.splitAdvice).not.toBeNull();
    expect(b.splitAdvice?.suggestedBreakAfter).toBeNull();
    expect(b.splitAdvice?.note).toContain("预收");
  });
});

describe("§10.5 事件密度", () => {
  it("密度区间来自章节类型", () => {
    const b = deriveBudget(plan({ chapterType: "climax" }), workProfile, rules, { now: NOW });
    expect([b.density.min, b.density.max]).toEqual([0.4, 0.8]);
  });

  it("加权值：w1→0.5 w2→1.0 w3→1.5", () => {
    expect(weightedEventValue([1], rules)).toBe(0.5);
    expect(weightedEventValue([2], rules)).toBe(1.0);
    expect(weightedEventValue([3], rules)).toBe(1.5);
    expect(weightedEventValue([3, 1, 1], rules)).toBe(2.5);
  });

  it("§10.5 的两个示例：高潮章 4200 字合规，事件章 2000 字超标", () => {
    // 高潮章 4200 字 / 1×w3 + 2×w1 = 2.5 → 密度 0.60 → 合规（硬字数下会被误判）
    const climax = measuredDensity([3, 1, 1], 4200, rules);
    expect(Math.round(climax * 100) / 100).toBe(0.6);
    expect(climax).toBeLessThanOrEqual(rules.densityRange.climax[1]);

    // 事件章 2000 字 / 3×w2 = 3.0 → 密度 1.50 → 超标（硬字数下反而"合规"）
    const event = measuredDensity([2, 2, 2], 2000, rules);
    expect(event).toBe(1.5);
    expect(event).toBeGreaterThan(rules.densityRange.event[1]);
  });

  it("字数为 0 时密度为 0，不是 Infinity", () => {
    expect(measuredDensity([3], 0, rules)).toBe(0);
  });
});

describe("§10.6 检测阈值按字数与题材缩放", () => {
  it("对齐设计文档那张表（玄幻 ×1.3 比喻）", () => {
    const t2000 = thresholdsForWords(2000, workProfile, rules);
    const t3000 = thresholdsForWords(3000, workProfile, rules);
    const t4500 = thresholdsForWords(4500, workProfile, rules);

    expect(t2000["高疲劳词_单词"]).toBe(1);
    expect(t3000["高疲劳词_单词"]).toBe(2);
    expect(t4500["高疲劳词_单词"]).toBe(2);

    expect(t2000["口头感叹词_总计"]).toBe(2);
    expect(t3000["口头感叹词_总计"]).toBe(4);
    expect(t4500["口头感叹词_总计"]).toBe(5);

    // 比喻：4.0 × 千字 × 1.3
    expect(t2000["比喻"]).toBe(10);
    expect(t3000["比喻"]).toBe(16);
    expect(t4500["比喻"]).toBe(23);
  });

  it("hardMin 兜底 —— 极短章不会给出 0 次上限", () => {
    const tiny = thresholdsForWords(200, workProfile, rules);
    for (const rule of rules.densityRules) {
      expect(tiny[rule.key]).toBeGreaterThanOrEqual(rule.hardMin);
    }
  });

  it("题材系数生效：悬疑比喻 ×0.7 比玄幻 ×1.3 严得多", () => {
    const mystery = thresholdsForWords(3000, { ...workProfile, genre: "mystery" }, rules);
    const xuanhuan = thresholdsForWords(3000, workProfile, rules);
    expect(mystery["比喻"]).toBeLessThan(xuanhuan["比喻"] ?? 0);
  });

  it("题材未列出的 key 取系数 1.0", () => {
    const urban = thresholdsForWords(3000, { ...workProfile, genre: "urban" }, rules);
    // 都市没配 环境描写段 → 1.0 × 3 = 3
    expect(urban["环境描写段"]).toBe(3);
  });

  it("规划期阈值按预算上限算 —— 按下限算会误判写到区间上端的章", () => {
    const words = { min: 3000, max: 4500, sweet: 3750 };
    const derived = deriveThresholds(words as never, workProfile, rules);
    expect(derived["比喻"]).toBe(thresholdsForWords(4500, workProfile, rules)["比喻"]);
  });

  it("阈值表被冻结", () => {
    expect(Object.isFrozen(thresholdsForWords(3000, workProfile, rules))).toBe(true);
  });
});

describe("§12.8 流程档位", () => {
  it("按章节类型自动选，回收/高潮强制严格档", () => {
    const tierOf = (t: ChapterPlan["chapterType"]) =>
      deriveBudget(plan({ chapterType: t }), workProfile, rules, { now: NOW }).tier;
    expect(tierOf("transition")).toBe("fast");
    expect(tierOf("event")).toBe("standard");
    expect(tierOf("setup")).toBe("standard");
    expect(tierOf("payoff")).toBe("strict");
    expect(tierOf("climax")).toBe("strict");
  });
});

describe("deriveBudget 的产物形态", () => {
  it("记下派生时的平台/题材/规则版本 —— 改平台后要能解释旧章的预算", () => {
    const b = deriveBudget(plan(), workProfile, rules, { now: NOW });
    expect(b.derivedFrom).toEqual({ platform: "fanqie", genre: "xuanhuan", rulesVersion: "r1" });
    expect(b.derivedAt).toBe(NOW);
  });

  it("同一输入派生两次结果相同（除时间戳）", () => {
    const a = deriveBudget(plan({ events: [ev(2), ev(1)] }), workProfile, rules, { now: NOW });
    const b = deriveBudget(plan({ events: [ev(2), ev(1)] }), workProfile, rules, { now: NOW });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
