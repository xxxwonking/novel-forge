import { createHash } from "node:crypto";
import type { CallOptions, CallResult, ClientError } from "./claude.js";
import type { ModelClient } from "./model.js";
import { chatRequest, chatResult, isRecord, parseChatCompletion, type JsonRecord } from "./chat-wire.js";
import { ChatStreamError, readChatStream } from "./chat-stream.js";
import { resolveChatCapabilities, type ChatCapabilities, type ChatConnectionOptions } from "./chat-config.js";

export interface ChatClientOptions extends ChatConnectionOptions {
  readonly onUsage?: (record: { readonly model: string; readonly stream: boolean; readonly usage: JsonRecord | null }) => void;
}

const STREAMING_THRESHOLD = 8192;

export class ChatClient implements ModelClient {
  readonly official = false;
  readonly conversationKey: string;
  private readonly endpoint: string;
  private readonly capabilities: ChatCapabilities;

  constructor(private readonly options: ChatClientOptions) {
    if (options.apiKey.trim() === "" || options.model.trim() === "") throw new Error("缺少 chat API key 或模型名");
    this.capabilities = resolveChatCapabilities(options);
    let url: URL;
    try { url = new URL(options.baseURL); } catch { throw new Error("CHAT_BASE_URL 必须是有效的 HTTP(S) 地址"); }
    if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new Error("CHAT_BASE_URL 必须是无凭证、查询或片段的 HTTP(S) 地址");
    const basePath = url.pathname.replace(/\/+$/u, "");
    url.pathname = basePath.endsWith("/chat/completions") ? basePath : `${basePath || "/v1"}/chat/completions`;
    this.endpoint = url.toString();
    const { thinking, reasoningEffort } = this.capabilities;
    // 默认摘要兼容已保存 Gemini 草稿；只在思考配置变化时隔离原始会话。
    const mode = thinking === "default" && reasoningEffort === "default" ? "" : `\n${JSON.stringify({ thinking, reasoningEffort })}`;
    this.conversationKey = createHash("sha256").update(`${this.endpoint}\n${options.model}${mode}`).digest("hex");
  }

  async call(options: CallOptions): Promise<CallResult> {
    try {
      if (!Number.isSafeInteger(options.maxTokens) || options.maxTokens < 1) throw new Error("chat maxTokens 必须是正整数");
      const maxTokens = Math.min(options.maxTokens, this.capabilities.maxOutputTokens ?? options.maxTokens);
      const stream = this.capabilities.stream === "always" || (this.capabilities.stream === "auto" && maxTokens > STREAMING_THRESHOLD);
      const body = chatRequest({ ...options, maxTokens }, this.options.model, this.conversationKey, stream, this.capabilities);
      const response = await fetch(this.endpoint, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(this.capabilities.timeoutMs),
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", accept: stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const detail = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : `chat HTTP ${response.status}`;
        const type: ClientError["type"] = response.status === 404 ? "not_found" : response.status === 429 ? "rate_limit" : "status";
        return { kind: "error", error: { type, status: response.status, message: this.safeError(detail), retryable: response.status === 429 || response.status >= 500 } };
      }
      const result = response.headers.get("content-type")?.includes("text/event-stream") ? await readChatStream(response) : parseChatCompletion(await response.json());
      this.options.onUsage?.({ model: result.model ?? this.options.model, stream, usage: result.usage ?? null });
      return chatResult(result, this.options.model, this.conversationKey);
    } catch (error) {
      const cause = error instanceof ChatStreamError ? error.cause : error;
      const connection = cause instanceof Error && ["TypeError", "AbortError", "TimeoutError"].includes(cause.name);
      return { kind: "error", error: { type: connection ? "connection" : "unknown", status: null, retryable: connection, message: this.safeError(error instanceof Error ? error.message : "chat 请求失败") },
        ...(error instanceof ChatStreamError && error.partialText.trim() !== "" ? { partialText: error.partialText } : {}) };
    }
  }

  private safeError(message: string): string {
    return message.split(this.options.apiKey).join("[REDACTED]").replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]").slice(0, 1000);
  }
}
