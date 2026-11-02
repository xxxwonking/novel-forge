import { DraftStore } from "../src/task/draft-store.js";
import { draftRevisionToken } from "../src/task/revision.js";
import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { handleAsync } from "../src/server/api.js";
import { fakeClient, modelText, writingSnapshot, savedDraft, NO_MODEL_REVIEW } from "./writing-fixtures.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
const body = "雨落下来。\n\n他没有回答。\n\n雨落下来。\n门外的脚步停了。";
function fixture(results = [modelText("建议：先写动作，再收束情绪。")]) {
  const root = mkdtempSync(join(tmpdir(), "nf-passage-")); roots.push(root);
  const store = new ProjectStore(root);
  store.save({ ...writingSnapshot(), beats: [], chapters: new Map([[175, body]]) });
  const model = fakeClient(results);
  const session = new ProjectSession(root, NO_MODEL_REVIEW, { client: model.client });
  const ask = (data: unknown) => handleAsync(session, { method: "POST", path: "/api/passage/assist", query: new URLSearchParams(), body: data });
  return { root, store, session, model, ask };
}
const request = { chapter: 175, start: body.lastIndexOf("雨落下来。"), quote: "雨落下来。", instruction: "润色这段，保留事实", history: [] };
it("无需选段即可围绕当前章节提问，默认附带本章正文且不修改它", async () => {
  const { ask, model, session } = fixture();
  expect(await ask({ chapter: 175, instruction: "这一章节奏怎么样？", history: [] })).toMatchObject({ status: 200, body: { contextTruncated: false } });
  const sent = JSON.stringify(model.calls[0]);
  expect(sent).toContain("门外的脚步停了");
  expect(sent).toContain("他没有回答");
  expect(model.calls[0]?.tools).toBeUndefined();
  expect(session.readCurrentChapterText(175)).toBe(body);
});
it("长章仅附首尾并明确告知上下文省略，不冒充全章读取", async () => {
  const { ask, store, model } = fixture();
  store.save({ ...writingSnapshot(), beats: [], chapters: new Map([[175, "开头" + "字".repeat(30000) + "结尾"]]) });
  expect((await ask({ chapter: 175, instruction: "分析本章", history: [] })).body).toMatchObject({ contextTruncated: true });
  const sent = JSON.stringify(model.calls[0]);
  expect(sent).toContain("开头"); expect(sent).toContain("结尾");
  expect(sent.length).toBeLessThan(26000);
});
it("无章节计划也可讨论第2处原文，附上下文且不提供工具、不修改正文", async () => {
  const { ask, session, model } = fixture();
  const before = JSON.stringify(session.events());
  const result = await ask(request);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ text: "建议：先写动作，再收束情绪。", truncated: false, stale: false });
  expect(model.calls).toHaveLength(1);
  expect(model.calls[0]?.tools).toBeUndefined();
  expect(model.calls[0]?.purpose).toBe("passage_assist");
  const input = JSON.stringify(model.calls[0]);
  expect(input).toContain("门外的脚步停了"); expect(input).toContain("他没有回答");
  expect(input).toContain(String(request.start));
  expect(session.readCurrentChapterText(175)).toBe(body); expect(JSON.stringify(session.events())).toBe(before);
});
it.each([
  { ...request, quote: "不存在的文字" }, { ...request, start: -1 },
  { ...request, start: 0.5 }, { ...request, instruction: "" },
  { ...request, history: [{ role: "system", text: "越权" }] },
  { ...request, quote: "字".repeat(12001) },
  { ...request, quote: undefined }, { ...request, start: undefined },
])("错误输入不会调用模型 %j", async data => {
  const { ask, model } = fixture(); const result = await ask(data);
  expect(result.status).toBeGreaterThanOrEqual(400); expect(model.calls).toHaveLength(0);
});
it("截断文本作为未完成建议返回，不冒充完整改写", async () => {
  const response = modelText("未完成的替代段落");
  if (response.kind !== "ok") throw new Error("fixture");
  const { ask } = fixture([{ kind: "max_tokens", message: response.message }]);
  expect((await ask(request)).body).toMatchObject({ truncated: true, text: "未完成的替代段落" });
});

it("草稿使用明确版本，过期凭据拒绝而当前片段可讨论", async () => {
  const { root, ask, model } = fixture();
  const draft = savedDraft({ body, status: "writing" });
  new DraftStore(root).saveDraft(draft);
  const payload = { ...request, chapter: 3, draftId: draft.draftId, revisionToken: draftRevisionToken(draft) };
  expect((await ask({ ...payload, revisionToken: "0".repeat(64) })).status).toBe(409);
  expect(model.calls).toHaveLength(0);
  expect((await ask(payload)).status).toBe(200);
  expect(new DraftStore(root).loadDraft(3, draft.draftId)?.body).toBe(body);
});
it("返回时原文已更新，明确标记建议的来源过时", async () => {
  const { ask, store, model } = fixture();
  const call = model.client.call.bind(model.client);
  model.client.call = async options => {
    store.save({ ...writingSnapshot(), beats: [], chapters: new Map([[175, body + "后续新句。"]]) });
    return call(options);
  };
  expect((await ask(request)).body).toMatchObject({ stale: true });
});
it("模型拒绝或连接错误不伪装成功", async () => {
  const { ask, model } = fixture([{ kind: "error", error: { type: "connection", status: null, message: "测试中转断开", retryable: true } }]);
  expect(await ask(request)).toMatchObject({ status: 502, body: { error: expect.stringContaining("测试中转断开") } });
  expect(model.calls).toHaveLength(1);
});
