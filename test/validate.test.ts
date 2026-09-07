/**
 * V2 节拍表校验（§12.2）。全是纯代码，零成本。
 *
 * 这一层的价值是把"祈祷模型遵守"变成"不合规就打回"，所以测试的重点是
 * **block 零漏检**（M2 的验收标准之一）：黑名单里的每个词都要真的拦住。
 */

import { describe, expect, it } from "vitest";
import { loadRules } from "../src/rules/load.js";
import { hasBlock, validatePlan, validateVolume } from "../src/beat/validate.js";
import type { ChapterBeat, ChapterPlan } from "../src/types/beat.js";
import type { ForeshadowId } from "../src/types/primitives.js";

const rules = loadRules();

function plan(over: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterType: "event",
    coreEvent: "李长风在西门茶摊问出三叔当晚不在城里",
    secondaryThread: null,
    stageFeedback: "李长风确认三叔说了谎，拿到第一个可查的时间点",
    hook: "三叔的马车停在巷口，车帘没拉",
    events: [{ kind: "action", summary: "问出实话", weight: 2, plotLine: null }],
    resolves: [],
    plants: [],
    characters: ["C01"],
    locations: ["S01"],
    ...over,
  };
}

function beat(chapter: number, over: Partial<ChapterPlan> = {}): ChapterBeat {
  return {
    chapter,
    volume: 3,
    plan: plan(over),
    budget: null,
    provenance: "proposed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
}

const ruleIds = (fs: readonly { rule: string }[]): readonly string[] => fs.map((f) => f.rule);

describe("§12.2 阶段反馈黑名单 —— block 零漏检", () => {
  for (const word of rules.beatValidation.stageFeedbackBlacklist) {
    it(`「${word}」出现在阶段反馈里就打回`, () => {
      const f = validatePlan(plan({ stageFeedback: `本章${word}后续的冲突` }), rules);
      const hit = f.find((x) => x.rule === "beat_stage_feedback_vague");
      expect(hit?.level).toBe("block");
      expect(hit?.message).toContain(word);
    });
  }

  it("具体兑现不报", () => {
    const f = validatePlan(plan({ stageFeedback: "李长风拿到账本，确认三叔当晚在山" }), rules);
    expect(ruleIds(f)).not.toContain("beat_stage_feedback_vague");
  });

  it("多个命中词一次报全 —— 让模型一次改完", () => {
    const f = validatePlan(plan({ stageFeedback: "继续铺垫，等待时机" }), rules);
    const hit = f.find((x) => x.rule === "beat_stage_feedback_vague");
    expect(hit?.message).toContain("继续");
    expect(hit?.message).toContain("铺垫");
    expect(hit?.message).toContain("等待");
  });
});

describe("§12.2 章末钩子黑名单 —— block 零漏检", () => {
  for (const word of rules.beatValidation.hookBlacklist) {
    it(`「${word}」出现在章末钩子里就打回`, () => {
      const f = validatePlan(plan({ hook: `一场更大的${word}将至` }), rules);
      expect(f.find((x) => x.rule === "beat_hook_cliche")?.level).toBe("block");
    });
  }

  it("具体落点不报", () => {
    const f = validatePlan(plan({ hook: "三叔推门进来，手里拿着那把钥匙" }), rules);
    expect(ruleIds(f)).not.toContain("beat_hook_cliche");
  });
});

describe("§12.2 核心事件的连接词", () => {
  it("一个连接词在限额内，不报", () => {
    const f = validatePlan(plan({ coreEvent: "李长风问出实话，然后连夜出城" }), rules);
    expect(ruleIds(f)).not.toContain("beat_core_event_multi_step");
  });

  it("两个以上 → warn 提示拆章（不是 block，可能只是叙述习惯）", () => {
    const f = validatePlan(
      plan({ coreEvent: "李长风问出实话，然后连夜出城，接着在山道遇伏" }),
      rules,
    );
    const hit = f.find((x) => x.rule === "beat_core_event_multi_step");
    expect(hit?.level).toBe("warn");
    expect(hit?.measured).toBe(2);
  });
});

describe("排章的结构性错误", () => {
  it("事件章没有事件 → block", () => {
    const f = validatePlan(plan({ events: [] }), rules);
    expect(f.find((x) => x.rule === "beat_no_events")?.level).toBe("block");
  });

  it("过渡章/布局章没有事件是正常的", () => {
    for (const t of ["transition", "setup"] as const) {
      const f = validatePlan(plan({ chapterType: t, events: [] }), rules);
      expect(ruleIds(f)).not.toContain("beat_no_events");
    }
  });

  it("回收章/高潮章没有收束安排 → block（收束是这两类章的定义）", () => {
    for (const t of ["payoff", "climax"] as const) {
      const f = validatePlan(plan({ chapterType: t, resolves: [] }), rules);
      expect(f.find((x) => x.rule === "beat_payoff_without_resolution")?.level).toBe("block");
    }
  });

  it("有收束安排的回收章不报", () => {
    const f = validatePlan(
      plan({
        chapterType: "payoff",
        resolves: [{ foreshadowId: "F03" as ForeshadowId, weight: "main", completeness: "full" }],
      }),
      rules,
    );
    expect(ruleIds(f)).not.toContain("beat_payoff_without_resolution");
  });

  it("干净的节拍表零 finding", () => {
    expect(validatePlan(plan(), rules)).toEqual([]);
    expect(hasBlock(validatePlan(plan(), rules))).toBe(false);
  });
});

describe("§12.2 卷级跨章校验", () => {
  const empty = { events: [], resolves: [] };

  it("连续 3 章既无事件也无收束 → block", () => {
    const f = validateVolume(
      { beats: [beat(41, empty), beat(42, empty), beat(43, empty)], dueInVolume: [] },
      rules,
    );
    const hit = f.find((x) => x.rule === "beat_no_stage_feedback_run");
    expect(hit?.level).toBe("block");
    expect(hit?.measured).toBe(3);
  });

  it("两章空档不报（规划期阈值 3）", () => {
    const f = validateVolume({ beats: [beat(41, empty), beat(42, empty)], dueInVolume: [] }, rules);
    expect(ruleIds(f)).not.toContain("beat_no_stage_feedback_run");
  });

  it("跨卷带过来的连续计数会累进", () => {
    const f = validateVolume(
      { beats: [beat(41, empty)], priorNoFeedbackRun: 2, dueInVolume: [] },
      rules,
    );
    expect(ruleIds(f)).toContain("beat_no_stage_feedback_run");
  });

  it("报一次即重置 —— 否则后面每章都报同一件事", () => {
    const f = validateVolume(
      {
        beats: [beat(41, empty), beat(42, empty), beat(43, empty), beat(44, empty)],
        dueInVolume: [],
      },
      rules,
    );
    expect(f.filter((x) => x.rule === "beat_no_stage_feedback_run")).toHaveLength(1);
  });

  it("5 章无伏笔收束 → warn（读者回报周期）", () => {
    const beats = [41, 42, 43, 44, 45].map((c) => beat(c));
    const f = validateVolume({ beats, dueInVolume: [] }, rules);
    const hit = f.find((x) => x.rule === "beat_no_payoff_gap");
    expect(hit?.level).toBe("warn");
    expect(hit?.measured).toBe(5);
  });

  it("有收束的章清零回报计数", () => {
    const withRes = beat(43, {
      resolves: [{ foreshadowId: "F03" as ForeshadowId, weight: "sub", completeness: "full" }],
    });
    const beats = [beat(41), beat(42), withRes, beat(44), beat(45)];
    const f = validateVolume({ beats, dueInVolume: [] }, rules);
    expect(ruleIds(f)).not.toContain("beat_no_payoff_gap");
  });

  it("expected_by 落在本卷但未安排 → warn", () => {
    const f = validateVolume(
      {
        beats: [beat(41), beat(42), beat(43)],
        dueInVolume: [{ foreshadowId: "F11" as ForeshadowId, label: "村口老树", expectedBy: 42 }],
      },
      rules,
    );
    const hit = f.find((x) => x.rule === "beat_due_foreshadow_unscheduled");
    expect(hit?.level).toBe("warn");
    expect(hit?.message).toContain("村口老树");
  });

  it("已排进某一章的伏笔不报", () => {
    const scheduled = beat(42, {
      resolves: [{ foreshadowId: "F11" as ForeshadowId, weight: "sub", completeness: "full" }],
    });
    const f = validateVolume(
      {
        beats: [beat(41), scheduled, beat(43)],
        dueInVolume: [{ foreshadowId: "F11" as ForeshadowId, label: "村口老树", expectedBy: 42 }],
      },
      rules,
    );
    expect(ruleIds(f)).not.toContain("beat_due_foreshadow_unscheduled");
  });

  it("到期日在本卷范围外的不报（下一卷的事）", () => {
    const f = validateVolume(
      {
        beats: [beat(41), beat(42)],
        dueInVolume: [{ foreshadowId: "F11" as ForeshadowId, label: "村口老树", expectedBy: 80 }],
      },
      rules,
    );
    expect(ruleIds(f)).not.toContain("beat_due_foreshadow_unscheduled");
  });

  it("乱序输入的节拍表按章号排序后再判", () => {
    const f = validateVolume(
      { beats: [beat(43, empty), beat(41, empty), beat(42, empty)], dueInVolume: [] },
      rules,
    );
    expect(f.find((x) => x.rule === "beat_no_stage_feedback_run")?.message).toContain("第 43 章");
  });
});
