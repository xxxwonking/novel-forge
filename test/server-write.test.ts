import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { handle, handleAsync, type ApiResponse } from "../src/server/api.js";
import { serve } from "../src/server/http.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore, type ProjectSnapshot } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { ClaudeClient, type CallOptions, type CallResult } from "../src/client/claude.js";
import { loadRules } from "../src/rules/load.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import type { ChapterDraft } from "../src/task/types.js";
import { C5_JSON, PROSE, SINGLE_PASS_RULES, WRITE_BEAT, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const server of servers.splice(0)) await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seed(client?: ClaudeClient, snapshot: ProjectSnapshot = writingSnapshot()) {
  const root = mkdtempSync(join(tmpdir(), "nf-server-write-"));
  roots.push(root);
  const store = new ProjectStore(root);
  store.save(snapshot);
  return { root, store, drafts: new DraftStore(root), session: new ProjectSession(root, SINGLE_PASS_RULES, client === undefined ? {} : { client }) };
}

function write(session: ProjectSession, body: unknown): Promise<ApiResponse> {
  return handleAsync(session, { method: "POST", path: "/api/chapter/write", query: new URLSearchParams(), body });
}

const FAILURE: CallResult = { kind: "error", error: { type: "connection", status: null, message: "连接中断", retryable: true } };

describe("POST /api/chapter/write", () => {
  it("从项目运行章节图并返回草稿，正式事件、正文和作品版本不受生成影响", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    const { session, store, drafts } = seed(model.client);
    const before = store.load();
    const response = await write(session, { chapter: 3 });
    expect(response.status).toBe(200);
    const draft = response.body as ChapterDraft;
    expect(draft.chapter).toBe(3);
    expect(draft.body).toBe(PROSE);
    expect(draft.declaration?.foreshadowResolved[0]?.foreshadowId).toBe("F01");
    // 短测试正文确实进入 C6，不能绕过字数检查而伪装成 ready。
    expect(draft.status).toBe("needs_revision");
    expect(draft.acceptable).toBe(false);
    expect(draft).not.toHaveProperty("session");
    expect(draft).not.toHaveProperty("writeContext");
    expect(store.load().events).toEqual(before.events);
    expect(store.load().chapters).toEqual(before.chapters);
    expect(drafts.workVersion()).toBe(0);
    expect(drafts.loadDraft(3, draft.draftId)?.session).not.toBeNull();
    expect(model.calls).toHaveLength(2);
  });

  it("写作工具读到真实人物/组织/前章，提议只进入草稿", async () => {
    const model = fakeClient([
      { kind: "ok", message: modelMessage([
        { type: "tool_use", id: "person", name: "load_character", caller: { type: "direct" }, input: { name: "断剑少年" } },
        { type: "tool_use", id: "setting", name: "load_setting", caller: { type: "direct" }, input: { name: "青云门" } },
        { type: "tool_use", id: "chapter", name: "load_chapter", caller: { type: "direct" }, input: { chapter: 2 } },
        { type: "tool_use", id: "proposal", name: "propose_character_update", caller: { type: "direct" }, input: { name: "李长风", field: "profile.wants", value: "追查失窃账页", reason: "见章末" } },
      ], "tool_use") },
      modelText(PROSE), modelText(C5_JSON),
    ]);
    const { session } = seed(model.client);
    const before = session.meta.characters;
    const response = await write(session, { chapter: 3 });
    expect(response.status).toBe(200);
    const roundTrip = JSON.stringify(model.calls[1]?.messages.at(-1));
    expect(roundTrip).toContain("毒伤尚未痊愈");
    expect(roundTrip).toContain("organization");
    expect(roundTrip).toContain("密库位置的旧图");
    expect((response.body as ChapterDraft).proposals).toHaveLength(1);
    expect(session.meta.characters).toEqual(before);
  });

  it("达标草稿采用后，下一章读取新正文与正式人物状态", async () => {
    const snapshot = writingSnapshot();
    const target = deriveBudget(WRITE_BEAT.plan, snapshot.profile, loadRules()).words.sweet;
    let prose = `${PROSE}\n李长风的毒伤已经痊愈。`;
    // 仅为默认代码闸门提供足量文本；这不是创作质量验收。
    while (countWords(prose) < target) prose += "\n他沿着石壁逐一查看架上的木匣，把封口和旧图上的记号对照，随后记下匣底的编号。";
    const c5 = JSON.stringify({ ...JSON.parse(C5_JSON), character_states: [{ character_id: "C01", field: "condition", from: "毒伤尚未痊愈", to: "毒伤已经痊愈", quote: "李长风的毒伤已经痊愈" }] });
    const model = fakeClient([modelText(prose), modelText(c5)]);
    const { root, session, drafts } = seed(model.client);
    const response = await write(session, { chapter: 3 });
    const draft = response.body as ChapterDraft;
    expect(draft.status, JSON.stringify(draft.findings)).toBe("ready");
    const adopted = handle(session, { method: "POST", path: "/api/chapter/adopt", query: new URLSearchParams(), body: { chapter: 3, draftId: draft.draftId } });
    expect(adopted.status).toBe(200);
    expect(session.chapterText(3)).toBe(prose);
    expect(drafts.workVersion()).toBe(1);

    session.putBeat({ ...WRITE_BEAT, chapter: 4, plan: { ...WRITE_BEAT.plan, chapterType: "event", resolves: [], coreEvent: "血刀客查阅账本" } });
    const next = fakeClient([modelText("血刀客翻开了旧账本。首页留着三叔的名字。"), modelText(JSON.stringify({ ...JSON.parse(C5_JSON), events: [], foreshadow_resolved: [], character_states: [] }))]);
    const continued = await write(new ProjectSession(root, SINGLE_PASS_RULES, { client: next.client }), { chapter: 4 });
    expect(continued.status).toBe(200);
    expect(JSON.stringify(next.calls[0]?.messages)).toContain("李长风 | 主角 | 毒伤已经痊愈");
    expect(JSON.stringify(next.calls[0]?.messages)).toContain(prose.slice(0, PROSE.length));
    expect(drafts.workVersion()).toBe(1);
  });

  it("C5 失败保留正文，重新打开项目后只恢复声明步骤", async () => {
    const first = fakeClient([modelText(PROSE), FAILURE]);
    const { root, session, drafts } = seed(first.client);
    const response = await write(session, { chapter: 3 });
    const failed = response.body as ChapterDraft;
    expect(failed.status).toBe("failed");
    expect(failed.error?.step).toBe("C5");
    expect(drafts.loadDraft(3, failed.draftId)?.body).toBe(PROSE);

    const second = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, SINGLE_PASS_RULES, { client: second.client });
    const resumed = await write(reopened, { chapter: 3, draftId: failed.draftId });
    expect(resumed.status).toBe(200);
    expect((resumed.body as ChapterDraft).draftId).toBe(failed.draftId);
    expect((resumed.body as ChapterDraft).body).toBe(PROSE);
    expect((resumed.body as ChapterDraft).declaration).not.toBeNull();
    expect(second.calls).toHaveLength(1);
    expect(second.calls[0]?.outputSchema).toBeDefined();
    expect(JSON.stringify(second.calls[0]?.messages)).toContain(PROSE);
    expect(drafts.listDrafts(3)).toHaveLength(1);
  });

  it("C4 失败后默认重试沿用原稿和已保存的输出预算", async () => {
    const first = fakeClient([FAILURE]);
    const { root, session } = seed(first.client);
    const failed = (await write(session, { chapter: 3, maxOutputTokens: 9000 })).body as ChapterDraft;
    const second = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    const resumed = await write(new ProjectSession(root, SINGLE_PASS_RULES, { client: second.client }), { chapter: 3 });
    expect((resumed.body as ChapterDraft).draftId).toBe(failed.draftId);
    expect(second.calls[0]?.maxTokens).toBe(9000);
  });

  it("普通重复请求返回现有结果，newDraft 才另写一版", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), modelText(PROSE), modelText(C5_JSON)]);
    const { session, drafts } = seed(model.client);
    const first = await write(session, { chapter: 3 });
    const repeated = await write(session, { chapter: 3 });
    expect(repeated).toEqual(first);
    expect(model.calls).toHaveLength(2);
    const alternate = await write(session, { chapter: 3, newDraft: true });
    expect((alternate.body as ChapterDraft).draftId).not.toBe((first.body as ChapterDraft).draftId);
    expect(drafts.listDrafts(3)).toHaveLength(2);
    expect(model.calls).toHaveLength(4);
  });

  it("重试时明确调整输出预算，后续恢复沿用调整后的值", async () => {
    const first = fakeClient([FAILURE, FAILURE]);
    const { root, session } = seed(first.client);
    await write(session, { chapter: 3, maxOutputTokens: 9000 });
    await write(session, { chapter: 3, maxOutputTokens: 12000 });
    const second = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    await write(new ProjectSession(root, SINGLE_PASS_RULES, { client: second.client }), { chapter: 3 });
    expect(second.calls[0]?.maxTokens).toBe(12000);
  });

  it("未采用上一章时拒绝跳章；历史多章返修不通过这个入口启动", async () => {
    const model = fakeClient([]);
    const { session } = seed(model.client);
    expect((await write(session, { chapter: 4 })).status).toBe(409);
    expect((await write(session, { chapter: 1 })).status).toBe(409);
    expect(model.calls).toHaveLength(0);
  });

  it("未知草稿返回 404；过期版本返回 409", async () => {
    const model = fakeClient([]);
    const { session, drafts } = seed(model.client);
    expect((await write(session, { chapter: 3, draftId: "ch3d99" })).status).toBe(404);
    drafts.saveDraft(savedDraft({ status: "stale" }));
    expect((await write(session, { chapter: 3, draftId: "ch3d1" })).status).toBe(409);
    drafts.saveDraft(savedDraft());
    drafts.bumpWorkVersion();
    expect((await write(session, { chapter: 3 })).status).toBe(409);
    expect(model.calls).toHaveLength(0);
  });

  it("已结束的指定草稿不重新生成", async () => {
    const model = fakeClient([]);
    const { session, drafts } = seed(model.client);
    for (const status of ["adopted", "discarded"] as const) {
      drafts.saveDraft(savedDraft({ status }));
      const response = await write(session, { chapter: 3, draftId: "ch3d1" });
      expect(response.status).toBe(200);
      expect((response.body as ChapterDraft).status).toBe(status);
    }
    expect(model.calls).toHaveLength(0);
  });

  it("设定或节拍在失败后改变，跨会话恢复会要求重新写稿", async () => {
    const model = fakeClient([modelText(PROSE), FAILURE]);
    const { root, session, store } = seed(model.client);
    const failed = (await write(session, { chapter: 3 })).body as ChapterDraft;
    store.writeDiscipline({ version: "changed", rules: ["改为第一人称。"] });
    const second = fakeClient([]);
    const response = await write(new ProjectSession(root, SINGLE_PASS_RULES, { client: second.client }), { chapter: 3, draftId: failed.draftId });
    expect(response.status).toBe(409);
    expect(JSON.stringify(response.body)).toMatch(/资料|节拍|变化/u);
    expect(second.calls).toHaveLength(0);
  });

  it.each([
    null, [], {}, { chapter: "3" }, { chapter: 0 }, { chapter: -1 }, { chapter: 1.5 },
    { chapter: 3, draftId: "../outside" }, { chapter: 3, draftId: "ch2d1" },
    { chapter: 3, draftId: "" }, { chapter: 3, draftId: 1 },
    { chapter: 3, newDraft: "yes" }, { chapter: 3, draftId: "ch3d1", newDraft: true },
    { chapter: 3, maxOutputTokens: 0 }, { chapter: 3, maxOutputTokens: "9000" },
  ])("拒绝非法请求 %j，且不调用模型", async (body) => {
    const model = fakeClient([]);
    const { session } = seed(model.client);
    expect((await write(session, body)).status).toBe(400);
    expect(model.calls).toHaveLength(0);
  });

  it("缺节拍或缺设定在模型调用前返回准备错误", async () => {
    const model = fakeClient([]);
    const noBeat = seed(model.client, { ...writingSnapshot(), beats: [] });
    expect((await write(noBeat.session, { chapter: 3 })).status).toBe(404);
    const noSettings = seed(model.client, { ...writingSnapshot(), settings: [] });
    expect((await write(noSettings.session, { chapter: 3 })).status).toBe(400);
    expect(model.calls).toHaveLength(0);
  });

  it("没有模型配置仍可读项目，首次写章返回 503", async () => {
    vi.spyOn(ClaudeClient, "fromEnv").mockImplementation(() => { throw new Error("缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN"); });
    const { session, drafts } = seed();
    const overview = await handleAsync(session, { method: "GET", path: "/api/overview", query: new URLSearchParams(), body: null });
    expect(overview.status).toBe(200);
    const response = await write(session, { chapter: 3 });
    expect(response.status).toBe(503);
    expect(JSON.stringify(response.body)).toContain("ANTHROPIC_API_KEY");
    expect(drafts.listDrafts(3)).toHaveLength(0);
  });
});

describe("运行中的请求与状态", () => {
  function pausedClient() {
    let release!: (value: CallResult) => void;
    const pending = new Promise<CallResult>((resolve) => { release = resolve; });
    const calls: CallOptions[] = [];
    const client = { official: true, call: vi.fn((options: CallOptions) => {
      calls.push(options);
      return calls.length === 1 ? pending : Promise.resolve(modelText(C5_JSON));
    }) } as unknown as ClaudeClient;
    return { client, calls, release };
  }

  it("重复请求共享任务，运行中可查询同一草稿，冲突请求返回 409", async () => {
    const model = pausedClient();
    const { session, drafts } = seed(model.client);
    const first = write(session, { chapter: 3 });
    const repeated = write(session, { chapter: 3 });
    try {
      await vi.waitFor(() => expect(model.calls).toHaveLength(1));
      const running = drafts.listDrafts(3);
      expect(running).toHaveLength(1);
      expect(running[0]?.status).toBe("writing");
      const conflict = await write(session, { chapter: 2 });
      expect(conflict.status).toBe(409);
      const discarded = handle(session, { method: "POST", path: "/api/chapter/discard", query: new URLSearchParams(), body: { chapter: 3, draftId: running[0]!.draftId } });
      expect(discarded.status).toBe(409);
    } finally { model.release(modelText(PROSE)); }
    expect(await repeated).toEqual(await first);
    expect(model.calls).toHaveLength(2);
    expect(drafts.listDrafts(3)).toHaveLength(1);
  });

  it("生成期间资料改变，保留正文并标为过期，不能直接采用", async () => {
    const model = pausedClient();
    const { session, drafts } = seed(model.client);
    const pending = write(session, { chapter: 3 });
    try {
      await vi.waitFor(() => expect(model.calls).toHaveLength(1));
      session.putBeat({ ...WRITE_BEAT, plan: { ...WRITE_BEAT.plan, hook: "密库石门从身后落下" } });
    } finally { model.release(modelText(PROSE)); }
    const response = await pending;
    const draft = response.body as ChapterDraft;
    expect(draft.status).toBe("stale");
    expect(draft.body).toBe(PROSE);
    expect(drafts.loadDraft(3, draft.draftId)?.status).toBe("stale");
    const adopted = handle(session, { method: "POST", path: "/api/chapter/adopt", query: new URLSearchParams(), body: { chapter: 3, draftId: draft.draftId } });
    expect(adopted.status).toBe(409);
  });

  it("HTTP 请求断开后任务继续，返回查询原稿不会再次生成", async () => {
    const model = pausedClient();
    const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, loadRules()).words.sweet;
    const complete = PROSE + "风".repeat(target - countWords(PROSE));
    const { root, drafts } = seed();
    const server = serve({ projectRoot: root, port: 0, client: model.client });
    servers.push(server);
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const controller = new AbortController();
    const request = fetch(`${url}/api/chapter/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapter: 3 }), signal: controller.signal }).catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(model.calls).toHaveLength(1));
      controller.abort();
      await request;
    } finally { model.release(modelText(complete)); }
    await vi.waitFor(() => expect(drafts.latestDraft(3)?.status).toBe("ready"));
    const response = await fetch(`${url}/api/chapter/drafts?n=3`);
    const list = await response.json() as ChapterDraft[];
    expect(list).toHaveLength(1);
    expect(list[0]?.body).toBe(complete);
    expect(model.calls).toHaveLength(2);
  });
});

describe("HTTP 写章传输", () => {
  it("真实 HTTP 等待异步任务完成，既有查询继续可用", async () => {
    const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, loadRules()).words.sweet;
    const complete = PROSE + "风".repeat(target - countWords(PROSE));
    const model = fakeClient([modelText(complete), modelText(C5_JSON)]);
    const { root } = seed();
    const server = serve({ projectRoot: root, port: 0, client: model.client });
    servers.push(server);
    await once(server, "listening");
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const response = await fetch(`${url}/api/chapter/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapter: 3 }) });
    expect(response.status).toBe(200);
    const draft = await response.json() as ChapterDraft;
    expect(draft.body).toBe(complete);
    expect(draft).not.toHaveProperty("session");
    const detail = await fetch(`${url}/api/chapter/draft?n=3&id=${draft.draftId}`);
    expect(await detail.json()).toEqual(draft);
    const invalid = await fetch(`${url}/api/chapter/write`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ chapter: -1 }) });
    expect(invalid.status).toBe(400);
  });
});
