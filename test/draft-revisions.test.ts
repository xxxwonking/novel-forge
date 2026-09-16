import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import { handle, handleAsync } from "../src/server/api.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import { buildChapterRunInput, buildChapterReadSource } from "../src/server/chapter-input.js";
import { parseC5 } from "../src/chapter/c5-schema.js";
import type { ChapterDraft } from "../src/task/types.js";
import type { ModelClient } from "../src/client/model.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, WRITE_BEAT, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
type View = ChapterDraft & { revisionToken: string; isCurrentAdopted: boolean };
const request = (path: string, body: unknown) => ({ method: "POST", path, body, query: new URLSearchParams() });
function fixture(client: ModelClient = fakeClient([]).client) {
  const root = mkdtempSync(join(tmpdir(), "nf-revisions-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const store = new DraftStore(root);
  store.saveDraft(savedDraft());
  return { root, store, session: new ProjectSession(root, NO_MODEL_REVIEW, { client }) };
}
function view(session: ProjectSession, draftId = "ch3d1", chapter = 3): View {
  const response = handle(session, { method: "GET", path: "/api/chapter/draft", body: undefined, query: new URLSearchParams({ n: String(chapter), id: draftId }) });
  expect(response.status).toBe(200);
  return response.body as View;
}
function bodyWithinBudget(session: ProjectSession): string {
  const target = deriveBudget(WRITE_BEAT.plan, session.meta.profile, session.rules).words.sweet;
  return PROSE + "风".repeat(target - countWords(PROSE));
}
function edit(session: ProjectSession, body: string, draftId = "ch3d1", requestId?: string): View {
  const source = view(session, draftId);
  const response = handle(session, request("/api/chapter/edit", {
    chapter: 3, draftId, body, revisionToken: source.revisionToken, summary: "调整本章正文",
    ...(requestId === undefined ? {} : { requestId }),
  }));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as View;
}
async function check(session: ProjectSession, draft: View, adoptOnSuccess = false): Promise<ChapterDraft> {
  const response = await handleAsync(session, request("/api/chapter/check", {
    chapter: draft.chapter, draftId: draft.draftId, revisionToken: draft.revisionToken, adoptOnSuccess,
  }));
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return session.writeChapter({ chapter: draft.chapter, draftId: draft.draftId });
}

describe("稿件编辑、重检与正式版本", () => {
  it("手动保存为待检查新版本，不调用模型、不改旧稿或正式正文", () => {
    const model = fakeClient([]); const { root, store, session } = fixture(model.client);
    const before = store.loadDraft(3, "ch3d1");
    const draft = edit(session, PROSE + "李长风发现账本末页被撕去了。");
    expect(draft).toMatchObject({ draftId: "ch3d2", status: "pending_check", acceptable: false, declaration: null, findings: [], revision: { kind: "manual", sourceDraftId: "ch3d1" } });
    expect(draft.revisionToken).toMatch(/^[a-f0-9]{64}$/u);
    expect(view(session, draft.draftId).revisionToken).toBe(draft.revisionToken);
    expect(draft).not.toHaveProperty("session");
    expect(store.loadDraft(3, "ch3d1")).toEqual(before);
    expect(session.chapterText(3)).toBeUndefined();
    expect(model.calls).toHaveLength(0);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW);
    expect(reopened.getDraft(3, draft.draftId)?.body).toBe(draft.body);
    expect(reopened.chapterTasks().find(task => task.draftId === draft.draftId)?.status).toBe("waiting");
    expect(reopened.chapterTasks().find(task => task.draftId === "ch3d1")?.isHistory).toBe(true);
    expect(() => reopened.adopt(3, draft.draftId)).toThrow(/未就绪/u);
  });

  it("编辑请求重试返回同一版本，复用编号提交不同正文会被拒绝", () => {
    const { session } = fixture();
    const first = edit(session, PROSE + "新内容。", "ch3d1", "edit-once");
    expect(edit(session, first.body, "ch3d1", "edit-once").draftId).toBe(first.draftId);
    const response = handle(session, request("/api/chapter/edit", { chapter: 3, draftId: "ch3d1", revisionToken: view(session).revisionToken, body: "不同内容", requestId: "edit-once" }));
    expect(response.status).toBe(409);
    expect(session.listDrafts(3)).toHaveLength(2);
  });

  it("另一页面改变源稿后，旧编辑凭据不能覆盖当前内容", () => {
    const { store, session } = fixture();
    const old = view(session);
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, body: PROSE + "另一页面的修改。" });
    const response = handle(session, request("/api/chapter/edit", { chapter: 3, draftId: old.draftId, revisionToken: old.revisionToken, body: "过时编辑" }));
    expect(response.status).toBe(409);
    expect(session.listDrafts(3)).toHaveLength(1);
    expect(session.getDraft(3, old.draftId)?.body).toContain("另一页面的修改");
  });

  it("另一份稿正在运行时拒绝检查，不能先改写目标稿的状态或采用请求", async () => {
    let finish!: (result: CallResult) => void;
    const pending = new Promise<CallResult>(resolve => { finish = resolve; });
    const { session } = fixture({ official: false, call: () => pending });
    const running = session.writeChapter({ chapter: 3, newDraft: true });
    try {
      const changed = edit(session, PROSE + "另一个候选版本。");
      const before = session.getDraft(3, changed.draftId);
      const response = await handleAsync(session, request("/api/chapter/check", { chapter: 3, draftId: changed.draftId, revisionToken: changed.revisionToken, adoptOnSuccess: true }));
      expect(response.status).toBe(409);
      expect(session.getDraft(3, changed.draftId)).toEqual(before);
    } finally {
      session.controlChapter(3, "ch3d2", "end");
      finish(modelText(PROSE));
      await running;
    }
  });

  it("检查作者正文只调用 C5，不复用旧 C4 响应或伪造模型会话", async () => {
    const model = fakeClient([modelText(C5_JSON)]); const { session, store } = fixture(model.client);
    store.saveDraft(savedDraft({ session: { system: [], tools: [], messages: [{ role: "user", content: "旧写作要求" }], c4Response: modelMessage([{ type: "text", text: "旧响应特有内容", citations: [] }]) } }));
    const changed = edit(session, bodyWithinBudget(session));
    const result = await check(session, changed);
    expect(result).toMatchObject({ status: "ready", acceptable: true, body: changed.body });
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.outputSchema).toBeDefined();
    expect(JSON.stringify(model.calls[0]?.messages)).toContain(changed.body);
    expect(JSON.stringify(model.calls[0]?.messages)).not.toContain("旧响应特有内容");
    expect(model.calls[0]?.messages.some(message => message.role === "assistant")).toBe(false);
    expect(session.currentChapter).toBe(2);
  });

  it("检查并采用只在真实闸门通过后提交同一版本，记录正式版本编号", async () => {
    const model = fakeClient([modelText(C5_JSON)]); const { session, root } = fixture(model.client);
    const changed = edit(session, bodyWithinBudget(session));
    const result = await check(session, changed, true);
    expect(result.status).toBe("adopted");
    expect(session.chapterText(3)).toBe(changed.body);
    expect(view(session, changed.draftId).isCurrentAdopted).toBe(true);
    expect(JSON.parse(readFileSync(join(root, "work-meta.json"), "utf8"))).toMatchObject({ workVersion: 1, adoptedDrafts: { "3": changed.draftId } });
    expect(session.adopt(3, changed.draftId).changed).toBe(false);
    expect(session.getDraft(3, "ch3d1")?.body).toBe(PROSE);
  });

  it("检查执行完成但字数不足时停在需要修改，不兑现检查并采用", async () => {
    const model = fakeClient([modelText(C5_JSON)]); const { session } = fixture(model.client);
    const changed = edit(session, PROSE + "账本还在。");
    const result = await check(session, changed, true);
    expect(result.status).toBe("needs_revision");
    expect(result.findings.some(finding => finding.level === "block")).toBe(true);
    expect(session.chapterText(3)).toBeUndefined();
    expect(session.currentChapter).toBe(2);
  });

  it("检查失败跨会话恢复仍使用编辑正文，并保留该版本的检查并采用请求", async () => {
    const first = fakeClient([{ kind: "error", error: { type: "connection", message: "C5 connection lost", status: null, retryable: true } }]);
    const { session, root } = fixture(first.client);
    const changed = edit(session, bodyWithinBudget(session));
    expect((await check(session, changed, true)).status).toBe("failed");
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW, { client: next.client });
    expect(reopened.chapterText(3)).toBeUndefined();
    const resumed = await reopened.writeChapter({ chapter: 3, draftId: changed.draftId });
    expect(resumed).toMatchObject({ status: "adopted", body: changed.body });
    expect(next.calls).toHaveLength(1);
    expect(JSON.stringify(next.calls[0]?.messages)).toContain(changed.body);
  });

  it("最新正式章先形成候选修订，采用后替换事实并使下一章各类未采用稿过期", async () => {
    const model = fakeClient([modelText(C5_JSON), modelText(C5_JSON)]); const { session, store } = fixture(model.client);
    const initial = edit(session, bodyWithinBudget(session));
    const adopted = await check(session, initial, true);
    const originalEvents = session.events().filter(event => event.envelope.chapter === 3 && event.envelope.provenance === "committed");
    expect(originalEvents.length).toBeGreaterThan(0);
    for (const [index, status] of ["ready", "failed", "pending_check"].entries()) {
      store.saveDraft(savedDraft({ chapter: 4, draftId: `ch4d${index + 1}`, status: status as ChapterDraft["status"], baseVersion: store.workVersion() }));
    }
    const replacement = edit(session, adopted.body + "门外响起了脚步声。", adopted.draftId);
    expect(session.chapterText(3)).toBe(adopted.body);
    expect(session.events().filter(event => event.envelope.provenance === "committed")).toEqual(expect.arrayContaining(originalEvents));
    await check(session, replacement, true);
    expect(session.chapterText(3)).toBe(replacement.body);
    expect(view(session, adopted.draftId).isCurrentAdopted).toBe(false);
    expect(view(session, replacement.draftId).isCurrentAdopted).toBe(true);
    expect(session.listDrafts(4).every(draft => draft.status === "stale")).toBe(true);
    expect(session.events().filter(event => originalEvents.some(old => old.envelope.id === event.envelope.id)).every(event => event.envelope.provenance === "rejected")).toBe(true);
    const staleSource = handle(session, request("/api/chapter/edit", { chapter: 3, draftId: adopted.draftId, revisionToken: view(session, adopted.draftId).revisionToken, body: "从旧正式稿直接覆盖" }));
    expect(staleSource.status).toBe(409);
  });

  it("检查完成与自动采用之间依据改变时保留过期标记，不退回可采用状态", async () => {
    const model = fakeClient([modelText(C5_JSON)]); const { session } = fixture(model.client);
    const changed = edit(session, bodyWithinBudget(session));
    const adopt = session.adopt.bind(session);
    session.adopt = (chapter, draftId) => {
      session.putChapter(2, session.chapterText(2)! + "上一章新增了线索。");
      return adopt(chapter, draftId);
    };
    const result = await check(session, changed, true);
    expect(result.status).toBe("stale");
    expect(result.acceptable).toBe(false);
    expect(result.review?.adoptionError).toMatch(/发生变化/u);
    expect(session.chapterText(3)).toBeUndefined();
  });

  it.each([
    { name: "C5 达到输出上限", result: { kind: "max_tokens", message: modelMessage([{ type: "text", text: C5_JSON, citations: [] }], "max_tokens") } as CallResult },
    { name: "C5 缺少结构数组", result: modelText("{}") },
    { name: "C5 结构数组类型错误", result: modelText(JSON.stringify({ ...JSON.parse(C5_JSON), character_presence: {} })) },
    { name: "C5 记录缺少必要字段", result: modelText(JSON.stringify({ ...JSON.parse(C5_JSON), events: [{ kind: "action" }] })) },
    { name: "C5 未完成工具调用", result: { kind: "ok", message: modelMessage([{ type: "text", text: C5_JSON, citations: [] }], "tool_use") } as CallResult },
  ])("$name 时保留正文并标记声明失败", async ({ result }) => {
    const model = fakeClient([result]); const { session } = fixture(model.client);
    const changed = edit(session, bodyWithinBudget(session));
    const checked = await check(session, changed, true);
    expect(checked.status).toBe("failed");
    expect(checked.error?.step).toBe("C5");
    expect(checked.body).toBe(changed.body);
    expect(session.chapterText(3)).toBeUndefined();
  });
});

describe("正文保持、纠正候选结构", () => {
  function setup() {
    const model = fakeClient([]); const base = fixture(model.client);
    const body = bodyWithinBudget(base.session) + "血刀客突然昏倒在门前，呼吸仍然平稳。";
    const input = buildChapterRunInput(base.session, 3);
    const declaration = parseC5({ ...JSON.parse(C5_JSON), character_states: [{ character_id: "C02", field: "vital", from: "alive", to: "dead", quote: "血刀客突然昏倒在门前" }] }, { ...input.parseContextBase, chapterText: body }).declaration;
    base.store.saveDraft(savedDraft({ body, declaration, findings: [{ rule: "old-finding", level: "warn", message: "上次核对" }] }));
    return { ...base, model, body, declaration };
  }
  const correction = { section: "characterStates", index: 0, value: { characterId: "C02", field: "condition", from: null, to: "昏倒，呼吸平稳", quote: "血刀客突然昏倒在门前" } };
  function correct(session: ProjectSession, changes: unknown) {
    return handle(session, request("/api/chapter/correct", { chapter: 3, draftId: "ch3d1", revisionToken: view(session).revisionToken, summary: "昏倒不是死亡，保留正文纠正状态", changes }));
  }

  it("纠正死亡误读形成新记录版本，重新核对时不调用 C4/C5、不改变正文", async () => {
    const { session, body, model, declaration } = setup();
    const response = correct(session, [correction]);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const changed = response.body as View;
    expect(changed).toMatchObject({ body, status: "pending_check", findings: [], acceptable: false, revision: { kind: "structure" } });
    expect(changed.declaration?.characterStates[0]).toMatchObject({ field: "condition", to: "昏倒，呼吸平稳", anchor: { offsetHint: body.indexOf("血刀客突然昏倒在门前") } });
    expect(session.getDraft(3, "ch3d1")?.declaration).toEqual(declaration);
    const checked = await check(session, changed, true);
    expect(checked.status).toBe("adopted");
    expect(session.chapterText(3)).toBe(body);
    expect(JSON.parse(buildChapterReadSource(session, 4).loadCharacter("C02")!).state).toMatchObject({ vital: "alive", condition: "昏倒，呼吸平稳" });
    expect(model.calls).toHaveLength(0);
  });

  it("纠错响应丢失后重试只返回原新版本，不同记录不能复用请求编号", () => {
    const { session, root } = setup();
    const payload = { chapter: 3, draftId: "ch3d1", revisionToken: view(session).revisionToken, summary: "昏倒不是死亡", changes: [correction], requestId: "correct-once" };
    const first = handle(session, request("/api/chapter/correct", payload));
    expect(first.status).toBe(200);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW);
    const retried = handle(reopened, request("/api/chapter/correct", payload));
    expect((retried.body as View).draftId).toBe((first.body as View).draftId);
    expect(reopened.listDrafts(3)).toHaveLength(2);
    expect(handle(reopened, request("/api/chapter/correct", { ...payload, changes: [{ section: "characterStates", index: 0, value: null }] })).status).toBe(409);
  });

  it("纠错与 C5 使用相同的未知生存状态值", () => {
    const { session, body } = setup();
    const response = correct(session, [{ section: "characterStates", index: 0, value: { characterId: "C02", field: "vital", from: "alive", to: "unknown", quote: "血刀客突然昏倒在门前" } }]);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((response.body as View).body).toBe(body);
    expect((response.body as View).declaration?.characterStates[0]).toMatchObject({ field: "vital", to: "unknown" });
  });

  it("不存在的人物引用不能被解析器静默丢弃后当作纠正成功", () => {
    const { session } = setup();
    const response = correct(session, [{ section: "events", index: 0, value: { kind: "action", summary: "陌生人打开密库", weight: 2, plotLine: "P01", participants: ["C999"], quote: "青铜钥匙打开了宗门密库" } }]);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/人物|引用/u);
    expect(session.listDrafts(3)).toHaveLength(1);
  });

  it("纠错引用必须真实存在，不能沿用无效 offset 或虚构原文", () => {
    const { session } = setup();
    const response = correct(session, [{ ...correction, value: { ...correction.value, quote: "本章不存在的死亡证据" } }]);
    expect(response.status).toBe(400);
    expect(JSON.stringify(response.body)).toMatch(/原文|引用/u);
    expect(session.listDrafts(3)).toHaveLength(1);
  });

  it("删除错误收束记录后重算承诺检查，未兑现的主线仍阻止采用", async () => {
    const { session, model } = setup();
    const response = correct(session, [{ section: "foreshadowResolved", index: 0, value: null }]);
    expect(response.status).toBe(200);
    const result = await check(session, response.body as View, true);
    expect(result.status).toBe("needs_revision");
    expect(result.findings).toContainEqual(expect.objectContaining({ rule: "resolution_missing", level: "block" }));
    expect(session.chapterText(3)).toBeUndefined();
    expect(model.calls).toHaveLength(0);
  });

  it("仅改一条新伏笔的安排时保留其 ID 和其他类别记录", () => {
    const { session, store, declaration, body } = setup();
    const planted = { type: "foreshadow_planted" as const, foreshadowId: "F03" as const, label: "缺页", intent: "揭晓是谁撕走了缺页", weight: "sub" as const, visibility: "covert" as const, expectedBy: 5, anchor: { chapter: 3, quote: "血刀客拿走了架上的旧账本", offsetHint: body.indexOf("血刀客拿走了架上的旧账本"), occurrence: 0 } };
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, declaration: { ...declaration, foreshadowPlanted: [planted] } });
    const response = correct(session, [{ section: "foreshadowPlanted", index: 0, value: { label: planted.label, intent: planted.intent, weight: planted.weight, visibility: planted.visibility, expectedBy: 8, quote: planted.anchor.quote } }]);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const revised = response.body as View;
    expect(revised.declaration?.foreshadowPlanted[0]).toMatchObject({ foreshadowId: "F03", expectedBy: 8 });
    expect(revised.declaration?.events).toEqual(declaration.events);
  });

  it("作者纠错后的代码检查不要求配置模型", async () => {
    const { session, root } = setup();
    const changed = correct(session, [correction]).body as View;
    vi.stubEnv("NOVEL_MODEL_PROVIDER", "invalid-provider-to-detect-model-creation");
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW);
    expect((await check(reopened, changed)).status).toBe("ready");
  });

  it("作者可在对话里读取确切稿件、纠错并检查采用，后续读取看到正确状态", async () => {
    const { root } = setup();
    let round = 0;
    const tool = (name: string, input: Record<string, unknown>): CallResult => ({ kind: "ok", message: modelMessage([{ type: "tool_use", id: `revision-tool-${round}`, name, input, caller: { type: "direct" } }], "tool_use") });
    const client: ModelClient = { official: false, call: async options => {
      round++;
      if (round === 1) return tool("get_chapter_draft", { draftId: "ch3d1" });
      const content = options.messages.at(-1)?.content;
      const result = Array.isArray(content) ? content.find(item => item.type === "tool_result") : undefined;
      if (result?.type !== "tool_result" || result.is_error) return modelText("工具未能执行，原稿仍保留。");
      const draft = JSON.parse(String(result.content)) as View;
      if (round === 2) {
        expect(draft.body).toContain("血刀客突然昏倒在门前");
        return tool("correct_draft_structure", { draftId: draft.draftId, revisionToken: draft.revisionToken, summary: "昏倒不是死亡，保留正文", changes: [correction] });
      }
      if (round === 3) return tool("check_chapter_draft", { draftId: draft.draftId, revisionToken: draft.revisionToken, adoptOnSuccess: true });
      return modelText("已保留正文并纠正记录，按你的要求检查后采用。");
    } };
    const session = new ProjectSession(root, NO_MODEL_REVIEW, { client });
    const reply = await session.converse("ch3d1 正文里的血刀客只是昏倒，正文保持，纠正死亡记录，检查通过就采用。");
    expect(reply.effects).toContainEqual(expect.objectContaining({ kind: "chapter_revised", draftId: "ch3d2" }));
    expect(reply.effects).toContainEqual(expect.objectContaining({ kind: "task_updated", draftId: "ch3d2" }));
    expect(reply.text).toContain("后台");
    const completed = await session.writeChapter({ chapter: 3, draftId: "ch3d2" });
    expect(completed.status).toBe("adopted");
    expect(JSON.parse(buildChapterReadSource(session, 4).loadCharacter("C02")!).state.vital).toBe("alive");
    expect(session.getDraft(3, "ch3d1")?.declaration?.characterStates[0]?.to).toBe("dead");
    expect(round).toBe(3);
  });
});
