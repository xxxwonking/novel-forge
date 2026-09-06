/**
 * §13.8 的三个回归测试。
 *
 * 它们便宜，但能挡住绝大多数缓存事故 —— 缓存失效是静默的，只能靠
 * cache_read_input_tokens 掉到 0 才发现，而那时已经付了钱。
 *
 * 现在 renderL1 / renderL2 / WRITING_TOOLS 尚未实现，测试对占位实现断言，
 * 保证契约先立起来；M1 实现时替换 import 即可，测试本身不用改。
 */

import { describe, expect, it } from "vitest";
import type { L2Renderer, L2Snapshot } from "../src/types/index.js";

// ── 占位实现（M1 实现后替换为真实 import）──────────────────────────────

const EXPECTED_TOOL_ORDER = [
  "load_character",
  "load_setting",
  "load_chapter",
  "list_open_foreshadows",
  "propose_character_update",
  "propose_foreshadow",
] as const;

const WRITING_TOOL_NAMES: readonly string[] = EXPECTED_TOOL_ORDER;

const renderL1 = (work: { readonly title: string; readonly genre: string }): string =>
  `【作品】${work.title}\n【题材】${work.genre}\n【写作纪律】POV 单一，禁止元层穿帮。`;

const renderL2: L2Renderer = (s) => {
  const lines: string[] = [];
  lines.push(`[人物名录] 共 ${s.characters.totalCount} 人，主要 ${s.characters.majorCount} 人`);
  for (const c of s.characters.rows) {
    lines.push(`${c.name} | ${c.role} | ${c.condition} | 最近 ${c.lastSeen}`);
  }
  lines.push(`[未收伏笔] ${s.foreshadows.rows.length} 条`);
  for (const f of s.foreshadows.rows) {
    lines.push(`${f.id} | ${f.weight} | ${f.label} | ${f.planted} | ${f.expectation}`);
  }
  for (const a of s.pendingAppend) {
    lines.push(`+ch${a.chapter} ${a.synopsis}`);
  }
  return lines.join("\n");
};

// ── fixture ─────────────────────────────────────────────────────────────

const snapshot: L2Snapshot = {
  formatVersion: 1,
  characters: {
    rows: [
      { id: "C01", name: "李长风", role: "主角", condition: "现居青州·养伤中", lastSeen: "ch52" },
      { id: "C02", name: "血刀客", role: "主要反派", condition: "下落不明·记恨主角", lastSeen: "ch48" },
    ],
    totalCount: 47,
    majorCount: 8,
  },
  synopsis: [{ granularity: "per_chapter", range: "ch52", text: "李长风在青州养伤，察觉师门有内应。" }],
  foreshadows: {
    rows: [
      { id: "F03", weight: "main", label: "生锈的钥匙", planted: "ch5埋", expectation: "预期3卷", flag: "due_soon" },
      { id: "F11", weight: "sub", label: "村口老树", planted: "ch18埋", expectation: "20章内", flag: "overdue" },
    ],
    counts: { main: 3, sub: 5, detail: 4 },
  },
  plotLines: [{ id: "P01", label: "复仇主线", weight: "main", lastAdvanced: "ch52" }],
  pendingAppend: [{ chapter: 53, synopsis: "血刀客围杀。", foreshadowDelta: ["F03 resolved"], characterDelta: [] }],
};

// ── 测试 ────────────────────────────────────────────────────────────────

describe("装配输出逐字节稳定", () => {
  it("同一快照的深拷贝渲染出完全相同的字符串", () => {
    expect(renderL2(structuredClone(snapshot))).toBe(renderL2(snapshot));
  });

  it("键序不同但内容相同的快照渲染结果一致", () => {
    const reordered: L2Snapshot = {
      ...snapshot,
      foreshadows: { counts: snapshot.foreshadows.counts, rows: snapshot.foreshadows.rows },
      characters: {
        majorCount: snapshot.characters.majorCount,
        totalCount: snapshot.characters.totalCount,
        rows: snapshot.characters.rows,
      },
    };
    expect(renderL2(reordered)).toBe(renderL2(snapshot));
  });

  it("增量附加只改变输出的尾部，前缀逐字节不变", () => {
    const before = renderL2({ ...snapshot, pendingAppend: [] });
    const after = renderL2(snapshot);
    expect(after.startsWith(before)).toBe(true);
  });
});

describe("L1 不含动态内容", () => {
  it("渲染结果不含日期、章号或计数", () => {
    const l1 = renderL1({ title: "青州旧事", genre: "玄幻" });
    expect(l1).not.toMatch(/\d{4}-\d{2}-\d{2}|第\s*\d+\s*章|共\s*\d+/);
  });
});

describe("工具顺序固定", () => {
  it("工具名数组与期望顺序完全一致", () => {
    expect(WRITING_TOOL_NAMES).toEqual([...EXPECTED_TOOL_ORDER]);
  });
});
