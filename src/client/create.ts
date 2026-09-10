import { ClaudeClient } from "./claude.js";
import { ChatClient } from "./chat.js";
import type { ModelClient } from "./model.js";

/** 配置选择显式生效；chat 的配置或请求失败均不回退到 Claude。 */
export function createModelClient(env: Readonly<Record<string, string | undefined>> = process.env): ModelClient {
  const provider = env.NOVEL_MODEL_PROVIDER ?? "claude";
  if (provider === "claude") return ClaudeClient.fromEnv(env);
  if (provider !== "chat") throw new Error("未知 NOVEL_MODEL_PROVIDER；可用值为 chat 或 claude");
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`缺少 ${name}`);
    return value;
  };
  return new ChatClient({ baseURL: required("CHAT_BASE_URL"), apiKey: required("CHAT_API_KEY"), model: required("CHAT_MODEL") });
}
