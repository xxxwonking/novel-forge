/**
 * 对话流式通道：文本增量按模型调用分轮、工具进度可见、最终以 done 携带的完整回复
 * 为准；回合照常落盘；开始前失败仍返回带状态码的 JSON。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { request as httpRequest, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions, CallResult, ClaudeClient } from "../src/client/claude.js";
import { conversationStream, handle } from "../src/server/api.js";
import { serve } from "../src/server/http.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import type { ConversationStreamEvent } from "../src/agent/types.js";
import { SINGLE_PASS_RULES, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

/** 每次调用先把文本按字流出，再返回完整结果；模拟真实客户端的增量回传。 */
function streamingClient(results: readonly CallResult[]): { client: ClaudeClient; calls: CallOptions[] } {
  const calls: CallOptions[] = [];
  const client = {
    official: true,
    call: vi.fn(async (options: CallOptions): Promise<CallResult> => {
      calls.push(options);
      const result = results[calls.length - 1];
      if (result === undefined) throw new Error("测试没有安排额外的模型调用");
      if (result.kind === "ok") {
        for (const block of result.message.content) {
          if (block.type !== "text") continue;
          for (const char of block.text) {
            await new Promise(resolve => setTimeout(resolve, 0));
            options.onTextDelta?.(char);
          }
        }
      }
      return result;
    }),
  } as unknown as ClaudeClient;
  return { client, calls };
}

function toolUse(name: string, input: unknown, text?: string): CallResult {
  const blocks: Anthropic.ContentBlock[] = [
    ...(text === undefined ? [] : [{ type: "text", text, citations: [] } as unknown as Anthropic.ContentBlock]),
    { type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock,
  ];
  return { kind: "ok", message: modelMessage(blocks, "tool_use") };
}

function seed(client?: ClaudeClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-conv-stream-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, SINGLE_PASS_RULES, client === undefined ? {} : { client }) };
}

describe("对话流式事件", () => {
  it("每次模型调用先发 round，文本增量拼起来等于该轮文本，最终 done 带完整回复", async () => {
    const model = streamingClient([
      toolUse("get_next_plan", {}, "我先看看计划。"),
      modelText("下一章按计划写。"),
    ]);
    const { session } = seed(model.client);
    const events: ConversationStreamEvent[] = [];
    const failed = await conversationStream(session, { text: "下一章写什么？" }, event => events.push(event));
    expect(failed).toBeNull();

    const rounds = events.map((event, index) => (event.type === "round" ? index : -1)).filter(index => index >= 0);
    expect(rounds).toHaveLength(2);
    const textOf = (from: number, to: number) => events.slice(from, to).flatMap(event => (event.type === "delta" ? [event.text] : [])).join("");
    expect(textOf(rounds[0]!, rounds[1]!)).toBe("我先看看计划。");
    expect(textOf(rounds[1]!, events.length)).toBe("下一章按计划写。");

    const tools = events.filter(event => event.type === "tool");
    expect(tools).toEqual([
      { type: "tool", name: "get_next_plan", status: "started", ok: true },
      { type: "tool", name: "get_next_plan", status: "finished", ok: true },
    ]);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.reply.text).toBe("下一章按计划写。");
      expect(done.reply.toolRounds).toBe(1);
    }
    expect(model.calls.every(call => typeof call.onTextDelta === "function")).toBe(true);

    const saved = handle(session, { method: "GET", path: "/api/conversation", query: new URLSearchParams(), body: null }).body as { turns: { role: string; text: string }[] };
    expect(saved.turns.map(turn => [turn.role, turn.text])).toEqual([["user", "下一章写什么？"], ["agent", "下一章按计划写。"]]);
  });

  it("缺少 text 或未配置模型时不发事件，返回原有的 JSON 错误", async () => {
    vi.stubEnv("NOVEL_MODEL_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const { session } = seed();
    const events: ConversationStreamEvent[] = [];
    expect(await conversationStream(session, { text: "  " }, event => events.push(event))).toMatchObject({ status: 400 });
    expect(await conversationStream(session, { text: "你好" }, event => events.push(event))).toMatchObject({ status: 503 });
    expect(events).toEqual([]);
  });

  it("模型调用失败不抛到传输层：作为回复文本进入 done", async () => {
    const model = streamingClient([{ kind: "error", error: { type: "connection", status: null, message: "连接中断", retryable: true } }]);
    const { session } = seed(model.client);
    const events: ConversationStreamEvent[] = [];
    expect(await conversationStream(session, { text: "在吗" }, event => events.push(event))).toBeNull();
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") expect(done.reply.text).toContain("模型调用失败");
  });
});

describe("POST /api/conversation/stream", () => {
  it("以 SSE 逐条发出事件，回合保存后普通 GET 能读到", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-conv-http-")); roots.push(root);
    new ProjectStore(root).save(writingSnapshot());
    const model = streamingClient([modelText("你好，作者。")]);
    const server = serve({ projectRoot: root, port: 0, client: model.client });
    servers.push(server); await once(server, "listening");
    const port = (server.address() as AddressInfo).port;

    const response = await new Promise<{ status: number; type: string | undefined; chunks: string[] }>((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port, path: "/api/conversation/stream", method: "POST", headers: { "content-type": "application/json" } }, res => {
        const chunks: string[] = [];
        res.setEncoding("utf8");
        res.on("data", chunk => chunks.push(chunk as string));
        res.on("end", () => resolve({ status: res.statusCode!, type: res.headers["content-type"], chunks }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.end(JSON.stringify({ text: "你好" }));
    });
    expect(response.status).toBe(200);
    expect(response.type).toContain("text/event-stream");
    expect(response.chunks.length).toBeGreaterThan(1);
    const events = response.chunks.join("").split("\n\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6)) as ConversationStreamEvent);
    expect(events[0]).toEqual({ type: "round", round: 1 });
    expect(events.flatMap(event => (event.type === "delta" ? [event.text] : [])).join("")).toBe("你好，作者。");
    expect(events.at(-1)).toMatchObject({ type: "done", reply: { text: "你好，作者。" } });

    const history = await fetch(`http://127.0.0.1:${port}/api/conversation`).then(res => res.json() as Promise<{ turns: { text: string }[] }>);
    expect(history.turns.map(turn => turn.text)).toEqual(["你好", "你好，作者。"]);
  });

  it("未配置模型时返回 503 JSON 而不是空的事件流", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-conv-http-")); roots.push(root);
    new ProjectStore(root).save(writingSnapshot());
    vi.stubEnv("NOVEL_MODEL_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const server = serve({ projectRoot: root, port: 0 });
    servers.push(server); await once(server, "listening");
    const port = (server.address() as AddressInfo).port;
    const res = await fetch(`http://127.0.0.1:${port}/api/conversation/stream`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "你好" }) });
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
  });
});
