import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions, CallResult } from "./claude.js";
import type { ChatCapabilities } from "./chat-config.js";

export type JsonRecord = Record<string, unknown>;
export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ChatToolCall extends JsonRecord {
  id: string;
  type: "function";
  function: { name: string; arguments: string } & JsonRecord;
}

export interface ChatAssistant extends JsonRecord {
  role: "assistant";
  content: string | null;
  tool_calls?: ChatToolCall[] | null;
}

export interface ChatCompletion {
  id?: string;
  model?: string;
  choices: { message: ChatAssistant; finish_reason: string | null }[];
  usage?: JsonRecord;
}

/** 原始 chat assistant 随内容块落盘，appendTurn 与 C5 恢复不会丢失签名。 */
const SNAPSHOT = "chat_response";

function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) throw new Error("chat 消息缺少文本内容");
  return content.map((block: unknown) => {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") {
      throw new Error("当前 chat 写作接口仅支持文本及工具消息");
    }
    return block.text;
  }).join("\n\n");
}

function assistantMessage(content: string | readonly Anthropic.ContentBlockParam[], target: string): ChatAssistant {
  if (typeof content === "string") return { role: "assistant", content };
  for (const block of content) {
    const saved = (block as unknown as JsonRecord)[SNAPSHOT];
    if (isRecord(saved)) {
      if (saved.target !== target) throw new Error("草稿会话的模型、接口或思考配置已变化，请恢复原配置后重试，或另写一版");
      if (!isRecord(saved.message) || saved.message.role !== "assistant") throw new Error("chat 会话快照损坏");
      return structuredClone(saved.message) as ChatAssistant;
    }
  }
  const texts: string[] = [];
  const tools: ChatToolCall[] = [];
  for (const block of content) {
    if (block.type === "text") texts.push(block.text);
    else if (block.type === "tool_use") tools.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input) } });
    else throw new Error("此草稿包含其他模型的内部消息，请使用原模型恢复或另写一版");
  }
  return { role: "assistant", content: texts.length === 0 ? null : texts.join("\n\n"), ...(tools.length === 0 ? {} : { tool_calls: tools }) };
}

export function chatRequest(options: CallOptions, model: string, target: string, stream: boolean, capabilities: ChatCapabilities): JsonRecord {
  const messages: JsonRecord[] = [];
  let system = options.system === undefined ? "" : textContent(options.system);
  if (options.outputSchema !== undefined && capabilities.jsonMode !== "json_schema") {
    system += `${system === "" ? "" : "\n\n"}最终回复必须是一个合法 JSON 对象，不要 Markdown 围栏或额外解释。可以先调用工具获取资料；完成后严格按以下 JSON Schema 输出 JSON：\n${JSON.stringify(options.outputSchema)}`;
  }
  if (system !== "") messages.push({ role: "system", content: system });
  for (const message of options.messages) {
    if (message.role === "assistant") {
      const assistant = assistantMessage(message.content, target);
      if (capabilities.thinking === "enabled" && (options.tools?.length ?? 0) > 0 && typeof assistant.reasoning_content !== "string") {
        throw new Error("思考模式的工具会话缺少原始 reasoning_content，请使用完整会话或设置 CHAT_THINKING=disabled");
      }
      messages.push(assistant);
      continue;
    }
    if (typeof message.content === "string") {
      messages.push({ role: "user", content: message.content });
      continue;
    }
    let texts: string[] = [];
    const flush = () => { if (texts.length > 0) messages.push({ role: "user", content: texts.join("\n\n") }); texts = []; };
    for (const block of message.content) {
      if (block.type === "text") texts.push(block.text);
      else if (block.type === "tool_result") {
        flush();
        messages.push({ role: "tool", tool_call_id: block.tool_use_id, content: (block.is_error ? "工具执行失败：\n" : "") + textContent(block.content ?? "") });
      } else throw new Error("当前 chat 写作接口不支持此用户消息类型");
    }
    flush();
  }
  return {
    model, messages, max_tokens: options.maxTokens, stream,
    ...(stream && capabilities.includeUsage ? { stream_options: { include_usage: true } } : {}),
    ...(capabilities.thinking === "default" ? {} : { thinking: { type: capabilities.thinking } }),
    ...(capabilities.reasoningEffort === "default" ? {} : { reasoning_effort: capabilities.reasoningEffort }),
    ...(options.tools === undefined || options.tools.length === 0 ? {} : { tools: options.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description ?? "", parameters: tool.input_schema } })) }),
    ...(options.outputSchema === undefined || capabilities.jsonMode === "prompt" ? {} : { response_format: capabilities.jsonMode === "json_object" ? { type: "json_object" } : { type: "json_schema", json_schema: { name: "chapter_declaration", strict: true, schema: options.outputSchema } } }),
  };
}

export function parseChatCompletion(value: unknown): ChatCompletion {
  if (!isRecord(value) || !Array.isArray(value.choices) || !isRecord(value.choices[0])) throw new Error("chat 响应缺少有效 choices");
  const choice = value.choices[0];
  if (!isRecord(choice.message) || !["stop", "tool_calls", "length", "content_filter", "insufficient_system_resource", "aborted"].includes(String(choice.finish_reason))) throw new Error("chat 响应缺少有效消息或结束原因");
  const message = choice.message;
  if (message.content !== null && message.content !== undefined && typeof message.content !== "string") throw new Error("chat 返回了非文本内容");
  if (message.tool_calls !== undefined && message.tool_calls !== null && !Array.isArray(message.tool_calls)) throw new Error("chat 工具调用格式无效");
  return {
    ...(typeof value.id === "string" ? { id: value.id } : {}),
    ...(typeof value.model === "string" ? { model: value.model } : {}),
    choices: [{ message: { ...message, role: "assistant", content: message.content ?? null } as ChatAssistant, finish_reason: String(choice.finish_reason) }],
    ...(isRecord(value.usage) ? { usage: value.usage } : {}),
  };
}

function tokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

export function chatResult(response: ChatCompletion, model: string, target: string): CallResult {
  const choice = response.choices[0];
  if (choice === undefined) throw new Error("chat 响应为空");
  if (choice.finish_reason === "insufficient_system_resource" || choice.finish_reason === "aborted") {
    return { kind: "error", error: { type: "status", status: null, retryable: true, message: `模型未完成生成（${choice.finish_reason}），请稍后重试。` } };
  }
  const raw = choice.message;
  const refusal = typeof raw.refusal === "string" && raw.refusal !== "" ? raw.refusal : null;
  const stopReason = refusal !== null || choice.finish_reason === "content_filter" ? "refusal" : choice.finish_reason === "length" ? "max_tokens" : (raw.tool_calls?.length ?? 0) > 0 ? "tool_use" : "end_turn";
  const content: Anthropic.ContentBlock[] = [];
  if (raw.content) content.push({ type: "text", text: raw.content, citations: [] });
  // 截断/拒绝时 arguments 可能尚未闭合；先保留停止状态，不解析为可执行工具。
  for (const tool of stopReason === "tool_use" ? raw.tool_calls ?? [] : []) {
    if (!isRecord(tool) || typeof tool.id !== "string" || tool.id === "" || tool.type !== "function" || !isRecord(tool.function) || typeof tool.function.name !== "string" || typeof tool.function.arguments !== "string") throw new Error("chat 工具调用缺少 id、名称或参数");
    let input: unknown;
    try { input = JSON.parse(tool.function.arguments); } catch { throw new Error("chat 工具 arguments 不是合法 JSON"); }
    if (!isRecord(input)) throw new Error("chat 工具 arguments 必须是对象");
    content.push({ type: "tool_use", id: tool.id, name: tool.function.name, input, caller: { type: "direct" } });
  }
  if (content.length === 0) content.push({ type: "text", text: "", citations: [] });
  content[0] = { ...content[0], [SNAPSHOT]: { target, message: structuredClone(raw) } } as unknown as Anthropic.ContentBlock;
  const message = {
    id: response.id ?? "chat-response", type: "message", role: "assistant", model: response.model ?? model,
    content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: tokenCount(response.usage?.prompt_tokens), output_tokens: tokenCount(response.usage?.completion_tokens), cache_creation_input_tokens: null, cache_read_input_tokens: null },
  } as unknown as Anthropic.Message;
  if (stopReason === "refusal") return { kind: "refusal", message, category: null, explanation: refusal, userMessage: refusal ?? "模型未生成本次内容，请调整章节要求后重试。" };
  if (stopReason === "max_tokens") return { kind: "max_tokens", message };
  return { kind: "ok", message };
}
