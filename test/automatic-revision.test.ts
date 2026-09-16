import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import { draftRevisionToken } from "../src/task/revision.js";
import { loadRules } from "../src/rules/load.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import type { ModelClient } from "../src/client/model.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, WRITE_BEAT, fakeClient, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const rules = NO_MODEL_REVIEW;
const withLimit = (limit: number) => ({ ...rules, task: { ...rules.task, maxAutoRevisions: limit } });
const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, rules).words.sweet;
const completeBody = PROSE + "\n" + "风".repeat(target - countWords(PROSE));
const rewrite = (body = completeBody): CallResult => modelText(JSON.stringify({ decision: "apply", replacement: body, summary: "补足取得账本前的交涉", scopeAdvice: "" }));
const disconnected: CallResult = { kind: "error", error: { type: "connection", status: null, message: "测试连接中断", retryable: true } };
function fixture(client: ModelClient, limit = 1) {
  const root = mkdtempSync(join(tmpdir(), "nf-auto-revision-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, store: new DraftStore(root), session: new ProjectSession(root, withLimit(limit), { client }) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("一次写章的有界自动修订", () => {
  it("短稿只修订一次，保留初稿及检查，并用新全文重新核对后等待采用", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), rewrite(), modelText(C5_JSON)]);
    const { session, store } = fixture(model.client);
    const result = await session.writeChapter({ chapter: 3, requestId: "one-writing-task" });
    expect(result.draftId).toBe("ch3d2");
    expect(result).toMatchObject({ draftId: "ch3d2", status: "ready", body: completeBody, autoRevisionsUsed: 1, revision: { kind: "automatic", sourceDraftId: "ch3d1" } });
    expect(store.loadDraft(3, "ch3d1")).toMatchObject({ body: PROSE, status: "needs_revision", automaticResultDraftId: "ch3d2", autoRevisionsUsed: 1, findings: expect.arrayContaining([expect.objectContaining({ rule: "route_patch", level: "block" })]) });
    expect(model.calls).toHaveLength(4);
    expect(JSON.stringify(model.calls[2]!.messages)).toContain("route_patch");
    expect(JSON.stringify(model.calls[3]!.messages)).toContain(completeBody.replace(/\n/gu, "\\n"));
    expect(result.execution?.usage.calls).toBe(4);
    expect(store.loadDraft(3, "ch3d1")?.execution?.usage.calls).toBe(2);
    expect(session.chapterText(3)).toBeUndefined();
    expect(session.startChapter({ chapter: 3, requestId: "one-writing-task" }).draftId).toBe("ch3d2");
    expect(model.calls).toHaveLength(4);
  });

  it("修订后仍有必须处理项就停止，规则额度大于一也不创建第三版", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), rewrite(PROSE + "门关了。"), modelText(C5_JSON)]);
    const { session, root } = fixture(model.client, 5);
    const result = await session.writeChapter({ chapter: 3 });
    expect(result).toMatchObject({ draftId: "ch3d2", status: "needs_revision", acceptable: false, autoRevisionsUsed: 1, writeContext: { autoRevisionLimit: 1 } });
    expect(session.listDrafts(3)).toHaveLength(2);
    expect(model.calls).toHaveLength(4);
    const reopened = new ProjectSession(root, withLimit(5), { client: model.client });
    expect((await reopened.writeChapter({ chapter: 3, draftId: "ch3d1" })).draftId).toBe("ch3d2");
    expect(() => reopened.adopt(3, result.draftId)).toThrow();
    expect(model.calls).toHaveLength(4);
  });

  it.each([0, 1])("额度 %i 时合格初稿不增加模型调用", async limit => {
    const model = fakeClient([modelText(completeBody), modelText(C5_JSON)]);
    const { session } = fixture(model.client, limit);
    expect(await session.writeChapter({ chapter: 3 })).toMatchObject({ draftId: "ch3d1", status: "ready", writeContext: { autoRevisionLimit: limit } });
    expect(model.calls).toHaveLength(2);
    expect(session.listDrafts(3)).toHaveLength(1);
  });

  it("额度零的短稿直接交付问题", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    const { session } = fixture(model.client, 0);
    expect(await session.writeChapter({ chapter: 3 })).toMatchObject({ status: "needs_revision", writeContext: { autoRevisionLimit: 0 } });
    expect(model.calls).toHaveLength(2);
  });

  it("不完整的自动替换不应用；明确重试沿同一新版本恢复，不新增修订次数", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), modelText("{invalid")]);
    const { session, root, store } = fixture(model.client);
    const failed = await session.writeChapter({ chapter: 3 });
    expect(failed).toMatchObject({ draftId: "ch3d2", status: "failed", body: PROSE, error: { step: "C4" }, autoRevisionsUsed: 1 });
    expect(store.loadDraft(3, "ch3d1")?.body).toBe(PROSE);
    const next = fakeClient([rewrite(), modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, withLimit(1), { client: next.client });
    expect(reopened.chapterTasks().find(task => task.draftId === failed.draftId)?.status).toBe("failed");
    expect(next.calls).toHaveLength(0);
    expect(await reopened.writeChapter({ chapter: 3, draftId: "ch3d1" })).toMatchObject({ draftId: "ch3d2", body: completeBody, status: "ready", autoRevisionsUsed: 1 });
    expect(next.calls).toHaveLength(2);
    expect(reopened.listDrafts(3)).toHaveLength(2);
  });

  it("自动修订的 C5 失败后跨会话只重做 C5，保留修改正文", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), rewrite(), disconnected]);
    const { session, root } = fixture(model.client);
    const failed = await session.writeChapter({ chapter: 3 });
    expect(failed.draftId).toBe("ch3d2");
    expect(failed).toMatchObject({ draftId: "ch3d2", body: completeBody, error: { step: "C5" } });
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, withLimit(1), { client: next.client });
    const result = await reopened.writeChapter({ chapter: 3, draftId: failed.draftId });
    expect(result).toMatchObject({ body: completeBody, status: "ready", execution: { usage: { calls: 5 } } });
    expect(next.calls).toHaveLength(1);
    expect(reopened.listDrafts(3)).toHaveLength(2);
  });

  it("原任务的暂停作用于自动稿，刷新不重启，继续时只做剩余检查", async () => {
    const waiting = deferred<CallResult>();
    let calls = 0;
    const { session, root } = fixture({ official: false, call: async () => {
      calls++;
      return calls === 1 ? modelText(PROSE) : calls === 2 ? modelText(C5_JSON) : waiting.promise;
    } });
    const operation = session.writeChapter({ chapter: 3 });
    await expect.poll(() => calls, { timeout: 1000 }).toBe(3);
    expect(session.chapterTasks().find(task => !task.isHistory)).toMatchObject({ draftId: "ch3d2", status: "running", stage: "revising" });
    expect(session.controlChapter(3, "ch3d1", "pause")).toMatchObject({ draftId: "ch3d2", status: "pausing" });
    waiting.resolve(rewrite());
    expect(await operation).toMatchObject({ draftId: "ch3d2", body: completeBody, execution: { status: "paused" } });
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, withLimit(1), { client: next.client });
    expect(reopened.chapterTasks().find(task => !task.isHistory)?.status).toBe("paused");
    expect(next.calls).toHaveLength(0);
    expect(await reopened.writeChapter({ chapter: 3, draftId: "ch3d1" })).toMatchObject({ draftId: "ch3d2", status: "ready", execution: { usage: { calls: 4 } } });
    expect(next.calls).toHaveLength(1);
  });

  it("C5 返回前作品依据变化，不发起自动修订", async () => {
    let calls = 0;
    const client: ModelClient = { official: false, call: async () => {
      if (++calls === 1) return modelText(PROSE);
      session.putDiscipline({ version: "changed", rules: ["对白简短。"] });
      return modelText(C5_JSON);
    } };
    const { session } = fixture(client);
    expect(await session.writeChapter({ chapter: 3 })).toMatchObject({ draftId: "ch3d1", status: "stale", body: PROSE });
    expect(calls).toBe(2);
    expect(session.listDrafts(3)).toHaveLength(1);
  });

  it("需要扩大范围时只交建议，不采用未应用的替换，也不继续 C5", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), modelText(JSON.stringify({ decision: "expand_scope", replacement: "不应生效", summary: "需要补充方向", scopeAdvice: "需要决定密库外的追兵是否出现。" }))]);
    const { session } = fixture(model.client);
    const result = await session.writeChapter({ chapter: 3 });
    expect(result).toMatchObject({ draftId: "ch3d2", body: PROSE, acceptable: false, revision: { scopeAdvice: "需要决定密库外的追兵是否出现。" } });
    expect(session.chapterTasks().find(task => !task.isHistory)?.status).toBe("awaiting_input");
    expect(model.calls).toHaveLength(3);
  });

  it("结构引文无依据时不重写正文迎合记录", async () => {
    const wrong = JSON.parse(C5_JSON);
    wrong.foreshadow_resolved[0].quote = "这句引文完全不在正文中";
    const model = fakeClient([modelText(completeBody), modelText(JSON.stringify(wrong))]);
    const { session } = fixture(model.client);
    const result = await session.writeChapter({ chapter: 3 });
    expect(result.status).toBe("needs_revision");
    expect(result.findings.some(finding => finding.level === "block")).toBe(true);
    expect(result.body).toBe(completeBody);
    expect(model.calls).toHaveLength(2);
    expect(session.listDrafts(3)).toHaveLength(1);
  });

  it("作者编辑后的检查不触发自动正文修改", async () => {
    const model = fakeClient([modelText(C5_JSON)]);
    const { session, store } = fixture(model.client);
    const source = savedDraft({ body: completeBody }); store.saveDraft(source);
    const edited = session.editDraft({ chapter: 3, draftId: source.draftId, revisionToken: draftRevisionToken(source), body: PROSE });
    session.checkDraft({ chapter: 3, draftId: edited.draftId, revisionToken: draftRevisionToken(edited), adoptOnSuccess: false });
    const result = await session.writeChapter({ chapter: 3, draftId: edited.draftId });
    expect(result).toMatchObject({ draftId: edited.draftId, status: "needs_revision", body: PROSE });
    expect(model.calls).toHaveLength(1);
    expect(session.listDrafts(3)).toHaveLength(2);
  });

  it("规则上调不能给旧任务追加额度，来源变化时先要求重新核对", async () => {
    const waiting = deferred<CallResult>(); let calls = 0;
    const { session, root } = fixture({ official: false, call: async () => { calls++; return waiting.promise; } }, 0);
    const operation = session.writeChapter({ chapter: 3 });
    await expect.poll(() => calls).toBe(1);
    session.controlChapter(3, "ch3d1", "pause"); waiting.resolve(modelText(PROSE));
    const paused = await operation;
    const next = fakeClient([modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, withLimit(8), { client: next.client });
    expect(() => reopened.writeChapter({ chapter: 3, draftId: paused.draftId })).toThrow(/发生变化/u);
    expect(reopened.getDraft(3, paused.draftId)).toMatchObject({ status: "stale", writeContext: { autoRevisionLimit: 0 } });
    expect(next.calls).toHaveLength(0);
  });

  it("检查明确选择的初稿不被自动链接替换为新稿", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON), rewrite(), modelText(C5_JSON)]);
    const { session, store } = fixture(model.client);
    const automatic = await session.writeChapter({ chapter: 3 });
    expect(automatic.draftId).toBe("ch3d2");
    const original = store.loadDraft(3, "ch3d1")!;
    session.checkDraft({ chapter: 3, draftId: original.draftId, revisionToken: draftRevisionToken(original), adoptOnSuccess: false });
    await expect.poll(() => session.chapterTasks().some(task => task.status === "running")).toBe(false);
    expect(store.loadDraft(3, "ch3d1")).toMatchObject({ body: PROSE, status: "needs_revision" });
    expect(store.loadDraft(3, "ch3d2")).toMatchObject({ body: completeBody, status: "ready" });
    expect(model.calls).toHaveLength(4);
  });

  it("自动版本保存失败时回滚初稿链接，重试仍只创建一份修订", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    const { session, root, store } = fixture(model.client);
    const originalSave = DraftStore.prototype.saveDraft;
    let failOnce = true;
    vi.spyOn(DraftStore.prototype, "saveDraft").mockImplementation(function (this: DraftStore, draft) {
      originalSave.call(this, draft);
      if (failOnce && draft.revision?.kind === "automatic") { failOnce = false; throw new Error("模拟保存修订版本中断"); }
    });
    expect(await session.writeChapter({ chapter: 3 })).toMatchObject({ draftId: "ch3d1", status: "failed", body: PROSE, error: { step: "C6" } });
    expect(store.loadDraft(3, "ch3d1")?.automaticResultDraftId).toBeUndefined();
    expect(store.listDrafts(3)).toHaveLength(1);
    expect(model.calls).toHaveLength(2);
    const next = fakeClient([rewrite(), modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, withLimit(1), { client: next.client });
    expect(await reopened.writeChapter({ chapter: 3, draftId: "ch3d1" })).toMatchObject({ draftId: "ch3d2", status: "ready", autoRevisionsUsed: 1 });
    expect(store.listDrafts(3)).toHaveLength(2);
    expect(next.calls).toHaveLength(2);
  });

  it("自动修订中结束会保存返回的正文，重开不能借原任务 ID 再次执行", async () => {
    const waiting = deferred<CallResult>(); let calls = 0;
    const { session, root } = fixture({ official: false, call: async () => {
      calls++;
      return calls === 1 ? modelText(PROSE) : calls === 2 ? modelText(C5_JSON) : waiting.promise;
    } });
    const operation = session.writeChapter({ chapter: 3 });
    await expect.poll(() => calls).toBe(3);
    expect(session.controlChapter(3, "ch3d1", "end").status).toBe("ending");
    waiting.resolve(rewrite());
    expect(await operation).toMatchObject({ draftId: "ch3d2", body: completeBody, execution: { status: "ended" } });
    const next = fakeClient([]);
    const reopened = new ProjectSession(root, withLimit(1), { client: next.client });
    expect(() => reopened.writeChapter({ chapter: 3, draftId: "ch3d1" })).toThrow(/结束/u);
    expect(next.calls).toHaveLength(0);
    expect(reopened.listDrafts(3)).toHaveLength(2);
  });
});
