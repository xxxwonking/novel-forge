import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import { handle, handleAsync } from "../src/server/api.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import { buildChapterReadSource } from "../src/server/chapter-input.js";
import type { ChapterDraft } from "../src/task/types.js";
import type { ModelClient } from "../src/client/model.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, WRITE_BEAT, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type View = ChapterDraft & { revisionToken: string };
const selected = "我要直接答应。";
const replacement = "李长风没有立刻答应，先让血刀客交出能证明诚意的信物。";
const request = (body: unknown) => ({ method: "POST", path: "/api/chapter/revise", body, query: new URLSearchParams() });
const rewritten = (text = replacement): CallResult => modelText(JSON.stringify({ decision: "apply", replacement: text, summary: "增加一轮试探，结尾保持不变", scopeAdvice: "" }));

function fixture(client: ModelClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-rewrite-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const session = new ProjectSession(root, NO_MODEL_REVIEW, { client });
  const store = new DraftStore(root);
  const words = deriveBudget(WRITE_BEAT.plan, session.meta.profile, session.rules).words.sweet;
  const passage = `${PROSE}\n开头仍然保留。${selected}结尾仍然保留。\n`;
  const body = passage + "风".repeat(words - countWords(passage));
  store.saveDraft(savedDraft({ body }));
  return { root, session, store, body };
}
function view(session: ProjectSession, draftId = "ch3d1"): View {
  const response = handle(session, { method: "GET", path: "/api/chapter/draft", body: undefined, query: new URLSearchParams({ n: "3", id: draftId }) });
  expect(response.status).toBe(200);
  return response.body as View;
}
function payload(session: ProjectSession, overrides: Record<string, unknown> = {}) {
  return { chapter: 3, draftId: "ch3d1", revisionToken: view(session).revisionToken, mode: "rewrite", instruction: "增加一轮试探，结尾不变", scope: { quote: selected }, requestId: "rewrite-once", ...overrides };
}
async function start(session: ProjectSession, input: unknown): Promise<View> {
  const response = await handleAsync(session, request(input));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as View;
}
const finish = (session: ProjectSession, draft: ChapterDraft) => session.writeChapter({ chapter: draft.chapter, draftId: draft.draftId });

describe("模型局部修订与片段续写", () => {
  it("只替换精确范围，完整新正文进入 C5，保留真实响应且不自动采用", async () => {
    const response = modelMessage([{ type: "thinking", thinking: "保留外部范围", signature: "original-thinking-signature" }, { type: "text", text: JSON.stringify({ decision: "apply", replacement, summary: "增加试探", scopeAdvice: "" }), citations: [] }]);
    const model = fakeClient([{ kind: "ok", message: response }, modelText(C5_JSON)]);
    const { session, body, store } = fixture(model.client);
    const draft = await start(session, payload(session));
    const result = await finish(session, draft);
    expect(result).toMatchObject({ status: "ready", acceptable: true, body: body.replace(selected, replacement), revision: { kind: "model", sourceDraftId: "ch3d1", resultSummary: "增加试探" } });
    expect(model.calls).toHaveLength(2);
    expect(JSON.stringify(model.calls[1]!.messages)).toContain(result.body.replace(/\n/gu, "\\n"));
    expect(model.calls[1]!.messages.some(message => message.role === "assistant" && JSON.stringify(message.content) === JSON.stringify(response.content))).toBe(true);
    expect(store.loadDraft(3, "ch3d1")?.body).toBe(body);
    expect(session.chapterText(3)).toBeUndefined();
    expect(view(session, draft.draftId)).not.toHaveProperty("generation");
  });

  it("需要扩大范围时只交建议，正文保持且不进行 C5", async () => {
    const model = fakeClient([modelText(JSON.stringify({ decision: "expand_scope", replacement: "未经授权的全文", summary: "需要改动结尾", scopeAdvice: "谈判必须影响下一段的离开理由，请扩大到下一段。" }))]);
    const { session, body } = fixture(model.client);
    const draft = await start(session, payload(session));
    const result = await finish(session, draft);
    expect(result).toMatchObject({ status: "needs_revision", body, declaration: null, acceptable: false, revision: { scopeAdvice: expect.stringContaining("扩大") } });
    expect(model.calls).toHaveLength(1);
    expect(session.chapterTasks().find(task => task.draftId === draft.draftId)?.status).toBe("awaiting_input");
    expect(() => session.adopt(3, draft.draftId)).toThrow();
    const check = await handleAsync(session, { method: "POST", path: "/api/chapter/check", query: new URLSearchParams(), body: { chapter: 3, draftId: draft.draftId, revisionToken: view(session, draft.draftId).revisionToken, adoptOnSuccess: true } });
    expect(check.status).toBe(409);
    expect(model.calls).toHaveLength(1);
    expect(session.controlChapter(3, draft.draftId, "end").status).toBe("ended");
    expect(session.chapterTasks().find(task => task.draftId === draft.draftId)?.status).toBe("ended");
  });

  it("重复原文必须指定出现序号，选中第二处只改第二处", async () => {
    const model = fakeClient([rewritten(), modelText(C5_JSON)]);
    const { session, store, body } = fixture(model.client);
    const repeated = body + selected;
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, body: repeated });
    expect((await handleAsync(session, request(payload(session)))).status).toBe(400);
    expect(session.listDrafts(3)).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
    const draft = await start(session, payload(session, { scope: { quote: selected, occurrence: 1 } }));
    expect((await finish(session, draft)).body).toBe(body + replacement);
  });

  it("相同请求跨会话重试不重新生成，变更要求不能复用编号", async () => {
    const model = fakeClient([rewritten(), modelText(C5_JSON)]);
    const { session, root } = fixture(model.client);
    const input = payload(session, { scope: { quote: selected, occurrence: 0 } });
    const draft = await start(session, input);
    await finish(session, draft);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW);
    expect((await start(reopened, { ...input, scope: { occurrence: 0, quote: selected } })).draftId).toBe(draft.draftId);
    expect((await handleAsync(reopened, request({ ...input, instruction: "改成直接交战" }))).status).toBe(409);
    expect(reopened.listDrafts(3)).toHaveLength(2);
    expect(model.calls).toHaveLength(2);
  });

  it("C5 失败后重开只恢复 C5，仍核对合成后的全文", async () => {
    const model = fakeClient([rewritten(), { kind: "error", error: { type: "connection", status: null, message: "C5 lost", retryable: true } }]);
    const { session, root, body } = fixture(model.client);
    const draft = await start(session, payload(session));
    expect((await finish(session, draft)).error?.step).toBe("C5");
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW, { client: next.client });
    const result = await finish(reopened, draft);
    expect(result).toMatchObject({ status: "ready", body: body.replace(selected, replacement) });
    expect(next.calls).toHaveLength(1);
    expect(JSON.stringify(next.calls[0]!.messages)).toContain(result.body.replace(/\n/gu, "\\n"));
  });

  it("正文修订请求失败后恢复，沿用保存的范围和要求", async () => {
    const first = fakeClient([{ kind: "error", error: { type: "connection", status: null, message: "connection lost", retryable: true } }]);
    const { session, root, body } = fixture(first.client);
    const draft = await start(session, payload(session));
    const failed = await finish(session, draft);
    expect(failed).toMatchObject({ status: "failed", body, error: { step: "C4" } });
    const next = fakeClient([rewritten(), modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW, { client: next.client });
    expect((await finish(reopened, failed)).body).toBe(body.replace(selected, replacement));
    expect(JSON.stringify(next.calls[0]?.messages)).toContain(selected);
    expect(reopened.listDrafts(3)).toHaveLength(2);
  });

  it.each([
    { label: "截断", result: { kind: "max_tokens", message: modelMessage([{ type: "text", text: JSON.stringify({ decision: "apply", replacement, summary: "试探", scopeAdvice: "" }), citations: [] }], "max_tokens") } as CallResult },
    { label: "连接中断", result: { kind: "error", error: { type: "connection", status: null, message: "connection lost", retryable: true }, partialText: '{"decision":"apply","replacement":"未完成' } as CallResult },
    { label: "缺少字段", result: modelText(JSON.stringify({ replacement })) },
  ])("修订输出$label时不应用替换、不启动 C5", async ({ result }) => {
    const model = fakeClient([result]); const { session, body } = fixture(model.client);
    const draft = await start(session, payload(session));
    expect(await finish(session, draft)).toMatchObject({ status: "failed", body, declaration: null, error: { step: "C4" } });
    expect(model.calls).toHaveLength(1);
    expect(view(session, draft.draftId)).toMatchObject({ canContinueBody: false });
  });

  it("生成期间正式依据改变时保留修订正文并标过期", async () => {
    let signal!: () => void; let release!: (value: CallResult) => void;
    const entered = new Promise<void>(resolve => { signal = resolve; });
    const pending = new Promise<CallResult>(resolve => { release = resolve; });
    const { session, body } = fixture({ official: false, call: options => {
      if (Object.hasOwn((options.outputSchema?.["properties"] ?? {}) as object, "decision")) { signal(); return pending; }
      return Promise.resolve(modelText(C5_JSON));
    } });
    const draft = await start(session, payload(session));
    await entered;
    session.putChapter(2, session.chapterText(2)! + "守夜人忽然现身。");
    release(rewritten());
    expect(await finish(session, draft)).toMatchObject({ status: "stale", acceptable: false, body: body.replace(selected, replacement) });
    expect(session.chapterText(3)).toBeUndefined();
  });

  it("修改在模型请求返回后暂停，重开继续核对而不重新修改", async () => {
    let release!: (value: CallResult) => void;
    let signal!: () => void;
    const entered = new Promise<void>(resolve => { signal = resolve; });
    const pending = new Promise<CallResult>(resolve => { release = resolve; });
    const { session, root, body } = fixture({ official: false, call: () => { signal(); return pending; } });
    const draft = await start(session, payload(session));
    await entered;
    session.controlChapter(3, draft.draftId, "pause");
    release(rewritten());
    const paused = await finish(session, draft);
    expect(paused).toMatchObject({ body: body.replace(selected, replacement), execution: { status: "paused" } });
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW, { client: next.client });
    expect((await finish(reopened, paused)).status).toBe("ready");
    expect(next.calls).toHaveLength(1);
  });

  it("全章改写要求明确的空范围，源凭据变化时不调用模型", async () => {
    const model = fakeClient([rewritten(PROSE + "风".repeat(3000)), modelText(C5_JSON)]);
    const { session, store } = fixture(model.client);
    const input = payload(session);
    const { scope: _scope, ...missing } = input;
    expect((await handleAsync(session, request(missing))).status).toBe(400);
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, updatedAt: new Date().toISOString(), body: "被另一页修改" });
    expect((await handleAsync(session, request(input))).status).toBe(409);
    expect(model.calls).toHaveLength(0);
    const draft = await start(session, payload(session, { scope: null }));
    expect((await finish(session, draft)).body).toBe(PROSE + "风".repeat(3000));
  });

  it.each(["max_tokens", "connection"])("续写保留已有片段，%s 后保留新增片段，下一次继续只接着写", async (kind) => {
    const more = "李长风合上账本，还没等他开口，";
    const partial = PROSE + "血刀客忽然说：";
    const first = fakeClient([kind === "max_tokens"
      ? { kind: "max_tokens", message: modelMessage([{ type: "text", text: more, citations: [] }], "max_tokens") }
      : { kind: "error", error: { type: "connection", status: null, message: "connection lost", retryable: true }, partialText: more } as CallResult]);
    const { session, store, root } = fixture(first.client);
    store.saveDraft(savedDraft({ body: partial, status: "failed", acceptable: false, declaration: null, error: { step: "C4", detail: "输出达到上限" } }));
    const draft = await start(session, payload(session, { mode: "continue", scope: null, instruction: "保留片段，继续完成本章" }));
    const incomplete = await finish(session, draft);
    expect(incomplete).toMatchObject({ body: partial + more, status: "failed", error: { step: "C4" } });
    expect(first.calls).toHaveLength(1);
    const suffix = "院门便被推开了。" + "风".repeat(2900);
    const next = fakeClient([modelText(suffix), modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW, { client: next.client });
    const continued = await start(reopened, { ...payload(reopened), draftId: incomplete.draftId, revisionToken: view(reopened, incomplete.draftId).revisionToken, mode: "continue", scope: null, instruction: "接着完成本章", requestId: "continue-next" });
    const result = await finish(reopened, continued);
    expect(result.body).toBe(partial + more + suffix);
    expect(result.revision).toMatchObject({ kind: "continuation", sourceDraftId: incomplete.draftId });
    expect(result.declaration).not.toBeNull();
    expect(next.calls).toHaveLength(2);
    expect(store.loadDraft(3, incomplete.draftId)?.body).toBe(partial + more);
    expect(session.chapterText(3)).toBeUndefined();
  });

  it("最新正式章修订先作为候选，明确采用后才替换正式正文", async () => {
    const model = fakeClient([rewritten(), modelText(C5_JSON)]);
    const { session, body } = fixture(model.client);
    session.adopt(3, "ch3d1");
    const draft = await start(session, payload(session));
    const result = await finish(session, draft);
    expect(result.status).toBe("ready");
    expect(session.chapterText(3)).toBe(body);
    session.adopt(3, draft.draftId);
    expect(session.chapterText(3)).toBe(body.replace(selected, replacement));
    expect(session.currentAdoptedDraftId(3)).toBe(draft.draftId);
  });

  it("对话读取确切范围并启动修订，采用后下一章读到实际修改", async () => {
    let round = 0;
    const tool = (name: string, input: Record<string, unknown>): CallResult => ({ kind: "ok", message: modelMessage([{ type: "tool_use", id: `rewrite-tool-${round}`, name, input, caller: { type: "direct" } }], "tool_use") });
    const client: ModelClient = { official: false, call: async options => {
      if (options.outputSchema) return Object.hasOwn((options.outputSchema["properties"] ?? {}) as object, "decision") ? rewritten() : modelText(C5_JSON);
      round++;
      if (round === 1) return tool("get_chapter_draft", { draftId: "ch3d1" });
      if (round === 3) return tool("adopt_chapter", { draftId: "ch3d2" });
      const content = options.messages.at(-1)?.content;
      const result = Array.isArray(content) ? content.find(item => item.type === "tool_result") : undefined;
      if (result?.type !== "tool_result" || result.is_error) return modelText("这次操作未完成，原稿保留。");
      if (round === 2) {
        const draft = JSON.parse(String(result.content)) as View;
        expect(draft.body).toContain(selected);
        return tool("revise_chapter_draft", { draftId: draft.draftId, revisionToken: draft.revisionToken, mode: "rewrite", instruction: "增加一轮试探，结尾保持不变", scope: { quote: selected }, requestId: "conversation-rewrite" });
      }
      if (round === 4) return tool("get_chapter_text", { chapter: 3 });
      if (round === 5) {
        expect(String(result.content)).toContain(replacement);
        expect(String(result.content)).not.toContain(selected);
        return modelText("已采用新版本，正式正文包含新增的试探。");
      }
      return tool("adopt_chapter", { draftId: "ch3d2" });
    } };
    const { session } = fixture(client);
    const reply = await session.converse(`只把 ch3d1 里「${selected}」改成试探，结尾不变。`);
    expect(reply.effects).toContainEqual(expect.objectContaining({ kind: "chapter_revised", draftId: "ch3d2" }));
    expect(reply.text).toContain("后台");
    expect(round).toBe(2);
    expect((await finish(session, view(session, "ch3d2"))).status).toBe("ready");
    expect(session.currentAdoptedDraftId(3)).toBeUndefined();
    await session.converse("采用 ch3d2，并读取第三章确认修改。");
    expect(session.currentAdoptedDraftId(3)).toBe("ch3d2");
    expect(buildChapterReadSource(session, 4).loadChapter(3, "full")).toContain(replacement);
    expect(round).toBe(5);
  });

  it("前章采用新版本后，过期的下一章按最新正式事实修改并重检才能采用", async () => {
    const nextBeat = { ...WRITE_BEAT, chapter: 4, plan: { ...WRITE_BEAT.plan, chapterType: "event" as const, resolves: [],
      coreEvent: "带着谈判取得的信物离开密库", stageFeedback: "双方按约同行", hook: "门外留下新脚印" } };
    const newOpening = "李长风握紧刚收下的信物，确认血刀客履约后才答应同行。";
    let nextBody = "";
    const model = fakeClient([
      rewritten(), modelText(C5_JSON),
      { kind: "ok", message: modelMessage([{ type: "tool_use", id: "read-latest-previous", name: "load_chapter", caller: { type: "direct" }, input: { chapter: 3, excerpt: "full" } }], "tool_use") },
      modelText("unused"),
      modelText(JSON.stringify({ events: [{ kind: "action", summary: "按约取得信物后同行", weight: 2, plot_line: "P01", participants: ["C01", "C02"], quote: newOpening }], foreshadow_planted: [], foreshadow_resolved: [], relations_changed: [], character_states: [], character_presence: [{ character_id: "C01", role: "pov" }, { character_id: "C02", role: "major" }] })),
    ]);
    const underlying = model.client.call.bind(model.client);
    const client: ModelClient = { official: false, call: async options => {
      const response = await underlying(options);
      if (model.calls.length !== 4) return response;
      const serialized = JSON.stringify(options.messages);
      expect(serialized).toContain(replacement);
      expect(serialized).not.toContain(selected);
      return rewritten(nextBody);
    } };
    const { session, store, body } = fixture(client);
    session.adopt(3, "ch3d1"); session.putBeat(nextBeat);
    const words = deriveBudget(nextBeat.plan, session.meta.profile, session.rules).words.sweet;
    const oldOpening = "李长风没有取得信物，先前已经直接答应同行。";
    const oldNextBody = oldOpening + "风".repeat(words - countWords(oldOpening));
    nextBody = newOpening + "风".repeat(words - countWords(newOpening));
    store.saveDraft(savedDraft({ chapter: 4, draftId: "ch4d1", body: oldNextBody, baseVersion: store.workVersion(), baseAdoptedThrough: 3 }));
    const revisedPrevious = await start(session, payload(session));
    expect((await finish(session, revisedPrevious)).status).toBe("ready");
    expect(session.chapterText(3)).toBe(body);
    session.adopt(3, revisedPrevious.draftId);
    const stale = store.loadDraft(4, "ch4d1")!;
    expect(stale.status).toBe("stale");
    expect(() => session.adopt(4, stale.draftId)).toThrow();
    const detail = handle(session, { method: "GET", path: "/api/chapter/draft", body: undefined, query: new URLSearchParams({ n: "4", id: "ch4d1" }) }).body as View;
    const response = await handleAsync(session, request({ chapter: 4, draftId: stale.draftId, revisionToken: detail.revisionToken,
      mode: "rewrite", instruction: "先查第3章的新正式版本，再按取得信物后才答应的事实修改本章。", scope: null, requestId: "rebase-next-chapter" }));
    expect(response.status).toBe(200);
    const result = await finish(session, response.body as View);
    expect(result).toMatchObject({ chapter: 4, status: "ready", body: nextBody, revision: { rebased: true, sourceDraftId: "ch4d1" } });
    expect(store.loadDraft(4, "ch4d1")?.body).toBe(oldNextBody);
    expect(session.chapterText(4)).toBeUndefined();
    session.adopt(4, result.draftId);
    expect(session.chapterText(4)).toBe(nextBody);
    expect(buildChapterReadSource(session, 5).loadChapter(3, "full")).toContain(replacement);
    expect(model.calls).toHaveLength(5);
  });
});
