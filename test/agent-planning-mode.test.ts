/**
 * 谋篇模式的只读锁。
 *
 * 锁有两道：工具集本身裁过一遍（模型看不到写类工具），`executeMainTool` 再兜一次
 * （将来有人改错工具集也漏不过去）。这里两道都验，外加提示里的「条目格式」——
 * 那张表是模型在谋篇模式下唯一的字段来源，必须覆盖全部可用工具。
 */

import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  EXPECTED_PLANNING_MODE_TOOL_ORDER,
  MAIN_AGENT_TOOLS,
  PLANNING_ALLOWED_TOOLS,
  PLANNING_MODE_TOOLS,
} from "../src/agent/tools.js";
import { executeMainTool, type MainAgentToolContext } from "../src/agent/tool-exec.js";
import { PROPOSAL_TOOLS, PROPOSAL_TOOL_FIELDS } from "../src/agent/proposal-types.js";
import { buildMainAgentSystem, type MainAgentContextInfo } from "../src/agent/system-prompt.js";

function block(name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id: "t1", name, input } as unknown as Anthropic.ToolUseBlock;
}

function fakeCtx(over: Partial<MainAgentToolContext> = {}): MainAgentToolContext {
  const stub = async (): Promise<never> => {
    throw new Error("谋篇模式下不该走到写入入口");
  };
  return {
    getOverview: () => "OVERVIEW",
    listChapterDrafts: () => "DRAFTS",
    getChapterText: () => "TEXT",
    getCharacter: () => "CARD",
    listOpenForeshadows: () => "FORESHADOWS",
    getNextPlan: () => "PLAN",
    getDirection: () => "DIRECTION",
    setDirection: stub,
    upsertCharacter: stub,
    upsertLocation: stub,
    definePlotLine: stub,
    setDiscipline: stub,
    planChapter: stub,
    addToNextChapter: stub,
    rescheduleForeshadow: stub,
    abandonForeshadow: stub,
    recordIdea: async (text) => ({ message: "已记录", effect: { kind: "idea_recorded", id: "idea1", text } }),
    writeNextChapter: stub,
    rewriteChapterDraft: stub,
    adoptChapter: stub,
    proposePlan: async () => ({
      message: "已出方案 p1",
      effect: { kind: "proposal_ready", id: "p1", version: 1, scope: "revision", items: 2, summary: "S" },
    }),
    ...over,
  };
}

describe("PLANNING_MODE_TOOLS", () => {
  it("顺序与 EXPECTED_PLANNING_MODE_TOOL_ORDER 逐位一致", () => {
    expect(PLANNING_MODE_TOOLS.map((t) => t.name)).toEqual([...EXPECTED_PLANNING_MODE_TOOL_ORDER]);
  });

  it("不含任何会改动作品的工具 —— 只读锁是结构性的", () => {
    const names = new Set(PLANNING_MODE_TOOLS.map((t) => t.name));
    for (const t of PROPOSAL_TOOLS) expect(names.has(t)).toBe(false);
    for (const t of ["write_next_chapter", "rewrite_chapter_draft", "adopt_chapter"]) expect(names.has(t)).toBe(false);
  });

  it("读类工具的定义与常规模式同一份（没有第二套描述要维护）", () => {
    const main = new Map(MAIN_AGENT_TOOLS.map((t) => [t.name, t]));
    for (const t of PLANNING_MODE_TOOLS) {
      if (t.name === "propose_plan") continue;
      expect(t).toBe(main.get(t.name));
    }
  });

  it("允许名单与工具集一致", () => {
    expect([...PLANNING_ALLOWED_TOOLS].sort()).toEqual([...EXPECTED_PLANNING_MODE_TOOL_ORDER].sort());
  });
});

describe("executeMainTool 的模式兜底", () => {
  it("谋篇模式下命中写类工具：回 is_error、不产 effect、不碰受控入口", async () => {
    const upsertCharacter = vi.fn();
    const r = await executeMainTool(
      block("upsert_character", { name: "守夜人", tier: "major" }),
      fakeCtx({ upsertCharacter: upsertCharacter as never }),
      "planning",
    );
    expect(r.result.is_error).toBe(true);
    expect(r.result.content).toContain("propose_plan");
    expect(r.effect).toBeUndefined();
    expect(upsertCharacter).not.toHaveBeenCalled();
  });

  it("谋篇模式下读类工具照常可用", async () => {
    const r = await executeMainTool(block("get_direction", {}), fakeCtx(), "planning");
    expect(r.result.is_error).toBeUndefined();
    expect(r.result.content).toBe("DIRECTION");
  });

  it("谋篇模式下仍可记备选 —— 它写的是对话域，不碰作品", async () => {
    const r = await executeMainTool(block("record_alternative_idea", { text: "师父是反派" }), fakeCtx(), "planning");
    expect(r.result.is_error).toBeUndefined();
    expect(r.effect).toMatchObject({ kind: "idea_recorded" });
  });

  it("常规模式下 propose_plan 不可用 —— 那时直接执行就好", async () => {
    const r = await executeMainTool(block("propose_plan", { summary: "s", items: [] }), fakeCtx(), "normal");
    expect(r.result.is_error).toBe(true);
    expect(r.effect).toBeUndefined();
  });

  it("谋篇模式下 propose_plan 产 proposal_ready", async () => {
    const r = await executeMainTool(block("propose_plan", { summary: "s", items: [] }), fakeCtx(), "planning");
    expect(r.result.is_error).toBeUndefined();
    expect(r.effect).toMatchObject({ kind: "proposal_ready", id: "p1" });
  });

  it("propose_plan 入参不合法：回 is_error 但不产 effect（模型自纠，不给作者留噪声 chip）", async () => {
    const r = await executeMainTool(
      block("propose_plan", { summary: "s" }),
      fakeCtx({ proposePlan: async () => "items 必须是非空数组" }),
      "planning",
    );
    expect(r.result.is_error).toBe(true);
    expect(r.result.content).toContain("items");
    expect(r.effect).toBeUndefined();
  });

  it("缺省模式是 normal —— 锁要显式打开", async () => {
    const r = await executeMainTool(block("propose_plan", { summary: "s", items: [] }), fakeCtx());
    expect(r.result.is_error).toBe(true);
  });
});

const EMPTY: MainAgentContextInfo = {
  title: "新书",
  genre: "mystery",
  platform: "fanqie",
  currentChapter: 0,
  nextChapter: 1,
  nextPlanReady: false,
  pendingDrafts: 0,
  prep: { premiseSet: false, conflictSet: false, characters: [], locations: [], plotLines: [], disciplineVersion: "d1" },
};

const WRITING: MainAgentContextInfo = {
  ...EMPTY,
  currentChapter: 12,
  nextChapter: 13,
  nextPlanReady: true,
  prep: {
    premiseSet: true,
    conflictSet: true,
    characters: [{ id: "C01", name: "沈砚", tier: "protagonist" }],
    locations: [{ id: "S01", name: "城南旧巷" }],
    plotLines: [{ id: "P01", label: "追查旧案", weight: "main" }],
    disciplineVersion: "a1",
  },
};

const planning = (info: MainAgentContextInfo): string => buildMainAgentSystem(info, "planning")[0]?.text ?? "";

describe("谋篇模式的系统提示", () => {
  it("开宗明义说清这个模式改不动作品，也不许假装做过", () => {
    const t = planning(EMPTY);
    expect(t).toContain("谋篇模式");
    expect(t).toContain("改不动作品");
    expect(t).toContain("不要说“我已经建好了/已经改成了”");
  });

  it("筹备未齐：走从零带的那条路，不追问“前提是什么”", () => {
    const t = planning(EMPTY);
    expect(t).toContain("从零把这本书筹备出来");
    expect(t).toContain("一句话冲动");
    expect(t).not.toContain("先读再提");
  });

  it("已在写作中途：要求先读再提，并写清 impact", () => {
    const t = planning(WRITING);
    expect(t).toContain("先读再提");
    expect(t).toContain("list_open_foreshadows");
    expect(t).toContain("impact");
    expect(t).not.toContain("一句话冲动");
  });

  it("带上条目格式表 —— 谋篇模式下模型看不到写类工具的 schema", () => {
    const t = planning(WRITING);
    for (const tool of PROPOSAL_TOOLS) expect(t).toContain(tool);
    expect(t).toContain("chapterType(transition|setup|event|payoff|climax)");
  });

  it("两种模式共用作品与筹备状态那一段", () => {
    const normal = buildMainAgentSystem(WRITING)[0]?.text ?? "";
    expect(normal).toContain("人物（1 位）：C01 沈砚(protagonist)");
    expect(planning(WRITING)).toContain("人物（1 位）：C01 沈砚(protagonist)");
  });

  it("常规模式的提示里没有谋篇那套指令，但告诉作者有这个模式", () => {
    const normal = buildMainAgentSystem(WRITING)[0]?.text ?? "";
    expect(normal).toContain("谋篇模式");
    expect(normal).toContain("你自己切不了模式");
    expect(normal).not.toContain("条目格式");
  });
});

describe("PROPOSAL_TOOL_FIELDS", () => {
  it("覆盖且只覆盖白名单里的工具 —— 改工具入参要同步改这张表", () => {
    expect(Object.keys(PROPOSAL_TOOL_FIELDS).sort()).toEqual([...PROPOSAL_TOOLS].sort());
    for (const t of PROPOSAL_TOOLS) expect(PROPOSAL_TOOL_FIELDS[t].length).toBeGreaterThan(0);
  });
});
