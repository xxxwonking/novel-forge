import type { DraftGeneration, ChapterDraft } from "../task/types.js";
import type { DraftReference } from "./draft-revisions.js";
import { ChapterWriteError } from "./chapter-input.js";

export interface DraftRewriteOptions extends DraftReference {
  readonly mode: "rewrite" | "continue";
  readonly instruction: string;
  /** null 明确允许整章修改；续写仍只追加。省略时不能推断整章授权。 */
  readonly scope: { readonly quote: string; readonly occurrence?: number } | null;
  readonly requestId: string;
}

export function validateRewriteOptions(options: DraftRewriteOptions): void {
  if (options.mode !== "rewrite" && options.mode !== "continue") throw new ChapterWriteError(400, "mode 必须是 rewrite 或 continue");
  if (typeof options.instruction !== "string" || !options.instruction.trim()) throw new ChapterWriteError(400, "请提供具体的改写或续写要求");
  if (typeof options.requestId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/u.test(options.requestId)) throw new ChapterWriteError(400, "请提供有效的 requestId，以便重试时连接同一任务");
  if (options.scope === undefined) throw new ChapterWriteError(400, "必须指定原文范围；明确整章修改时 scope 为 null");
  if (options.scope !== null && (typeof options.scope !== "object" || Array.isArray(options.scope) ||
    typeof options.scope.quote !== "string" || !options.scope.quote.trim() ||
    (options.scope.occurrence !== undefined && (!Number.isSafeInteger(options.scope.occurrence) || options.scope.occurrence < 0)))) {
    throw new ChapterWriteError(400, "原文范围或出现序号无效");
  }
  if (options.mode === "continue" && options.scope !== null) throw new ChapterWriteError(400, "片段续写只从已有正文末尾追加，请将 scope 设为 null");
}

export function prepareGeneration(options: DraftRewriteOptions, source: ChapterDraft): DraftGeneration {
  if (!source.body.trim()) throw new ChapterWriteError(409, "尚无正文可供修改，请先生成正文");
  if (options.mode === "continue" && !canContinueBody(source)) {
    throw new ChapterWriteError(409, "此稿没有可续写的未完成片段；请修改正文或恢复尚未完成的检查");
  }
  let range: DraftGeneration["range"] = null;
  if (options.scope !== null) {
    const { quote } = options.scope;
    const positions: number[] = [];
    for (let offset = source.body.indexOf(quote); offset >= 0; offset = source.body.indexOf(quote, offset + 1)) positions.push(offset);
    if (positions.length > 1 && options.scope.occurrence === undefined) throw new ChapterWriteError(400, "所选原文出现多次，请明确出现序号或重新选择更完整的段落");
    const occurrence = options.scope.occurrence ?? 0;
    const start = positions[occurrence];
    if (start === undefined) throw new ChapterWriteError(400, "所选范围不在当前源正文中，请重新选择");
    range = { quote, occurrence, start, end: start + quote.length };
  }
  return { mode: options.mode, instruction: options.instruction.trim(), originalBody: source.body, range };
}

export function canContinueBody(draft: ChapterDraft): boolean {
  return !!draft.body.trim() && (draft.error?.step === "C4" || draft.status === "writing") && draft.generation?.mode !== "rewrite" && !["adopted", "discarded"].includes(draft.status);
}
