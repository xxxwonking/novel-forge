import { describe, expect, it } from "vitest";
import { buildPlotBoard, type PlotBoardInput } from "../src/view/plot-board.js";
import { EventStream } from "../src/store/event-stream.js";
import { loadRules } from "../src/rules/load.js";
import type { ChapterBeat } from "../src/types/beat.js";

const NOW = "2026-10-31T00:00:00.000Z";
const anchor = { chapter: 1201, quote: "钥匙交给了林舟。", offsetHint: 0, occurrence: 0 };
function fixture(): PlotBoardInput {
  const stream = new EventStream(() => NOW);
  for (const provenance of ["authored", "committed", "proposed", "rejected"] as const) {
    const e = stream.append({ chapter: 1201, provenance: provenance === "authored" ? provenance : "proposed", origin: "C5_declaration",
      payload: { type: "plot_event", kind: "resource", summary: provenance, weight: 2, plotLine: "P01", participants: ["C01"], anchor } });
    if (provenance === "committed" || provenance === "rejected") stream.decide(e.envelope.id, provenance);
  }
  stream.append({ chapter: 1201, provenance: "authored", origin: "P4_outline", payload: { type: "plot_event", kind: "info", summary: "旧的规划事件", weight: 1, plotLine: "P01", participants: [], anchor } });
  stream.append({ chapter: 1203, provenance: "authored", origin: "user_edit", payload: { type: "plot_event", kind: "info", summary: "无出处也保留", weight: 1, plotLine: null, participants: ["C99"], anchor: { ...anchor, chapter: 1203 } } });
  return { events: stream.all(), beats: [], currentChapter: 1201,
    plotLines: [{ id: "P01", label: "主线", weight: "main" }], characters: [{ id: "C01", name: "林舟" }],
    text: (n) => n === 1201 ? anchor.quote : undefined };
}
function beat(chapter: number, provenance: ChapterBeat["provenance"] = "authored"): ChapterBeat {
  return { chapter, volume: 2, provenance, updatedAt: NOW, budget: null, plan: {
    chapterType: "event", coreEvent: "找到失踪者", secondaryThread: null, stageFeedback: "找到失踪者", hook: "门后传来敲击", characters: ["C01"], locations: [], resolves: [], plants: [],
    events: [{ kind: "info", summary: "发现新的证词", weight: 2, plotLine: "P01" }],
  } };
}
const build = (over: Partial<PlotBoardInput> = {}) => buildPlotBoard({ ...fixture(), ...over }, loadRules().anchor);

describe("剧情白板读模型", () => {
  it("只展示已确认事实，包含未分线事件和真实人物名，计划来源不冒充正文", () => {
    const board = build();
    expect(board.nodes.map(n => n.summary)).toEqual(["authored", "committed", "无出处也保留"]);
    expect(board.nodes[0]?.characters).toEqual([{ id: "C01", name: "林舟" }]);
    expect(board.nodes[2]?.characters).toEqual([{ id: "C99", name: "C99" }]);
    expect(board.groups.at(-1)?.id).toBe("unassigned");
    expect(board.nodes[0]?.point?.resolution.status).toBe("exact");
    expect(board.nodes[2]?.point?.resolution.status).toBe("stale");
  });
  it("只展示已确认未来章计划，过滤已写章、候选方案与旧计划，不伪造锚点", () => {
    const board = build({ beats: [beat(1), beat(1201), beat(1300), beat(1301, "committed"), beat(1302, "proposed"), beat(1303, "rejected")] });
    const plans = board.nodes.filter(n => n.status === "planned");
    expect(plans.map(n => n.chapter)).toEqual([1300, 1301]);
    expect(plans.every(n => n.point === null && n.source === "章计划")).toBe(true);
    expect(plans[0]?.volume).toBe(2);
  });
  it("不预设章数，保留超过 1000 章与稀疏章号；同线只建立时序边", () => {
    const board = build({ beats: [beat(5000)] });
    expect(board.nodes.map(n => n.chapter)).toEqual([1201, 1201, 1203, 5000]);
    expect(board.edges).toHaveLength(2);
    expect(board.edges.every(e => e.kind === "sequence")).toBe(true);
    expect(new Set(board.nodes.map(n => n.id)).size).toBe(board.nodes.length);
  });
  it("同一计划的 ID 可恢复；内容变化不复用旧位置，更新时间变化不改变 ID", () => {
    const b = beat(1300);
    const id = build({ beats: [b] }).nodes.at(-1)!.id;
    expect(build({ beats: [{ ...b, updatedAt: "2027-01-01T00:00:00.000Z" }] }).nodes.at(-1)!.id).toBe(id);
    expect(build({ beats: [{ ...b, plan: { ...b.plan, events: [{ ...b.plan.events[0]!, summary: "不同的剧情" }] } }] }).nodes.at(-1)!.id).not.toBe(id);
  });
  it("没有分事件的未来章计划也可浏览核心事件，空作品返回空画布", () => {
    const b = beat(2000);
    expect(build({ beats: [{ ...b, plan: { ...b.plan, events: [] } }] }).nodes.at(-1)?.summary).toBe(b.plan.coreEvent);
    expect(build({ events: [], beats: [], plotLines: [] })).toEqual({ groups: [], nodes: [], edges: [] });
  });
});
