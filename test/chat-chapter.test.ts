import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClaudeClient } from "../src/client/claude.js";
import { handle, handleAsync } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import type { ChapterDraft } from "../src/task/types.js";
import { loadRules } from "../src/rules/load.js";
import { C5_JSON, PROSE, padToBudget, writingSnapshot } from "./writing-fixtures.js";

type Body = Record<string, any>;
const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function setup(reply: (request: Body, number: number) => { status?: number; message?: Body; error?: string }) {
  const requests: Body[] = [];
  const server = createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input) as Body;
    requests.push(body);
    const result = reply(body, requests.length);
    res.writeHead(result.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result.error === undefined ? {
      id: `chat-${requests.length}`, model: "gemini-test", usage: { prompt_tokens: 30, completion_tokens: 20 },
      choices: [{ message: result.message, finish_reason: result.message?.tool_calls ? "tool_calls" : "stop" }],
    } : { error: { message: result.error } }));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  vi.stubEnv("NOVEL_MODEL_PROVIDER", "chat");
  vi.stubEnv("CHAT_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv("CHAT_API_KEY", "local-test-key");
  vi.stubEnv("CHAT_MODEL", "gemini-test");
  const claude = vi.spyOn(ClaudeClient, "fromEnv").mockImplementation(() => { throw new Error("本测试必须选择 chat，不能调用 Claude"); });
  const root = mkdtempSync(join(tmpdir(), "nf-chat-chapter-"));
  roots.push(root);
  const store = new ProjectStore(root);
  store.save(writingSnapshot());
  return { root, store, requests, claude, drafts: new DraftStore(root), session: new ProjectSession(root, loadRules()) };
}

function write(session: ProjectSession, draftId?: string) {
  return handleAsync(session, { method: "POST", path: "/api/chapter/write", query: new URLSearchParams(), body: { chapter: 3, ...(draftId === undefined ? {} : { draftId }) } });
}

describe("Gemini chat 章节入口", () => {
  it("真实 HTTP chat 协议生成草稿，采用后正文与正式事件才生效", async () => {
    const prose = padToBudget();
    const state = await setup((request) => ({ message: { role: "assistant", content: request.response_format === undefined ? prose : C5_JSON, reasoning_content: "测试元数据" } }));
    const before = state.store.load();
    const response = await write(state.session);
    expect(response.status).toBe(200);
    const draft = response.body as ChapterDraft;
    expect(draft.status, JSON.stringify(draft.findings)).toBe("ready");
    expect(draft.body).toBe(prose);
    expect(draft).not.toHaveProperty("session");
    expect(state.store.load().events).toEqual(before.events);
    expect(state.store.load().chapters).toEqual(before.chapters);
    expect(state.requests.every((request) => request.model === "gemini-test")).toBe(true);
    expect(state.claude).not.toHaveBeenCalled();
    const adoption = handle(state.session, { method: "POST", path: "/api/chapter/adopt", query: new URLSearchParams(), body: { chapter: 3, draftId: draft.draftId } });
    expect(adoption.status).toBe(200);
    expect(state.session.chapterText(3)).toBe(prose);
    expect(state.drafts.workVersion()).toBe(1);
  });

  it("工具签名与最终 assistant 跨 Session 保留，C5 失败恢复不重写正文，检查未过自动修订一次", async () => {
    const revised = padToBudget(PROSE);
    const toolAssistant = { role: "assistant", content: null, reasoning_content: "先读取人物。", tool_calls: [{ id: "person", type: "function", function: { name: "load_character", arguments: '{"name":"李长风"}' }, extra_content: { google: { thought_signature: "persisted-signature" } } }] };
    const finalAssistant = { role: "assistant", content: PROSE, reasoning_content: "完整会话元数据。" };
    const state = await setup((_request, number) =>
      number === 1 ? { message: toolAssistant }
      : number === 2 ? { message: finalAssistant }
      : number === 3 ? { status: 503, error: "临时故障 local-test-key" }
      : number === 5 ? { message: { role: "assistant", content: revised } }
      : { message: { role: "assistant", content: C5_JSON } });
    const response = await write(state.session);
    expect(response.status).toBe(200);
    const failed = response.body as ChapterDraft;
    expect(failed.status).toBe("failed");
    expect(failed.error?.step).toBe("C5");
    expect(failed.error?.detail).not.toContain("local-test-key");
    expect(failed.body).toBe(PROSE);
    const restored = new ProjectSession(state.root, loadRules());
    const resumed = await write(restored, failed.draftId);
    expect(resumed.status).toBe(200);
    // resume 只补跑 C5（#4）；检查判短 → 修订（#5）→ 重新声明（#6）→ 达标。
    const draft = resumed.body as ChapterDraft;
    expect(draft.status, JSON.stringify(draft.findings)).toBe("ready");
    expect(draft.body).toBe(revised);
    expect(draft.revisions).toHaveLength(1);
    expect(draft.revisions[0]?.body).toBe(PROSE);
    expect(state.requests).toHaveLength(6);
    expect(state.requests[3]?.messages).toContainEqual(toolAssistant);
    expect(state.requests[3]?.messages).toContainEqual(finalAssistant);
    expect(state.requests[3]?.response_format.type).toBe("json_schema");
    expect(JSON.stringify(state.requests[4]?.messages.at(-1))).toContain("问题清单");
    expect(state.claude).not.toHaveBeenCalled();
    expect(state.drafts.workVersion()).toBe(0);
  });
});
