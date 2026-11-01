/** Gemini原生GenerateContent。内部继续使用最小ModelClient协议，签名仅随模型历史保存。 */
import { createHash, randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import {
  startTiming,
  describeTiming,
  type CallOptions,
  type CallResult,
} from "./claude.js";
import { isRecord } from "./chat-wire.js";
import type { ModelClient } from "./model.js";
export interface GeminiOptions {
  baseURL: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxOutputTokens?: number;
}
type Part = Record<string, any>;
export class GeminiClient implements ModelClient {
  readonly official = false;
  readonly conversationKey: string;
  private readonly endpoint: string;
  constructor(private readonly options: GeminiOptions) {
    const url = new URL(options.baseURL);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("Gemini地址必须是无凭证、查询和片段的HTTP(S)地址");
    if (!options.apiKey.trim() || !/^[-\w.]+$/u.test(options.model))
      throw new Error("Gemini需要有效密钥和模型ID（不含models/前缀）");
    const prefix = url.pathname.replace(/\/+$/u, "") || "/v1beta";
    url.pathname = `${prefix}/models/${options.model}`;
    this.endpoint = url.toString();
    this.conversationKey = createHash("sha256")
      .update(`gemini\n${this.endpoint}`)
      .digest("hex");
  }
  private request(options: CallOptions) {
    const calls = new Map<string, { name: string; id?: string }>();
    const contents = options.messages
      .map((m) => {
        const blocks =
          typeof m.content === "string"
            ? [{ type: "text" as const, text: m.content }]
            : m.content;
        for (const b of blocks)
          if (b.type === "tool_use")
            calls.set(b.id, {
              name: b.name,
              ...(typeof (b as any).geminiCallId === "string"
                ? { id: (b as any).geminiCallId }
                : {}),
            });
        const snapshot = blocks
          .map((b) => (b as any).gemini_response)
          .find(
            (s) =>
              isRecord(s) &&
              s.target === this.conversationKey &&
              Array.isArray(s.parts),
          );
        if (snapshot && m.role === "assistant")
          return { role: "model", parts: snapshot.parts };
        const parts = blocks.flatMap((b): Part[] => {
          if (b.type === "text") return [{ text: b.text }];
          if (b.type === "tool_use")
            return [{ functionCall: { name: b.name, args: b.input } }];
          if (b.type === "tool_result") {
            const call = calls.get(b.tool_use_id);
            if (!call) throw new Error("Gemini工具结果缺少对应调用");
            return [
              {
                functionResponse: {
                  ...call,
                  response: b.is_error
                    ? { error: b.content }
                    : { result: b.content },
                },
              },
            ];
          }
          return [];
        });
        return { role: m.role === "assistant" ? "model" : "user", parts };
      })
      .filter((c) => c.parts.length > 0);
    return {
      contents,
      ...(options.system
        ? {
            systemInstruction: {
              parts: options.system.map((b) => ({ text: b.text })),
            },
          }
        : {}),
      ...(options.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: options.tools.map((t) => ({
                  name: t.name,
                  description: t.description ?? "",
                  parametersJsonSchema: t.input_schema,
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        maxOutputTokens: Math.min(
          options.maxTokens,
          this.options.maxOutputTokens ?? options.maxTokens,
        ),
        ...(options.outputSchema
          ? {
              responseMimeType: "application/json",
              responseJsonSchema: options.outputSchema,
            }
          : {}),
      },
    };
  }
  async call(options: CallOptions): Promise<CallResult> {
    const elapsed = startTiming();
    let visible = "";
    try {
      const stream = options.onTextDelta !== undefined;
      const response = await fetch(
        `${this.endpoint}:${stream ? "streamGenerateContent?alt=sse" : "generateContent"}`,
        {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(this.options.timeoutMs ?? 300000),
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": this.options.apiKey,
          },
          body: JSON.stringify(this.request(options)),
        },
      );
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const detail =
          isRecord(body) &&
          isRecord(body.error) &&
          typeof body.error.message === "string"
            ? body.error.message
            : `Gemini HTTP ${response.status}`;
        return {
          kind: "error",
          error: {
            type:
              response.status === 429
                ? "rate_limit"
                : response.status === 404
                  ? "not_found"
                  : "status",
            status: response.status,
            message: this.safe(detail),
            retryable: response.status === 429 || response.status >= 500,
            timing: elapsed(),
          },
        };
      }
      let parts: Part[] = [],
        finish: string | undefined,
        usage: Part | undefined,
        model = this.options.model,
        blocked = false;
      const consume = (raw: unknown) => {
        if (!isRecord(raw)) throw new Error("Gemini响应不是对象");
        if (raw.error) throw new Error("Gemini流返回错误");
        const candidate = Array.isArray(raw.candidates)
          ? raw.candidates[0]
          : undefined;
        if (isRecord(raw.promptFeedback) && raw.promptFeedback.blockReason)
          blocked = true;
        if (candidate) {
          if (candidate.finishReason) finish = candidate.finishReason;
          const next = candidate.content?.parts ?? [];
          if (!Array.isArray(next)) throw new Error("Gemini内容格式无效");
          parts.push(...next);
          for (const p of next)
            if (typeof p.text === "string" && !p.thought) {
              visible += p.text;
              options.onTextDelta?.(p.text);
            }
        }
        if (isRecord(raw.usageMetadata)) usage = raw.usageMetadata;
        if (typeof raw.modelVersion === "string") model = raw.modelVersion;
      };
      if (response.headers.get("content-type")?.includes("text/event-stream")) {
        if (!response.body) throw new Error("Gemini流没有响应体");
        const reader = response.body.getReader(),
          decoder = new TextDecoder();
        let buffer = "";
        let eventData: string[] = [];
        const flush = () => {
          if (eventData.length) {
            const data = eventData.join("\n");
            eventData = [];
            consume(JSON.parse(data));
          }
        };
        const line = (raw: string) => {
          const text = raw.replace(/\r$/u, "");
          if (text === "") flush();
          else if (text.startsWith("data:"))
            eventData.push(text.slice(5).trimStart());
        };
        const drain = () => {
          let pos;
          while ((pos = buffer.indexOf("\n")) >= 0) {
            line(buffer.slice(0, pos));
            buffer = buffer.slice(pos + 1);
          }
        };
        try {
          for (;;) {
            const { done, value } = await reader.read();
            buffer += done
              ? decoder.decode()
              : decoder.decode(value, { stream: true });
            drain();
            if (done) break;
          }
          if (buffer.trim()) line(buffer);
          flush();
        } finally {
          reader.releaseLock();
        }
      } else consume(await response.json());
      const refusal =
        blocked ||
        [
          "SAFETY",
          "RECITATION",
          "BLOCKLIST",
          "PROHIBITED_CONTENT",
          "SPII",
          "IMAGE_SAFETY",
        ].includes(finish ?? "");
      if (!refusal && finish !== "STOP" && finish !== "MAX_TOKENS")
        throw new Error(`Gemini响应未完成（${finish ?? "缺少结束原因"}）`);
      const content: Part[] = parts.flatMap((p): Part[] => {
        if (p.thought) return [];
        if (typeof p.text === "string") return [{ type: "text", text: p.text }];
        if (isRecord(p.functionCall)) {
          if (
            typeof p.functionCall.name !== "string" ||
            !isRecord(p.functionCall.args ?? {})
          )
            throw new Error("Gemini工具参数无效");
          return [
            {
              type: "tool_use",
              id:
                typeof p.functionCall.id === "string"
                  ? p.functionCall.id
                  : `gemini_${randomUUID()}`,
              name: p.functionCall.name,
              input: p.functionCall.args ?? {},
              ...(typeof p.functionCall.id === "string"
                ? { geminiCallId: p.functionCall.id }
                : {}),
            },
          ];
        }
        return [];
      });
      if (!content.length && !refusal)
        throw new Error("Gemini没有返回文本或工具调用");
      if (content[0])
        content[0].gemini_response = { target: this.conversationKey, parts };
      const count = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0;
      const message = {
        id: `gemini-${randomUUID()}`,
        type: "message",
        role: "assistant",
        model,
        content,
        stop_reason:
          finish === "MAX_TOKENS"
            ? "max_tokens"
            : refusal
              ? "refusal"
              : content.some((p) => p.type === "tool_use")
                ? "tool_use"
                : "end_turn",
        stop_sequence: null,
        usage: {
          input_tokens: Math.max(
            0,
            count(usage?.promptTokenCount) -
              count(usage?.cachedContentTokenCount),
          ),
          output_tokens:
            count(usage?.candidatesTokenCount) +
            count(usage?.thoughtsTokenCount),
          cache_read_input_tokens: usage?.cachedContentTokenCount ?? null,
          cache_creation_input_tokens: null,
        },
      } as unknown as Anthropic.Message;
      if (refusal)
        return {
          kind: "refusal",
          message,
          category: finish ?? "blocked",
          explanation: null,
          userMessage: "模型未生成这段内容，请调整表述或场景后再试。",
        };
      return { kind: finish === "MAX_TOKENS" ? "max_tokens" : "ok", message };
    } catch (error) {
      const timing = elapsed();
      const connection =
        error instanceof Error &&
        ["TypeError", "AbortError", "TimeoutError"].includes(error.name);
      return {
        kind: "error",
        error: {
          type: connection ? "connection" : "unknown",
          status: null,
          retryable: connection,
          message: this.safe(
            `${error instanceof Error ? error.message : "Gemini请求失败"}（${describeTiming(timing)}）`,
          ),
          timing,
        },
        ...(visible.trim() ? { partialText: visible } : {}),
      };
    }
  }
  private safe(text: string): string {
    return text
      .split(this.options.apiKey)
      .join("[REDACTED]")
      .replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]")
      .slice(0, 1000);
  }
}
