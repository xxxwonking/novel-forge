/**
 * C6 代码通道 + C7 分流（§10.6-10.9、§12.3）。
 *
 * 两组断言最重要：
 * ① **零容忍规则的 scope 限定** —— 误报会让用户关掉整个检查器，所以叙述里
 *    出现"作者"必须不报，只有对白/内心活动里才报。
 * ② **回收/高潮章收束未完成时超额放行（pass）** —— §10.9 对"高于上限优先
 *    拆章"的关键修正，也是 pass 这一级存在的理由。
 */

import { describe, expect, it } from "vitest";
import { loadRules } from "../src/rules/load.js";
import { gateChapter } from "../src/gate/code-channel.js";
import { canAccept, routeChapter, unresolvedFromFindings } from "../src/gate/route.js";
import { gateCrossChapter, checkStageFeedbackRun } from "../src/gate/cross-chapter.js";
import { deriveBudget } from "../src/beat/derive.js";
import type { ChapterBudget, ChapterPlan, GateFinding, WorkProfile } from "../src/types/beat.js";
import type { EventWeight } from "../src/types/events.js";
import type { ForeshadowId } from "../src/types/primitives.js";
import { asDerived, foreshadows, plotLines, workProfile } from "./fixtures.js";

const rules = loadRules();
const NOW = "2026-09-06T00:00:00.000Z";

function plan(over: Partial<ChapterPlan> = {}): ChapterPlan {
  return {
    chapterType: "event",
    coreEvent: "李长风问出三叔当晚不在城里",
    secondaryThread: null,
    stageFeedback: "确认三叔说了谎",
    hook: "三叔的马车停在巷口",
    events: [{ kind: "action", summary: "问出实话", weight: 2, plotLine: null }],
    resolves: [],
    plants: [],
    characters: ["C01"],
    locations: ["S01"],
    ...over,
  };
}

/** 造一段指定字数的中文正文，内容中性（不触任何规则）。 */
function filler(words: number): string {
  const unit = "他沿着城墙往西走了一段路又停下看了看远处的山影";
  const lines: string[] = [];
  let total = 0;
  while (total < words) {
    lines.push(unit);
    total += unit.length;
  }
  return lines.join("\n");
}

function budgetFor(p: ChapterPlan, profile: WorkProfile = workProfile): ChapterBudget {
  return deriveBudget(p, profile, rules, { now: NOW });
}

function run(
  text: string,
  p: ChapterPlan = plan(),
  weights: readonly EventWeight[] = [2],
  profile: WorkProfile = workProfile,
) {
  return gateChapter(
    { chapterText: text, plan: p, budget: budgetFor(p, profile), profile, declaredEventWeights: weights },
    rules,
  );
}

const rulesHit = (findings: readonly GateFinding[]): readonly string[] => findings.map((f) => f.rule);

describe("§10.4 字数闸门", () => {
  it("低于下限 → block", () => {
    const r = run(filler(500));
    const f = r.findings.find((x) => x.rule === "word_count_under");
    expect(f?.level).toBe("block");
    expect(f?.threshold).toBe(2100);
  });

  it("落在区间内 → 无字数 finding", () => {
    const r = run(filler(2300));
    expect(rulesHit(r.findings)).not.toContain("word_count_under");
    expect(rulesHit(r.findings)).not.toContain("word_count_over");
  });

  it("超上限 → warn（放行判断归 C7，不在这里定级）", () => {
    const r = run(filler(3500));
    expect(r.findings.find((x) => x.rule === "word_count_over")?.level).toBe("warn");
  });

  it("回收类章超额时提示 C7 可能放行", () => {
    const p = plan({
      chapterType: "climax",
      resolves: [{ foreshadowId: "F03" as ForeshadowId, weight: "main", completeness: "full" }],
    });
    const r = run(filler(9000), p, [3]);
    expect(r.findings.find((x) => x.rule === "word_count_over")?.message).toContain("C7");
  });

  it("阈值按实际字数复算 —— 写得比预算短时不被过宽的阈值放过", () => {
    const short = run(filler(2200));
    const long = run(filler(3000));
    expect(short.thresholds["比喻"]).toBeLessThan(long.thresholds["比喻"] ?? 0);
  });
});

describe("§10.5 密度闸门", () => {
  it("密度过低 → warn 提示查拖沓", () => {
    // 事件章下限 0.30；2400 字 1×w1 = 0.5/2.4 ≈ 0.21
    const r = run(filler(2400), plan(), [1]);
    const f = r.findings.find((x) => x.rule === "density_under");
    expect(f?.level).toBe("warn");
    expect(f?.message).toContain("拖沓");
  });

  it("密度过高 → warn 提示拆章", () => {
    // 事件章上限 0.55；2200 字 3×w2 = 3.0/2.2 ≈ 1.36
    const r = run(filler(2200), plan(), [2, 2, 2]);
    const f = r.findings.find((x) => x.rule === "density_over");
    expect(f?.level).toBe("warn");
    expect(f?.message).toContain("拆章");
  });

  it("§10.5 的正反例：高潮章 4200 字 w3+2×w1 合规", () => {
    const p = plan({
      chapterType: "climax",
      resolves: [
        { foreshadowId: "F03" as ForeshadowId, weight: "main", completeness: "full" },
        { foreshadowId: "F07" as ForeshadowId, weight: "main", completeness: "full" },
      ],
    });
    const r = run(filler(4200), p, [3, 1, 1]);
    expect(rulesHit(r.findings)).not.toContain("density_over");
    expect(rulesHit(r.findings)).not.toContain("density_under");
  });
});

describe("§10.6 词表闸门", () => {
  it("单个高疲劳词超限 → warn，逐词报", () => {
    const text = `${filler(2200)}\n他瞳孔骤缩。她瞳孔骤缩。老丈也瞳孔骤缩。`;
    const hits = run(text).findings.filter((f) => f.rule === "fatigue_word_over");
    expect(hits).toHaveLength(1);
    expect(hits[0]?.message).toContain("瞳孔骤缩");
    expect(hits[0]?.measured).toBe(3);
  });

  it("不同疲劳词各一次不报 —— 逐词计数而非总计", () => {
    const text = `${filler(2200)}\n他心中一凛。她微微一笑。老丈深吸一口气。`;
    expect(rulesHit(run(text).findings)).not.toContain("fatigue_word_over");
  });

  it("题材词表生效：玄幻词在玄幻作品里被计入", () => {
    const text = `${filler(2200)}\n周身灵力暴涨。周身灵力暴涨。周身灵力暴涨。`;
    expect(rulesHit(run(text).findings)).toContain("fatigue_word_over");

    const urban: WorkProfile = { ...workProfile, genre: "urban" };
    expect(rulesHit(run(text, plan(), [2], urban).findings)).not.toContain("fatigue_word_over");
  });

  it("口头感叹词按总计算", () => {
    const text = `${filler(2200)}\n啊。呀。哦。唉。哎。嗯。咦。呵。`;
    const f = run(text).findings.find((x) => x.rule === "interjection_over");
    expect(f?.level).toBe("warn");
    expect(f?.measured).toBeGreaterThan(f?.threshold ?? 0);
  });
});

describe("§10.7 零容忍 —— scope 限定是这一组的关键", () => {
  it("对白里的元层词汇 → block", () => {
    const text = `${filler(2200)}\n「按剧本我该死在这。」他说。`;
    const f = run(text).findings.find((x) => x.rule === "meta_leak");
    expect(f?.level).toBe("block");
  });

  it("内心活动里的元层词汇 → block", () => {
    const text = `${filler(2200)}\n他想这是伏笔，后面必有回应。`;
    expect(rulesHit(run(text).findings)).toContain("meta_leak");
  });

  it("**叙述里的「作者」不报** —— 它可能是小说里的一个角色", () => {
    const text = `${filler(2200)}\n作者在青州城开了间书铺，卖些闲书。他进去买了一本。`;
    expect(rulesHit(run(text).findings)).not.toContain("meta_leak");
  });

  it("叙述里出现「设定里」也不报（宁漏不误报）", () => {
    const text = `${filler(2200)}\n设定里的规矩谁都懂，城内不许动武。`;
    expect(rulesHit(run(text).findings)).not.toContain("meta_leak");
  });

  it("章末总结句 → block，且只查最后 3 段", () => {
    const bad = `${filler(2200)}\n这只是开始。`;
    expect(rulesHit(run(bad).findings)).toContain("ending_cliche");
  });

  it("同一套路句出现在章首不报 —— scope 是章末 3 段", () => {
    const text = ["这只是开始。", ...Array.from({ length: 20 }, () => filler(120))].join("\n");
    expect(rulesHit(run(text).findings)).not.toContain("ending_cliche");
  });

  it("零容忍不按字数缩放 —— 长章里一次也报", () => {
    const p = plan({ chapterType: "climax", resolves: [{ foreshadowId: "F03" as ForeshadowId, weight: "main", completeness: "full" }] });
    const text = `${filler(4000)}\n属于他的时代。`;
    expect(rulesHit(run(text, p, [3]).findings)).toContain("ending_cliche");
  });
});

describe("§10.7 复读式结构", () => {
  it("连续 3 行同主语破折号 → block，并提示可 pass 放行", () => {
    const text = [
      filler(2200),
      "他知道——这事没那么简单。",
      "他明白——三叔不会认。",
      "他清楚——账本才是关键。",
    ].join("\n");
    const f = run(text).findings.find((x) => x.rule === "parallel_run");
    expect(f?.level).toBe("block");
    expect(f?.message).toContain("排比修辞");
  });

  it("相邻行同一感叹词 → block", () => {
    const text = `${filler(2200)}\n「啊，是你。」\n「啊，你怎么在这。」`;
    expect(run(text).findings.find((x) => x.rule === "interjection_repeat")?.level).toBe("block");
  });
});

describe("§10.9 C7 分流", () => {
  const promised = (id: string) => ({ foreshadowId: id as ForeshadowId, weight: "main" as const, completeness: "full" as const });

  it("字数不足 → patch，带补写优先级与禁止项", () => {
    const p = plan();
    const r = routeChapter({ words: 1200, plan: p, budget: budgetFor(p), unresolvedPromises: [] }, rules);
    expect(r.action.action).toBe("patch");
    expect(r.findings[0]?.level).toBe("block");
    expect(r.findings[0]?.message).toContain("对手的反制动作");
    expect(r.findings[0]?.message).toContain("空泛抒情");
  });

  it("字数不足且有未完成收束 → 优先补收束，给出字数区间", () => {
    const p = plan({ chapterType: "payoff", resolves: [promised("F03")] });
    const r = routeChapter(
      { words: 1200, plan: p, budget: budgetFor(p), unresolvedPromises: ["F03"] },
      rules,
    );
    expect(r.findings[0]?.message).toContain("F03");
    expect(r.findings[0]?.message).toContain("300-400");
  });

  it("落在区间内 → ok，无 finding", () => {
    const p = plan();
    const r = routeChapter({ words: 2300, plan: p, budget: budgetFor(p), unresolvedPromises: [] }, rules);
    expect(r.action).toEqual({ action: "ok" });
    expect(r.findings).toEqual([]);
  });

  it("**高潮章超额 + 收束未完成 → pass**（§10.9 的关键修正）", () => {
    const p = plan({ chapterType: "climax", resolves: [promised("F03"), promised("F07")] });
    const r = routeChapter(
      { words: 9000, plan: p, budget: budgetFor(p), unresolvedPromises: ["F03"] },
      rules,
    );
    expect(r.action.action).toBe("pass");
    expect(r.findings[0]?.level).toBe("pass");
    // pass 必须留下理由，否则"违规但正确"就没有正当记录
    expect(r.findings[0]?.passReason).toBeTruthy();
    expect(canAccept(r.findings)).toBe(true);
  });

  it("回收章超额但收束已完成 → trim", () => {
    const p = plan({ chapterType: "payoff", resolves: [promised("F03")] });
    const r = routeChapter(
      { words: 9000, plan: p, budget: budgetFor(p), unresolvedPromises: [] },
      rules,
    );
    expect(r.action.action).toBe("trim");
    expect(r.findings[0]?.message).toContain("绝不能删");
    expect(r.findings[0]?.message).toContain("伏笔呼应");
  });

  it("事件章多事件超额 → split，断点给次级事件", () => {
    const p = plan({
      events: [
        { kind: "action", summary: "围杀", weight: 3, plotLine: null },
        { kind: "info", summary: "账本现身", weight: 2, plotLine: null },
      ],
    });
    const r = routeChapter({ words: 9000, plan: p, budget: budgetFor(p), unresolvedPromises: [] }, rules);
    expect(r.action).toEqual({ action: "split", at: "账本现身" });
  });

  it("事件章单事件超额 → trim（超的是水分）", () => {
    const p = plan();
    const r = routeChapter({ words: 9000, plan: p, budget: budgetFor(p), unresolvedPromises: [] }, rules);
    expect(r.action.action).toBe("trim");
    expect(r.findings[0]?.message).toContain("只有一个事件");
  });

  it("过渡章超额也走 trim/split，不会被误当回收章放行", () => {
    const p = plan({ chapterType: "transition", events: [] });
    const r = routeChapter({ words: 9000, plan: p, budget: budgetFor(p), unresolvedPromises: ["F03"] }, rules);
    expect(r.action.action).toBe("trim");
  });
});

describe("unresolvedFromFindings / canAccept", () => {
  it("从 c5-crosscheck 的 finding 里提取伏笔 ID，去重", () => {
    const findings: GateFinding[] = [
      { rule: "resolution_missing", level: "block", message: "节拍表承诺本章收束 F03，但结构声明里没有" },
      { rule: "resolution_downgraded", level: "warn", message: "F07 计划完全收束，实际只做到部分收束" },
      { rule: "resolution_unplanned", level: "info", message: "本章额外收束了 F11" },
      { rule: "resolution_missing", level: "block", message: "节拍表承诺本章收束 F03，但结构声明里没有" },
    ];
    expect(unresolvedFromFindings(findings)).toEqual(["F03", "F07"]);
  });

  it("block 未清则不允许接受；pass 不阻断", () => {
    expect(canAccept([{ rule: "x", level: "block", message: "" }])).toBe(false);
    expect(canAccept([{ rule: "x", level: "pass", message: "", passReason: "r" }])).toBe(true);
    expect(canAccept([{ rule: "x", level: "warn", message: "" }])).toBe(true);
  });
});

describe("§10.8 跨章检测", () => {
  it("伏笔逾期 → warn，逾期章数进 measured", () => {
    const f = gateCrossChapter(
      { currentChapter: 53, foreshadows, plotLines: [], arcs: [] },
      rules,
    ).filter((x) => x.rule === "foreshadow_overdue");
    // F07 逾期 3 章、F11 逾期 15 章；F03 未到期；F02 已收
    expect(f).toHaveLength(2);
    expect(f.map((x) => x.measured).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([3, 15]);
  });

  it("已收束/已废弃的伏笔不报", () => {
    const all = gateCrossChapter({ currentChapter: 53, foreshadows, plotLines: [], arcs: [] }, rules);
    expect(all.every((f) => !f.message.includes("断剑的裂纹"))).toBe(true);
  });

  it("临近到期 → info", () => {
    const f = gateCrossChapter(
      { currentChapter: 53, foreshadows, plotLines: [], arcs: [] },
      rules,
    ).find((x) => x.rule === "foreshadow_due_soon");
    expect(f?.level).toBe("info");
    expect(f?.message).toContain("生锈的钥匙"); // F03 expectedBy 55
  });

  it("埋下超过 20 章无动静 → warn（与逾期是两条不同的规则）", () => {
    const f = gateCrossChapter(
      { currentChapter: 53, foreshadows, plotLines: [], arcs: [] },
      rules,
    ).find((x) => x.rule === "foreshadow_stale");
    // F03 埋于第 5 章、未逾期 → 命中 stale
    expect(f?.message).toContain("生锈的钥匙");
  });

  it("情节线断线按权重派生阈值：支线断 22 章报，主线刚推进不报", () => {
    const f = gateCrossChapter(
      { currentChapter: 52, foreshadows: [], plotLines, arcs: [] },
      rules,
    ).filter((x) => x.rule === "plotline_gap");
    expect(f).toHaveLength(1);
    expect(f[0]?.message).toContain("血刀客的刀谱"); // P03 gap 22 > 12
  });

  it("从未推进过的线不报断线 —— 它还没开始", () => {
    const fresh = [{ ...plotLines[0]!, lastAdvancedAt: 0, currentGap: asDerived(52) }];
    const f = gateCrossChapter({ currentChapter: 52, foreshadows: [], plotLines: fresh, arcs: [] }, rules);
    expect(rulesHit(f)).not.toContain("plotline_gap");
  });

  it("角色消失按档位派生：主角 2 章、龙套永不报", () => {
    const arcs = [
      { characterId: "C01" as const, name: "李长风", tier: "protagonist" as const, introducedAt: 1, lastSeenAt: 45, presence: [], turningPoints: [] },
      { characterId: "C09" as const, name: "路人", tier: "extra" as const, introducedAt: 1, lastSeenAt: 2, presence: [], turningPoints: [] },
    ];
    const f = gateCrossChapter({ currentChapter: 53, foreshadows: [], plotLines: [], arcs }, rules);
    expect(f.filter((x) => x.rule === "character_missing")).toHaveLength(1);
    expect(f[0]?.message).toContain("李长风");
  });

  it("连续无兑现 → block（交稿期阈值 2，比规划期的 3 更严）", () => {
    const f = checkStageFeedbackRun(
      [
        { chapter: 50, delivered: true },
        { chapter: 51, delivered: false },
        { chapter: 52, delivered: false },
      ],
      rules,
    );
    expect(f[0]?.level).toBe("block");
    expect(f[0]?.measured).toBe(2);
  });

  it("最近一章有兑现则清零", () => {
    expect(
      checkStageFeedbackRun(
        [
          { chapter: 51, delivered: false },
          { chapter: 52, delivered: false },
          { chapter: 53, delivered: true },
        ],
        rules,
      ),
    ).toEqual([]);
  });
});
