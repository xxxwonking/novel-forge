import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AlertList } from "./AlertList.js";
import type { AlertsPayload } from "../api.js";

const state = vi.hoisted(() => ({ data: null as AlertsPayload | null }));
vi.mock("../hooks.js", () => ({
  useRouteActive: () => () => true,
  useFetch: () => ({ data: state.data, error: null, reload: () => {} }),
}));

describe("覆盖信息故障降级", () => {
  it("保留当前提示，未知覆盖不显示为零或已完成", () => {
    state.data = {
      homepage: [], repairQueue: [], suppressed: [], progress: [], coverage: null,
      coverageError: "结构提取进度暂时无法读取，覆盖情况未知。",
      fullList: [{ id: "gap:P01", category: "plotline_gap", subject: { kind: "plotline", id: "P01" }, title: "旧案推进待核对", detail: "上次记录在第 2 章", direction: "forward", impact: 1, decay: 1, score: 1, fatigueCount: 0, acknowledged: false, migratedTo: null, actions: [], createdAt: "", lastEvaluatedAt: "" }],
      evidence: { "gap:P01": { coverageKnown: false, source: null, unrecorded: [], pending: [] } },
    };
    const html = renderToStaticMarkup(createElement(AlertList, { onAction: () => {}, onIgnore: () => {}, onPlanningAction: () => {}, refreshKey: 0 }));
    expect(html).toContain("旧案推进待核对");
    expect(html).toContain("结构提取进度暂时无法读取");
    expect(html).toContain("当前无法判断记录是否齐全");
    expect(html).not.toContain("章已有正式结构");
    expect(html).not.toContain("相关章节中");
  });
});
