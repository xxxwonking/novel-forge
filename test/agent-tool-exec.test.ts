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
    getOverview: () => "OVERVIEW",
    listChapterDrafts: () => "DRAFTS",
    getChapterText: () => "TEXT",
    getCharacter: (name) => (name === "李长风" ? "CARD" : null),
    listOpenForeshadows: () => "FORESHADOWS",
    getNextPlan: () => "PLAN",
    getDirection: () => "DIRECTION",
    setDirection: async (input) => ({ message: "已更新方向", effect: { kind: "setting_updated", fields: Object.keys(input) } }),
    upsertCharacter: async (input) => ({ message: "已新建人物", effect: { kind: "character_upserted", id: "C01", name: input.name ?? "", created: true } }),
    upsertLocation: async (input) => ({ message: "已新建地点", effect: { kind: "location_upserted", id: "S01", name: input.name ?? "", created: true } }),
    definePlotLine: async (input) => ({ message: "已定义情节线", effect: { kind: "plotline_defined", id: "P01", label: input.label ?? "", created: true } }),
    setDiscipline: async (rules) => ({ message: "已更新纪律", effect: { kind: "discipline_updated", version: "a1", count: rules.length } }),
    planChapter: async ({ chapter, plan }) => ({ message: "已排章", effect: { kind: "chapter_planned", chapter: chapter ?? 1, chapterType: plan.chapterType, warnings: 0 } }),
    addToNextChapter: async () => ({ message: "计划已更新", effect: { kind: "plan_updated", chapter: 3, promotedToPayoff: false } }),
    rescheduleForeshadow: async (foreshadowId, expectedBy) => ({ message: "已改期", effect: { kind: "foreshadow_rescheduled", foreshadowId, expectedBy } }),
    abandonForeshadow: async (foreshadowId) => ({ message: "已废弃", effect: { kind: "foreshadow_abandoned", foreshadowId } }),
    recordIdea: async (text) => ({ message: "已记录", effect: { kind: "idea_recorded", id: "idea1", text } }),
    writeNextChapter: async () => ({ message: "已写草稿", effect: { kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true, revisions: 0 } }),
    rewriteChapterDraft: async (chapter) => ({ message: "已另写一版", effect: { kind: "chapter_written", chapter: chapter ?? 3, draftId: "ch3d2", status: "ready", acceptable: true, revisions: 0 } }),
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

  it("rewrite_chapter_draft：缺省章号传 null，非法章号 is_error 且不调 ctx", async () => {
    const rewriteChapterDraft = vi.fn(fakeCtx().rewriteChapterDraft);
    const ok = await executeMainTool(block("rewrite_chapter_draft", {}), fakeCtx({ rewriteChapterDraft }));
    expect(rewriteChapterDraft).toHaveBeenCalledWith(null);
    expect(ok.effect).toMatchObject({ kind: "chapter_written", draftId: "ch3d2" });

    const bad = await executeMainTool(block("rewrite_chapter_draft", { chapter: 1.5 }), fakeCtx({ rewriteChapterDraft }));
    expect(bad.result.is_error).toBe(true);
    expect(bad.effect).toBeUndefined();
    expect(rewriteChapterDraft).toHaveBeenCalledOnce();
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
    expect(r.effects).toEqual([{ kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true, revisions: 0 }]);
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
