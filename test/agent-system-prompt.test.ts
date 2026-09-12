/**
 * 主 Agent 系统提示的就绪度渲染（Stage 2·切片 2）：空作品列出缺项并引导筹备顺序；
 * 已建对象以「编号 名字」出现（模型唯一合法的引用来源）；齐备后明确"可以写章"。
 */

import { describe, expect, it } from "vitest";
import { buildMainAgentSystem, prepGaps, type MainAgentContextInfo } from "../src/agent/system-prompt.js";

const EMPTY: MainAgentContextInfo = {
  title: "新书",
  genre: "xuanhuan",
  platform: "fanqie",
  currentChapter: 0,
  nextChapter: 1,
  nextPlanReady: false,
  pendingDrafts: 0,
  prep: { premiseSet: false, conflictSet: false, characters: [], locations: [], plotLines: [], disciplineVersion: "d1" },
};

const READY: MainAgentContextInfo = {
  ...EMPTY,
  nextPlanReady: true,
  prep: {
    premiseSet: true,
    conflictSet: true,
    characters: [{ id: "C01", name: "李长风", tier: "protagonist" }, { id: "C02", name: "苏晚晴", tier: "major" }],
    locations: [{ id: "S01", name: "集市" }],
    plotLines: [{ id: "P01", label: "复仇主线", weight: "main" }],
    disciplineVersion: "a2",
  },
};

const text = (info: MainAgentContextInfo): string => buildMainAgentSystem(info)[0]?.text ?? "";

describe("系统提示的筹备状态", () => {
  it("空作品：列出全部缺项，不说可以写章", () => {
    expect(prepGaps(EMPTY)).toEqual(["前提", "核心冲突", "人物", "情节线", "第 1 章节拍"]);
    const t = text(EMPTY);
    expect(t).toContain("写首章前还缺：前提、核心冲突、人物、情节线、第 1 章节拍");
    expect(t).toContain("人物（0 位）：（无）");
    expect(t).toContain("平台缺省版");
    expect(t).not.toContain("筹备已齐");
  });

  it("齐备作品：编号与名字成对出现，标记可以写章、纪律为作者定制版", () => {
    expect(prepGaps(READY)).toEqual([]);
    const t = text(READY);
    expect(t).toContain("C01 李长风(protagonist)、C02 苏晚晴(major)");
    expect(t).toContain("S01 集市");
    expect(t).toContain("P01 复仇主线(main)");
    expect(t).toContain("作者定制版 a2");
    expect(t).toContain("筹备已齐，可以写章。");
  });

  it("纯函数：同一状态两次渲染逐字一致", () => {
    expect(text(READY)).toBe(text(READY));
  });
});
