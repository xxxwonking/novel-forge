import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handle, handleAsync } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { ConversationStore } from "../src/agent/conversation-store.js";
import { loadRules } from "../src/rules/load.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, WRITE_BEAT, writingSnapshot } from "./writing-fixtures.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";

type Body = Record<string, any>;
type Reply = { message?: Body; finish?: string; status?: number };
const servers: Server[] = [];
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const assistant = (content: string, reasoning = "private-reasoning") => ({ role: "assistant", content, reasoning_content: reasoning });
const ideaTool = (id: string, text = "支线备选") => ({
  ...assistant("", `private-reasoning-${id}`),
  tool_calls: [{ id, type: "function", function: { name: "record_alternative_idea", arguments: JSON.stringify({ text }) }, extra_content: { signature: `signature-${id}` } }],
});

async function setup(replies: Reply[] | ((body: Body) => Reply), maxRounds = 8) {
  const requests: Body[] = [];
  const server = createServer(async (req, res) => {
    let input = "";
    for await (const chunk of req) input += chunk;
    requests.push(JSON.parse(input));
    const reply: Reply = (typeof replies === "function" ? replies(requests.at(-1)!) : replies[requests.length - 1]) ?? { message: assistant("完成") };
    res.writeHead(reply.status ?? 200, { "content-type": "application/json" });
    res.end(JSON.stringify(reply.status === undefined ? { choices: [{ message: reply.message, finish_reason: reply.finish ?? (reply.message?.tool_calls ? "tool_calls" : "stop") }] } : { error: { message: "temporary model failure" } }));
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  vi.stubEnv("NOVEL_MODEL_PROVIDER", "chat");
  vi.stubEnv("CHAT_BASE_URL", `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v3`);
  vi.stubEnv("CHAT_API_KEY", "local-test-key");
  vi.stubEnv("CHAT_MODEL", "deepseek-test");
  vi.stubEnv("CHAT_PRESET", "deepseek");
  vi.stubEnv("CHAT_THINKING", "enabled");
  const root = mkdtempSync(join(tmpdir(), "nf-chat-conversation-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const rules = NO_MODEL_REVIEW;
  const session = () => new ProjectSession(root, { ...rules, agent: { ...rules.agent, maxConversationRounds: maxRounds } });
  return { root, requests, session, store: new ConversationStore(root) };
}

function send(session: ProjectSession, text: string) {
  return handleAsync(session, { method: "POST", path: "/api/conversation", query: new URLSearchParams(), body: { text } });
}

describe("Chat 主 Agent 跨回合", () => {
  it("DeepSeek 风格接口完成对话→写章→声明→采用→下一轮读取正文", async () => {
    let prose = PROSE;
    const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, loadRules()).words.sweet;
    while (countWords(prose) < target) prose += "\n他沿着石壁查看木匣，把封口与旧图对照，再记下匣底的编号。";
    const tool = (id: string, name: string, input: unknown) => ({ ...assistant("", `reason-${id}`), tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(input) }, extra_content: { signature: `signature-${id}` } }] });
    const isMain = (body: Body) => body.tools?.some((t: Body) => t.function?.name === "write_next_chapter");
    const writeTool = tool("write", "write_next_chapter", {});
    const mainReplies = [
      { message: writeTool },
      { message: tool("adopt", "adopt_chapter", { draftId: "ch3d1" }) },
      { message: assistant("已采用第三章。") },
      { message: tool("read", "get_chapter_text", { chapter: 3, excerpt: "full" }) },
      { message: assistant("已读取第三章正文。") },
    ];
    let mainIndex = 0;
    const state = await setup((body) => isMain(body) ? mainReplies[mainIndex++]! : { message: body.response_format ? assistant(C5_JSON, "declaration-private-reasoning") : assistant(prose, "chapter-private-reasoning") });
    const session = state.session();
    const written = await send(session, "按计划写下一章");
    expect(written.body).toMatchObject({ effects: [{ kind: "chapter_started", draftId: "ch3d1", status: "writing" }] });
    expect(written.body).toMatchObject({ text: expect.stringContaining("后台") });
    expect(mainIndex).toBe(1);
    expect((await session.writeChapter({ chapter: 3, draftId: "ch3d1" })).status).toBe("ready");
    expect(new ProjectStore(state.root).load().chapters.has(3)).toBe(false);
    const declarationRequest = state.requests.find((body) => body.response_format !== undefined);
    expect(declarationRequest?.response_format).toEqual({ type: "json_object" });
    expect(declarationRequest?.messages).toContainEqual(assistant(prose, "chapter-private-reasoning"));
    const adopted = await send(state.session(), "采用 ch3d1");
    expect(adopted.body).toMatchObject({ effects: [{ kind: "chapter_adopted", draftId: "ch3d1" }] });
    expect(new ProjectStore(state.root).load().chapters.get(3)).toBe(prose);
    const resumed = state.requests.filter(isMain)[1]!.messages;
    expect(resumed.filter((message: Body) => message.role === "assistant")).toEqual([writeTool]);
    expect(resumed).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "write" }));
    expect(resumed).toContainEqual({ role: "user", content: expect.stringContaining("系统记录：") });
    expect(JSON.stringify(resumed)).not.toContain("chapter-private-reasoning");
    expect(JSON.stringify([written.body, adopted.body])).not.toMatch(/reason-write|signature-write/u);
    await send(state.session(), "读取第三章正文");
    expect(state.requests).toHaveLength(7);
    expect(state.requests[6]?.messages).toContainEqual({ role: "tool", tool_call_id: "read", content: prose });
    expect(state.requests.every((r) => r.thinking.type === "enabled")).toBe(true);
  });

  it("工具往返与最终思考消息跨 Session 原样回放，ideas 与 API 的可见内容保持正确", async () => {
    const tool = ideaTool("idea-call");
    const final = assistant("已记下备选想法。");
    const state = await setup([{ message: tool }, { message: final }, { message: assistant("继续讨论。", "next-reasoning") }]);
    const first = await send(state.session(), "记录一个备选想法");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ text: "已记下备选想法。", effects: [{ kind: "idea_recorded" }] });
    const persisted = readFileSync(join(state.root, "conversation.json"), "utf8");
    expect(persisted).toContain("private-reasoning");
    expect(persisted).not.toContain("local-test-key");
    const restored = state.session();
    const second = await send(restored, "继续讨论");
    expect(second.body).toMatchObject({ text: "继续讨论。" });
    expect(state.requests).toHaveLength(3);
    expect(state.requests[2]?.messages).toContainEqual(tool);
    expect(state.requests[2]?.messages).toContainEqual(final);
    expect(state.requests[2]?.messages).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "idea-call" }));
    expect(state.store.listIdeas()).toHaveLength(1);
    const history = handle(restored, { method: "GET", path: "/api/conversation", query: new URLSearchParams(), body: null });
    expect(history.body).toMatchObject({ turns: expect.any(Array), ideas: expect.any(Array) });
    expect(JSON.stringify([first.body, second.body, history.body])).not.toMatch(/private-reasoning|modelHistory|chat_response|signature-idea-call/u);
  });

  it("没有调用工具的思考回复也完整回放", async () => {
    const first = assistant("写到第二章了。", "no-tool-reasoning");
    const state = await setup([{ message: first }, { message: assistant("可以先讨论下一章。") }]);
    await send(state.session(), "写到哪了");
    await send(state.session(), "接下来呢");
    expect(state.requests).toHaveLength(2);
    expect(state.requests[1]?.messages).toContainEqual(first);
  });

  it.each([false, true])("旧文本历史转为上下文，不伪造 assistant 推理；损坏内部快照=%s", async (broken) => {
    const state = await setup([{ message: assistant("记得，我们在讨论旧计划。") }]);
    writeFileSync(join(state.root, "conversation.json"), JSON.stringify({
      turns: [{ role: "user", text: "旧问题", at: "2026-09-11" }, { role: "agent", text: "旧回答", at: "2026-09-11" }],
      ideas: [], ...(broken ? { modelHistory: { target: "broken", turnCount: 2, messages: "invalid" } } : {}),
    }));
    const response = await send(state.session(), "继续旧计划");
    expect(response.body).toMatchObject({ text: "记得，我们在讨论旧计划。" });
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]?.messages.filter((m: Body) => m.role === "assistant")).toEqual([]);
    expect(JSON.stringify(state.requests[0]?.messages)).toContain("旧问题");
    expect(JSON.stringify(state.requests[0]?.messages)).toContain("旧回答");
    expect(state.store.load().turns).toHaveLength(4);
  });

  it("切换模型只转交可见历史文字，后续使用新模型的完整消息", async () => {
    const newer = assistant("新模型已接续。", "new-model-reasoning");
    const state = await setup([{ message: assistant("已有对话。", "old-model-reasoning") }, { message: newer }, { message: assistant("收到。") }]);
    await send(state.session(), "第一句");
    vi.stubEnv("CHAT_MODEL", "different-model");
    const changed = state.session();
    await send(changed, "第二句");
    await send(changed, "第三句");
    expect(state.requests).toHaveLength(3);
    expect(JSON.stringify(state.requests[1])).toContain("已有对话。");
    expect(JSON.stringify(state.requests[1])).not.toContain("old-model-reasoning");
    expect(state.requests[2]?.messages).toContainEqual(newer);
  });

  it.each(["error", "length", "refusal", "cap"])("%s 后只续接已执行工具，不回放未完成工具", async (kind) => {
    const pending = ideaTool("unexecuted-call", "不应记录的想法");
    if (kind === "length" || kind === "refusal") pending.tool_calls[0]!.function.arguments = "{";
    const interruption: Reply = kind === "error" ? { status: 503 } : { message: pending, finish: kind === "length" ? "length" : kind === "refusal" ? "content_filter" : "tool_calls" };
    const state = await setup([{ message: ideaTool("executed-call") }, interruption, { message: assistant("本轮只讨论。") }], 1);
    await send(state.session(), "记录备选");
    expect(state.store.listIdeas()).toHaveLength(1);
    const response = await send(state.session(), "下一条消息");
    expect(response.body).toMatchObject({ text: "本轮只讨论。" });
    expect(state.requests).toHaveLength(3);
    const resumed = state.requests[2]?.messages;
    expect(resumed).toContainEqual(ideaTool("executed-call"));
    expect(resumed).toContainEqual(expect.objectContaining({ role: "tool", tool_call_id: "executed-call" }));
    expect(JSON.stringify(resumed)).not.toContain("unexecuted-call");
    expect(state.store.listIdeas()).toHaveLength(1);
  });
});
