import { describe, expect, it } from "vitest";
import { alertGroup, groupAlerts } from "../web/src/alert-browse.js";
import type { Alert, AlertEvidence } from "../web/src/alert-types.js";

const reminder: Alert = {
  id: "plotline_gap:P1", category: "plotline_gap", subject: { kind: "plotline", id: "P1" },
  title: "推进间隔", detail: "记录", direction: "forward", impact: 1, decay: 1, score: 1,
  fatigueCount: 0, acknowledged: false, migratedTo: null, actions: [{ kind: "acknowledge" }], createdAt: "", lastEvaluatedAt: "",
};
const complete: AlertEvidence = { source: null, pending: [], unrecorded: [] };
describe("提示分层与同一对象聚合", () => {
  it("记录间隔不等于正文错误，缺记录和失效出处优先核对", () => {
    expect(alertGroup(reminder)).toBe("structure");
    expect(alertGroup(reminder, { ...complete, pending: [5] })).toBe("coverage");
    expect(alertGroup(reminder, { ...complete, unrecorded: [6] })).toBe("coverage");
    expect(alertGroup(reminder, { ...complete, coverageKnown: false })).toBe("coverage");
    expect(alertGroup(reminder, { pending: [5], unrecorded: [], source: { chapter: 2, quote: "旧引文", status: "stale" } })).toBe("source");
    expect(alertGroup({ ...reminder, category: "setting_conflict" }, complete)).toBe("prose");
  });
  it("合并同一对象的阅读分组，不丢失不同提醒及各自操作", () => {
    const another = { ...reminder, id: "second", actions: [{ kind: "open_view" as const, view: "plotline" as const }] };
    const result = groupAlerts([reminder, another, reminder]);
    expect(result).toHaveLength(1);
    expect(result[0]?.count).toBe(2);
    expect(result[0]?.subjects).toEqual([[reminder, another]]);
    expect(result[0]?.subjects[0]?.[1]?.actions).toBe(another.actions);
  });
  it("不同对象不合并，分层不会重复计数", () => {
    const other = { ...reminder, id: "other", subject: { kind: "plotline" as const, id: "P2" } };
    const result = groupAlerts([reminder, other], { other: { ...complete, unrecorded: [3] } });
    expect(result.map(g => [g.kind, g.count])).toEqual([["coverage", 1], ["structure", 1]]);
  });
});
