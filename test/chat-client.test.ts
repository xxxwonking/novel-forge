import { afterEach, describe, expect, it } from "vitest";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { ChatClient } from "../src/client/chat.js";
import { readChatStream } from "../src/client/chat-stream.js";
import { appendTurn, type CallOptions } from "../src/client/claude.js";

const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

type Body = Record<string, any>;
async function endpoint(reply: (body: Body, res: ServerResponse, req: IncomingMessage) => void) {
  const requests: Body[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const chunk of req) text += chunk;
    const body = JSON.parse(text) as Body;
    requests.push(body);
    reply(body, res, req);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, requests };
}

function completion(message: Body = { role: "assistant", content: "雨停了。" }, finish = "stop") {
  return { id: "chat-test", model: "gemini-test", choices: [{ index: 0, message, finish_reason: finish }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 35 } };
}

function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(value));
}

function options(overrides: Partial<CallOptions> = {}): CallOptions {
  return { role: "creative", maxTokens: 200, messages: [{ role: "user", content: "写一段雨夜。" }], ...overrides };
}

describe("ChatClient", () => {
  it.each(["", "/v1", "/v1/"])("从 base URL %s 调用 chat，转换文本且不发送 Claude 专用参数", async (suffix) => {
    const service = await endpoint((body, res, req) => {
      expect(req.url).toBe("/v1/chat/completions");
      expect(req.headers.authorization).toBe("Bearer local-test-key");
      json(res, completion());
    });
    const client = new ChatClient({ baseURL: service.baseURL + suffix, apiKey: "local-test-key", model: "gemini-test" });
    const result = await client.call(options({
      thinking: true, effort: "xhigh",
      system: [{ type: "text", text: "只写正文。", cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: [{ type: "text", text: "人物资料", cache_control: { type: "ephemeral" } }, { type: "text", text: "写一段雨夜。" }] }],
    }));
    expect(client.official).toBe(false);
    expect(service.requests[0]).toMatchObject({ model: "gemini-test", max_tokens: 200, stream: false, messages: [{ role: "system", content: "只写正文。" }, { role: "user", content: "人物资料\n\n写一段雨夜。" }] });
    expect(JSON.stringify(service.requests)).not.toMatch(/cache_control|output_config|thinking|effort/);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.message.content[0]).toMatchObject({ type: "text", text: "雨停了。" });
    expect(result.message.usage).toMatchObject({ input_tokens: 12, output_tokens: 8 });
  });

  it("工具消息经过 JSON 持久化后保留完整 assistant、推理字段和 Gemini 工具签名", async () => {
    const assistant = { role: "assistant", content: null, reasoning_content: "检查人物。", tool_calls: [{ id: "tool-1", type: "function", function: { name: "load_character", arguments: '{"name":"李长风"}' }, extra_content: { google: { thought_signature: "test-signature" } } }] };
    const service = await endpoint((_body, res) => json(res, service.requests.length === 1 ? completion(assistant, "tool_calls") : completion()));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" });
    const initial = options({ tools: [{ name: "load_character", description: "读取人物", input_schema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] }, cache_control: { type: "ephemeral" } }] });
    const first = await client.call(initial);
    expect(first.kind).toBe("ok");
    if (first.kind !== "ok") return;
    expect(first.message.stop_reason).toBe("tool_use");
    expect(first.message.content[0]).toMatchObject({ type: "tool_use", id: "tool-1", name: "load_character", input: { name: "李长风" } });
    const restored = JSON.parse(JSON.stringify(first.message));
    await client.call(options({ messages: appendTurn(initial.messages, restored, [{ type: "tool_result", tool_use_id: "tool-1", content: "李长风正在养伤。" }]) }));
    expect(service.requests[0]?.tools).toEqual([{ type: "function", function: { name: "load_character", description: "读取人物", parameters: initial.tools?.[0]?.input_schema } }]);
    expect(service.requests[1]?.messages.slice(-2)).toEqual([assistant, { role: "tool", tool_call_id: "tool-1", content: "李长风正在养伤。" }]);
  });

  it("C5 按 JSON schema 请求结构化声明", async () => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: '{"events":[]}' })));
    const schema = { type: "object", properties: { events: { type: "array", items: { type: "string" } } }, required: ["events"], additionalProperties: false };
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" });
    expect((await client.call(options({ outputSchema: schema }))).kind).toBe("ok");
    expect(service.requests[0]?.response_format).toEqual({ type: "json_schema", json_schema: { name: "chapter_declaration", strict: true, schema } });
  });

  it.each(["/api/v3", "/compatible-mode/v1/", "/chat/completions", "/custom/v2/chat/completions/"])("保留国内官方与代理的路径前缀 %s", async (suffix) => {
    let path: string | undefined;
    const service = await endpoint((_body, res, req) => { path = req.url; json(res, completion()); });
    const client = new ChatClient({ baseURL: service.baseURL + suffix, apiKey: "local-test-key", model: "domestic-model" });
    expect((await client.call(options())).kind).toBe("ok");
    const clean = suffix.replace(/\/$/u, "");
    expect(path).toBe(clean.endsWith("/chat/completions") ? clean : `${clean}/chat/completions`);
  });

  it.each(["json_object", "prompt"] as const)("C5 %s 提供完整 schema 与 JSON 指令，普通正文不受影响", async (jsonMode) => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const schema = { type: "object", properties: { events: { type: "array", items: { type: "string" } } }, required: ["events"], additionalProperties: false };
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "domestic-model", jsonMode });
    const system = [{ type: "text" as const, text: "保持设定一致。" }];
    await client.call(options({ system, outputSchema: schema }));
    const request = service.requests[0]!;
    expect(request.messages[0].role).toBe("system");
    expect(request.messages[0].content).toContain("保持设定一致。");
    expect(request.messages[0].content).toContain(JSON.stringify(schema));
    expect(request.messages[0].content).toMatch(/JSON/u);
    expect(request.response_format).toEqual(jsonMode === "json_object" ? { type: "json_object" } : undefined);
    expect(system).toEqual([{ type: "text", text: "保持设定一致。" }]);
    await client.call(options());
    expect(service.requests[1]?.messages).toEqual([{ role: "user", content: "写一段雨夜。" }]);
    expect(service.requests[1]).not.toHaveProperty("response_format");
  });

  it("JSON Object 没有原 system 时仍加入 JSON 格式要求", async () => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "deepseek-test", preset: "deepseek" });
    await client.call(options({ outputSchema: { type: "object", properties: {} } }));
    expect(service.requests[0]?.messages[0]).toMatchObject({ role: "system" });
    expect(service.requests[0]?.messages[0].content).toContain('"properties":{}');
  });

  it("思考参数由 Chat 配置显式决定，适用于对话和创作两个角色", async () => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "deepseek-test", thinking: "enabled", reasoningEffort: "low" });
    await client.call(options({ role: "judge" }));
    await client.call(options({ thinking: false, effort: "xhigh" }));
    for (const request of service.requests) expect(request).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "low" });
  });

  it("开启思考并携带工具时拒绝没有原始 reasoning_content 的 assistant 历史", async () => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "deepseek-test", thinking: "enabled" });
    const result = await client.call(options({ tools: [{ name: "read", input_schema: { type: "object" } }], messages: [{ role: "assistant", content: "旧的纯文本回复" }, { role: "user", content: "继续" }] }));
    expect(result).toMatchObject({ kind: "error", error: { retryable: false, message: expect.stringContaining("reasoning_content") } });
    expect(service.requests).toHaveLength(0);
  });

  it("输出预算先按配置限额，流式选择使用限额后的预算", async () => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "domestic-test", maxOutputTokens: 4096 });
    await client.call(options({ maxTokens: 16000 }));
    await client.call(options({ maxTokens: 1000 }));
    expect(service.requests[0]).toMatchObject({ max_tokens: 4096, stream: false });
    expect(service.requests[1]).toMatchObject({ max_tokens: 1000, stream: false });
  });

  it.each(["always", "never"] as const)("代理可显式选择 %s 流式并省略不支持的 usage 扩展", async (stream) => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "domestic-test", stream, includeUsage: false });
    await client.call(options({ maxTokens: stream === "always" ? 100 : 16000 }));
    expect(service.requests[0]?.stream).toBe(stream === "always");
    expect(service.requests[0]).not.toHaveProperty("stream_options");
  });

  it("思考配置变化阻止旧草稿恢复，JSON 模式与密钥轮换允许恢复", async () => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const config = { baseURL: service.baseURL, apiKey: "local-test-key", model: "domestic-test" };
    const result = await new ChatClient(config).call(options());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const messages = appendTurn([], JSON.parse(JSON.stringify(result.message)), []);
    const changed = await new ChatClient({ ...config, thinking: "disabled" }).call(options({ messages }));
    expect(changed.kind).toBe("error");
    expect(service.requests).toHaveLength(1);
    const compatible = await new ChatClient({ ...config, apiKey: "rotated-test-key", jsonMode: "json_object" }).call(options({ messages }));
    expect(compatible.kind).toBe("ok");
    expect(service.requests).toHaveLength(2);
  });

  it.each(["insufficient_system_resource", "aborted"])("国内模型 %s 返回明确错误，残缺工具参数不会执行", async (reason) => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: "部分内容", tool_calls: [{ id: "partial", type: "function", function: { name: "load_character", arguments: "{" } }] }, reason)));
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "deepseek-test" }).call(options());
    expect(result).toMatchObject({ kind: "error", partialText: "部分内容", error: { type: "status", retryable: true, message: expect.stringContaining(reason) } });
    expect(result).not.toHaveProperty("message");
    expect(service.requests).toHaveLength(1);
  });

  it("SSE 的资源不足停止原因同样返回模型错误", async () => {
    const service = await endpoint((_body, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end('data: {"choices":[{"delta":{"content":"未完成"},"finish_reason":"insufficient_system_resource"}]}\n\ndata: [DONE]\n\n');
    });
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "deepseek-test" }).call(options({ maxTokens: 9000 }));
    expect(result).toMatchObject({ kind: "error", error: { type: "status", retryable: true } });
  });

  it("兼容代理用 tool_calls: null 表示没有工具调用的 JSON 响应", async () => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: '{"events":[]}', tool_calls: null })));
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" });
    const result = await client.call(options());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.message.content[0]).toMatchObject({ type: "text", text: '{"events":[]}' });
  });

  it("配置模型变化后不把已保存会话直接发往新模型", async () => {
    const service = await endpoint((_body, res) => json(res, completion()));
    const first = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" });
    const result = await first.call(options());
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const changed = new ChatClient({ baseURL: service.baseURL, apiKey: "rotated-test-key", model: "gemini-other" });
    const second = await changed.call(options({ messages: appendTurn([], JSON.parse(JSON.stringify(result.message)), []) }));
    expect(second.kind).toBe("error");
    expect(service.requests).toHaveLength(1);
  });

  it("长输出使用 SSE 并返回合并后的正文", async () => {
    const service = await endpoint((_body, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write('data: {"id":"chat-stream","choices":[{"delta":{"role":"assistant","content":"雨"},"finish_reason":null}]}\n\n');
      res.write('data: {"choices":[{"delta":{"content":"停了。"},"finish_reason":"stop"}]}\n\n');
      res.end('data: {"choices":[],"usage":{"prompt_tokens":20,"completion_tokens":6}}\n\ndata: [DONE]\n\n');
    });
    const client = new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" });
    const result = await client.call(options({ maxTokens: 9000 }));
    expect(service.requests[0]).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") expect(result.message.content[0]).toMatchObject({ text: "雨停了。" });
  });

  it.each(["length", "content_filter"])("识别 %s 停止原因", async (reason) => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: "部分正文" }, reason)));
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options());
    expect(result.kind).toBe(reason === "length" ? "max_tokens" : "refusal");
  });

  it.each(["length", "content_filter"])("%s 伴随未完成工具参数时仍保留停止原因和已有正文", async (reason) => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: "已有正文", tool_calls: [{ id: "partial", type: "function", function: { name: "load_character", arguments: '{"name":' } }] }, reason)));
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options());
    expect(result.kind).toBe(reason === "length" ? "max_tokens" : "refusal");
    if (result.kind === "max_tokens" || result.kind === "refusal") {
      expect(result.message.content[0]).toMatchObject({ type: "text", text: "已有正文" });
      expect(result.message.content.some((block) => block.type === "tool_use")).toBe(false);
    }
  });

  it("识别 message.refusal", async () => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: null, refusal: "无法完成这个请求。" })));
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options());
    expect(result.kind).toBe("refusal");
  });

  it.each([401, 429, 503])("HTTP %i 返回错误，不自动重试且清除密钥", async (status) => {
    const service = await endpoint((_body, res) => json(res, { error: { message: "请求失败 local-test-key" } }, status));
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options());
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.error.status).toBe(status);
      expect(result.error.retryable).toBe(status === 429 || status >= 500);
      expect(result.error.message).not.toContain("local-test-key");
    }
    expect(service.requests).toHaveLength(1);
  });

  it("超时返回可重试的连接错误", async () => {
    const service = await endpoint(() => {});
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test", timeoutMs: 30 }).call(options());
    expect(result).toMatchObject({ kind: "error", error: { type: "connection", retryable: true } });
  });

  it("工具 arguments 不是合法 JSON 时停止，不执行伪造空参数", async () => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: null, tool_calls: [{ id: "broken", type: "function", function: { name: "load_character", arguments: "{" } }] }, "tool_calls")));
    expect((await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options())).kind).toBe("error");
  });

  it("无有效 choices 的响应不冒充成功", async () => {
    const service = await endpoint((_body, res) => json(res, { choices: [] }));
    expect((await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options())).kind).toBe("error");
  });

  it.each([{ tool_calls: undefined }, { tool_calls: [] }])("tool_calls 结束但调用列表为 $tool_calls 时不能冒充正文完成", async ({ tool_calls }) => {
    const service = await endpoint((_body, res) => json(res, completion({ role: "assistant", content: "我还需要先查资料。", tool_calls }, "tool_calls")));
    const result = await new ChatClient({ baseURL: service.baseURL, apiKey: "local-test-key", model: "gemini-test" }).call(options());
    expect(result).toMatchObject({ kind: "error", error: { message: expect.stringContaining("工具") } });
    expect(service.requests).toHaveLength(1);
  });
});

describe("chat SSE", () => {
  it("收到 DONE 后立即结束，不依赖代理关闭响应连接", async () => {
    let reads = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++reads > 1) { controller.error(new Error("不应继续读取已完成的 SSE")); return; }
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"正文"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await expect(readChatStream(new Response(stream))).resolves.toMatchObject({ choices: [{ message: { content: "正文" } }] });
    expect(cancelled).toBe(true);
    expect(reads).toBe(1);
  });

  it("UTF-8 字节、CRLF、工具参数及签名分块后仍能还原", async () => {
    const chunks = [
      { id: "stream-id", choices: [{ delta: { role: "assistant", content: "雨夜", reasoning_content: "先查", tool_calls: [{ index: 0, id: "call-1", type: "function", function: { name: "load_character", arguments: '{"name":' }, extra_content: { google: { thought_signature: "signature" } } }] }, finish_reason: null }] },
      { choices: [{ delta: { content: "。", reasoning_content: "人物。", tool_calls: [{ index: 0, function: { arguments: '"李长风"}' } }] }, finish_reason: "tool_calls" }] },
    ];
    const bytes = new TextEncoder().encode(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\r\n\r\n`).join("") + "data: [DONE]\r\n\r\n");
    let offset = 0;
    const stream = new ReadableStream<Uint8Array>({ pull(controller) { if (offset === bytes.length) controller.close(); else controller.enqueue(bytes.slice(offset, ++offset)); } });
    const result = await readChatStream(new Response(stream));
    expect(result.choices[0]?.message).toMatchObject({ content: "雨夜。", reasoning_content: "先查人物。", tool_calls: [{ id: "call-1", function: { name: "load_character", arguments: '{"name":"李长风"}' }, extra_content: { google: { thought_signature: "signature" } } }] });
    expect(result.choices[0]?.message.tool_calls?.[0]).not.toHaveProperty("index");
  });

  it("网络提前结束且没有 finish_reason 时拒绝不完整响应", async () => {
    const response = new Response('data: {"choices":[{"delta":{"content":"未完成"},"finish_reason":null}]}\n\n');
    await expect(readChatStream(response)).rejects.toMatchObject({ partialText: "未完成" });
  });

  it("读取连接中断时保留已完成的文本事件，不混入思考或半截工具", async () => {
    let reads = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (++reads > 1) { controller.error(new TypeError("connection lost")); return; }
        controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"已经写出的片段","reasoning_content":"内部推理","tool_calls":[{"index":0,"id":"partial","type":"function","function":{"name":"load_character","arguments":"{"}}]},"finish_reason":null}]}\n\n'));
      },
    }, { highWaterMark: 0 });
    await expect(readChatStream(new Response(stream))).rejects.toMatchObject({ partialText: "已经写出的片段", cause: expect.any(TypeError) });
  });

  it("只有思考内容的中断不会伪造正文片段", async () => {
    const response = new Response('data: {"choices":[{"delta":{"reasoning_content":"内部推理"},"finish_reason":null}]}\n\n');
    await expect(readChatStream(response)).rejects.toMatchObject({ partialText: "" });
  });
});
