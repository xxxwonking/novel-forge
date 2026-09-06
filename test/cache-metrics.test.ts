/**
 * 缓存度量与 M1 验收判定的测试（§13.8）。
 *
 * 重点是 inferInvalidatedAt 的分段推断 —— 它是排查缓存事故的主要工具，
 * 推错段会把人带到错误的方向上。
 */

import { describe, expect, it } from "vitest";
import {
  evaluateAcceptance,
  inferInvalidatedAt,
  recordCacheMetrics,
  type CacheRecord,
} from "../src/metrics/cache.js";
import { isOfficialEndpoint } from "../src/client/claude.js";

/** 段 0-4 的典型 token 分布（§13.1）。 */
const SEGMENTS = [1200, 2500, 4000, 5000, 5500] as const;

describe("inferInvalidatedAt", () => {
  it("cache_read 为 0 时判定段 0 冷（最坏情况）", () => {
    expect(inferInvalidatedAt(0, SEGMENTS)).toBe(0);
  });

  it("全部可缓存段命中时返回 null", () => {
    expect(inferInvalidatedAt(12_700, SEGMENTS)).toBeNull();
  });

  it("只命中 tools 时判定段 1 冷（L1 被改了）", () => {
    expect(inferInvalidatedAt(1200, SEGMENTS)).toBe(1);
  });

  it("命中到 L1 但 L2 冷时判定段 2（L2 重建的正常情形）", () => {
    expect(inferInvalidatedAt(3700, SEGMENTS)).toBe(2);
  });

  it("命中到 L2 但 L3 冷时判定段 3（换了出场人物的正常情形）", () => {
    expect(inferInvalidatedAt(7700, SEGMENTS)).toBe(3);
  });
});

describe("recordCacheMetrics", () => {
  it("命中率按 read/(read+input) 计算，不把 creation 算进分母", () => {
    const r = recordCacheMetrics(
      {
        chapter: 53,
        step: "C4",
        usage: { input_tokens: 5500, cache_read_input_tokens: 12_700, cache_creation_input_tokens: 0 },
        segmentTokens: SEGMENTS,
      },
      true,
    );
    expect(r.hitRatio).toBeCloseTo(12_700 / 18_200, 4);
    expect(r.invalidatedAt).toBeNull();
  });

  it("usage 缺缓存字段时按 0 处理而非崩溃（中转常吞掉这些字段）", () => {
    const r = recordCacheMetrics(
      { chapter: 1, step: "C4", usage: { input_tokens: 18_200 }, segmentTokens: SEGMENTS },
      false,
    );
    expect(r.cacheReadInputTokens).toBe(0);
    expect(r.hitRatio).toBe(0);
    expect(r.trustworthy).toBe(false);
  });
});

function record(chapter: number, hitRatio: number, invalidatedAt: 0 | 1 | 2 | 3 | null): CacheRecord {
  const total = 18_200;
  const read = Math.round(total * hitRatio);
  return {
    chapter,
    step: "C4",
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: read,
    inputTokens: total - read,
    hitRatio,
    invalidatedAt,
    trustworthy: true,
  };
}

describe("M1 验收判定", () => {
  it("达标的 10 章通过", () => {
    const records = [
      record(1, 0.45, 2),
      ...Array.from({ length: 9 }, (_, i) => record(i + 2, 0.87, 3)),
    ];
    const report = evaluateAcceptance(records, new Set([1]));
    expect(report.chapters).toBe(10);
    expect(report.passed).toBe(true);
    expect(report.verifiable).toBe(true);
    expect(report.failures).toHaveLength(0);
  });

  it("段 0/1 冷掉即判失败，且提示查动态内容", () => {
    const records = [...Array.from({ length: 9 }, (_, i) => record(i + 1, 0.9, 3)), record(10, 0.9, 1)];
    const report = evaluateAcceptance(records, new Set());
    expect(report.passed).toBe(false);
    expect(report.coldSegment01Count).toBe(1);
    expect(report.failures.some((f) => f.includes("动态内容"))).toBe(true);
  });

  it("平均命中率不足时报出具体数字", () => {
    const records = Array.from({ length: 10 }, (_, i) => record(i + 1, 0.5, 3));
    const report = evaluateAcceptance(records, new Set());
    expect(report.passed).toBe(false);
    expect(report.failures.some((f) => f.includes("50.0%"))).toBe(true);
  });

  it("任一记录不可信则整体 verifiable 为 false（中转端点下命中率不作为依据）", () => {
    const records = [
      ...Array.from({ length: 9 }, (_, i) => record(i + 1, 0.9, 3)),
      { ...record(10, 0.9, 3), trustworthy: false },
    ];
    const report = evaluateAcceptance(records, new Set());
    expect(report.verifiable).toBe(false);
  });
});

describe("端点可信度判定", () => {
  it("官方端点与未设置 baseURL 都视为可信", () => {
    expect(isOfficialEndpoint(undefined)).toBe(true);
    expect(isOfficialEndpoint("")).toBe(true);
    expect(isOfficialEndpoint("https://api.anthropic.com")).toBe(true);
  });

  it("第三方中转判为不可信", () => {
    expect(isOfficialEndpoint("https://agentrouter.org")).toBe(false);
    expect(isOfficialEndpoint("https://api.example.com/v1")).toBe(false);
    expect(isOfficialEndpoint("not-a-url")).toBe(false);
  });
});
