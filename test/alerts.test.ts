/**
 * 首页告警（§12.6）。
 *
 * 这批测试守的是 §12.6 的四条立论，它们都是反直觉的、也都容易在后续改动里
 * 被"顺手简化"掉：
 *   ① 排序按**修复成本增长率**，不按当前严重度 —— 逾期 8 章排在逾期 35 章前面
 *   ② 前向修复优先于后向修复（direction 0.4 折），但后者不被完全埋掉
 *   ③ **节拍表里安排了，告警立刻消失**，不等写完
 *   ④ 同类递减但不禁止 —— 真有 3 条主线伏笔都严重逾期时它们占满三格是对的
 */

import { describe, expect, it } from "vitest";
import { computeAlerts, type AlertComputeInput } from "../src/alerts/compute.js";
import { selectAlerts } from "../src/alerts/select.js";
import {
  acknowledgeAlert,
  applyActionToBeat,
  ignoreAlert,
  initialAlertState,
  unacknowledgeAlert,
} from "../src/alerts/apply.js";
import {
  decayCharacterMissing,
  decayConflict,
  decayFlat,
  decayForeshadowOverdue,
  decayPlotlineGap,
} from "../src/alerts/decay.js";
import { loadRules } from "../src/rules/load.js";
import { validatePlan } from "../src/beat/validate.js";
import { asDerived, beat, workProfile } from "./fixtures.js";
import type { AlertId, ChapterNo, TextAnchor } from "../src/types/primitives.js";
import type { AlertState, CharacterArc, ForeshadowTimelineItem, PlotLineTrack } from "../src/types/projections.js";
import type { ChapterPlan } from "../src/types/beat.js";

const rules = loadRules();
const a = rules.alerts;
const NOW = "2026-09-07T00:00:00.000Z";

function anchor(chapter: ChapterNo, quote: string): TextAnchor {
  return { chapter, quote, offsetHint: 0, occurrence: 0 };
}

function openForeshadow(
  over: Partial<ForeshadowTimelineItem> & { id: ForeshadowTimelineItem["id"] },
): ForeshadowTimelineItem {
  return {
    label: "母亲的信",
    intent: "信里写明主角并非三叔亲侄。",
    weight: "main",
    visibility: "covert",
    status: "open",
    plantedAt: 12,
    plantedAnchor: anchor(12, "信纸边角被烧去一块"),
    expectedBy: 50,
    resolutions: [],
    overdueBy: asDerived(0),
    ...over,
  };
}

function track(over: Partial<PlotLineTrack> & { id: PlotLineTrack["id"] }): PlotLineTrack {
  return {
    label: "感情线",
    weight: "sub",
    gapLimit: asDerived(12),
    lastAdvancedAt: 30,
    currentGap: asDerived(22),
    points: [],
    ...over,
  };
}

function arc(over: Partial<CharacterArc> & { characterId: CharacterArc["characterId"] }): CharacterArc {
  return {
    name: "苏晚晴",
    tier: "major",
    introducedAt: 3,
    lastSeenAt: 26,
    presence: [{ chapter: 26, role: "major" }],
    turningPoints: [],
    ...over,
  };
}

function input(over: Partial<AlertComputeInput> = {}): AlertComputeInput {
  return {
    currentChapter: 52,
    nextChapter: 53,
    foreshadows: [],
    plotLines: [],
    arcs: [],
    states: new Map(),
    now: NOW,
    ...over,
  };
}

const emptyPlan: ChapterPlan = {
  chapterType: "event",
  coreEvent: "李长风查到账本的下落",
  secondaryThread: null,
  stageFeedback: "李长风确认账本在密室",
  hook: "门外有人敲了三下",
  events: [],
  resolves: [],
  plants: [],
  characters: [],
  locations: [],
};

// ── decay 曲线 ──────────────────────────────────────────────────────────

describe("decay：伏笔逾期是先升后降（§12.6.2 ②）", () => {
  const d = a.decay;

  it("未到期时随剩余章数减少而上升，到期处接上 1.0", () => {
    const far = decayForeshadowOverdue(-d.foreshadowOverdue.dueSoonWindow * 2, d);
    const near = decayForeshadowOverdue(-1, d);
    const due = decayForeshadowOverdue(0, d);

    expect(far).toBeCloseTo(d.foreshadowOverdue.dueSoonFloor);
    expect(near).toBeGreaterThan(far);
    expect(due).toBeLessThanOrEqual(1);
    expect(near).toBeLessThan(1);
  });

  it("逾期段单调上升到拐点", () => {
    const peakAt = d.foreshadowOverdue.peakAt;
    const series = [1, 5, 10, peakAt].map((o) => decayForeshadowOverdue(o, d));
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]!).toBeGreaterThan(series[i - 1]!);
    }
  });

  it("拐点后转下降 —— 这是整个排序算法的立论点", () => {
    // §12.6.2：逾期 8 章的伏笔下一章顺手收掉，逾期 35 章的读者早忘了。
    // 所以逾期更久的 decay 必须更**低**，否则排序就退化成了按严重度。
    const peak = decayForeshadowOverdue(a.decay.foreshadowOverdue.peakAt, d);
    const late = decayForeshadowOverdue(35, d);
    expect(late).toBeLessThan(peak);
  });

  it("下降段有 floor，不会归零", () => {
    expect(decayForeshadowOverdue(9999, d)).toBe(d.foreshadowOverdue.floor);
  });
});

describe("decay：其余三种曲线", () => {
  const d = a.decay;

  it("情节线按 gap/limit 的比值，主线与细节线等比时同分", () => {
    // 横轴用比值而非绝对章数 —— 权重已经在 impact 里计过一次，
    // 用绝对章数会让细节线永远排在主线后面（重复计权）。
    const main = decayPlotlineGap(6, 3, d);
    const detail = decayPlotlineGap(40, 20, d);
    expect(main).toBeCloseTo(detail);
  });

  it("情节线未越界时取 base，越界后上升并封顶", () => {
    expect(decayPlotlineGap(3, 3, d)).toBe(d.plotlineGap.base);
    expect(decayPlotlineGap(4, 3, d)).toBeGreaterThan(d.plotlineGap.base);
    expect(decayPlotlineGap(9999, 3, d)).toBe(d.plotlineGap.cap);
  });

  it("角色消失：低档平坦 → 上升 → 迁移后回落", () => {
    const low = decayCharacterMissing(d.characterMissing.lowGap, d);
    const mid = decayCharacterMissing(d.characterMissing.highGap, d);
    const after = decayCharacterMissing(d.characterMissing.highGap + 1, d);

    expect(low).toBe(d.characterMissing.low);
    expect(mid).toBeGreaterThan(low);
    expect(after).toBe(d.characterMissing.afterExit);
    expect(after).toBeLessThan(mid);
  });

  it("设定冲突单调上升且上限够高 —— 打 0.4 折后仍能冒头", () => {
    // §12.6.4：cap 4.0 × impact 3.0 × direction 0.4 = 4.8。
    // 后向修复要被压制，但不能被完全埋掉。
    const capped = decayConflict(9999, d);
    expect(capped).toBe(d.settingConflict.cap);
    expect(decayConflict(1, d)).toBeLessThan(capped);
    expect(capped * a.impact.main * a.direction.backward).toBeGreaterThan(1);
  });

  it("平坦型不随时间变化", () => {
    expect(decayFlat(d)).toBe(d.flat);
  });
});

// ── 候选计算 ────────────────────────────────────────────────────────────

describe("computeAlerts：伏笔", () => {
  it("逾期的伏笔产生 foreshadow_overdue，ID 是「类别:对象」", () => {
    const out = computeAlerts(input({ foreshadows: [openForeshadow({ id: "F07", expectedBy: 44 })] }), rules);
    expect(out).toHaveLength(1);
    expect(out[0]?.alert.id).toBe("foreshadow_overdue:F07");
    expect(out[0]?.alert.category).toBe("foreshadow_overdue");
  });

  it("同一份输入重跑得到同一个 ID —— 重复诊断不产生重复条目", () => {
    const i = input({ foreshadows: [openForeshadow({ id: "F07", expectedBy: 44 })] });
    expect(computeAlerts(i, rules).map((c) => c.alert.id)).toEqual(
      computeAlerts(i, rules).map((c) => c.alert.id),
    );
  });

  it("planned / resolved / abandoned 都不告警", () => {
    const fs = (["planned", "resolved", "abandoned"] as const).map((status, i) =>
      openForeshadow({ id: `F0${i}` as ForeshadowTimelineItem["id"], status, expectedBy: 30 }),
    );
    expect(computeAlerts(input({ foreshadows: fs }), rules)).toEqual([]);
  });

  it("临近到期也进候选（前向修复，提前排比事后催便宜）", () => {
    const soon = 52 + rules.crossChapter.foreshadowDueSoon;
    const out = computeAlerts(input({ foreshadows: [openForeshadow({ id: "F03", expectedBy: soon })] }), rules);
    expect(out).toHaveLength(1);
    expect(out[0]?.alert.title).toContain("到期");
  });

  it("期限还远则不告警", () => {
    const far = 52 + rules.crossChapter.foreshadowDueSoon + 10;
    expect(computeAlerts(input({ foreshadows: [openForeshadow({ id: "F03", expectedBy: far, plantedAt: 50 })] }), rules)).toEqual([]);
  });

  it("逾期超过迁移拐点 → migratedTo=suggest_abandon，动作里出现「废弃」", () => {
    const over = a.migration.foreshadowAbandonAfter + 5;
    const out = computeAlerts(
      input({ currentChapter: 52, foreshadows: [openForeshadow({ id: "F11", expectedBy: 52 - over })] }),
      rules,
    );
    const alert = out[0]?.alert;
    expect(alert?.migratedTo).toBe("suggest_abandon");
    expect(alert?.title).toContain("还打算收吗");
    expect(alert?.actions[0]?.kind).toBe("abandon");
  });

  it("未逾期但埋了很久无动静 → foreshadow_stale（与逾期是两条不同的判据）", () => {
    // 逾期看的是承诺，stale 看的是读者记忆 —— expectedBy 排得很远的伏笔
    // 也会被读者忘掉。
    const planted = 52 - rules.crossChapter.foreshadowStale - 5;
    const out = computeAlerts(
      input({ foreshadows: [openForeshadow({ id: "F11", plantedAt: planted, expectedBy: 90 })] }),
      rules,
    );
    expect(out.map((c) => c.alert.category)).toEqual(["foreshadow_stale"]);
  });

  it("逾期与 stale 同时成立时只报逾期，不重复占格", () => {
    const planted = 52 - rules.crossChapter.foreshadowStale - 5;
    const out = computeAlerts(
      input({ foreshadows: [openForeshadow({ id: "F11", plantedAt: planted, expectedBy: 40 })] }),
      rules,
    );
    expect(out).toHaveLength(1);
    expect(out[0]?.alert.category).toBe("foreshadow_overdue");
  });

  it("impact 按权重取，主线分数高于细节", () => {
    const out = computeAlerts(
      input({
        foreshadows: [
          openForeshadow({ id: "F01", weight: "main", expectedBy: 44 }),
          openForeshadow({ id: "F02", weight: "detail", expectedBy: 44 }),
        ],
      }),
      rules,
    );
    expect(out[0]?.alert.id).toBe("foreshadow_overdue:F01");
    expect(out[0]?.alert.score).toBeGreaterThan(out[1]!.alert.score as number);
  });
});

describe("computeAlerts：情节线与角色", () => {
  it("断线超阈值才告警", () => {
    const ok = track({ id: "P02", lastAdvancedAt: 48, currentGap: asDerived(4) });
    const bad = track({ id: "P03", lastAdvancedAt: 30, currentGap: asDerived(22) });
    const out = computeAlerts(input({ plotLines: [ok, bad] }), rules);
    expect(out.map((c) => c.alert.id)).toEqual(["plotline_gap:P03"]);
  });

  it("从未推进过的线不报断线（它还没开始，不是断了）", () => {
    const virgin = track({ id: "P09", lastAdvancedAt: 0, currentGap: asDerived(52) });
    expect(computeAlerts(input({ plotLines: [virgin] }), rules)).toEqual([]);
  });

  it("角色消失按档位阈值，主角比配角早报", () => {
    const gap = rules.crossChapter.characterAbsent.major;
    const hero = arc({ characterId: "C01", tier: "protagonist", lastSeenAt: 52 - gap });
    const side = arc({ characterId: "C05", tier: "major", lastSeenAt: 52 - gap });
    const out = computeAlerts(input({ arcs: [hero, side] }), rules);
    expect(out.map((c) => c.alert.id)).toEqual(["character_missing:C01"]);
  });

  it("龙套不告警（characterImpact.extra=0 让 score 落到 minScore 之下）", () => {
    const extra = arc({ characterId: "C99", tier: "extra", lastSeenAt: 1 });
    expect(computeAlerts(input({ arcs: [extra] }), rules)).toEqual([]);
  });

  it("从未出场的角色卡不告警", () => {
    const unborn = arc({ characterId: "C08", presence: [], lastSeenAt: 0 });
    expect(computeAlerts(input({ arcs: [unborn] }), rules)).toEqual([]);
  });

  it("消失超过迁移拐点 → confirm_exit", () => {
    const gap = a.migration.characterExitAfter + 5;
    const out = computeAlerts(input({ arcs: [arc({ characterId: "C05", lastSeenAt: 52 - gap })] }), rules);
    expect(out[0]?.alert.migratedTo).toBe("confirm_exit");
    expect(out[0]?.alert.actions[0]?.kind).toBe("confirm_exit");
  });
});

// ── fatigue 流转 ────────────────────────────────────────────────────────

describe("fatigue（§12.6.4、§12.6.8）", () => {
  const overdue = openForeshadow({ id: "F07", expectedBy: 44 });
  const id = "foreshadow_overdue:F07" as AlertId;

  function stateWith(over: Partial<AlertState>): ReadonlyMap<AlertId, AlertState> {
    return new Map([[id, { ...initialAlertState(id, NOW), ...over }]]);
  }

  it("忽略一次后 score 按系数表下降", () => {
    const fresh = computeAlerts(input({ foreshadows: [overdue] }), rules)[0]!;
    const ignored = computeAlerts(
      input({ foreshadows: [overdue], states: stateWith({ fatigueCount: 1, lastDecay: fresh.alert.decay as number }) }),
      rules,
    )[0]!;

    expect(ignored.alert.score as number).toBeCloseTo((fresh.alert.score as number) * a.fatigue[1]!);
  });

  it("decay 显著上升时重置 fatigue（§12.6.4 末条）", () => {
    // 用户第一次忽略"感情线断了 12 章"，等它断到 25 章时问题性质已变。
    const before = stateWith({ fatigueCount: 2, lastDecay: 0.1 });
    const out = computeAlerts(input({ foreshadows: [overdue], states: before }), rules)[0]!;
    expect(out.alert.fatigueCount).toBe(0);
  });

  it("decay 没怎么变则保留忽略次数", () => {
    const fresh = computeAlerts(input({ foreshadows: [overdue] }), rules)[0]!;
    const out = computeAlerts(
      input({
        foreshadows: [overdue],
        states: stateWith({ fatigueCount: 2, lastDecay: fresh.alert.decay as number }),
      }),
      rules,
    )[0]!;
    expect(out.alert.fatigueCount).toBe(2);
  });

  it("类别迁移也重置 fatigue —— 「催收」与「建议废弃」是两个不同的问题", () => {
    const over = a.migration.foreshadowAbandonAfter + 5;
    const migrated = openForeshadow({ id: "F07", expectedBy: 52 - over });
    const decayThere = decayForeshadowOverdue(over, a.decay);
    const out = computeAlerts(
      input({
        foreshadows: [migrated],
        // lastDecay 设成与当前相同，排除 decayJumped 这条路径的干扰。
        states: stateWith({ fatigueCount: 2, lastDecay: decayThere, migratedTo: null }),
      }),
      rules,
    )[0]!;
    expect(out.alert.fatigueCount).toBe(0);
    expect(out.nextState.migratedTo).toBe("suggest_abandon");
  });

  it("忽略次数超出系数表长度时取末位，不越界成 undefined", () => {
    const out = computeAlerts(
      input({ foreshadows: [overdue], states: stateWith({ fatigueCount: 99, lastDecay: 1.4 }) }),
      rules,
    )[0]!;
    expect(Number.isFinite(out.alert.score as number)).toBe(true);
  });

  it("createdAt 沿用旧状态 —— 「这个问题存在多久了」不能每次重算", () => {
    const old = "2026-01-01T00:00:00.000Z";
    const out = computeAlerts(
      input({ foreshadows: [overdue], states: stateWith({ createdAt: old, lastDecay: 1.4 }) }),
      rules,
    )[0]!;
    expect(out.alert.createdAt).toBe(old);
    expect(out.alert.lastEvaluatedAt).toBe(NOW);
  });
});

// ── 选择：gate + MMR ────────────────────────────────────────────────────

describe("selectAlerts：可执行性 gate（§12.6.6）", () => {
  it("节拍表已排回收 → 告警立刻消失，不等写完", () => {
    // 这是全节最关键的一条。不做的话用户的感受是"我已经处理了它还在催"。
    const candidates = computeAlerts(
      input({ foreshadows: [openForeshadow({ id: "F07", expectedBy: 44 })] }),
      rules,
    );
    const plan: ChapterPlan = {
      ...emptyPlan,
      resolves: [{ foreshadowId: "F07", weight: "main", completeness: "full" }],
    };

    expect(selectAlerts({ candidates, nextPlan: null }, a).homepage).toHaveLength(1);
    const after = selectAlerts({ candidates, nextPlan: plan }, a);
    expect(after.homepage).toHaveLength(0);
    expect(after.suppressed[0]?.reason).toBe("scheduled");
  });

  it("节拍表已排该情节线的事件 / 该角色出场 → 同样消失", () => {
    const candidates = computeAlerts(
      input({ plotLines: [track({ id: "P03" })], arcs: [arc({ characterId: "C05", lastSeenAt: 20 })] }),
      rules,
    );
    const plan: ChapterPlan = {
      ...emptyPlan,
      events: [{ kind: "action", summary: "推进这条线", weight: 1, plotLine: "P03" }],
      characters: ["C05"],
    };
    expect(selectAlerts({ candidates, nextPlan: plan }, a).homepage).toHaveLength(0);
  });

  it("标了「有意为之」→ 永久静音", () => {
    const id = "character_missing:C05" as AlertId;
    const states = new Map([[id, acknowledgeAlert(initialAlertState(id, NOW))]]);
    const candidates = computeAlerts(input({ arcs: [arc({ characterId: "C05", lastSeenAt: 20 })], states }), rules);
    const out = selectAlerts({ candidates, nextPlan: null }, a);

    expect(out.homepage).toHaveLength(0);
    expect(out.suppressed[0]?.reason).toBe("acknowledged");
    // 静音的条目也不进完整列表 —— 用户说了别再提。
    expect(out.fullList).toHaveLength(0);
  });

  it("忽略达上限 → 退出首页但仍在完整列表", () => {
    const id = "foreshadow_overdue:F07" as AlertId;
    const state: AlertState = {
      ...initialAlertState(id, NOW),
      fatigueCount: a.fatigueDropAt,
      lastDecay: decayForeshadowOverdue(8, a.decay),
    };
    const candidates = computeAlerts(
      input({ foreshadows: [openForeshadow({ id: "F07", expectedBy: 44 })], states: new Map([[id, state]]) }),
      rules,
    );
    const out = selectAlerts({ candidates, nextPlan: null }, a);

    expect(out.homepage).toHaveLength(0);
    expect(out.fullList).toHaveLength(1);
    expect(out.suppressed[0]?.reason).toBe("fatigued");
  });
});

describe("selectAlerts：MMR 多样性（§12.6.5）", () => {
  function manyForeshadows(n: number): readonly ForeshadowTimelineItem[] {
    return Array.from({ length: n }, (_, i) =>
      openForeshadow({ id: `F1${i}` as ForeshadowTimelineItem["id"], expectedBy: 44 - i }),
    );
  }

  it("首页硬上限，即使有 8 条也只给 3 条", () => {
    const candidates = computeAlerts(input({ foreshadows: manyForeshadows(8) }), rules);
    const out = selectAlerts({ candidates, nextPlan: null }, a);
    expect(candidates.length).toBe(8);
    expect(out.homepage).toHaveLength(a.homepageLimit);
    expect(out.fullList).toHaveLength(8);
  });

  it("不硬性禁止同类 —— 三条主线伏笔都严重逾期时占满三格是对的", () => {
    const out = selectAlerts({ candidates: computeAlerts(input({ foreshadows: manyForeshadows(5) }), rules), nextPlan: null }, a);
    expect(new Set(out.homepage.map((x) => x.category))).toEqual(new Set(["foreshadow_overdue"]));
  });

  it("同类第二条打折后被分数更低的异类挤掉", () => {
    // 构造：两条同类高分（各 5.4）+ 一条原始分更低的异类（3.0）。
    // 不打折时第二格该是同类的 5.4，打 5 折后变 2.7 < 3.0 ⇒ 异类挤进来。
    // 这正是 §12.6.5 要防的"3 条全是伏笔告警，用户以为这书只有伏笔问题"。
    const candidates = computeAlerts(
      input({
        foreshadows: [
          openForeshadow({ id: "F01", expectedBy: 44 }),
          openForeshadow({ id: "F02", expectedBy: 44 }),
        ],
        plotLines: [track({ id: "P03", weight: "main", gapLimit: asDerived(3), lastAdvancedAt: 48 })],
      }),
      rules,
    );

    // 前提：异类的原始分确实低于同类，否则这个测试什么都没验证。
    const byId = new Map(candidates.map((c) => [c.alert.id, c.alert.score as number]));
    expect(byId.get("plotline_gap:P03")!).toBeLessThan(byId.get("foreshadow_overdue:F02")!);

    const out = selectAlerts({ candidates, nextPlan: null }, a);
    expect(out.homepage[0]?.category).toBe("foreshadow_overdue");
    expect(out.homepage[1]?.category).toBe("plotline_gap");
    expect(out.homepage[2]?.category).toBe("foreshadow_overdue");
  });

  it("选择结果可复现（平手时按 id 定序）", () => {
    const candidates = computeAlerts(input({ foreshadows: manyForeshadows(6) }), rules);
    const first = selectAlerts({ candidates, nextPlan: null }, a).homepage.map((x) => x.id);
    const second = selectAlerts({ candidates, nextPlan: null }, a).homepage.map((x) => x.id);
    expect(first).toEqual(second);
  });

  it("homepage 是 fullList 的子集 —— 「另有 N 条」的计数不会打架", () => {
    const out = selectAlerts({ candidates: computeAlerts(input({ foreshadows: manyForeshadows(6) }), rules), nextPlan: null }, a);
    for (const h of out.homepage) expect(out.fullList.map((x) => x.id)).toContain(h.id);
  });
});

// ── 一键闭环 ────────────────────────────────────────────────────────────

describe("applyActionToBeat：一键写进节拍表（§12.6.7）", () => {
  const plainBeat = { ...beat, plan: emptyPlan, budget: null };

  it("加回收 → 节拍表多一条，预算重算且变宽", () => {
    // 闭环第二步：收一条主线伏笔要 +600~900 字，漏掉重算会让用户
    // 按了按钮却拿到旧的字数目标。
    const payoff = { ...plainBeat, plan: { ...emptyPlan, chapterType: "payoff" as const } };
    const before = applyActionToBeat(
      { beat: payoff, action: { kind: "acknowledge" }, profile: workProfile, now: NOW },
      rules,
    );
    expect(before.changed).toBe(false);

    const after = applyActionToBeat(
      {
        beat: payoff,
        action: { kind: "add_resolution_to_beat", targetChapter: 53, foreshadowId: "F07", weight: "main", completeness: "full" },
        profile: workProfile,
        now: NOW,
      },
      rules,
    );

    expect(after.changed).toBe(true);
    expect(after.beat.plan.resolves).toHaveLength(1);
    expect(after.beat.budget).not.toBeNull();
    expect(after.beat.budget!.words.min).toBeGreaterThan(0);
    expect(after.beat.provenance).toBe("authored");
    expect(after.beat.updatedAt).toBe(NOW);
  });

  describe("主线收束会把事件章升级为回收章", () => {
    // §12.6.7 承诺"回收主线伏笔 +600~900 字"，但 §10.4 只让回收章/高潮章
    // 计入收束成本。往事件章加收束若不改类型，预算一个字都不变 ——
    // 承诺的闭环是空的。见 apply.ts 的 typeAfterResolution。
    const action = {
      kind: "add_resolution_to_beat" as const,
      targetChapter: 53 as ChapterNo,
      foreshadowId: "F07" as const,
      weight: "main" as const,
      completeness: "full" as const,
    };

    it("事件章 + 主线收束 → payoff，且预算真的变宽", () => {
      const base = applyActionToBeat(
        { beat: plainBeat, action: { kind: "add_character_to_beat", targetChapter: 53, characterId: "C05" }, profile: workProfile, now: NOW },
        rules,
      );
      const promoted = applyActionToBeat({ beat: plainBeat, action, profile: workProfile, now: NOW }, rules);

      expect(promoted.promotedToPayoff).toBe(true);
      expect(promoted.beat.plan.chapterType).toBe("payoff");
      expect(promoted.beat.budget!.words.max).toBeGreaterThan(base.beat.budget!.words.max);
      // 至少要放宽到能装下一条主线收束的下限（§10.4 resolveCost.main）。
      const [lo] = rules.resolveCost.main;
      expect(promoted.beat.budget!.words.max - base.beat.budget!.words.max).toBeGreaterThanOrEqual(lo);
    });

    it("已是回收章/高潮章则不动类型", () => {
      for (const chapterType of ["payoff", "climax"] as const) {
        const out = applyActionToBeat(
          { beat: { ...plainBeat, plan: { ...emptyPlan, chapterType } }, action, profile: workProfile, now: NOW },
          rules,
        );
        expect(out.beat.plan.chapterType).toBe(chapterType);
        expect(out.promotedToPayoff).toBe(false);
      }
    });

    it("支线与细节收束不升级 —— 一句呼应不改变一章的性质", () => {
      for (const weight of ["sub", "detail"] as const) {
        const out = applyActionToBeat(
          { beat: plainBeat, action: { ...action, weight }, profile: workProfile, now: NOW },
          rules,
        );
        expect(out.beat.plan.chapterType).toBe("event");
        expect(out.promotedToPayoff).toBe(false);
      }
    });

    it("升级后 V2 不会因「回收章没有收束」而打回", () => {
      // 顺序上必须是"先加 resolves 再改类型"，否则 validatePlan 的
      // beat_payoff_without_resolution 会 block 一个刚被按钮改出来的节拍表。
      // 基础节拍表要带一个事件 —— 没有事件的事件章本身就会被 V2 打回
      // （beat_no_events），那样测的就不是升级这件事了。
      const withEvent = {
        ...plainBeat,
        plan: {
          ...emptyPlan,
          events: [{ kind: "action" as const, summary: "撬开密室", weight: 2 as const, plotLine: "P01" as const }],
        },
      };
      const out = applyActionToBeat({ beat: withEvent, action, profile: workProfile, now: NOW }, rules);
      expect(out.beat.plan.chapterType).toBe("payoff");
      expect(validatePlan(out.beat.plan, rules).filter((f) => f.level === "block")).toEqual([]);
    });

    it("升级后流程档位变严格（§12.8：回收章强制 strict）", () => {
      const out = applyActionToBeat({ beat: plainBeat, action, profile: workProfile, now: NOW }, rules);
      expect(out.beat.budget!.tier).toBe("strict");
    });
  });

  it("回收章的收束确实让预算变宽（§10.4 resolveCost 生效）", () => {
    const payoff = { ...plainBeat, plan: { ...emptyPlan, chapterType: "payoff" as const } };
    const base = applyActionToBeat(
      {
        beat: payoff,
        action: { kind: "add_character_to_beat", targetChapter: 53, characterId: "C05" },
        profile: workProfile,
        now: NOW,
      },
      rules,
    );
    const withResolve = applyActionToBeat(
      {
        beat: payoff,
        action: { kind: "add_resolution_to_beat", targetChapter: 53, foreshadowId: "F07", weight: "main", completeness: "full" },
        profile: workProfile,
        now: NOW,
      },
      rules,
    );
    expect(withResolve.beat.budget!.words.max).toBeGreaterThan(base.beat.budget!.words.max);
  });

  it("重复点同一个按钮不产生重复条目（连点会让预算凭空多算一次收束）", () => {
    const action = {
      kind: "add_resolution_to_beat" as const,
      targetChapter: 53 as ChapterNo,
      foreshadowId: "F07" as const,
      weight: "main" as const,
      completeness: "full" as const,
    };
    const once = applyActionToBeat({ beat: plainBeat, action, profile: workProfile, now: NOW }, rules);
    const twice = applyActionToBeat({ beat: once.beat, action, profile: workProfile, now: NOW }, rules);
    expect(twice.changed).toBe(false);
    expect(twice.beat.plan.resolves).toHaveLength(1);
  });

  it("加推进 → events 多一条，带占位文案与最低权重", () => {
    const out = applyActionToBeat(
      { beat: plainBeat, action: { kind: "add_advance_to_beat", targetChapter: 53, plotLine: "P03" }, profile: workProfile, now: NOW },
      rules,
    );
    const added = out.beat.plan.events[0];
    expect(added?.plotLine).toBe("P03");
    expect(added?.weight).toBe(1);
    expect(added?.summary).toContain("待填");
  });

  it("加出场 → characters 多一个", () => {
    const out = applyActionToBeat(
      { beat: plainBeat, action: { kind: "add_character_to_beat", targetChapter: 53, characterId: "C05" }, profile: workProfile, now: NOW },
      rules,
    );
    expect(out.beat.plan.characters).toContain("C05");
  });

  it("改期/废弃/静音不动节拍表（它们要么走事件流，要么只改告警状态）", () => {
    for (const action of [
      { kind: "reschedule" as const, foreshadowId: "F07" as const, expectedBy: 70 as ChapterNo },
      { kind: "abandon" as const, foreshadowId: "F07" as const },
      { kind: "confirm_exit" as const, characterId: "C05" as const },
      { kind: "open_view" as const, view: "plotline" as const },
    ]) {
      const out = applyActionToBeat({ beat: plainBeat, action, profile: workProfile, now: NOW }, rules);
      expect(out.changed).toBe(false);
      expect(out.beat).toBe(plainBeat);
    }
  });

  it("完整闭环：点按钮 → 改节拍表 → 告警消失", () => {
    const foreshadows = [openForeshadow({ id: "F07", expectedBy: 44 })];
    const candidates = computeAlerts(input({ foreshadows }), rules);
    const action = candidates[0]!.alert.actions.find((x) => x.kind === "add_resolution_to_beat")!;

    const applied = applyActionToBeat({ beat: plainBeat, action, profile: workProfile, now: NOW }, rules);
    const after = selectAlerts({ candidates, nextPlan: applied.beat.plan }, a);

    expect(after.homepage).toHaveLength(0);
    expect(after.suppressed.map((s) => s.reason)).toEqual(["scheduled"]);
  });
});

describe("告警状态的三个动作", () => {
  const id = "foreshadow_overdue:F07" as AlertId;

  it("忽略累加，且不封顶（真实次数是校准数据）", () => {
    let s = initialAlertState(id, NOW);
    for (let i = 0; i < a.fatigueDropAt + 3; i += 1) s = ignoreAlert(s);
    expect(s.fatigueCount).toBe(a.fatigueDropAt + 3);
  });

  it("静音与撤销静音", () => {
    const acked = acknowledgeAlert(ignoreAlert(initialAlertState(id, NOW)));
    expect(acked.acknowledged).toBe(true);
    const undone = unacknowledgeAlert(acked);
    expect(undone.acknowledged).toBe(false);
    expect(undone.fatigueCount).toBe(0);
  });
});
