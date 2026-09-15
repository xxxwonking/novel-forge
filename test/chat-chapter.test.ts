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
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import { C5_JSON, PROSE, SINGLE_PASS_RULES, WRITE_BEAT, writingSnapshot } from "./writing-fixtures.js";
import { C5_OUTPUT_SCHEMA } from "../src/chapter/c5-schema.js";

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

async function setup(reply: (request: Body, number: number) => { status?: number; message?: Body; error?: string; sse?: string; finish?: string }, env: Record<string, string> = {}) {
  const requests: Body[] = [];
  const server = createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    const body = JSON.parse(input) as Body;
    requests.push(body);
    const result = reply(body, requests.length);
    if (result.sse !== undefined) {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(result.sse);
      return;
    }
    res.writeHead(result.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(result.error === undefined ? {
      id: `chat-${requests.length}`, model: "gemini-test", usage: { prompt_tokens: 30, completion_tokens: 20 },
      choices: [{ message: result.message, finish_reason: result.finish ?? (result.message?.tool_calls ? "tool_calls" : "stop") }],
    } : { error: { message: result.error } }));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  vi.stubEnv("NOVEL_MODEL_PROVIDER", "chat");
  vi.stubEnv("CHAT_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  vi.stubEnv("CHAT_API_KEY", "local-test-key");
  vi.stubEnv("CHAT_MODEL", "gemini-test");
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const claude = vi.spyOn(ClaudeClient, "fromEnv").mockImplementation(() => { throw new Error("本测试必须选择 chat，不能调用 Claude"); });
  const root = mkdtempSync(join(tmpdir(), "nf-chat-chapter-"));
  roots.push(root);
  const store = new ProjectStore(root);
  store.save(writingSnapshot());
  return { root, store, requests, claude, drafts: new DraftStore(root), session: new ProjectSession(root, SINGLE_PASS_RULES) };
}

function write(session: ProjectSession, draftId?: string) {
  return handleAsync(session, { method: "POST", path: "/api/chapter/write", query: new URLSearchParams(), body: { chapter: 3, ...(draftId === undefined ? {} : { draftId }) } });
}

describe("Chat 章节入口", () => {
  it.each(["sse", "aborted", "insufficient_system_resource"])("%s 中断保留正文，重开作品可续写，未完成的正文不能采用", async (kind) => {
    const content = PROSE + "血刀客正要开口，";
    const state = await setup(() => kind === "sse"
      ? { sse: `data: ${JSON.stringify({ choices: [{ delta: { content, reasoning_content: "内部推理" }, finish_reason: null }] })}\n\n` }
      : { message: { role: "assistant", content, reasoning_content: "内部推理" }, finish: kind });
    const before = state.store.load();
    const response = await write(state.session);
    expect(response.status).toBe(200);
    const draft = response.body as ChapterDraft;
    expect(draft).toMatchObject({ status: "failed", body: content, acceptable: false, declaration: null, error: { step: "C4" } });
    expect(state.requests).toHaveLength(1);
    const restored = new ProjectSession(state.root, SINGLE_PASS_RULES);
    const view = handle(restored, { method: "GET", path: "/api/chapter/draft", query: new URLSearchParams({ n: "3", id: draft.draftId }), body: undefined });
    expect(view.body).toMatchObject({ body: content, canContinueBody: true });
    expect(handle(restored, { method: "POST", path: "/api/chapter/adopt", query: new URLSearchParams(), body: { chapter: 3, draftId: draft.draftId } })).toMatchObject({ status: 400, body: { error: expect.stringContaining("不能采用") } });
    expect(state.store.load().events).toEqual(before.events);
    expect(state.store.load().chapters).toEqual(before.chapters);
  });

  it.each(["generic", "deepseek"])("%s 真实本地 HTTP 生成草稿，采用后正文与正式事件才生效", async (preset) => {
    let prose = PROSE;
    const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, loadRules()).words.sweet;
    while (countWords(prose) < target) prose += "\n他沿着石壁查看木匣，把封口与旧图对照，再记下匣底的编号。";
    const state = await setup((request) => ({ message: { role: "assistant", content: request.response_format === undefined ? prose : C5_JSON, reasoning_content: "测试元数据" } }), { CHAT_PRESET: preset });
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

  it.each(["generic", "deepseek"])("%s 工具签名与思考字段跨 Session 保留，C5 失败恢复不重写正文", async (preset) => {
    const toolAssistant = { role: "assistant", content: null, reasoning_content: "先读取人物。", tool_calls: [{ id: "person", type: "function", function: { name: "load_character", arguments: '{"name":"李长风"}' }, extra_content: { google: { thought_signature: "persisted-signature" } } }] };
    const finalAssistant = { role: "assistant", content: PROSE, reasoning_content: "完整会话元数据。" };
    const state = await setup((_request, number) => number === 1 ? { message: toolAssistant } : number === 2 ? { message: finalAssistant } : number === 3 ? { status: 503, error: "临时故障 local-test-key" } : { message: { role: "assistant", content: C5_JSON } }, { CHAT_PRESET: preset, CHAT_THINKING: preset === "deepseek" ? "enabled" : "default" });
    const response = await write(state.session);
    expect(response.status).toBe(200);
    const failed = response.body as ChapterDraft;
    expect(failed.status).toBe("failed");
    expect(failed.error?.step).toBe("C5");
    expect(failed.error?.detail).not.toContain("local-test-key");
    expect(failed.body).toBe(PROSE);
    const restored = new ProjectSession(state.root, SINGLE_PASS_RULES);
    const resumed = await write(restored, failed.draftId);
    expect(resumed.status).toBe(200);
    expect((resumed.body as ChapterDraft).status).toBe("needs_revision");
    expect((resumed.body as ChapterDraft).body).toBe(PROSE);
    expect(state.requests).toHaveLength(4);
    expect(state.requests[3]?.messages).toContainEqual(toolAssistant);
    expect(state.requests[3]?.messages).toContainEqual(finalAssistant);
    expect(state.requests[3]?.response_format.type).toBe(preset === "deepseek" ? "json_object" : "json_schema");
    if (preset === "deepseek") {
      expect(state.requests[3]?.messages[0].content).toContain(JSON.stringify(C5_OUTPUT_SCHEMA));
      expect(state.requests[3]?.thinking).toEqual({ type: "enabled" });
    }
    expect(state.claude).not.toHaveBeenCalled();
    expect(state.drafts.workVersion()).toBe(0);
  });

  it.each(["json_object", "prompt"])("%s 返回不合法声明时仍由本地校验拦截，保留正文且不采用", async (mode) => {
    const state = await setup((_request, number) => ({ message: { role: "assistant", content: number === 1 ? PROSE : "这不是 JSON" } }), { CHAT_PRESET: "deepseek", CHAT_JSON_MODE: mode });
    const before = state.store.load();
    const response = await write(state.session);
    expect(response.body).toMatchObject({ status: "failed", body: PROSE, error: { step: "C5", detail: "C5 输出不是合法 JSON" } });
    expect(state.requests[1]?.messages[0].content).toContain(JSON.stringify(C5_OUTPUT_SCHEMA));
    expect(state.requests[1]?.response_format).toEqual(mode === "json_object" ? { type: "json_object" } : undefined);
    expect(state.store.load().events).toEqual(before.events);
    expect(state.store.load().chapters).toEqual(before.chapters);
    expect(state.drafts.workVersion()).toBe(0);
  });
});
