/**
 * 方案的解析与执行。
 *
 * 两件事都复用 `executeMainTool`，所以这里重点验证复用带来的那几个性质：
 * 提案期就能拿到真实的入参校验结果；执行期占位名换成代码分配的真编号；失败即停。
 */

import { describe, expect, it, vi } from "vitest";
import { applyProposal, parseProposalDraft } from "../src/agent/proposal.js";
import type { MainAgentToolContext } from "../src/agent/tool-exec.js";
import type { ProposalItem } from "../src/agent/proposal-types.js";

const MAX_ITEMS = 24;

/** 一份能过校验的节拍入参。引用的编号由调用方替换成占位名或真编号。 */
function plan(characters: readonly string[], locations: readonly string[] = []): Record<string, unknown> {
  return {
    chapterType: "event",
    coreEvent: "李长风在旧巷截住守夜人，逼问密库入口",
    stageFeedback: "读者拿到密库入口的确切位置",
    hook: "守夜人报出一个不该知道的名字",
    events: [{ kind: "action", summary: "李长风截住守夜人并逼问出入口", weight: 2, plotLine: null }],
    characters: [...characters],
    locations: [...locations],
  };
}

function fakeCtx(over: Partial<MainAgentToolContext> = {}): MainAgentToolContext {
  const stub = async (): Promise<never> => {
    throw new Error("未预期的调用");
  };
  return {
    getOverview: () => "",
    listChapterDrafts: () => "",
    getChapterText: () => null,
    getCharacter: () => null,
    listOpenForeshadows: () => "",
    getNextPlan: () => "",
    getDirection: () => "",
    setDirection: async (input) => ({ message: "方向已更新", effect: { kind: "setting_updated", fields: Object.keys(input) } }),
    upsertCharacter: async (input) => ({
      message: "已新建人物",
      effect: { kind: "character_upserted", id: "C07", name: input.name ?? "", created: true },
    }),
    upsertLocation: async (input) => ({
      message: "已新建地点",
      effect: { kind: "location_upserted", id: "S05", name: input.name ?? "", created: true },
    }),
    definePlotLine: async (input) => ({
      message: "已定义情节线",
      effect: { kind: "plotline_defined", id: "P03", label: input.label ?? "", created: true },
    }),
    setDiscipline: stub,
    planChapter: async ({ plan: p }) => ({
      message: "已排章",
      effect: { kind: "chapter_planned", chapter: 3, chapterType: p.chapterType, warnings: 0 },
    }),
    addToNextChapter: stub,
    rescheduleForeshadow: stub,
    abandonForeshadow: stub,
    recordIdea: stub,
    writeNextChapter: stub,
    rewriteChapterDraft: stub,
    adoptChapter: stub,
    proposePlan: stub,
    ...over,
  };
}

describe("parseProposalDraft", () => {
  it("合法方案：记下占位名，条目按原序保留", async () => {
    const parsed = await parseProposalDraft(
      {
        summary: "先把守夜人立起来，再让第 3 章跟他正面撞上。",
        impact: ["会用掉 F01 的收束窗口"],
        items: [
          { ref: "守夜人", tool: "upsert_character", input: { name: "守夜人", tier: "major" }, note: "新建守夜人" },
          { tool: "plan_chapter", input: plan(["@守夜人"]), note: "第 3 章排上这场对峙" },
        ],
      },
      MAX_ITEMS,
    );
    expect(typeof parsed).not.toBe("string");
    if (typeof parsed === "string") return;
    expect(parsed.items.map((i) => i.tool)).toEqual(["upsert_character", "plan_chapter"]);
    expect(parsed.items[0]?.ref).toBe("守夜人");
    expect(parsed.impact).toHaveLength(1);
  });

  it("impact 可省略，缺省为空数组", async () => {
    const parsed = await parseProposalDraft(
      { summary: "改一条情节线", items: [{ tool: "define_plotline", input: { label: "信任崩塌" }, note: "新增支线" }] },
      MAX_ITEMS,
    );
    expect(typeof parsed === "string" ? parsed : parsed.impact).toEqual([]);
  });

  it.each([
    ["summary 为空", { summary: "  ", items: [{ tool: "define_plotline", input: {}, note: "x" }] }, "summary"],
    ["items 为空", { summary: "s", items: [] }, "items"],
    [
      "工具不在白名单（写章不进方案）",
      { summary: "s", items: [{ tool: "write_next_chapter", input: {}, note: "写章" }] },
      "不在方案可用的工具里",
    ],
    ["缺 note", { summary: "s", items: [{ tool: "define_plotline", input: { label: "甲" } }] }, "note"],
    [
      "引用了没声明过的占位名",
      { summary: "s", items: [{ tool: "plan_chapter", input: plan(["@查无此人"]), note: "排章" }] },
      "没有在更早的条目里声明",
    ],
    [
      "占位名重复",
      {
        summary: "s",
        items: [
          { ref: "甲", tool: "define_plotline", input: { label: "甲线" }, note: "一" },
          { ref: "甲", tool: "define_plotline", input: { label: "乙线" }, note: "二" },
        ],
      },
      "重复",
    ],
    [
      "不新建对象的工具给了 ref",
      { summary: "s", items: [{ ref: "甲", tool: "set_direction", input: { premise: "p" }, note: "改方向" }] },
      "不新建对象",
    ],
    [
      "入参形状不合法：枚举值写错",
      { summary: "s", items: [{ tool: "upsert_character", input: { name: "甲", tier: "boss" }, note: "建人物" }] },
      "入参不合法",
    ],
    [
      "入参形状不合法：节拍缺钩子",
      {
        summary: "s",
        items: [{ tool: "plan_chapter", input: { chapterType: "event", coreEvent: "c", stageFeedback: "f" }, note: "排章" }],
      },
      "入参不合法",
    ],
  ])("%s → 回错误串让模型自纠", async (_name, raw, expected) => {
    const parsed = await parseProposalDraft(raw as Record<string, unknown>, MAX_ITEMS);
    expect(typeof parsed).toBe("string");
    expect(parsed as string).toContain(expected);
  });

  it("条目数超上限即拒", async () => {
    const items = Array.from({ length: 4 }, (_, i) => ({ tool: "define_plotline", input: { label: `L${i}` }, note: "x" }));
    const parsed = await parseProposalDraft({ summary: "s", items }, 3);
    expect(parsed).toContain("最多 3 条");
  });

  it("占位名按声明它的工具换成前缀正确的哨兵，所以编号格式检查照常生效", async () => {
    // locations 期望 S 前缀：占位名由 upsert_character 声明时，哨兵是 C00，必须被打回。
    const parsed = await parseProposalDraft(
      {
        summary: "s",
        items: [
          { ref: "甲", tool: "upsert_character", input: { name: "甲", tier: "major" }, note: "建人物" },
          { tool: "plan_chapter", input: plan([], ["@甲"]), note: "把人物编号填到场景位" },
        ],
      },
      MAX_ITEMS,
    );
    expect(parsed).toContain("locations 含非法场景编号");
  });
});

describe("applyProposal", () => {
  it("占位名换成代码分配的真编号，再交给后续条目", async () => {
    const planChapter = vi.fn(async ({ plan: p }: { plan: { chapterType: string; characters: readonly string[] } }) => ({
      message: "已排章",
      effect: { kind: "chapter_planned" as const, chapter: 3, chapterType: p.chapterType, warnings: 0 },
    }));
    const items: ProposalItem[] = [
      { ref: "守夜人", tool: "upsert_character", input: { name: "守夜人", tier: "major" }, note: "建人物" },
      { tool: "plan_chapter", input: plan(["@守夜人"]), note: "排章" },
    ];

    const result = await applyProposal(items, fakeCtx({ planChapter: planChapter as never }));

    expect(result.status).toBe("adopted");
    expect(result.effects).toHaveLength(2);
    // 模型写的是 @守夜人，落到受控入口时已经是 upsertCharacter 分配的 C07。
    expect(planChapter.mock.calls[0]?.[0]?.plan.characters).toEqual(["C07"]);
  });

  it("中途失败即停：已落的保留，后面的不执行", async () => {
    const later = vi.fn();
    const items: ProposalItem[] = [
      { tool: "define_plotline", input: { label: "信任崩塌" }, note: "先建线" },
      { tool: "plan_chapter", input: plan([]), note: "这条会被打回" },
      { tool: "upsert_location", input: { name: "城南旧巷" }, note: "不该执行到这里" },
    ];

    const result = await applyProposal(
      items,
      fakeCtx({
        planChapter: async () => ({
          message: "节拍未通过校验，未写入：章末钩子是空钩",
          effect: { kind: "action_failed", tool: "plan_chapter", message: "章末钩子是空钩" },
        }),
        upsertLocation: later as never,
      }),
    );

    expect(result.status).toBe("partially_applied");
    expect(result.failure).toMatchObject({ index: 1, tool: "plan_chapter" });
    expect(result.failure?.message).toContain("空钩");
    expect(result.effects).toHaveLength(1);
    expect(result.effects[0]).toMatchObject({ kind: "plotline_defined" });
    expect(later).not.toHaveBeenCalled();
  });

  it("入参在执行期才被打回也算失败即停（形状错误不产 effect）", async () => {
    const items: ProposalItem[] = [{ tool: "upsert_character", input: { name: "甲", tier: "boss" }, note: "枚举错" }];
    const result = await applyProposal(items, fakeCtx());
    expect(result.status).toBe("partially_applied");
    expect(result.failure).toMatchObject({ index: 0, tool: "upsert_character" });
    expect(result.effects).toEqual([]);
  });

  it("引用的条目没产出编号时停下，不把 @占位名 当编号写进去", async () => {
    const items: ProposalItem[] = [
      // set_direction 不产出编号，ref 在解析期就会被拒；这里直接构造绕过解析的坏数据。
      { tool: "plan_chapter", input: plan(["@没人建过"]), note: "排章" },
    ];
    const result = await applyProposal(items, fakeCtx());
    expect(result.status).toBe("partially_applied");
    expect(result.failure?.message).toContain("@没人建过");
  });

  it("空方案直接算完成（不会有，但不该抛）", async () => {
    const result = await applyProposal([], fakeCtx());
    expect(result).toMatchObject({ status: "adopted", effects: [], messages: [] });
  });
});
