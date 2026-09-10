import { describe, expect, it } from "vitest";
import { ChatClient } from "../src/client/chat.js";
import { ClaudeClient } from "../src/client/claude.js";
import { createModelClient } from "../src/client/create.js";

const chat = { NOVEL_MODEL_PROVIDER: "chat", CHAT_BASE_URL: "http://127.0.0.1:1/v1", CHAT_API_KEY: "local-test-key", CHAT_MODEL: "gemini-test" };

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
});
