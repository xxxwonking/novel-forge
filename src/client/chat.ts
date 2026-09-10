import { createHash } from "node:crypto";
import type { CallOptions, CallResult, ClientError } from "./claude.js";
import type { ModelClient } from "./model.js";
import { chatRequest, chatResult, isRecord, parseChatCompletion, type JsonRecord } from "./chat-wire.js";
import { readChatStream } from "./chat-stream.js";

export interface ChatClientOptions {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly timeoutMs?: number;
  readonly onUsage?: (record: { readonly model: string; readonly stream: boolean; readonly usage: JsonRecord | null }) => void;
}

const STREAMING_THRESHOLD = 8192;
const DEFAULT_TIMEOUT_MS = 300_000;

export class ChatClient implements ModelClient {
  readonly official = false;
  private readonly endpoint: string;
  private readonly target: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: ChatClientOptions) {
    if (options.apiKey.trim() === "" || options.model.trim() === "") throw new Error("缺少 chat API key 或模型名");
    const url = new URL(options.baseURL);
    if (!["http:", "https:"].includes(url.protocol) || url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") throw new Error("CHAT_BASE_URL 必须是无凭证、查询或片段的 HTTP(S) 地址");
    const basePath = url.pathname.replace(/\/+$/u, "");
    url.pathname = basePath.endsWith("/chat/completions") ? basePath : (basePath.endsWith("/v1") ? basePath : `${basePath}/v1`) + "/chat/completions";
    this.endpoint = url.toString();
    this.target = createHash("sha256").update(`${this.endpoint}\n${options.model}`).digest("hex");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1) throw new Error("chat timeoutMs 必须是正整数");
  }

  async call(options: CallOptions): Promise<CallResult> {
    try {
      const stream = options.maxTokens > STREAMING_THRESHOLD;
      const response = await fetch(this.endpoint, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(this.timeoutMs),
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json", accept: stream ? "text/event-stream" : "application/json" },
        body: JSON.stringify(chatRequest(options, this.options.model, this.target, stream)),
      });
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null);
        const detail = isRecord(payload) && isRecord(payload.error) && typeof payload.error.message === "string" ? payload.error.message : `chat HTTP ${response.status}`;
        const type: ClientError["type"] = response.status === 404 ? "not_found" : response.status === 429 ? "rate_limit" : "status";
        return { kind: "error", error: { type, status: response.status, message: this.safeError(detail), retryable: response.status === 429 || response.status >= 500 } };
      }
      const result = response.headers.get("content-type")?.includes("text/event-stream") ? await readChatStream(response) : parseChatCompletion(await response.json());
      this.options.onUsage?.({ model: result.model ?? this.options.model, stream, usage: result.usage ?? null });
      return chatResult(result, this.options.model, this.target);
    } catch (error) {
      const connection = error instanceof Error && ["TypeError", "AbortError", "TimeoutError"].includes(error.name);
      return { kind: "error", error: { type: connection ? "connection" : "unknown", status: null, retryable: connection, message: this.safeError(error instanceof Error ? error.message : "chat 请求失败") } };
    }
  }

  private safeError(message: string): string {
    return message.split(this.options.apiKey).join("[REDACTED]").replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]").slice(0, 1000);
  }
}
