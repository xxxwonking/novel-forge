import { describe, expect, it, vi } from "vitest";
import { alertEvidence, structureCoverage } from "../src/alerts/evidence.js";
import { loadRules } from "../src/rules/load.js";
import type { Alert } from "../src/types/projections.js";
import { asDerived } from "./fixtures.js";

const rules = loadRules();
const anchor = { chapter: 2, quote: "他收起了旧信。", offsetHint: 0, occurrence: 0 };
const alert: Alert = {
  id: "anchor:2", category: "anchor_stale", direction: "backward",
  title: "核对旧信", detail: "测试记录", subject: { kind: "anchor", anchor },
  impact: asDerived(2), decay: asDerived(1), score: asDerived(2),
  fatigueCount: 0, acknowledged: false, migratedTo: null, actions: [], createdAt: "", lastEvaluatedAt: "",
};
const projections = { foreshadows: [], plotLines: [], arcs: [] };

describe("结构提示的来源与覆盖", () => {
  it("分别计数正式记录、待确认和缺记录，跳过与失败不算完成", () => {
    expect(structureCoverage([
      { chapter: 1, state: "written" }, { chapter: 2, state: "confirmed" },
      { chapter: 3, state: "pending" }, { chapter: 4, state: "none" },
      { chapter: 5, state: "failed" }, { chapter: 6, state: "skipped" }, { chapter: 7, state: "problem" },
    ])).toEqual({ total: 7, recorded: 2, pending: 1, unrecorded: 4 });
    expect(structureCoverage([])).toEqual({ total: 0, recorded: 0, pending: 0, unrecorded: 0 });
  });
  it("只计相关已存在章节，核对引文但不修改提醒", () => {
    const before = JSON.stringify(alert);
    const read = vi.fn(() => anchor.quote);
    const result = alertEvidence([alert, { ...alert, id: "other" }], projections, [
      { chapter: 1, state: "none" }, { chapter: 2, state: "confirmed" },
      { chapter: 5, state: "pending" }, { chapter: 8, state: "none" },
    ], read, rules.anchor);
    expect(result[alert.id]).toEqual({ coverageKnown: true, source: { chapter: 2, quote: anchor.quote, status: "exact" }, pending: [5], unrecorded: [8] });
    expect(read).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(alert)).toBe(before);
  });
  it("正文改写或缺失时保留旧引文并标记失效，移位仍可定位", () => {
    for (const text of [undefined, "信件内容已经改写。"])
      expect(alertEvidence([alert], projections, [], () => text, rules.anchor)[alert.id]?.source?.status).toBe("stale");
    expect(alertEvidence([alert], projections, [], () => "序".repeat(rules.anchor.shiftTolerance + 10) + anchor.quote, rules.anchor)[alert.id]?.source?.status).toBe("shifted");
  });
});
