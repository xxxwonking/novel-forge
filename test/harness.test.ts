/**
 * 验收工装的离线测试。
 *
 * 工装本身打真实 API，但它的**装配逻辑**必须可离线验证 —— 否则拿不到
 * 官方 key 期间，工装是否正确无从得知。这里验证跨章的缓存前缀行为：
 * 段 0/1 恒定、段 2 只在重建章变化。
 */

import { describe, expect, it } from "vitest";
import { assemble } from "../src/context/assemble.js";
import { buildL2Snapshot, shouldRebuildL2 } from "../src/context/build-l2.js";
import { selectL3 } from "../src/context/select-l3.js";
import { WRITING_DISCIPLINE } from "../src/context/discipline.js";
import { formatReport, type HarnessResult } from "../src/harness/ten-chapters.js";
import type { L2AppendEntry } from "../src/types/l2.js";
import type { CacheRecord } from "../src/metrics/cache.js";
import {
  beat,
  characters,
  chapterSynopses,
  foreshadows,
  plotLines,
  settings,
  volumeSummaries,
  workSetting,
} from "./fixtures.js";

const l1 = { setting: workSetting, discipline: WRITING_DISCIPLINE };

function assembleAt(chapter: number, pendingAppend: readonly L2AppendEntry[]) {
  return assemble({
    l1,
    l2: buildL2Snapshot({
      currentChapter: chapter,
      characters,
      chapterSynopses: chapterSynopses.filter((s) => s.chapter <= chapter),
      volumeSummaries: [...volumeSummaries],
      foreshadows,
      plotLines,
      pendingAppend,
    }),
    l3: selectL3({
      beat,
      characters: characters.filter((c) => beat.plan.characters.includes(c.id)),
      settings: settings.filter((s) => beat.plan.locations.includes(s.id)),
      volumeBoundary: null,
      plantedExcerpts: [],
    }),
    volatile: {
      previous: { chapter, headSummary: null, tailText: `第 ${chapter} 章的结尾。` },
      beat,
      resolves: [],
      avoid: [],
      task: `写出第 ${chapter + 1} 章。`,
    },
  });
}

function segmentText(req: ReturnType<typeof assemble>, index: number): string {
  const content = req.messages[0]?.content;
  if (!Array.isArray(content)) return "";
  const block = content[index];
  return block !== undefined && block.type === "text" ? block.text : "";
}

describe("跨章缓存前缀行为", () => {
  it("段 0（tools）在任何章都逐字节相同", () => {
    const a = assembleAt(10, []);
    const b = assembleAt(52, []);
    expect(JSON.stringify(a.tools)).toBe(JSON.stringify(b.tools));
  });

  it("段 1（L1）在任何章都逐字节相同 —— 这是段 0/1 冷次数为 0 的前提", () => {
    const a = assembleAt(10, []);
    const b = assembleAt(52, []);
    expect(a.system[0]?.text).toBe(b.system[0]?.text);
  });

  it("增量附加不改动带 bp2 的那个 block（否则每章都要重建缓存）", () => {
    const base = assembleAt(52, []);
    const appended = assembleAt(52, [
      { chapter: 53, synopsis: "破庙被围。", foreshadowDelta: [], characterDelta: [] },
    ]);
    expect(segmentText(appended, 0)).toBe(segmentText(base, 0));
  });

  it("连续 7 章增量附加，带 bp2 的 block 始终逐字节不变", () => {
    const baseline = segmentText(assembleAt(52, []), 0);
    let pending: L2AppendEntry[] = [];
    for (let i = 53; i < 60; i += 1) {
      pending = [...pending, { chapter: i, synopsis: `第${i}章。`, foreshadowDelta: [], characterDelta: [] }];
      expect(segmentText(assembleAt(52, pending), 0)).toBe(baseline);
    }
  });

  it("增量区作为独立的无缓存 block 出现在 bp 之后", () => {
    const withAppend = assembleAt(52, [
      { chapter: 53, synopsis: "破庙被围。", foreshadowDelta: [], characterDelta: [] },
    ]);
    const content = withAppend.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    const appendBlock = content.find((b) => b.type === "text" && b.text.includes("最新进展"));
    expect(appendBlock).toBeDefined();
    expect(appendBlock && "cache_control" in appendBlock ? appendBlock.cache_control : undefined).toBeUndefined();
  });

  it("shouldRebuildL2 在攒够 8 章时触发，此前不触发", () => {
    const state = (pendingChapters: number) => ({
      pendingChapters,
      pendingTokens: 0,
      majorEventPending: false,
      foreshadowResolvedPending: false,
    });
    expect(shouldRebuildL2(state(7))).toBe(false);
    expect(shouldRebuildL2(state(8))).toBe(true);
  });

  it("weight-3 事件或伏笔收束立即触发重建（正确性优先于成本）", () => {
    const base = {
      pendingChapters: 1,
      pendingTokens: 0,
      majorEventPending: false,
      foreshadowResolvedPending: false,
    };
    expect(shouldRebuildL2(base)).toBe(false);
    expect(shouldRebuildL2({ ...base, majorEventPending: true })).toBe(true);
    expect(shouldRebuildL2({ ...base, foreshadowResolvedPending: true })).toBe(true);
  });

  it("易变区每章都变（否则说明上一章正文没进上下文）", () => {
    expect(segmentText(assembleAt(10, []), 2)).not.toBe(segmentText(assembleAt(11, []), 2));
  });
});

describe("验收报告文案", () => {
  function record(hitRatio: number, trustworthy: boolean): CacheRecord {
    return {
      chapter: 1,
      step: "C4",
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: Math.round(18_200 * hitRatio),
      inputTokens: 18_200 - Math.round(18_200 * hitRatio),
      hitRatio,
      invalidatedAt: null,
      trustworthy,
    };
  }

  it("非官方端点时明确标注不可验证，不给出通过结论", () => {
    const r: HarnessResult = {
      records: [record(0.9, false)],
      rebuildChapters: new Set(),
      chapterTexts: new Map(),
      failures: [],
    };
    const out = formatReport(r);
    expect(out).toContain("不可验证");
    expect(out).not.toContain("M1 验收通过");
  });

  it("官方端点且达标时给出通过结论", () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ ...record(0.9, true), chapter: i + 1 }));
    const out = formatReport({
      records,
      rebuildChapters: new Set(),
      chapterTexts: new Map(),
      failures: [],
    });
    expect(out).toContain("✅ M1 验收通过");
  });

  it("运行中的失败被单独列出", () => {
    const out = formatReport({
      records: [record(0.9, true)],
      rebuildChapters: new Set(),
      chapterTexts: new Map(),
      failures: ["第 3 章：refused — 这段内容模型无法生成"],
    });
    expect(out).toContain("运行中的失败");
    expect(out).toContain("第 3 章");
  });
});
