import { ClaudeClient, MODELS, type ModelRole } from "./claude.js";
import { ChatClient } from "./chat.js";
import { chatOptionsFromEnv } from "./chat-config.js";
import type { ModelClient } from "./model.js";

/** 配置选择显式生效；chat 的配置或请求失败均不回退到 Claude。 */
export function createModelClient(env: Readonly<Record<string, string | undefined>> = process.env): ModelClient {
  const provider = env.NOVEL_MODEL_PROVIDER ?? "claude";
  if (provider === "claude") return ClaudeClient.fromEnv(env);
  if (provider !== "chat") throw new Error("未知 NOVEL_MODEL_PROVIDER；可用值为 chat 或 claude");
  return new ChatClient(chatOptionsFromEnv(env));
}

/**
 * 这个 role 实际会打到哪个模型。配置读不出来时返回空串。
 *
 * 与 `createModelClient` 放在同一个文件，是为了只有一处知道路由规则 —— 费用预估
 * 要按真实模型查价，读错了就会把 chat 接入的账按 Claude 报给作者。以本仓价格表为例，
 * opus 的输出价是 gemini-3-flash 的 30 倍：同一次反推，一个报 1000 积分、一个报 30，
 * 作者会据此放弃一条其实很便宜的路。
 *
 * **chat 接入不按 role 分派**：它只有一个 `CHAT_MODEL`，`MODELS.creative/judge`
 * 那张分工表在这条路径上根本不生效。这正是不能直接查 `MODELS` 的原因。
 */
export function resolveModelName(role: ModelRole, env: Readonly<Record<string, string | undefined>> = process.env): string {
  const provider = env.NOVEL_MODEL_PROVIDER ?? "claude";
  if (provider === "chat") return env.CHAT_MODEL?.trim() ?? "";
  return MODELS[role];
}
