/**
 * 主 Agent 服务的单测：假客户端脚本化四条主线（查询 / 写章 / 含糊“继续”不自动采用 /
 * 采用），并验证对话历史落盘。ctx 用假实现，不触真实写章内部。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { MainAgentService } from "../src/agent/service.js";
import { ConversationStore } from "../src/agent/conversation-store.js";
import type { MainAgentToolContext } from "../src/agent/tool-exec.js";
import type { MainAgentContextInfo } from "../src/agent/system-prompt.js";
import { fakeClient, modelMessage, modelText } from "./writing-fixtures.js";

const INFO: MainAgentContextInfo = {
  title: "雨夜账册",
  genre: "xuanhuan",
  platform: "fanqie",
  currentChapter: 2,
  nextChapter: 3,
  nextPlanReady: true,
  pendingDrafts: 0,
  prep: {
    premiseSet: true,
    conflictSet: true,
    characters: [{ id: "C01", name: "李长风", tier: "protagonist" }],
    locations: [],
    plotLines: [{ id: "P01", label: "追查旧案", weight: "main" }],
    disciplineVersion: "d1",
  },
};

function toolUse(name: string, input: unknown) {
  return {
    kind: "ok" as const,
    message: modelMessage(
      [{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
      "tool_use",
    ),
  };
}

function ctxWith(over: Partial<MainAgentToolContext> = {}): MainAgentToolContext {
  return {
    getOverview: () => "OVERVIEW",
    listChapterDrafts: () => "DRAFTS",
    getChapterText: () => "TEXT",
    getCharacter: () => "CARD",
    listOpenForeshadows: () => "FS",
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
    writeNextChapter: async () => ({ message: "已写草稿", effect: { kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true } }),
    adoptChapter: async (draftId) => ({ message: "已采用", effect: { kind: "chapter_adopted", chapter: 3, draftId, superseded: 0, staleMarked: [] } }),
    ...over,
  };
}

let root: string;
let store: ConversationStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nf-agent-"));
  store = new ConversationStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service(results: Parameters<typeof fakeClient>[0], ctx: MainAgentToolContext = ctxWith()): MainAgentService {
  const { client } = fakeClient(results);
  return new MainAgentService({ client, store, ctx, contextInfo: () => INFO, maxRounds: 8, clock: () => "2026-09-11T00:00:00.000Z" });
}

describe("MainAgentService.send", () => {
  it("纯查询：返回文本、无 effect，两条记录落盘", async () => {
    const reply = await service([modelText("现在写到第 2 章。")]).send("写到哪了？");
    expect(reply.text).toBe("现在写到第 2 章。");
    expect(reply.effects).toEqual([]);
    const turns = store.load().turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", text: "写到哪了？" });
    expect(turns[1]).toMatchObject({ role: "agent", text: "现在写到第 2 章。" });
    expect(turns[1]?.effects).toBeUndefined();
  });

  it("写章：产 chapter_written，ctx.writeNextChapter 被调用", async () => {
    const writeNextChapter = vi.fn(ctxWith().writeNextChapter);
    const reply = await service([toolUse("write_next_chapter", {}), modelText("第 3 章草稿写好了。")], ctxWith({ writeNextChapter })).send(
      "按计划写下一章",
    );
    expect(writeNextChapter).toHaveBeenCalledOnce();
    expect(reply.effects).toEqual([{ kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true }]);
    expect(store.load().turns[1]?.effects).toHaveLength(1);
  });

  it("含糊“继续”：模型只回文本时不采用任何草稿", async () => {
    const adoptChapter = vi.fn(ctxWith().adoptChapter);
    const reply = await service([modelText("你是指采用第 3 章的哪一版？目前有 ch3d1 待采用。")], ctxWith({ adoptChapter })).send("继续");
    expect(adoptChapter).not.toHaveBeenCalled();
    expect(reply.effects).toEqual([]);
  });

  it("采用：产 chapter_adopted，带上 draftId", async () => {
    const adoptChapter = vi.fn(ctxWith().adoptChapter);
    const reply = await service([toolUse("adopt_chapter", { draftId: "ch3d1" }), modelText("已采用。")], ctxWith({ adoptChapter })).send(
      "采用 ch3d1",
    );
    expect(adoptChapter).toHaveBeenCalledWith("ch3d1");
    expect(reply.effects).toEqual([{ kind: "chapter_adopted", chapter: 3, draftId: "ch3d1", superseded: 0, staleMarked: [] }]);
  });

  it("多轮对话：历史累积落盘", async () => {
    await service([modelText("好的。")]).send("第一句");
    await service([modelText("收到。")]).send("第二句");
    const turns = store.load().turns;
    expect(turns.map((t) => t.text)).toEqual(["第一句", "好的。", "第二句", "收到。"]);
  });

  it("第二轮把历史作为消息带给模型", async () => {
    await service([modelText("好的。")]).send("第一句");
    const { client, calls } = fakeClient([modelText("收到。")]);
    const svc = new MainAgentService({ client, store, ctx: ctxWith(), contextInfo: () => INFO, maxRounds: 8 });
    await svc.send("第二句");
    // 历史两条 + 本轮一条
    const messages = calls[0]?.messages ?? [];
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.content)).toEqual(["第一句", "好的。", "第二句"]);
  });

  it("空消息被拒", async () => {
    await expect(service([modelText("x")]).send("   ")).rejects.toThrow();
  });
});
