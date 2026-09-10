import { isRecord, parseChatCompletion, type ChatCompletion, type JsonRecord } from "./chat-wire.js";

/** 合并代理的附加元数据；文本和工具 arguments 在调用处按增量拼接。 */
function mergeMetadata(base: JsonRecord, delta: JsonRecord): JsonRecord {
  const result = { ...base };
  for (const [key, value] of Object.entries(delta)) {
    if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
    result[key] = isRecord(value) && isRecord(result[key]) ? mergeMetadata(result[key], value) : structuredClone(value);
  }
  return result;
}

export async function readChatStream(response: Response): Promise<ChatCompletion> {
  if (response.body === null) throw new Error("chat 流式响应没有正文");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let data: string[] = [];
  let id: string | undefined;
  let model: string | undefined;
  let usage: JsonRecord | undefined;
  let message: JsonRecord = { role: "assistant", content: null };
  let finishReason: string | null = null;
  let completed = false;
  const tools = new Map<number, JsonRecord>();

  const event = () => {
    if (data.length === 0) return;
    const text = data.join("\n");
    data = [];
    if (text === "[DONE]") { completed = true; return; }
    const chunk: unknown = JSON.parse(text);
    if (!isRecord(chunk)) throw new Error("chat SSE 数据格式无效");
    if (chunk.error !== undefined) throw new Error("chat SSE 返回模型错误");
    if (typeof chunk.id === "string") id = chunk.id;
    if (typeof chunk.model === "string") model = chunk.model;
    if (isRecord(chunk.usage)) usage = chunk.usage;
    if (!Array.isArray(chunk.choices) || chunk.choices.length === 0) return;
    const choice = chunk.choices[0];
    if (!isRecord(choice)) throw new Error("chat SSE choice 格式无效");
    if (typeof choice.finish_reason === "string") finishReason = choice.finish_reason;
    if (!isRecord(choice.delta)) return;
    const delta = choice.delta;
    for (const [key, value] of Object.entries(delta)) {
      if (["content", "reasoning_content", "refusal"].includes(key) && typeof value === "string") {
        message[key] = (typeof message[key] === "string" ? message[key] : "") + value;
      } else if (key === "tool_calls" && Array.isArray(value)) {
        for (const item of value) {
          if (!isRecord(item) || !Number.isSafeInteger(item.index) || (item.index as number) < 0) throw new Error("chat SSE 工具缺少有效 index");
          const index = item.index as number;
          const { index: _index, function: fn, ...extra } = item;
          let tool = mergeMetadata(tools.get(index) ?? {}, extra);
          if (isRecord(fn)) {
            const previous = isRecord(tool.function) ? tool.function : {};
            const merged = mergeMetadata(previous, fn);
            for (const field of ["name", "arguments"]) {
              if (typeof fn[field] === "string") merged[field] = (typeof previous[field] === "string" ? previous[field] : "") + fn[field];
            }
            tool = { ...tool, function: merged };
          }
          tools.set(index, tool);
        }
      } else if (value !== null && value !== undefined) message = mergeMetadata(message, { [key]: value });
    }
  };

  const line = (value: string) => {
    const clean = value.endsWith("\r") ? value.slice(0, -1) : value;
    if (clean === "") event();
    else if (clean.startsWith("data:")) data.push(clean.slice(5).replace(/^ /u, ""));
  };
  try {
    for (;;) {
      const next = await reader.read();
      buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
      let boundary: number;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        line(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 1);
        if (completed) break;
      }
      if (next.done || completed) break;
    }
    if (!completed) {
      if (buffer !== "") line(buffer);
      event();
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  if (finishReason === null) throw new Error("chat 流在完成前中断，缺少 finish_reason");
  if (tools.size > 0) message.tool_calls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, tool]) => tool);
  return parseChatCompletion({ id, model, choices: [{ message, finish_reason: finishReason }], usage });
}
