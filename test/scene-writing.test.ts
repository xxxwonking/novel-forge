import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handleAsync } from "../src/server/api.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import { DraftStore } from "../src/task/draft-store.js";
import { C5_JSON, PROSE, SINGLE_PASS_RULES, WRITE_BEAT, fakeClient, modelText, writingSnapshot } from "./writing-fixtures.js";
import type { CallResult } from "../src/client/claude.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const budget = { maxCalls: 16, maxCredits: 50 };
const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, SINGLE_PASS_RULES).words.sweet;
const count = Math.max(2, Math.min(6, Math.ceil(target / 900)));
const scenes = Array.from({ length: count }, (_, i) => ({ title: `场景${i + 1}`, goal: `按照计划推进第${i + 1}段行动`, eventIndices: i === 0 ? [0] : [] }));
const bodies = Array.from({ length: count }, (_, i) => (i === 0 ? PROSE : "") + ["风", "雨", "灯", "石", "门", "路"][i]!.repeat(Math.ceil((target - countWords(PROSE)) / count)));
const priced = (text: string): CallResult => { const r = modelText(text); return r.kind === "error" ? r : { ...r, message: { ...r.message, model: "gemini-3-flash" } }; };
const replies = () => [priced(JSON.stringify({ scenes })), ...bodies.map(priced), priced(C5_JSON)];
const failure: CallResult = { kind: "error", error: { type: "connection", status: null, message: "连接中断", retryable: true } };
function fixture(results: CallResult[]) {
  const root = mkdtempSync(join(tmpdir(), "nf-scenes-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const model = fakeClient(results);
  return { root, model, session: new ProjectSession(root, SINGLE_PASS_RULES, { client: model.client }) };
}

describe("有界分场写章", () => {
  it("逐场生成后以完整正文检查，下一场包含已经完成的正文", async () => {
    const { session, model } = fixture(replies());
    const result = await session.writeChapter({ chapter: 3, sceneWriting: budget });
    expect(result.status).toBe("ready");
    expect(result.body).toBe(bodies.join("\n\n"));
    expect(result.scenes?.completed).toEqual(bodies);
    expect(JSON.stringify(model.calls[2]?.messages)).toContain(PROSE);
    expect(JSON.stringify(model.calls.at(-1)?.messages)).toContain(bodies.at(-1));
    expect(model.calls).toHaveLength(count + 2);
    expect(result.execution?.usage.credits).toBeGreaterThan(0);
    expect(session.chapterText(3)).toBeUndefined();
  });

  it("连接失败保留已完成场景与片段，重启不会重跑拆场和已完成正文", async () => {
    const { session, root, model } = fixture([priced(JSON.stringify({ scenes })), priced(bodies[0]!), { ...failure, partialText: "未完成的行动片段" }]);
    const failed = await session.writeChapter({ chapter: 3, sceneWriting: budget });
    expect(failed).toMatchObject({ status: "failed", scenes: { completed: [bodies[0]], partial: "未完成的行动片段" } });
    expect(failed.body).toContain(bodies[0]);
    expect(failed.body).toContain("未完成的行动片段");
    const next = fakeClient([...bodies.slice(1).map(priced), priced(C5_JSON)]);
    const resumed = await new ProjectSession(root, SINGLE_PASS_RULES, { client: next.client }).writeChapter({ chapter: 3, draftId: failed.draftId });
    // 未报告费用不能假装免费继续：显式保留恢复入口但先要求核对额度。
    expect(resumed.error?.detail).toMatch(/用量|计价|额度/u);
    expect(next.calls).toHaveLength(0);
    expect(model.calls).toHaveLength(3);
    const acknowledged = await new ProjectSession(root, SINGLE_PASS_RULES, { client: next.client }).writeChapter({ chapter: 3, draftId: failed.draftId, acknowledgeUnknownUsage: true });
    expect(acknowledged.status).toBe("ready");
    expect(acknowledged.body).toBe(bodies.join("\n\n"));
    expect(next.calls).toHaveLength(count);
    expect(acknowledged.execution?.usage.calls).toBe(count + 3);
  });

  it("拆场遗漏原计划事件时停止，不编写正文", async () => {
    const { session, model } = fixture([priced(JSON.stringify({ scenes: scenes.map(s => ({ ...s, eventIndices: [] })) }))]);
    const result = await session.writeChapter({ chapter: 3, sceneWriting: budget });
    expect(result).toMatchObject({ status: "failed", body: "" });
    expect(result.error?.detail).toContain("事件");
    expect(model.calls).toHaveLength(1);
  });

  it("同一计划事件可以分成不同阶段推进，引用同一事件不等于重复写事件", async () => {
    const { session } = fixture([priced(JSON.stringify({ scenes: scenes.map(s => ({ ...s, eventIndices: [0] })) })), ...bodies.map(priced), priced(C5_JSON)]);
    expect((await session.writeChapter({ chapter: 3, sceneWriting: budget })).status).toBe("ready");
  });

  it("总调用额度包含拆场和声明，耗尽时保留正文而不采用", async () => {
    const { session, model } = fixture(replies());
    const result = await session.writeChapter({ chapter: 3, sceneWriting: { ...budget, maxCalls: 2 } });
    expect(result.status).toBe("failed");
    expect(result.body).toBe(bodies[0]);
    expect(result.error?.detail).toContain("调用");
    expect(model.calls).toHaveLength(2);
    expect(session.chapterText(3)).toBeUndefined();
  });

  it("调用方在异步执行中修改原配置对象不能提高已冻结额度", async () => {
    const { session, model } = fixture(replies());
    const limits = { ...budget, maxCalls: 2 };
    const pending = session.writeChapter({ chapter: 3, sceneWriting: limits });
    limits.maxCalls = 100;
    expect((await pending).status).toBe("failed");
    expect(model.calls).toHaveLength(2);
  });

  it("自动修订继承同一总调用额度，不能另开一份预算", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-scene-revision-")); roots.push(root);
    new ProjectStore(root).save(writingSnapshot());
    const model = fakeClient([priced(JSON.stringify({ scenes })), ...scenes.map((_, i) => priced(i === 0 ? PROSE : `短场景${i}。`)), priced(C5_JSON)]);
    const session = new ProjectSession(root, { ...SINGLE_PASS_RULES, task: { ...SINGLE_PASS_RULES.task, maxAutoRevisions: 1 } }, { client: model.client });
    const result = await session.writeChapter({ chapter: 3, sceneWriting: { ...budget, maxCalls: count + 2 } });
    expect(result).toMatchObject({ status: "failed", autoRevisionsUsed: 1 });
    expect(result.error?.detail).toContain("调用额度");
    expect(result.writeContext?.sceneWriting?.maxCalls).toBe(count + 2);
    expect(model.calls).toHaveLength(count + 2);
  });

  it("损坏的已存用量不能绕过总额度恢复", async () => {
    const { session, root, model } = fixture(replies());
    const saved = await session.writeChapter({ chapter: 3, sceneWriting: { ...budget, maxCalls: 2 } });
    new DraftStore(root).saveDraft({ ...saved, execution: { ...saved.execution!, usage: { ...saved.execution!.usage, calls: -1 } } });
    const result = await session.writeChapter({ chapter: 3, draftId: saved.draftId });
    expect(result.error?.detail).toContain("用量记录");
    expect(model.calls).toHaveLength(2);
  });

  it("恢复不能换额度，也不能用同一请求号把旧协议换成新协议", async () => {
    const { session } = fixture(replies());
    const result = await session.writeChapter({ chapter: 3, sceneWriting: { ...budget, maxCalls: 2 }, requestId: "scene-request" });
    expect(() => session.writeChapter({ chapter: 3, draftId: result.draftId, sceneWriting: budget })).toThrow(/额度|配置/u);
    expect(() => session.writeChapter({ chapter: 3, requestId: "scene-request", sceneWriting: budget })).toThrow(/额度|配置|请求/u);
  });

  it("暂停后跨进程只续未完成场景，C5失败也不重写整章", async () => {
    const { root, session, model } = fixture(replies());
    const original = model.client.call.bind(model.client);
    model.client.call = async options => {
      const result = await original(options);
      if (model.calls.length === 2) session.controlChapter(3, "ch3d1", "pause");
      return result;
    };
    const paused = await session.writeChapter({ chapter: 3, sceneWriting: budget });
    expect(paused.execution?.status).toBe("paused");
    expect(paused.scenes?.completed).toEqual([bodies[0]]);
    const remaining = fakeClient([...bodies.slice(1).map(priced), failure]);
    const failed = await new ProjectSession(root, SINGLE_PASS_RULES, { client: remaining.client }).writeChapter({ chapter: 3, draftId: paused.draftId });
    expect(failed.error?.step).toBe("C5");
    expect(failed.body).toBe(bodies.join("\n\n"));
    const declare = fakeClient([priced(C5_JSON)]);
    const checked = await new ProjectSession(root, SINGLE_PASS_RULES, { client: declare.client }).writeChapter({ chapter: 3, draftId: paused.draftId, acknowledgeUnknownUsage: true });
    expect(checked.status).toBe("ready");
    expect(declare.calls).toHaveLength(1);
    expect(model.calls).toHaveLength(2);
  });

  it.each([0, -1, NaN, 101, 1.5])("非法调用额度不创建任务或发请求：%s", maxCalls => {
    const { session, model } = fixture([]);
    expect(() => session.writeChapter({ chapter: 3, sceneWriting: { ...budget, maxCalls } })).toThrow(/额度/u);
    expect(session.allDrafts()).toEqual([]);
    expect(model.calls).toHaveLength(0);
  });

  it("积分停止线在当前调用返回后拦住下一次，不把未知价格当免费", async () => {
    const { session, model } = fixture(replies());
    const result = await session.writeChapter({ chapter: 3, sceneWriting: { ...budget, maxCredits: 0.00001 } });
    expect(result.error?.detail).toContain("积分停止线");
    expect(model.calls).toHaveLength(1);
    const unknown = fixture([modelText(JSON.stringify({ scenes }))]);
    const stopped = await unknown.session.writeChapter({ chapter: 3, sceneWriting: budget });
    expect(stopped.error?.detail).toContain("未计价");
    expect(unknown.model.calls).toHaveLength(1);
  });

  it("HTTP写章入口保留显式分场配置，返回完整合格候选", async () => {
    const { session } = fixture(replies());
    const response = await handleAsync(session, { method: "POST", path: "/api/chapter/write", query: new URLSearchParams(), body: { chapter: 3, sceneWriting: budget } });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "ready", body: bodies.join("\n\n") });
  });

  it("连写授权将分场及每章额度送入真实章节任务，检查通过才自动采用", async () => {
    const { session } = fixture(replies());
    session.run.start({ through: 3, sceneWriting: budget });
    await expect.poll(() => session.run.view().status).not.toBe("running");
    expect(session.run.view()).toMatchObject({ status: "idle", adopted: [3], sceneWriting: budget });
    expect(session.chapterText(3)).toBe(bodies.join("\n\n"));
  });

  it("非法连写配置在登记授权前拒绝", () => {
    const { session, model } = fixture([]);
    expect(() => session.run.start({ through: 3, sceneWriting: { maxCalls: 0, maxCredits: 20 } })).toThrow(/额度/u);
    expect(session.run.view().status).toBe("idle");
    expect(model.calls).toHaveLength(0);
  });

  it("最终声明未计价时也不能静默自动采用，即使不再需要后续模型调用", async () => {
    const { session } = fixture([priced(JSON.stringify({ scenes })), ...bodies.map(priced), modelText(C5_JSON)]);
    session.run.start({ through: 3, sceneWriting: budget });
    await expect.poll(() => session.run.view().status).not.toBe("running");
    expect(session.run.view()).toMatchObject({ status: "stopped", adopted: [], stopped: { reason: "blocked" } });
    expect(session.chapterText(3)).toBeUndefined();
  });
});
