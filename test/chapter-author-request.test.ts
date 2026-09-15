import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import type { CallOptions, CallResult } from "../src/client/claude.js";
import type { ModelClient } from "../src/client/model.js";
import { C5_JSON, PROSE, SINGLE_PASS_RULES, fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(client: ModelClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-author-request-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, SINGLE_PASS_RULES, { client }) };
}
const writeTool = (): CallResult => ({ kind: "ok", message: modelMessage([
  { type: "tool_use", id: "write", name: "write_next_chapter", input: {}, caller: { type: "direct" } },
], "tool_use") });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const instruction = "按计划写下一章。钥匙保持在主角皮包里；用另外制作的试样查证，不得挤压原封签。";

describe("章节任务中的作者本轮写作要求", () => {
  it("传给 C4 的是本轮请求，不把过去的讨论作为写作要求或正式事实", async () => {
    const creative: CallOptions[] = [];
    let judge = 0;
    const { root, session } = fixture({ official: false, call: async options => {
      if (options.role === "judge") return ++judge === 1 ? modelText("先只讨论这个可能性。") : writeTool();
      creative.push(options);
      return modelText(options.outputSchema ? C5_JSON : PROSE);
    } });
    const before = new ProjectStore(root).load();
    await session.converse("只讨论让师父变成反派的可能性，不修改资料。");
    await session.converse(instruction);
    await session.writeChapter({ chapter: 3, draftId: "ch3d1" });
    expect(JSON.stringify(creative[0]?.messages)).toContain(instruction);
    expect(JSON.stringify(creative[0]?.messages)).not.toContain("让师父变成反派");
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(session.currentChapter).toBe(2);
    expect(judge).toBe(2);
  });

  it("任务启动即保存要求，C4 失败后跨 Session 恢复保持原要求", async () => {
    const waiting = deferred<CallResult>();
    const { root, session } = fixture({ official: false, call: async options => options.role === "judge" ? writeTool() : waiting.promise });
    await session.converse(instruction);
    const pending = session.writeChapter({ chapter: 3, draftId: "ch3d1" });
    try {
      expect(session.getDraft(3, "ch3d1")?.writeContext?.authorRequest).toBe(instruction);
    } finally {
      waiting.resolve({ kind: "error", error: { type: "connection", status: null, message: "test disconnect", retryable: true } });
      await pending;
    }
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    const reopened = new ProjectSession(root, SINGLE_PASS_RULES, { client: model.client });
    const completed = await reopened.writeChapter({ chapter: 3, draftId: "ch3d1" });
    expect(JSON.stringify(model.calls[0]?.messages)).toContain(instruction);
    expect(completed.writeContext?.authorRequest).toBe(instruction);
    expect(model.calls).toHaveLength(2);
    expect(reopened.listDrafts(3)).toHaveLength(1);
  });

  it.each([true, false])("同一请求编号不能覆盖已有写作要求，活动中=%s", async active => {
    const waiting = deferred<CallResult>();
    const { session } = fixture({ official: false, call: async options => options.outputSchema ? modelText(C5_JSON) : waiting.promise });
    const request = { chapter: 3, requestId: "frozen-request", authorRequest: instruction };
    session.startChapter(request);
    const pending = session.writeChapter(request);
    try {
      if (!active) { waiting.resolve(modelText(PROSE)); await pending; }
      expect(() => session.startChapter({ ...request, authorRequest: "改成直接砸开箱子" })).toThrow(/请求|要求/u);
    } finally {
      waiting.resolve(modelText(PROSE)); await pending;
    }
    expect(session.getDraft(3, "ch3d1")?.writeContext?.authorRequest).toBe(instruction);
    expect(session.listDrafts(3)).toHaveLength(1);
  });

  it("已有稿件与历史任务不被新一轮请求补入或覆盖要求", async () => {
    const model = fakeClient([modelText(PROSE), modelText(C5_JSON)]);
    const { session } = fixture(model.client);
    await session.writeChapter({ chapter: 3 });
    expect(() => session.startChapter({ chapter: 3, authorRequest: instruction })).toThrow(/已有|要求/u);
    expect(session.getDraft(3, "ch3d1")?.writeContext?.authorRequest).toBeUndefined();
    expect(model.calls).toHaveLength(2);
  });

  it.each([null, 3, "   "])("无效要求 %j 不创建任务或调用模型", authorRequest => {
    const model = fakeClient([]);
    const { session } = fixture(model.client);
    expect(() => session.startChapter({ chapter: 3, authorRequest: authorRequest as string })).toThrow(/authorRequest/u);
    expect(session.listDrafts(3)).toEqual([]);
    expect(model.calls).toEqual([]);
  });
});
