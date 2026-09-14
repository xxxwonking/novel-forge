import { createHash } from "node:crypto";
import { assemble } from "../context/assemble.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import type { ChapterDraft, DraftSession } from "./types.js";

/** 精确标识作者正在编辑的源结果；正文、结构、检查或状态改变都使旧凭据失效。 */
export function draftRevisionToken(draft: ChapterDraft): string {
  // 正文和元数据分文件保存，重读后字段顺序会变；只让内容变化影响凭据。
  const serialized = JSON.stringify(draft, (_key, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map(key => [key, record[key]]));
  });
  return createHash("sha256").update(serialized).digest("hex");
}

/** 重建当前资料，不把作者编辑伪装为旧 C4 响应，也不带入旧思考签名。 */
export function authoredSession(input: ChapterRunInput): DraftSession {
  const req = assemble({
    ...input.assembleInput,
    volatile: { ...input.assembleInput.volatile, task: "本轮仅核对作者提供的正文。以随后提供的完整正文为准，不生成、续写或改写正文。" },
  });
  return { system: req.system, tools: req.tools, messages: req.messages, c4Response: null };
}
