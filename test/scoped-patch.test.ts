import { describe, expect, it } from "vitest";
import { routeChapter } from "../src/gate/route.js";
import { deriveBudget } from "../src/beat/derive.js";
import { loadRules } from "../src/rules/load.js";
import { WRITE_BEAT, writingSnapshot } from "./writing-fixtures.js";

describe("补写目标跟随本章计划", () => {
  it("整理账册不能被强迫补对手反制和交易筹码", () => {
    const rules = loadRules();
    const plan = { ...WRITE_BEAT.plan, chapterType: "event" as const, secondaryThread: null,
      coreEvent: "整理已核实的账册并逐页编号，不引入新线索", stageFeedback: "清单与页码一一对应",
      hook: "把清单放在已编号账册上", resolves: [], events: [{ kind: "info" as const, summary: "账册编号完成", weight: 2 as const, plotLine: "P01" as const }] };
    const result = routeChapter({ words: 590, plan, budget: deriveBudget(plan, writingSnapshot().profile, rules), unresolvedPromises: [] }, rules);
    const text = JSON.stringify(result);
    expect(text).toContain(plan.coreEvent);
    expect(text).toContain(plan.stageFeedback);
    expect(text).toContain(plan.hook);
    expect(text).not.toContain("对手的反制动作");
    expect(text).not.toContain("交易的具体条件与筹码");
    expect(result.findings[0]?.level).toBe("block");
  });
});
