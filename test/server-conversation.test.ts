/**
 * POST/GET /api/conversation 的端到端测试：经真实 ProjectSession + 注入假客户端，
 * 覆盖查询、经对话写章（含嵌套章节任务）、经对话采用，以及未配模型时的 503。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { handle, handleAsync, type ApiResponse } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { loadRules } from "../src/rules/load.js";
import type { ClaudeClient } from "../src/client/claude.js";
import type { ConversationReply } from "../src/agent/types.js";
import { C5_JSON, PROSE, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seed(client?: ClaudeClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-conv-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return {
    root,
    drafts: new DraftStore(root),
    session: new ProjectSession(root, loadRules(), client === undefined ? {} : { client }),
  };
}

function converse(session: ProjectSession, text: string): Promise<ApiResponse> {
  return handleAsync(session, { method: "POST", path: "/api/conversation", query: new URLSearchParams(), body: { text } });
}

function history(session: ProjectSession): ApiResponse {
  return handle(session, { method: "GET", path: "/api/conversation", query: new URLSearchParams(), body: null });
}

function toolUse(name: string, input: unknown) {
  return {
    kind: "ok" as const,
    message: modelMessage(
      [{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
      "tool_use",
    ),
  };
}

describe("/api/conversation", () => {
  it("GET 空历史返回 turns/ideas 空数组", () => {
    const { session } = seed();
    expect(history(session).body).toEqual({ turns: [], ideas: [] });
  });

  it("POST 纯查询：返回文本，历史落盘两条", async () => {
    const model = fakeClient([modelText("现在写到第 2 章，下一章第 3 章。")]);
    const { session } = seed(model.client);
    const res = await converse(session, "写到哪了？");
    expect(res.status).toBe(200);
    expect((res.body as ConversationReply).text).toContain("第 2 章");
    expect((res.body as ConversationReply).effects).toEqual([]);
    const turns = (history(session).body as { turns: unknown[] }).turns;
    expect(turns).toHaveLength(2);
  });

  it("POST 经对话写下一章：跑真实章节任务，产 chapter_written 草稿落盘", async () => {
    const model = fakeClient([toolUse("write_next_chapter", {}), modelText(PROSE), modelText(C5_JSON), modelText("第 3 章草稿写好了。")]);
    const { session, drafts } = seed(model.client);
    const res = await converse(session, "按计划写下一章");
    expect(res.status).toBe(200);
    const reply = res.body as ConversationReply;
    const written = reply.effects.find((e) => e.kind === "chapter_written");
    expect(written).toMatchObject({ kind: "chapter_written", chapter: 3 });
    expect(drafts.listDrafts(3)).toHaveLength(1);
    expect(model.calls).toHaveLength(4); // 对话1 + C4 + C5 + 对话2
  });

  it("POST 经对话采用一份 ready 草稿：产 chapter_adopted，当前章推进到 3", async () => {
    const model = fakeClient([toolUse("adopt_chapter", { draftId: "ch3d1" }), modelText("已采用第 3 章。")]);
    const { session, drafts } = seed(model.client);
    drafts.saveDraft(savedDraft());
    const res = await converse(session, "采用 ch3d1");
    expect(res.status).toBe(200);
    expect((res.body as ConversationReply).effects).toContainEqual({
      kind: "chapter_adopted",
      chapter: 3,
      draftId: "ch3d1",
      superseded: 0,
      staleMarked: [],
    });
    const overview = handle(session, { method: "GET", path: "/api/overview", query: new URLSearchParams(), body: null });
    expect((overview.body as { currentChapter: number }).currentChapter).toBe(3);
  });

  it("未配置模型时返回 503", async () => {
    vi.stubEnv("NOVEL_MODEL_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const { session } = seed();
    const res = await converse(session, "写下一章");
    expect(res.status).toBe(503);
  });

  it("缺 text 返回 400", async () => {
    const { session } = seed(fakeClient([modelText("x")]).client);
    const res = await handleAsync(session, { method: "POST", path: "/api/conversation", query: new URLSearchParams(), body: {} });
    expect(res.status).toBe(400);
  });
});
