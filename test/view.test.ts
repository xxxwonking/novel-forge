/**
 * 四视图 view-model（§12.3、M3）。
 *
 * 产品前提是「作者不读正文」，所以这一层的正确性标准是：**图上能看出问题、
 * 每个元素都能点回原文。** 测试按这两条组织 —— 区间（逾期段/断线段/缺席段）
 * 与锚点解析。
 */

import { describe, expect, it } from "vitest";
import { buildViewModel, type BuildViewInput } from "../src/view/models.js";
import { textSourceOf } from "../src/anchor/resolve.js";
import { loadRules } from "../src/rules/load.js";
import { asDerived, foreshadows, plotLines } from "./fixtures.js";
import type { ChapterNo, TextAnchor } from "../src/types/primitives.js";
import type { CharacterArc, PlotLineTrack, RelationEdge } from "../src/types/projections.js";

const rules = loadRules().anchor;

const CH5 = "他把那把生锈的钥匙塞回怀里，站起身。";
const CH12 = "信纸边角被烧去一块，剩下的字迹还认得出。";

function anchor(chapter: ChapterNo, quote: string, offsetHint = 0): TextAnchor {
  return { chapter, quote, offsetHint, occurrence: 0 };
}

const texts = new Map<ChapterNo, string>([
  [5, CH5],
  [12, CH12],
]);

function input(over: Partial<BuildViewInput> = {}): BuildViewInput {
  return {
    currentChapter: 52,
    foreshadows: [],
    plotLines: [],
    arcs: [],
    relations: [],
    text: textSourceOf(texts),
    ...over,
  };
}

function arc(over: Partial<CharacterArc> & { characterId: CharacterArc["characterId"] }): CharacterArc {
  return {
    name: "苏晚晴",
    tier: "major",
    introducedAt: 3,
    lastSeenAt: 26,
    presence: [
      { chapter: 3, role: "minor" },
      { chapter: 26, role: "major" },
    ],
    turningPoints: [],
    ...over,
  };
}

describe("横轴", () => {
  it("上界取「当前章」与「最远期限」的较大者", () => {
    // 期限排在未来的伏笔必须在轴上有位置，否则"还有 5 章到期"在图上看不见 ——
    // 而那恰好是最该提前看到的。
    const vm = buildViewModel(input({ currentChapter: 52, foreshadows }), rules);
    expect(vm.axis.from).toBe(1);
    expect(vm.axis.current).toBe(52);
    expect(vm.axis.to).toBe(Math.max(52, ...foreshadows.map((f) => f.expectedBy)));
  });

  it("没有伏笔时上界就是当前章", () => {
    expect(buildViewModel(input({ currentChapter: 7 }), rules).axis.to).toBe(7);
  });
});

describe("视图一：伏笔时间线", () => {
  it("埋点锚点被解析，能点回原文", () => {
    const vm = buildViewModel(input({ foreshadows }), rules);
    const f03 = vm.foreshadows.find((x) => x.id === "F03")!;
    const r = f03.planted.resolution;

    // fixture 的 offsetHint 是 1840（真实长章里的位置），而测试正文是短片段，
    // 所以这里必然判 shifted —— 那正是"作者删掉了前面大段内容"的形状。
    // 视图层要的只是"能定位"，exact 与 shifted 都算能点。
    expect(r.status).toBe("shifted");
    if (r.status === "stale") return;
    expect(CH5.slice(r.offset, r.offset + r.length)).toBe(f03.planted.anchor.quote);
  });

  it("正文缺失时降级为 stale 而不是丢掉这条伏笔", () => {
    const vm = buildViewModel(input({ foreshadows, text: () => undefined }), rules);
    expect(vm.foreshadows).toHaveLength(foreshadows.length);
    expect(vm.foreshadows[0]?.planted.resolution.status).toBe("stale");
  });

  it("逾期段只覆盖「期限 → 当前章」，供前端单独上色", () => {
    const vm = buildViewModel(input({ currentChapter: 52, foreshadows }), rules);
    const f11 = vm.foreshadows.find((x) => x.id === "F11")!;
    expect(f11.overdueSpan).toEqual({ from: 38, to: 52 });
  });

  it("未逾期与已收束的伏笔没有逾期段", () => {
    const vm = buildViewModel(input({ currentChapter: 52, foreshadows }), rules);
    expect(vm.foreshadows.find((x) => x.id === "F03")?.overdueSpan).toBeNull();
    expect(vm.foreshadows.find((x) => x.id === "F02")?.overdueSpan).toBeNull();
  });

  it("收束点带完整度与锚点", () => {
    const vm = buildViewModel(input({ foreshadows }), rules);
    const f02 = vm.foreshadows.find((x) => x.id === "F02")!;
    expect(f02.resolutions).toHaveLength(1);
    expect(f02.resolutions[0]?.completeness).toBe("full");
    expect(f02.resolutions[0]?.point.chapter).toBe(40);
  });

  it("轨道装箱：时间跨度不重叠的伏笔共用一条轨道", () => {
    const early = { ...foreshadows[3]!, id: "F01" as const, plantedAt: 1, expectedBy: 5, status: "resolved" as const, resolutions: [{ chapter: 5, completeness: "full" as const, anchor: anchor(5, "他把那把生锈的钥匙塞回怀里") }] };
    const late = { ...foreshadows[0]!, id: "F09" as const, plantedAt: 20, expectedBy: 60 };
    const vm = buildViewModel(input({ foreshadows: [early, late] }), rules);
    expect(vm.foreshadows.map((x) => x.lane)).toEqual([0, 0]);
  });

  it("时间跨度重叠时分到不同轨道", () => {
    const vm = buildViewModel(input({ foreshadows }), rules);
    const open = vm.foreshadows.filter((x) => x.status === "open");
    expect(new Set(open.map((x) => x.lane)).size).toBe(open.length);
  });

  it("轨道分配可复现", () => {
    const first = buildViewModel(input({ foreshadows }), rules).foreshadows.map((x) => [x.id, x.lane]);
    const second = buildViewModel(input({ foreshadows }), rules).foreshadows.map((x) => [x.id, x.lane]);
    expect(first).toEqual(second);
  });
});

describe("视图二：情节线", () => {
  it("带上投影算好的断线阈值，供前端画参考线", () => {
    const vm = buildViewModel(input({ plotLines }), rules);
    expect(vm.plotTracks.map((t) => t.gapLimit)).toEqual([3, 12, 12]);
  });

  it("断线段覆盖「上次推进 → 当前章」", () => {
    const vm = buildViewModel(input({ currentChapter: 52, plotLines }), rules);
    expect(vm.plotTracks.find((t) => t.id === "P03")?.gapSpan).toEqual({ from: 30, to: 52 });
  });

  it("刚推进过的线没有断线段", () => {
    const vm = buildViewModel(input({ currentChapter: 52, plotLines }), rules);
    expect(vm.plotTracks.find((t) => t.id === "P01")?.gapSpan).toBeNull();
  });

  it("从未推进过的线也没有断线段（它还没开始）", () => {
    const virgin: PlotLineTrack = {
      id: "P09",
      label: "尚未展开的线",
      weight: "sub",
      gapLimit: asDerived(12),
      lastAdvancedAt: 0,
      currentGap: asDerived(52),
      points: [],
    };
    expect(buildViewModel(input({ plotLines: [virgin] }), rules).plotTracks[0]?.gapSpan).toBeNull();
  });

  it("规划态标记透传（前端画虚线）", () => {
    const withNode: PlotLineTrack = {
      ...plotLines[0]!,
      points: [
        {
          chapter: 52,
          eventId: "ch52-1",
          summary: "已写的推进",
          weight: 2,
          kind: "action",
          anchor: anchor(5, "他把那把生锈的钥匙塞回怀里"),
          planned: false,
        },
        {
          chapter: 53,
          eventId: "ch53-1",
          summary: "排了还没写",
          weight: 1,
          kind: "action",
          anchor: anchor(53, "尚未存在的正文"),
          planned: true,
        },
      ],
    };
    const nodes = buildViewModel(input({ plotLines: [withNode] }), rules).plotTracks[0]!.nodes;
    expect(nodes.map((n) => n.planned)).toEqual([false, true]);
    // 规划态的锚点必然 stale —— 正文还不存在。前端据此不给点击。
    expect(nodes[1]?.point.resolution.status).toBe("stale");
  });
});

describe("视图三：人物弧线", () => {
  it("出场是稀疏数组，不是逐章矩阵", () => {
    const vm = buildViewModel(input({ arcs: [arc({ characterId: "C05" })] }), rules);
    expect(vm.arcs[0]?.presence.map((p) => p.chapter)).toEqual([3, 26]);
  });

  it("缺席段覆盖「末次出场 → 当前章」", () => {
    const vm = buildViewModel(input({ currentChapter: 52, arcs: [arc({ characterId: "C05" })] }), rules);
    expect(vm.arcs[0]?.absenceSpan).toEqual({ from: 26, to: 52 });
  });

  it("本章出场的角色没有缺席段", () => {
    const vm = buildViewModel(
      input({ currentChapter: 52, arcs: [arc({ characterId: "C01", lastSeenAt: 52, presence: [{ chapter: 52, role: "pov" }] })] }),
      rules,
    );
    expect(vm.arcs[0]?.absenceSpan).toBeNull();
  });

  it("从未出场的卡没有缺席段（不是消失，是还没登场）", () => {
    const vm = buildViewModel(input({ arcs: [arc({ characterId: "C08", presence: [], lastSeenAt: 0 })] }), rules);
    expect(vm.arcs[0]?.absenceSpan).toBeNull();
  });

  it("转折点带锚点，能点回那一段", () => {
    const vm = buildViewModel(
      input({
        arcs: [
          arc({
            characterId: "C05",
            turningPoints: [
              { chapter: 12, field: "condition", from: "健康", to: "重伤", anchor: anchor(12, "信纸边角被烧去一块") },
            ],
          }),
        ],
      }),
      rules,
    );
    expect(vm.arcs[0]?.turningPoints[0]?.point.resolution.status).toBe("exact");
  });
});

describe("视图四：关系图", () => {
  const edges: readonly RelationEdge[] = [
    {
      from: "C01",
      to: "C05",
      kind: "ally",
      note: "并肩挡下血刀客",
      changedAt: 12,
      anchor: anchor(12, "信纸边角被烧去一块"),
      history: [
        { chapter: 3, kind: "acquaintance", note: "同门旧识" },
        { chapter: 12, kind: "ally", note: "并肩挡下血刀客" },
      ],
    },
  ];

  it("节点的 degree 由代码数好，前端不必自己算", () => {
    const vm = buildViewModel(
      input({ relations: edges, arcs: [arc({ characterId: "C01" }), arc({ characterId: "C05" })] }),
      rules,
    );
    expect(vm.relations.nodes.map((n) => [n.id, n.degree])).toEqual([
      ["C01", 1],
      ["C05", 1],
    ]);
  });

  it("没有关系边的角色不进关系图", () => {
    const vm = buildViewModel(
      input({ relations: edges, arcs: [arc({ characterId: "C01" }), arc({ characterId: "C05" }), arc({ characterId: "C09" })] }),
      rules,
    );
    expect(vm.relations.nodes.map((n) => n.id)).not.toContain("C09");
  });

  it("边带 historyCount，>1 时前端可展开沿革", () => {
    const vm = buildViewModel(input({ relations: edges, arcs: [arc({ characterId: "C01" })] }), rules);
    expect(vm.relations.edges[0]?.historyCount).toBe(2);
    expect(vm.relations.edges[0]?.history).toHaveLength(2);
  });

  it("边的锚点被解析", () => {
    const vm = buildViewModel(input({ relations: edges, arcs: [] }), rules);
    expect(vm.relations.edges[0]?.point.resolution.status).toBe("exact");
  });
});
