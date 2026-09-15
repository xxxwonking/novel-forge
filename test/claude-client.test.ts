import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { ClaudeClient } from "../src/client/claude.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
});

async function endpoint(ending: "missing" | "error" | "complete") {
  const requests: unknown[] = [];
  const server = createServer(async (req, res) => {
    let body = ""; for await (const chunk of req) body += chunk;
    requests.push(JSON.parse(body));
    res.writeHead(200, { "content-type": "text/event-stream" });
    const event = (value: Record<string, unknown>) => res.write(`event: ${value.type}\ndata: ${JSON.stringify(value)}\n\n`);
    event({ type: "message_start", message: { id: "local-message", type: "message", role: "assistant", model: "local-model", content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 0 } } });
    event({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "", signature: "" } });
    event({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "内部推理" } });
    event({ type: "content_block_stop", index: 0 });
    event({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
    event({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "已经收到的正文。" } });
    if (ending === "error") event({ type: "error", error: { type: "overloaded_error", message: "local stream interrupted" } });
    if (ending === "complete") {
      event({ type: "content_block_stop", index: 1 });
      event({ type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 20 } });
      event({ type: "message_stop" });
    }
    res.end();
  });
  servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const client = new ClaudeClient({ apiKey: "local-test-key", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, official: false });
  return { client, requests };
}

describe("Claude 协议的本地流式响应", () => {
  it("代理返回的 HTTP 错误不向任务和页面回传 API 凭证", async () => {
    const server = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume request */ }
      res.writeHead(401, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { type: "authentication_error", message: "invalid key: local-test-key Bearer echoed-token" } }));
    });
    servers.push(server); server.listen(0, "127.0.0.1"); await once(server, "listening");
    const client = new ClaudeClient({ apiKey: "local-test-key", baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, official: false });
    const result = await client.call({ role: "creative", maxTokens: 100, messages: [{ role: "user", content: "本地错误测试" }] });
    expect(result.kind).toBe("error");
    expect(JSON.stringify(result)).not.toContain("local-test-key");
    expect(JSON.stringify(result)).not.toContain("echoed-token");
  });

  it("代理重定向不能把 x-api-key 发送给另一个端点", async () => {
    const redirectedKeys: unknown[] = [];
    const target = createServer((req, res) => { redirectedKeys.push(req.headers["x-api-key"]); res.writeHead(400); res.end(); });
    servers.push(target); target.listen(0, "127.0.0.1"); await once(target, "listening");
    const source = createServer(async (req, res) => {
      for await (const _chunk of req) { /* consume request */ }
      res.writeHead(307, { location: `http://127.0.0.1:${(target.address() as AddressInfo).port}/redirected` }); res.end();
    });
    servers.push(source); source.listen(0, "127.0.0.1"); await once(source, "listening");
    const client = new ClaudeClient({ apiKey: "local-test-key", baseURL: `http://127.0.0.1:${(source.address() as AddressInfo).port}`, official: false });
    expect((await client.call({ role: "creative", maxTokens: 100, messages: [{ role: "user", content: "本地重定向测试" }] })).kind).toBe("error");
    expect(redirectedKeys).toEqual([]);
  });

  it.each(["missing", "error"] as const)("%s 中断保留可见正文，不把思考内容当成片段", async ending => {
    const service = await endpoint(ending);
    const result = await service.client.call({ role: "creative", maxTokens: 9000, messages: [{ role: "user", content: "仅测试本地协议" }] });
    expect(result).toMatchObject({ kind: "error", partialText: "已经收到的正文。" });
    expect(result).not.toHaveProperty("message");
    expect(service.requests).toHaveLength(1);
  });

  it("完整响应仍返回全部内容块供同会话结构核对", async () => {
    const service = await endpoint("complete");
    const result = await service.client.call({ role: "creative", maxTokens: 9000, messages: [{ role: "user", content: "仅测试本地协议" }] });
    expect(result).toMatchObject({ kind: "ok", message: { stop_reason: "end_turn", content: [{ type: "thinking" }, { type: "text", text: "已经收到的正文。" }] } });
    expect(service.requests).toHaveLength(1);
  });
});
