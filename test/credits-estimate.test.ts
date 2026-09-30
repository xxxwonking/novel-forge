/**
 * 两条反推路线的费用预估。
 *
 * 这个功能的全部用途是**让两个数字可比** —— 作者面对同一个目标下的两个按钮，
 * 其中一条按章计费。所以测试钉住的不是"算得准"（事前没有准可言），而是三条
 * 让数字可以被当真的纪律：基准一致、不知道就说不知道、偏差方向明示。
 */

import { describe, expect, it } from "vitest";
import { estimateModes, type ModeFacts } from "../src/credits/estimate.js";
import type { CreditEntry } from "../src/credits/ledger.js";
import type { Pricing } from "../src/credits/pricing.js";

const pricing: Pricing = {
  version: "test", creditsPerUsd: 100, signupGrant: 0,
  models: {
    cheap: { input: 0.3, output: 2.5, cacheWrite: 0.3, cacheRead: 0.075 },
    dear: { input: 15, output: 75, cacheWrite: 18.75, cacheRead: 1.5 },
  },
};

const materials = (model = "cheap"): ModeFacts => ({
  key: "materials", model, purpose: "preparation", maxOutputTokens: 8_000,
  calls: { min: 2, max: 8 }, inputTokens: { min: 40_000, max: 160_000 },
});
const chapters = (model = "cheap"): ModeFacts => ({
  key: "chapters", model, purpose: "inference", maxOutputTokens: 4_000,
  calls: { min: 100, max: 100 }, inputTokens: { min: 330_000, max: 330_000 },
});

const entry = (purpose: string, credits: number, over: Partial<CreditEntry> = {}): CreditEntry => ({
  at: "2026-09-30T00:00:00.000Z", model: "upstream-actual", role: "judge", purpose,
  tokens: { input: 1_000, output: 200, cacheWrite: null, cacheRead: null },
  credits, priced: true, ...over,
});

describe("上限推算", () => {
  it("次数确定的那档区间两端相同，不确定的那档给出区间", () => {
    const [m, c] = estimateModes([materials(), chapters()], [], pricing);
    expect(m?.calls).toEqual({ min: 2, max: 8 });
    expect(m?.credits?.min).toBeLessThan(m!.credits!.max);
    expect(c?.calls).toEqual({ min: 100, max: 100 });
    expect(c?.credits?.min).toBe(c?.credits?.max);
  });

  it("按 role 实际落到的模型查价 —— 同一批事实换个模型，数字差一个量级", () => {
    const [cheap] = estimateModes([chapters("cheap")], [], pricing);
    const [dear] = estimateModes([chapters("dear")], [], pricing);
    // 这正是必须读真实配置的理由：把 chat 接入的账按 Claude 报，作者会放弃
    // 一条其实很便宜的路。
    expect(dear!.credits!.max / cheap!.credits!.max).toBeGreaterThan(20);
  });

  it("价格表里没有这个模型时报 null，不报 0", () => {
    const [m] = estimateModes([chapters("没配过的模型")], [], pricing);
    // 0 是"不花钱"，null 是"不知道"。显示成 0 会让作者以为这条路免费。
    expect(m?.credits).toBeNull();
    expect(m?.basis).toBe("ceiling");
  });

  it("没有正文可反推时次数为 0，积分也是 0", () => {
    const [m] = estimateModes([{ ...chapters(), calls: { min: 0, max: 0 }, inputTokens: { min: 0, max: 0 } }], [], pricing);
    expect(m?.credits).toEqual({ min: 0, max: 0 });
  });
});

describe("实测基准", () => {
  const measured = [
    ...Array.from({ length: 3 }, () => entry("preparation", 2)),
    ...Array.from({ length: 3 }, () => entry("inference", 0.5)),
  ];

  it("两档都攒够样本才改按实测：均价 × 次数", () => {
    const [m, c] = estimateModes([materials(), chapters()], measured, pricing);
    expect(m?.basis).toBe("measured");
    expect(m?.samples).toBe(3);
    expect(m?.credits).toEqual({ min: 4, max: 16 });
    expect(c?.credits).toEqual({ min: 50, max: 50 });
  });

  it("只有一档有样本时**两档都**退回上限 —— 混用基准比两边都偏高有害", () => {
    // 上限推算里输出占九成以上，实际输出通常只有上限的四分之一。一档按实测、
    // 一档按上限，前者会凭空显得便宜好几倍，而这个功能唯一的用途就是让两个数可比。
    const onlyOne = Array.from({ length: 5 }, () => entry("preparation", 2));
    const [m, c] = estimateModes([materials(), chapters()], onlyOne, pricing);
    expect(m?.basis).toBe("ceiling");
    expect(c?.basis).toBe("ceiling");
    expect(m?.samples).toBe(0);
  });

  it("样本不足三条不改基准 —— 一次异常调用就能把均值带跑", () => {
    const two = [entry("preparation", 2), entry("preparation", 900), entry("inference", 0.5), entry("inference", 0.5), entry("inference", 0.5)];
    expect(estimateModes([materials(), chapters()], two, pricing).every((m) => m.basis === "ceiling")).toBe(true);
  });

  it("未计价的记录不参与均价 —— 它们的 credits 记 0，会把均价拉低", () => {
    const polluted = [
      ...Array.from({ length: 3 }, () => entry("preparation", 2)),
      ...Array.from({ length: 3 }, () => entry("inference", 0.5)),
      ...Array.from({ length: 30 }, () => entry("inference", 0, { priced: false })),
    ];
    const [, c] = estimateModes([materials(), chapters()], polluted, pricing);
    expect(c?.credits).toEqual({ min: 50, max: 50 });
  });

  it("模型名取账本里最近一条 —— 中转会换模型，上游报回来的那个才是真的", () => {
    const withSwap = [
      ...Array.from({ length: 3 }, () => entry("preparation", 2)),
      ...Array.from({ length: 2 }, () => entry("inference", 0.5)),
      entry("inference", 0.5, { model: "上游换过的模型" }),
    ];
    const [, c] = estimateModes([materials("cheap"), chapters("cheap")], withSwap, pricing);
    expect(c?.model).toBe("上游换过的模型");
  });
});
