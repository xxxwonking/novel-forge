import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlotBoardDetails } from "./PlotBoard.js";
import type { PlotBoardNode } from "../api.js";

const node: PlotBoardNode = { id: "e1", groupId: "P01", chapter: 1500, volume: null, kind: "info", summary: "发现证词", status: "written", source: "作者标注", characters: [{ id: "C01", name: "林舟" }],
  point: { chapter: 1500, anchor: { chapter: 1500, quote: "证词就在门后", offsetHint: 0, occurrence: 0 }, resolution: { status: "exact", offset: 0, length: 6 } } };
const html = (n: PlotBoardNode) => renderToStaticMarkup(createElement(PlotBoardDetails, { node: n, groupLabel: "调查主线", onJump: () => {}, onClose: () => {} }));
describe("白板详情的来源与原文入口", () => {
  it("只有能定位的正文事实提供原文跳转", () => {
    expect(html(node)).toContain("打开原文");
    expect(html(node)).toContain("林舟");
    const stale = html({ ...node, point: { ...node.point!, resolution: { status: "stale", reason: "quote_not_found" } } });
    expect(stale).toContain("原文已变动");
    expect(stale).not.toContain(">打开原文<");
  });
  it("未来计划明确标记来源，没有原文按钮和伪造引文", () => {
    const plan = html({ ...node, status: "planned", source: "章计划", point: null });
    expect(plan).toContain("未来计划");
    expect(plan).toContain("章计划");
    expect(plan).not.toContain("打开原文");
    expect(plan).not.toContain("证词就在门后");
  });
});
