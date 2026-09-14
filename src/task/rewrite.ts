/** 只让模型返回已授权范围的替换内容，完整正文由代码合成。 */
import { assemble } from "../context/assemble.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import { textOf } from "../chapter/pipeline.js";
import { outputShapeIssue, type OutputShape } from "../chapter/c5-validation.js";
import type { ModelClient } from "../client/model.js";
import { runToolLoop, type ToolContext } from "./tool-exec.js";
import { C4_MAX_TOKENS, type WriteResult } from "./steps.js";
import type { DraftGeneration } from "./types.js";

const REWRITE_SCHEMA = {
  type: "object", additionalProperties: false, required: ["decision", "replacement", "summary", "scopeAdvice"],
  properties: {
    decision: { type: "string", enum: ["apply", "expand_scope"] },
    replacement: { type: "string", description: "仅返回授权范围的完整替换正文，不重复范围外文字" },
    summary: { type: "string", description: "本次实际改动的简短说明" },
    scopeAdvice: { type: "string", description: "需要扩大范围时说明原因和建议范围；正常替换为空字符串" },
  },
};

export async function rewriteChapterBody(client: ModelClient, input: ChapterRunInput, ctx: ToolContext, maxToolRounds: number, generation: DraftGeneration): Promise<WriteResult> {
  const { originalBody, range, mode, instruction } = generation;
  if (range !== null && (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end) || range.start < 0 || range.end <= range.start || originalBody.slice(range.start, range.end) !== range.quote)) {
    return { kind: "failed", detail: "保存的修改范围与原文不一致，请重新选择源稿和范围" };
  }
  const task = mode === "continue"
    ? `继续完成本章，严格保留已经写出的片段。只输出新增正文，从片段最后一个字之后衔接，不重述前文、不输出标题、分析或 JSON。遵循本章原有目标和字数预算。\n作者要求：${instruction}\n\n已保留的正文片段：\n${originalBody}`
    : `按作者要求修订本章。仅允许修改指定范围；正文外的事实、段落、结尾由程序原样保留。不得通过建议工具偷偷修改设定或计划。范围不足以满足要求时返回 decision=expand_scope，说明原因和建议范围，replacement 留空；不会直接扩大范围。可以完成则 decision=apply，replacement 只包含该范围的完整替换文字，删除段落时可为空。输出符合 schema 的 JSON。\n作者要求：${instruction}\n\n源版本全文：\n${originalBody}\n\n授权范围：${range === null ? "作者明确允许修改本章全文" : `第 ${range.occurrence + 1} 次出现的以下原文（精确替换）：\n${range.quote}`}`;
  const req = assemble({ ...input.assembleInput, volatile: { ...input.assembleInput.volatile, task } });
  const loop = await runToolLoop(client, {
    role: "creative", effort: "xhigh", thinking: true, maxTokens: input.maxOutputTokens ?? C4_MAX_TOKENS,
    tools: req.tools, system: req.system, messages: req.messages,
    ...(mode === "rewrite" ? { outputSchema: REWRITE_SCHEMA } : {}),
  }, ctx, maxToolRounds);
  const result = loop.result;
  if (result.kind === "error") return { kind: "failed", detail: result.error.message };
  if (result.kind === "refusal") return { kind: "refused", userMessage: result.userMessage };
  const text = textOf(result.message);
  if (mode === "rewrite" && result.kind === "max_tokens") return { kind: "failed", detail: "改写输出达到上限，未应用不完整替换；原文已保留，可以重试这次修改" };
  if (result.kind !== "max_tokens" && result.message.stop_reason !== "end_turn" && result.message.stop_reason !== "stop_sequence") return { kind: "failed", detail: "正文修订响应未完整结束，原文已保留" };

  let body: string;
  let summary: string;
  if (mode === "continue") {
    if (!text.trim()) return { kind: "failed", detail: "模型未返回新增正文，已有片段保持不变" };
    if (text.startsWith(originalBody)) return { kind: "failed", detail: "模型重复返回了已有全文，未重复追加；请重试续写任务" };
    body = originalBody + text;
    summary = "保留已有片段，接着完成本章";
    if (result.kind === "max_tokens") return { kind: "incomplete", body, detail: "续写再次达到输出上限，已有及新增片段均已保存；可继续完成" };
  } else {
    let raw: unknown;
    try { raw = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gu, "")); }
    catch { return { kind: "failed", detail: "修订响应不是合法 JSON，原文保持不变" }; }
    const issue = outputShapeIssue(raw, REWRITE_SCHEMA as OutputShape, "修订结果");
    if (issue !== null) return { kind: "failed", detail: issue };
    const changed = raw as { decision: "apply" | "expand_scope"; replacement: string; summary: string; scopeAdvice: string };
    if (changed.decision === "expand_scope") return { kind: "scope_change", summary: changed.summary, advice: changed.scopeAdvice.trim() || "需要扩大修改范围，请先明确允许修改的其他段落。" };
    body = range === null ? changed.replacement : originalBody.slice(0, range.start) + changed.replacement + originalBody.slice(range.end);
    if (!body.trim()) return { kind: "failed", detail: "修订会清空整章正文，未应用；请调整修改范围或要求" };
    summary = changed.summary;
  }
  return { kind: "ok", body, req, c4Response: result.message, sessionMessages: loop.messages, hitToolCap: loop.hitCap, declarationBody: true, summary };
}
