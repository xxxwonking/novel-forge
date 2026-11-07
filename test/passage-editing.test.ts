import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handleAsync } from "../src/server/api.js";
import { draftRevisionToken, stableFingerprint } from "../src/task/revision.js";
import { fakeClient, modelText, NO_MODEL_REVIEW, writingSnapshot } from "./writing-fixtures.js";
import type { ChapterDraft } from "../src/task/types.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const body = "雨落下来。\n\n他没有回答。\n\n雨落下来。\n门外的脚步停了。";
const replacement = "雨水沿着门缝渗进来。";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nf-passage-edit-")); roots.push(root);
  const store = new ProjectStore(root);
  store.save({ ...writingSnapshot(), beats: [], chapters: new Map([[175, body], [176, "后续章节。"]]) });
  const model = fakeClient([modelText(JSON.stringify({ events: [], character_states: [], relations_changed: [], foreshadow_planted: [], foreshadow_resolved: [], character_presence: [] }))]);
  const session = new ProjectSession(root, NO_MODEL_REVIEW, { client: model.client });
  const send = (path: string, data: unknown) => handleAsync(session, { method: "POST", path, body: data, query: new URLSearchParams() });
  const input = { chapter: 175, sourceToken: stableFingerprint(body), start: body.lastIndexOf("雨落下来。"), quote: "雨落下来。", replacement, requestId: "replace-1" };
  return { root, store, session, model, send, input };
}

it("无计划导入章精确替换第二处选段并保存版本，重试幂等且正式原文不变", async () => {
  const { session, model, send, input } = fixture();
  const result = await send("/api/passage/apply", input);
  expect(result.status, JSON.stringify(result.body)).toBe(200);
  const draft = result.body as ChapterDraft;
  expect(draft.body).toBe(body.slice(0, input.start) + replacement + body.slice(input.start + input.quote.length));
  expect(draft.status).toBe("pending_check");
  expect(session.getDraft(175, draft.revision!.sourceDraftId)?.body).toBe(body);
  expect(session.readCurrentChapterText(175)).toBe(body);
  expect(session.meta.beats).toEqual([]);
  expect(model.calls).toHaveLength(0);
  expect((await send("/api/passage/apply", input)).body).toMatchObject({ draftId: draft.draftId });
  expect(session.listDrafts(175)).toHaveLength(2);
  expect((await send("/api/passage/apply", { ...input, replacement: "另一个版本。" })).status).toBe(409);
});

it.each([{ change: { sourceToken: "0".repeat(64) }, status: 409 }, { change: { quote: "不匹配" }, status: 409 }, { change: { start: -1 }, status: 400 }, { change: { replacement: "" }, status: 400 }])("冲突或无效请求不产生任何稿件 %j", async ({ change, status }) => {
  const { session, send, input } = fixture();
  expect((await send("/api/passage/apply", { ...input, ...change })).status).toBe(status);
  expect(session.listDrafts(175)).toEqual([]);
});

it("草稿候选的正式来源变化后不能通过应用段落悄悄重置依据", async () => {
  const { store, session, send, input } = fixture();
  const result = await send("/api/passage/apply", input);
  const draft = result.body as ChapterDraft & { revisionToken: string };
  store.save({ ...writingSnapshot(), beats: [], chapters: new Map([[175, body + "新句。"], [176, "后续章节。"]]) });
  const response = await send("/api/passage/apply", { ...input, draftId: draft.draftId, revisionToken: draft.revisionToken,
    sourceToken: stableFingerprint(draft.body), start: 0, quote: "雨落下来。", requestId: "draft-selection" });
  expect(response.status).toBe(409);
  expect(session.listDrafts(175)).toHaveLength(2);
});

it("无计划旧章可只检查，不生成正文；显式采用后才更新且保留原始版本", async () => {
  const { session, send, input, model } = fixture();
  const saved = await send("/api/passage/apply", input);
  expect(saved.status, JSON.stringify(saved.body)).toBe(200);
  const draft = saved.body as ChapterDraft & { revisionToken: string };
  const response = await send("/api/chapter/check", { chapter: 175, draftId: draft.draftId, revisionToken: draft.revisionToken, adoptOnSuccess: false });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const checked = await session.writeChapter({ chapter: 175, draftId: draft.draftId });
  expect(checked.status, JSON.stringify(checked.error)).toBe("ready");
  expect(checked.findings.some(f => f.rule === "plan_unavailable")).toBe(true);
  expect(model.calls).toHaveLength(1);
  expect(session.readCurrentChapterText(175)).toBe(body);
  session.adopt(175, checked.draftId, { revisionToken: draftRevisionToken(checked) });
  expect(session.readCurrentChapterText(175)).toBe(draft.body);
  expect(session.getDraft(175, draft.revision!.sourceDraftId)?.body).toBe(body);
});

it("保存候选后正式原文外部变化，拒绝基于旧来源检查", async () => {
  const { store, send, input } = fixture();
  const result = await send("/api/passage/apply", input);
  expect(result.status).toBe(200);
  const draft = result.body as ChapterDraft & { revisionToken: string };
  store.save({ ...writingSnapshot(), beats: [], chapters: new Map([[175, body + "新句。"], [176, "后续章节。"]]) });
  expect((await send("/api/chapter/check", { chapter: 175, draftId: draft.draftId, revisionToken: draft.revisionToken, adoptOnSuccess: false })).status).toBe(409);
});
