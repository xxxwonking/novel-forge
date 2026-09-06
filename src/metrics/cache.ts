/**
 * 缓存度量（§13.8）。**这一步不做等于没做** —— 装配正确性无法靠 review
 * 保证，只能靠 usage.cache_read_input_tokens 实测。
 *
 * ⚠ 前提警告：若 API 走第三方中转，`cache_read_input_tokens` 可能被吞或
 * 被伪造（§8.2）。`trustworthy` 字段记录该次度量是否来自官方直连，
 * 否则统计出的命中率不能作为 M1 验收依据。
 */

import type { CacheMetrics, ContextSegment } from "../types/l2.js";
import type { ChapterNo } from "../types/primitives.js";
import { M1_CACHE_TARGETS } from "../types/l2.js";

/** SDK usage 里我们关心的四个字段。 */
export interface UsageLike {
  readonly input_tokens: number;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

export interface RecordInput {
  readonly chapter: ChapterNo;
  readonly step: string;
  readonly usage: UsageLike;
  /** assemble() 返回的各段估算 token，用于推断 invalidatedAt。 */
  readonly segmentTokens: readonly [number, number, number, number, number];
}

/** 落库记录 = CacheMetrics + 可信度标记。 */
export interface CacheRecord extends CacheMetrics {
  /** false 表示该次度量来自非官方端点，命中率不可作为验收依据。 */
  readonly trustworthy: boolean;
}

/**
 * 从 usage 推断哪一段失效了。
 *
 * 原理：缓存命中是前缀式的 —— 命中量必然等于前 k 段的 token 之和。
 * 所以拿 cache_read 去和各段的累计和比对，找到最接近的那个 k，
 * 第 k 段就是第一个冷掉的段。比逐个排查快得多。
 */
export function inferInvalidatedAt(
  cacheRead: number,
  segmentTokens: readonly [number, number, number, number, number],
): Exclude<ContextSegment, 4> | null {
  if (cacheRead === 0) return 0;

  // 段 0-3 是可缓存段，段 4 永不缓存。
  const cumulative: number[] = [];
  let sum = 0;
  for (let i = 0; i <= 3; i += 1) {
    sum += segmentTokens[i] ?? 0;
    cumulative.push(sum);
  }

  // 全部可缓存段都命中
  const total = cumulative[3] ?? 0;
  if (cacheRead >= total * 0.9) return null;

  // 找 cacheRead 落在哪两个累计点之间 → 下一段就是失效起点
  for (let k = 0; k <= 3; k += 1) {
    const upTo = cumulative[k] ?? 0;
    if (cacheRead < upTo * 0.9) {
      return k as Exclude<ContextSegment, 4>;
    }
  }
  return 3;
}

export function recordCacheMetrics(input: RecordInput, trustworthy: boolean): CacheRecord {
  const read = input.usage.cache_read_input_tokens ?? 0;
  const created = input.usage.cache_creation_input_tokens ?? 0;
  const uncached = input.usage.input_tokens;
  const denominator = read + uncached;

  return {
    chapter: input.chapter,
    step: input.step,
    cacheCreationInputTokens: created,
    cacheReadInputTokens: read,
    inputTokens: uncached,
    hitRatio: denominator === 0 ? 0 : read / denominator,
    invalidatedAt: inferInvalidatedAt(read, input.segmentTokens),
    trustworthy,
  };
}

// ── M1 验收 ─────────────────────────────────────────────────────────────

export interface AcceptanceReport {
  readonly chapters: number;
  readonly averageHitRatio: number;
  readonly steadyStateHitRatio: number;
  readonly rebuildChapterHitRatio: number;
  readonly coldSegment01Count: number;
  readonly passed: boolean;
  /** 全部记录都可信才算真实验收。false 时 passed 无意义。 */
  readonly verifiable: boolean;
  readonly failures: readonly string[];
}

/**
 * §13.8 M1 验收：连续 10 章，平均 ≥70%、稳态 ≥85%、重建章 ≥45%、
 * 段 0/1 冷次数 = 0。
 *
 * 第四条是硬指标 —— 段 0/1 意外冷掉说明有动态内容混进去了，必须查到根因。
 */
export function evaluateAcceptance(
  records: readonly CacheRecord[],
  rebuildChapters: ReadonlySet<ChapterNo>,
): AcceptanceReport {
  const chapters = new Set(records.map((r) => r.chapter)).size;
  const steady = records.filter((r) => !rebuildChapters.has(r.chapter));
  const rebuild = records.filter((r) => rebuildChapters.has(r.chapter));

  const average = mean(records.map((r) => r.hitRatio));
  const steadyRatio = mean(steady.map((r) => r.hitRatio));
  const rebuildRatio = mean(rebuild.map((r) => r.hitRatio));
  const cold01 = records.filter((r) => r.invalidatedAt === 0 || r.invalidatedAt === 1).length;

  const failures: string[] = [];
  if (average < M1_CACHE_TARGETS.averageHitRatio) {
    failures.push(`平均命中率 ${pct(average)} < ${pct(M1_CACHE_TARGETS.averageHitRatio)}`);
  }
  if (steady.length > 0 && steadyRatio < M1_CACHE_TARGETS.steadyStateHitRatio) {
    failures.push(`稳态命中率 ${pct(steadyRatio)} < ${pct(M1_CACHE_TARGETS.steadyStateHitRatio)}`);
  }
  if (rebuild.length > 0 && rebuildRatio < M1_CACHE_TARGETS.rebuildChapterHitRatio) {
    failures.push(`L2 重建章命中率 ${pct(rebuildRatio)} < ${pct(M1_CACHE_TARGETS.rebuildChapterHitRatio)}`);
  }
  if (cold01 > M1_CACHE_TARGETS.coldSegment01Count) {
    failures.push(`段 0/1 冷掉 ${cold01} 次，应为 0 —— 查是否有动态内容混入 tools 或 L1`);
  }

  return {
    chapters,
    averageHitRatio: average,
    steadyStateHitRatio: steadyRatio,
    rebuildChapterHitRatio: rebuildRatio,
    coldSegment01Count: cold01,
    passed: failures.length === 0,
    verifiable: records.length > 0 && records.every((r) => r.trustworthy),
    failures,
  };
}

function mean(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`;
}
