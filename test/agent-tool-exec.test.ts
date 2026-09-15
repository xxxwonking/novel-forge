/**
 * 主 Agent 工具执行与对话循环的单测。假 ctx + 假客户端，不打真实 API。
 *
 * 重点：读类零副作用（无 effect）；动作类恰好一个 effect；输入校验错误回 is_error
 * 但不产 effect；循环达上限即停。
 */

import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { executeMainTool, runAgentLoop, type MainAgentToolContext } from "../src/agent/tool-exec.js";
import { MAIN_AGENT_TOOLS } from "../src/agent/tools.js";
import type { CallOptions } from "../src/client/claude.js";
import { fakeClient, modelMessage, modelText } from "./writing-fixtures.js";

function block(name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id: "t1", name, input } as unknown as Anthropic.ToolUseBlock;
}

function fakeCtx(over: Partial<MainAgentToolContext> = {}): MainAgentToolContext {
  return {
    reviseDraft: async () => ({ message: "已启动修订", effect: { kind: "chapter_revised", chapter: 3, draftId: "ch3d2", status: "writing", acceptable: false } }),
    getChapterDraft: () => "DRAFT",
    correctDraft: async () => ({ message: "已保存新记录", effect: { kind: "chapter_revised", chapter: 3, draftId: "ch3d2", status: "pending_check", acceptable: false } }),
    checkDraft: async (draftId) => ({ message: "已开始检查", effect: { kind: "task_updated", chapter: 3, draftId, status: "running" } }),
    getPreparation: () => "PREPARATION",
    listChapterTasks: () => "[]",
    controlChapterTask: async (draftId) => ({ message: "已暂停", effect: { kind: "task_updated", chapter: 3, draftId, status: "paused" } }),
    proposePreparation: async () => ({ message: "方案已保存", effect: { kind: "preparation_proposed", proposalId: "proposal-test", summary: "开篇" } }),
    confirmPreparation: async (proposalId) => ({ message: "已确认", effect: { kind: "preparation_confirmed", proposalId, summary: "开篇" } }),
    getOverview: () => "OVERVIEW",
    getStoryProgress: () => "PROGRESS",
    prepareTextExport: async () => ({ message: "EXPORT", effect: { kind: "export_prepared", exportId: "export-test", chapters: 1 } }),
    listChapterDrafts: () => "DRAFTS",
    getChapterText: () => "TEXT",
    getCharacter: (name) => (name === "李长风" ? "CARD" : null),
    listOpenForeshadows: () => "FORESHADOWS",
    getNextPlan: () => "PLAN",
    addToNextChapter: async () => ({ message: "计划已更新", effect: { kind: "plan_updated", chapter: 3, promotedToPayoff: false } }),
    rescheduleForeshadow: async (foreshadowId, expectedBy) => ({ message: "已改期", effect: { kind: "foreshadow_rescheduled", foreshadowId, expectedBy } }),
    abandonForeshadow: async (foreshadowId) => ({ message: "已废弃", effect: { kind: "foreshadow_abandoned", foreshadowId } }),
    recordIdea: async (text) => ({ message: "已记录", effect: { kind: "idea_recorded", id: "idea1", text } }),
    writeNextChapter: async () => ({ message: "已写草稿", effect: { kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true } }),
    adoptChapter: async (draftId) => ({ message: "已采用", effect: { kind: "chapter_adopted", chapter: 3, draftId, superseded: 0, staleMarked: [] } }),
    ...over,
  };
}

const CALL_OPTS: CallOptions = {
  role: "judge",
  maxTokens: 2048,
  tools: MAIN_AGENT_TOOLS,
  system: [{ type: "text", text: "你是写作助手" }],
  messages: [{ role: "user", content: "hi" }],
};

describe("executeMainTool", () => {
  it("读类工具返回数据、不产 effect", async () => {
    const r = await executeMainTool(block("get_overview", {}), fakeCtx());
    expect(r.result.content).toBe("OVERVIEW");
    expect(r.result.is_error).toBeUndefined();
    expect(r.effect).toBeUndefined();
  });

  it("get_character 找不到时 is_error、无 effect", async () => {
    const r = await executeMainTool(block("get_character", { name: "查无此人" }), fakeCtx());
    expect(r.result.is_error).toBe(true);
    expect(r.effect).toBeUndefined();
  });

  it("plan_add_to_next_chapter 缺子字段 → is_error 且不调用 ctx", async () => {
    const addToNextChapter = vi.fn(fakeCtx().addToNextChapter);
    const r = await executeMainTool(block("plan_add_to_next_chapter", { what: "resolution" }), fakeCtx({ addToNextChapter }));
    expect(r.result.is_error).toBe(true);
    expect(r.effect).toBeUndefined();
    expect(addToNextChapter).not.toHaveBeenCalled();
  });

  it("plan_add_to_next_chapter 合法 → 调用 ctx，产 plan_updated", async () => {
    const r = await executeMainTool(
      block("plan_add_to_next_chapter", { what: "resolution", foreshadowId: "F01", weight: "main", completeness: "full" }),
      fakeCtx(),
    );
    expect(r.result.is_error).toBeUndefined();
    expect(r.effect).toEqual({ kind: "plan_updated", chapter: 3, promotedToPayoff: false });
  });

  it("write_next_chapter → chapter_written effect", async () => {
    const r = await executeMainTool(block("write_next_chapter", {}), fakeCtx());
    expect(r.effect).toMatchObject({ kind: "chapter_written", chapter: 3, draftId: "ch3d1" });
  });

  it("adopt_chapter 缺 draftId → is_error、无 effect", async () => {
    const adoptChapter = vi.fn(fakeCtx().adoptChapter);
    const r = await executeMainTool(block("adopt_chapter", {}), fakeCtx({ adoptChapter }));
    expect(r.result.is_error).toBe(true);
    expect(r.effect).toBeUndefined();
    expect(adoptChapter).not.toHaveBeenCalled();
  });

  it("ctx 返回 action_failed → is_error 结果 + action_failed effect", async () => {
    const ctx = fakeCtx({
      adoptChapter: async () => ({ message: "草稿未就绪", effect: { kind: "action_failed", tool: "adopt_chapter", message: "草稿未就绪" } }),
    });
    const r = await executeMainTool(block("adopt_chapter", { draftId: "ch3d1" }), ctx);
    expect(r.result.is_error).toBe(true);
    expect(r.effect).toEqual({ kind: "action_failed", tool: "adopt_chapter", message: "草稿未就绪" });
  });

  it("未知工具 → is_error", async () => {
    const r = await executeMainTool(block("no_such_tool", {}), fakeCtx());
    expect(r.result.is_error).toBe(true);
  });
});

function toolUse(name: string, input: unknown) {
  return {
    kind: "ok" as const,
    message: modelMessage(
      [{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
      "tool_use",
    ),
  };
}

describe("runAgentLoop", () => {
  it.each([
    ["revise_chapter_draft", { draftId: "ch3d1", revisionToken: "source-token", instruction: "补足调查证据", requestId: "revision-1", mode: "rewrite", scope: null }],
    ["check_chapter_draft", { draftId: "ch3d2", revisionToken: "source-token", adoptOnSuccess: false }],
  ])("%s 受理后台任务后交接，不再让模型轮询进度", async (name, input) => {
    const { client, calls } = fakeClient([toolUse(name as string, input), toolUse("list_chapter_tasks", {}), toolUse("list_chapter_tasks", {})]);
    const r = await runAgentLoop(client, CALL_OPTS, fakeCtx(), 2);
    expect(r.hitCap).toBe(false);
    expect(calls).toHaveLength(1);
    expect(r.text).toContain("ch3d2");
    expect(r.text).toContain("后台");
    expect(r.text).not.toContain("更具体");
    expect(r.modelMessages).toContainEqual(expect.objectContaining({ role: "assistant", content: expect.arrayContaining([expect.objectContaining({ type: "tool_use", name })]) }));
    expect(r.modelMessages).toContainEqual(expect.objectContaining({ role: "user", content: expect.arrayContaining([expect.objectContaining({ type: "tool_result", tool_use_id: "t1" })]) }));
  });

  it("采用并继续保留采用结果，完成整批工具历史后返回后台任务", async () => {
    const { client, calls } = fakeClient([{ kind: "ok", message: modelMessage([
      { ...block("adopt_chapter", { draftId: "ch2d1" }), id: "adopt" },
      { ...block("write_next_chapter", {}), id: "write" },
    ], "tool_use") }, toolUse("list_chapter_tasks", {}), toolUse("list_chapter_tasks", {})]);
    const ctx = fakeCtx({
      adoptChapter: async draftId => ({ message: "已采用", effect: { kind: "chapter_adopted", chapter: 2, draftId, superseded: 0, staleMarked: [] } }),
      writeNextChapter: async () => ({ message: "任务已受理", effect: { kind: "chapter_started", chapter: 3, draftId: "ch3d1", status: "writing", acceptable: false } }),
    });
    const r = await runAgentLoop(client, CALL_OPTS, ctx, 2);
    expect(calls).toHaveLength(1);
    expect(r.hitCap).toBe(false);
    expect(r.effects.map(effect => effect.kind)).toEqual(["chapter_adopted", "chapter_started"]);
    expect(r.text).toContain("已采用第 2 章");
    expect(r.text).toContain("ch3d1");
    const results = r.modelMessages.flatMap(message => typeof message.content === "string" ? [] : message.content).filter(item => item.type === "tool_result");
    expect(results.map(item => item.tool_use_id)).toEqual(["adopt", "write"]);
  });

  it.each(["pausing", "ending"])("%s 请求交接时说明等待当前调用保存，不冒充控制已经生效", async status => {
    const { client, calls } = fakeClient([toolUse("control_chapter_task", { draftId: "ch3d1", action: status === "pausing" ? "pause" : "end" }), modelText("已经结束。")]);
    const ctx = fakeCtx({ controlChapterTask: async draftId => ({ message: "控制已请求", effect: { kind: "task_updated", chapter: 3, draftId, status } }) });
    const r = await runAgentLoop(client, CALL_OPTS, ctx, 8);
    expect(calls).toHaveLength(1);
    expect(r.text).toContain("保存");
    expect(r.text).not.toContain("已经结束");
  });

  it("同步结构纠错仍继续检查，后台交接同时报告本轮失败动作", async () => {
    const { client, calls } = fakeClient([
      toolUse("correct_draft_structure", { draftId: "ch3d1", revisionToken: "source", summary: "纠正记录", changes: [] }),
      { kind: "ok", message: modelMessage([
        { ...block("check_chapter_draft", { draftId: "ch3d2", revisionToken: "new", adoptOnSuccess: false }), id: "check" },
        { ...block("adopt_chapter", { draftId: "ch3d2" }), id: "failed-adopt" },
      ], "tool_use") }, modelText("错误地说已经采用"),
    ]);
    const ctx = fakeCtx({ adoptChapter: async () => ({ message: "稿件仍有必须处理项，未采用", effect: { kind: "action_failed", tool: "adopt_chapter", message: "稿件仍有必须处理项，未采用" } }) });
    const r = await runAgentLoop(client, CALL_OPTS, ctx, 8);
    expect(calls).toHaveLength(2);
    expect(r.effects.map(effect => effect.kind)).toEqual(["chapter_revised", "task_updated", "action_failed"]);
    expect(r.text).toContain("未采用");
    expect(r.text).toContain("后台");
  });

  it("读类工具轮 → 最终文本，无 effect", async () => {
    const { client, calls } = fakeClient([toolUse("get_overview", {}), modelText("现在写到第 2 章。")]);
    const r = await runAgentLoop(client, CALL_OPTS, fakeCtx(), 8);
    expect(r.text).toBe("现在写到第 2 章。");
    expect(r.toolRounds).toBe(1);
    expect(r.effects).toEqual([]);
    expect(r.hitCap).toBe(false);
    expect(calls).toHaveLength(2);
  });

  it("写章工具 → chapter_written effect 汇集到结果", async () => {
    const { client } = fakeClient([toolUse("write_next_chapter", {}), modelText("已经写好第 3 章草稿，你可以看看。")]);
    const r = await runAgentLoop(client, CALL_OPTS, fakeCtx(), 8);
    expect(r.effects).toEqual([{ kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true }]);
    expect(r.text).toContain("第 3 章");
  });

  it("拒绝直接归一化为可展示文本，不抛", async () => {
    const { client } = fakeClient([{ kind: "refusal", message: modelMessage([]), category: "violence", explanation: null, userMessage: "这段无法生成" }]);
    const r = await runAgentLoop(client, CALL_OPTS, fakeCtx(), 8);
    expect(r.text).toBe("这段无法生成");
    expect(r.toolRounds).toBe(0);
  });

  it("达到轮数上限即停，hitCap=true", async () => {
    const { client } = fakeClient([toolUse("get_overview", {}), toolUse("get_overview", {})]);
    const r = await runAgentLoop(client, CALL_OPTS, fakeCtx(), 1);
    expect(r.hitCap).toBe(true);
    expect(r.toolRounds).toBe(1);
  });
});
