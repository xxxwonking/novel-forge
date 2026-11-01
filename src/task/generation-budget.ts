import { creditsFor, loadPricing } from "../credits/pricing.js";
import type { CallResult } from "../client/claude.js";
import type { SceneWritingOptions, TaskUsage } from "./types.js";

export function parseSceneWriting(raw: unknown): SceneWritingOptions {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new Error("分场配置需要调用次数和积分停止线");
  const { maxCalls, maxCredits, ...extra } = raw as Record<string, unknown>;
  if (Object.keys(extra).length || !Number.isSafeInteger(maxCalls) || (maxCalls as number) < 1 || (maxCalls as number) > 100 ||
    typeof maxCredits !== "number" || !Number.isFinite(maxCredits) || maxCredits <= 0 || maxCredits > 100_000) throw new Error("分场额度无效：调用次数须为1–100整数，积分停止线须大于0且不超过100000");
  return { maxCalls: maxCalls as number, maxCredits };
}

export function assertGenerationBudget(limit: SceneWritingOptions, usage: TaskUsage): void {
  parseSceneWriting(limit);
  const unknown = usage.unmeasuredCalls + (usage.unpricedCalls ?? 0);
  if (![usage.calls, usage.unmeasuredCalls, usage.pendingCalls ?? 0, usage.unpricedCalls ?? 0, usage.acknowledgedUnknownCalls ?? 0].every(n => Number.isSafeInteger(n) && n >= 0) ||
    typeof (usage.credits ?? 0) !== "number" || !Number.isFinite(usage.credits ?? 0) || (usage.credits ?? 0) < 0 || (usage.acknowledgedUnknownCalls ?? 0) > unknown) throw new Error("已保存的用量记录无效，请保留现稿并核对任务记录");
  if (usage.unmeasuredCalls + (usage.unpricedCalls ?? 0) > (usage.acknowledgedUnknownCalls ?? 0)) throw new Error("本任务存在未报告用量或未计价调用，请先核对费用；不能把未知消耗当作零继续使用额度");
  if (usage.calls >= limit.maxCalls) throw new Error(`已达到本章 ${limit.maxCalls} 次模型调用额度，已完成内容保留；恢复不会重置额度`);
  if ((usage.credits ?? 0) >= limit.maxCredits) throw new Error(`已达到本章 ${limit.maxCredits} 积分停止线，已完成内容保留；当前请求完成后生效`);
}

export function callCredits(result: Exclude<CallResult, { kind: "error" }>): number | null {
  const usage = result.message.usage;
  if (![usage.input_tokens, usage.output_tokens, usage.cache_creation_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0].every(n => typeof n === "number" && Number.isFinite(n) && n >= 0)) return null;
  const pricing = loadPricing();
  const credits = creditsFor(pricing.models[result.message.model], { input: usage.input_tokens, output: usage.output_tokens,
    cacheWrite: usage.cache_creation_input_tokens ?? null, cacheRead: usage.cache_read_input_tokens ?? null }, pricing);
  return credits !== null && Number.isFinite(credits) ? credits : null;
}
