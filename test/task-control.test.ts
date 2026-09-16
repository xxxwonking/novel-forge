import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import type { CallOptions, CallResult } from "../src/client/claude.js";
import type { ModelClient } from "../src/client/model.js";
import { handle, handleAsync } from "../src/server/api.js";
import { C5_JSON, PROSE, SINGLE_PASS_RULES, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function fixture(client: ModelClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-task-control-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, SINGLE_PASS_RULES, { client }) };
}
const request = (path: string, body?: unknown) => ({ method: body === undefined ? "GET" : "POST", path, body, query: new URLSearchParams() });

describe("章节任务控制与返回恢复", () => {
  it("启动立即返回持久化任务，重复请求和只读查询连接同一任务", async () => {
    const waiting = deferred<CallResult>();
    let calls = 0;
    const client: ModelClient = { official: false, call: async () => ++calls === 1 ? waiting.promise : modelText(C5_JSON) };
    const { session } = fixture(client);
    const first = session.startChapter({ chapter: 3 });
    expect(first.draftId).toBe("ch3d1");
    expect(first.execution?.status).toBe("running");
    expect(session.getDraft(3, first.draftId)).toBeDefined();
    expect(session.startChapter({ chapter: 3 }).draftId).toBe(first.draftId);
    expect(session.chapterTasks()[0]).toMatchObject({ draftId: first.draftId, status: "running", stage: "writing" });
    const completed = session.writeChapter({ chapter: 3, draftId: first.draftId });
    waiting.resolve(modelText(PROSE));
    const result = await completed;
    expect(calls).toBe(2);
    expect(result.execution?.status).toBe("completed");
    expect(result.status).toBe("needs_revision"); // 任务完成不能绕过字数闸门。
    expect(session.startChapter({ chapter: 3 }).draftId).toBe(first.draftId);
    expect(session.currentChapter).toBe(2);
  });

  it("正文请求中暂停会保留返回正文，阻止 C5，重开后只恢复未完成步骤", async () => {
    const waiting = deferred<CallResult>();
    const entered = deferred<void>();
    let calls = 0;
    const { root, session } = fixture({ official: false, call: async () => { calls++; entered.resolve(); return waiting.promise; } });
    const operation = session.writeChapter({ chapter: 3 });
    await entered.promise;
    expect(session.controlChapter(3, "ch3d1", "pause").status).toBe("pausing");
    expect(session.controlChapter(3, "ch3d1", "pause").status).toBe("pausing");
    waiting.resolve(modelText(PROSE));
    const paused = await operation;
    expect(paused.body).toBe(PROSE);
    expect(paused.execution?.status).toBe("paused");
    expect(paused.declaration).toBeNull();
    expect(calls).toBe(1);
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, SINGLE_PASS_RULES, { client: next.client });
    expect(reopened.chapterTasks()[0]?.status).toBe("paused");
    expect(next.calls).toHaveLength(0);
    const resumed = await reopened.writeChapter({ chapter: 3, draftId: paused.draftId });
    expect(resumed.body).toBe(PROSE);
    expect(resumed.execution?.status).toBe("completed");
    expect(next.calls).toHaveLength(1);
    expect(resumed.execution?.usage.calls).toBe(2);
  });

  it("结构核对中结束保留已返回声明，不能把结束当成采用或悄悄恢复", async () => {
    const waiting = deferred<CallResult>(); const entered = deferred<void>(); let calls = 0;
    const { session } = fixture({ official: false, call: async () => { if (++calls === 1) return modelText(PROSE); entered.resolve(); return waiting.promise; } });
    const operation = session.writeChapter({ chapter: 3 }); await entered.promise;
    expect(session.chapterTasks()[0]?.stage).toBe("declaring");
    expect(session.controlChapter(3, "ch3d1", "end").status).toBe("ending");
    waiting.resolve(modelText(C5_JSON));
    const ended = await operation;
    expect(ended.execution?.status).toBe("ended");
    expect(ended.body).toBe(PROSE);
    expect(ended.declaration).not.toBeNull();
    expect(ended.acceptable).toBe(false);
    expect(() => session.writeChapter({ chapter: 3, draftId: ended.draftId })).toThrow(/结束/u);
    expect(session.controlChapter(3, ended.draftId, "end").status).toBe("ended");
    expect(session.currentChapter).toBe(2);
  });

  it("磁盘运行标记没有活动任务时显示未完成，查询不触发生成或改写历史", () => {
    const model = fakeClient([]); const { root } = fixture(model.client);
    const store = new DraftStore(root);
    store.saveDraft(savedDraft({ status: "writing", body: "", declaration: null, acceptable: false }));
    const reopened = new ProjectSession(root, SINGLE_PASS_RULES, { client: model.client });
    expect(reopened.chapterTasks()[0]).toMatchObject({ status: "interrupted", stage: "writing", draftId: "ch3d1" });
    expect(handle(reopened, request("/api/tasks")).body).toMatchObject([{ status: "interrupted" }]);
    expect(store.loadDraft(3, "ch3d1")?.status).toBe("writing");
    expect(model.calls).toHaveLength(0);
  });

  it("HTTP 启动和控制复用业务入口，拒绝其他章节与未知控制动作", async () => {
    const waiting = deferred<CallResult>(); const entered = deferred<void>();
    const { session } = fixture({ official: false, call: async () => { entered.resolve(); return waiting.promise; } });
    const started = await handleAsync(session, request("/api/chapter/start", { chapter: 3 }));
    expect(started.status).toBe(200);
    expect(started.body).toMatchObject({ chapter: 3, draftId: "ch3d1", execution: { status: "running" } });
    expect(started.body).not.toHaveProperty("session");
    await entered.promise;
    expect(handle(session, request("/api/chapter/control", { chapter: 4, draftId: "ch3d1", action: "pause" })).status).toBe(400);
    expect(handle(session, request("/api/chapter/control", { chapter: 3, draftId: "ch3d1", action: "delete" })).status).toBe(400);
    const stop = handle(session, request("/api/chapter/control", { chapter: 3, draftId: "ch3d1", action: "pause" }));
    expect(stop.body).toMatchObject({ status: "pausing" });
    const operation = session.writeChapter({ chapter: 3, draftId: "ch3d1" });
    waiting.resolve(modelText(PROSE)); await operation;
  });

  it("模型异常时保留已有正文并记录失败步骤，运行状态不会永久卡住", async () => {
    let calls = 0;
    const { session } = fixture({ official: false, call: async () => { if (++calls === 1) return modelText(PROSE); throw new Error("connection closed"); } });
    const result = await session.writeChapter({ chapter: 3 });
    expect(result.body).toBe(PROSE);
    expect(result.error).toMatchObject({ step: "C5", detail: "connection closed" });
    expect(session.chapterTasks()[0]?.status).toBe("failed");
  });

  it("输出被截断时保留片段，不启动结构检查或把半章当成完整稿", async () => {
    const model = fakeClient([{ kind: "max_tokens", message: modelMessage([{ type: "text", text: PROSE, citations: [] }], "max_tokens") }]);
    const { session } = fixture(model.client);
    const result = await session.writeChapter({ chapter: 3 });
    expect(result.body).toBe(PROSE);
    expect(result.status).toBe("failed");
    expect(result.error).toMatchObject({ step: "C4" });
    expect(result.error?.detail).toMatch(/截断|上限/u);
    expect(result.acceptable).toBe(false);
    expect(model.calls).toHaveLength(1);
  });

  it("暂停时当前请求报错仍保留暂停决定与失败原因", async () => {
    const waiting = deferred<CallResult>(); const entered = deferred<void>();
    const { session } = fixture({ official: false, call: async () => { entered.resolve(); return waiting.promise; } });
    const operation = session.writeChapter({ chapter: 3 }); await entered.promise;
    session.controlChapter(3, "ch3d1", "pause");
    waiting.resolve({ kind: "error", error: { type: "connection", status: null, message: "lost response", retryable: true } });
    const draft = await operation;
    expect(session.chapterTasks()[0]).toMatchObject({ status: "paused", detail: "lost response" });
    expect(draft.execution?.usage.unmeasuredCalls).toBe(1);
  });

  it("写章请求返回后对话立即可用，作者下一轮能通过工具暂停同一任务", async () => {
    const waiting = deferred<CallResult>(); const entered = deferred<void>(); let judge = 0;
    const tool = (name: string, input: Record<string, unknown>): CallResult => ({ kind: "ok", message: modelMessage([{ type: "tool_use", id: `tool-${judge}`, name, input, caller: { type: "direct" } }], "tool_use") });
    const client: ModelClient = { official: false, call: async (options: CallOptions) => {
      if (options.role === "creative") { if (options.outputSchema) return modelText(C5_JSON); entered.resolve(); return waiting.promise; }
      judge++;
      if (judge === 1) return tool("write_next_chapter", {});
      if (judge === 2) return tool("control_chapter_task", { draftId: "ch3d1", action: "pause" });
      throw new Error("后台任务受理后不应额外调用主 Agent");
    } };
    const { session } = fixture(client);
    const reply = session.converse("按计划写下一章");
    await entered.promise;
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(judge).toBe(1);
      const started = await reply;
      expect(started.effects).toContainEqual(expect.objectContaining({ kind: "chapter_started", draftId: "ch3d1" }));
      expect(started.text).toContain("后台");
      expect(session.chapterTasks()[0]).toMatchObject({ status: "running", stage: "writing" });
      expect(session.currentChapter).toBe(2);
      expect(session.getDraft(3, "ch3d1")?.body).toBe("");
      const paused = await session.converse("暂停 ch3d1");
      expect(paused.effects).toContainEqual(expect.objectContaining({ kind: "task_updated", draftId: "ch3d1", status: "pausing" }));
      expect(paused.text).toContain("当前模型调用返回并保存内容后生效");
      expect(judge).toBe(2);
      expect(session.conversationTurns()).toHaveLength(4);
    } finally {
      const work = session.writeChapter({ chapter: 3, draftId: "ch3d1" });
      waiting.resolve(modelText(PROSE)); await work; await reply;
    }
    expect(session.chapterTasks()[0]?.status).toBe("paused");
  });

  it("真实子进程在 C5 请求中退出后，重开只恢复 C5，保留正文及未计量调用", async () => {
    const model = fakeClient([modelText(C5_JSON)]);
    const { root } = fixture(model.client);
    const childScript = `import { ProjectSession } from ${JSON.stringify(pathToFileURL(resolve("src/server/state.ts")).href)};
      import { loadRules } from ${JSON.stringify(pathToFileURL(resolve("src/rules/load.ts")).href)};
      // 与父进程同一套规则（含关掉两个 model 通道）：采用前的来源指纹里含 rules，
      // 两边不一致会被判成"作品资料发生变化"。
      const rules = { ...loadRules(), review: { voice: false, semantics: false } };
      let calls = 0;
      const client = { official: false, call: async () => { if (++calls === 1) return ${JSON.stringify(modelText(PROSE))}; process.exit(17); } };
      await new ProjectSession(${JSON.stringify(root)}, { ...rules, task: { ...rules.task, maxAutoRevisions: 0 } }, { client }).writeChapter({ chapter: 3 });`;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", childScript], { cwd: process.cwd(), encoding: "utf8", timeout: 10000 });
    expect(child.status, child.stderr).toBe(17);
    const reopened = new ProjectSession(root, SINGLE_PASS_RULES, { client: model.client });
    const task = reopened.chapterTasks()[0]!;
    expect(task).toMatchObject({ status: "interrupted", stage: "declaring" });
    expect(reopened.getDraft(3, "ch3d1")?.body).toBe(PROSE);
    expect(task.usage.unmeasuredCalls).toBe(1);
    expect(model.calls).toHaveLength(0);
    const result = await reopened.writeChapter({ chapter: 3, draftId: "ch3d1" });
    expect(result.body).toBe(PROSE);
    expect(model.calls).toHaveLength(1);
    expect(result.execution?.usage).toMatchObject({ calls: 3, unmeasuredCalls: 1 });
  });

  it("重新生成截断正文时阶段应显示创作中，不能误显示为核对结构", async () => {
    const waiting = deferred<CallResult>(); const entered = deferred<void>(); let calls = 0;
    const model: ModelClient = { official: false, call: async (options) => {
      if (++calls === 1) return { kind: "max_tokens", message: modelMessage([{ type: "text", text: PROSE, citations: [] }]) };
      if (options.outputSchema) return modelText(C5_JSON);
      entered.resolve(); return waiting.promise;
    } };
    const { session } = fixture(model);
    await session.writeChapter({ chapter: 3 });
    const operation = session.writeChapter({ chapter: 3, draftId: "ch3d1" }); await entered.promise;
    try { expect(session.chapterTasks()[0]?.stage).toBe("writing"); }
    finally { waiting.resolve(modelText(PROSE)); await operation; }
  });

  it("另写请求完成后重试同一请求编号仍返回原版本，不再消耗模型调用", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), modelText(PROSE), modelText(C5_JSON)]);
    const { session } = fixture(model.client);
    const request = { chapter: 3, newDraft: true, requestId: "retry-after-lost-response" };
    const first = await session.writeChapter(request);
    const replay = await session.writeChapter(request);
    expect(replay.draftId).toBe(first.draftId);
    expect(model.calls).toHaveLength(2);
    expect(() => session.writeChapter({ ...request, chapter: 4 })).toThrow(/请求|编号/u);
    const next = await session.writeChapter({ ...request, requestId: "explicit-new-version" });
    expect(next.draftId).toBe("ch3d2");
    expect(model.calls).toHaveLength(4);
  });
});
