import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatClient } from "../src/client/chat.js";
import { ClaudeClient } from "../src/client/claude.js";
import { createModelClient } from "../src/client/create.js";

const chat = { NOVEL_MODEL_PROVIDER: "chat", CHAT_BASE_URL: "http://127.0.0.1:1/v1", CHAT_API_KEY: "local-test-key", CHAT_MODEL: "gemini-test" };
afterEach(() => vi.unstubAllGlobals());

async function requestFor(env: Record<string, string>) {
  let body: Record<string, any> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return Response.json({ choices: [{ message: { role: "assistant", content: "{}" }, finish_reason: "stop" }] });
  }));
  const client = createModelClient({ ...chat, ...env });
  const result = await client.call({ role: "creative", maxTokens: 16000, outputSchema: { type: "object", properties: {} }, messages: [{ role: "user", content: "声明" }] });
  expect(result.kind).toBe("ok");
  return body;
}

describe("模型配置", () => {
  it("明确选择 chat 时创建 chat 客户端，即使同时存在 Claude 配置", () => {
    expect(createModelClient({ ...chat, ANTHROPIC_API_KEY: "unused-test-key" })).toBeInstanceOf(ChatClient);
  });

  it("旧配置保留 Claude 客户端入口", () => {
    expect(createModelClient({ ANTHROPIC_API_KEY: "unused-test-key" })).toBeInstanceOf(ClaudeClient);
  });

  it.each(["CHAT_BASE_URL", "CHAT_API_KEY", "CHAT_MODEL"])("chat 缺少 %s 时明确报错", (name) => {
    expect(() => createModelClient({ ...chat, [name]: "" })).toThrow(name);
  });

  it("provider 拼错时不回退到 Claude", () => {
    expect(() => createModelClient({ ...chat, NOVEL_MODEL_PROVIDER: "typo" })).toThrow("NOVEL_MODEL_PROVIDER");
  });

  it("拒绝将凭证放在 base URL", () => {
    expect(() => createModelClient({ ...chat, CHAT_BASE_URL: "https://user:secret@example.invalid/v1" })).toThrow();
  });

  it("DeepSeek 预设在官方或代理地址均生成 JSON Object 和显式非思考请求", async () => {
    for (const url of ["https://api.deepseek.com/chat/completions", "https://proxy.example.invalid/api/v3"]) {
      const body = await requestFor({ CHAT_PRESET: "deepseek", CHAT_BASE_URL: url, CHAT_MODEL: "account-model-id" });
      expect(body).toMatchObject({ model: "account-model-id", response_format: { type: "json_object" }, thinking: { type: "disabled" } });
      expect(body).not.toHaveProperty("reasoning_effort");
    }
  });

  it("所有兼容参数能显式覆盖预设", async () => {
    const body = await requestFor({ CHAT_PRESET: "deepseek", CHAT_JSON_MODE: "prompt", CHAT_THINKING: "enabled", CHAT_REASONING_EFFORT: "low", CHAT_MAX_OUTPUT_TOKENS: "4096", CHAT_STREAM: "always", CHAT_STREAM_INCLUDE_USAGE: "false", CHAT_TIMEOUT_MS: "2000" });
    expect(body).toMatchObject({ max_tokens: 4096, stream: true, thinking: { type: "enabled" }, reasoning_effort: "low" });
    expect(body).not.toHaveProperty("response_format");
    expect(body).not.toHaveProperty("stream_options");
    expect(body.messages[0].content).toContain('"type":"object"');
  });

  it("空的可选变量沿用旧 Gemini 默认行为，不根据域名猜测预设", async () => {
    const body = await requestFor({ CHAT_BASE_URL: "https://api.deepseek.com", CHAT_PRESET: "  ", CHAT_JSON_MODE: "", CHAT_THINKING: "", CHAT_MAX_OUTPUT_TOKENS: "" });
    expect(body.response_format.type).toBe("json_schema");
    expect(body).not.toHaveProperty("thinking");
    expect(body).toMatchObject({ max_tokens: 16000, stream: true, stream_options: { include_usage: true } });
  });

  it.each([
    ["CHAT_PRESET", "typo"], ["CHAT_JSON_MODE", "auto"], ["CHAT_THINKING", "true"],
    ["CHAT_REASONING_EFFORT", "xhigh"], ["CHAT_STREAM", "true"], ["CHAT_STREAM_INCLUDE_USAGE", "yes"],
    ["CHAT_MAX_OUTPUT_TOKENS", "0"], ["CHAT_MAX_OUTPUT_TOKENS", "1.5"], ["CHAT_MAX_OUTPUT_TOKENS", "1e3"],
    ["CHAT_MAX_OUTPUT_TOKENS", "9007199254740992"], ["CHAT_TIMEOUT_MS", "-1"], ["CHAT_TIMEOUT_MS", "2147483648"],
  ])("%s=%s 在发送请求前报配置错误", (name, value) => {
    expect(() => createModelClient({ ...chat, [name!]: value! })).toThrow(name);
  });

  it("配置 effort 时要求显式开启思考，避免请求中出现相互冲突的参数", () => {
    expect(() => createModelClient({ ...chat, CHAT_PRESET: "deepseek", CHAT_REASONING_EFFORT: "high" })).toThrow("CHAT_THINKING");
  });

  it("配置错误不回显可能误填的密钥", () => {
    expect(() => createModelClient({ ...chat, CHAT_JSON_MODE: "sensitive-test-value" })).toThrowError(/^((?!sensitive-test-value).)*$/u);
  });
});
