import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectStore, type ProjectSnapshot } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handle } from "../src/server/api.js";
import { EventStream } from "../src/store/event-stream.js";
import { fakeClient, writingSnapshot, NO_MODEL_REVIEW } from "./writing-fixtures.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function fixture(overrides: Partial<ProjectSnapshot> = {}) {
  const root = mkdtempSync(join(tmpdir(), "nf-health-")); roots.push(root);
  const store = new ProjectStore(root);
  store.save({ ...writingSnapshot(), ...overrides });
  const model = fakeClient([]);
  const session = new ProjectSession(root, NO_MODEL_REVIEW, { client: model.client });
  const health = (chapter: number) => handle(session, { method: "GET", path: "/api/health", query: new URLSearchParams({ n: String(chapter) }), body: undefined });
  return { store, model, health };
}
it("导入正文没有计划仍运行文本规则，缺少预算和结构数据不会误报", () => {
  const text = "他瞳孔骤缩。".repeat(12);
  const { store, model, health } = fixture({ beats: [], events: [], chapters: new Map([[175, text]]) });
  const before = store.load();
  const result = health(175);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ chapterGate: null, unavailable: { plan: expect.any(String), density: expect.any(String), crossChapter: expect.any(String) }, textGate: { words: 60, findings: expect.arrayContaining([expect.objectContaining({ rule: "fatigue_word_over" })]) } });
  expect(JSON.stringify(result.body)).not.toContain('"density_under"');
  expect(JSON.stringify(result.body)).not.toContain('"word_count_under"');
  expect(store.load()).toEqual(before); expect(model.calls).toHaveLength(0);
});
it("有计划但无正文事件记录仍检查预算，不把未知事件密度显示为零", () => {
  const { health } = fixture({ events: [] });
  expect(health(2).body).toMatchObject({ chapterGate: { density: null, findings: expect.arrayContaining([expect.objectContaining({ rule: "word_count_under" })]) }, unavailable: { plan: null, density: expect.any(String) } });
  expect(JSON.stringify(health(2).body)).not.toContain('"density_under"');
});
it("无计划章仍使用已确认结构记录；较早章节不读取未来的伏笔兑现", () => {
  const stream = EventStream.restore(writingSnapshot().events);
  stream.append({ chapter: 2, origin: "C5_declaration", provenance: "authored", payload: { type: "foreshadow_resolved", foreshadowId: "F01", completeness: "full", anchor: { chapter: 2, quote: "密库", occurrence: 0, offsetHint: 0 } } });
  const { health } = fixture({ beats: [], events: stream.all() });
  expect(health(1).body).toMatchObject({ unavailable: { crossChapter: null }, crossChapter: expect.arrayContaining([expect.objectContaining({ rule: "foreshadow_due_soon" })]) });
});
it("无正文无计划才返回404，仅有计划仍给规划检查", () => {
  const { health } = fixture();
  expect(health(175).status).toBe(404);
  expect(health(3)).toMatchObject({ status: 200, body: { textGate: null, chapterGate: null, unavailable: { plan: null } } });
});
