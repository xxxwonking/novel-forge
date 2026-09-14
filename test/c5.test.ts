/**
 * C5 解析与交叉验证的测试。
 *
 * 重点在"残缺输入不放行" —— §6.1：清单一旦失去可信度，用户就再也不看了，
 * 功能等于没做。所以解析器的正确行为是丢弃而非补默认值。
 */

import { describe, expect, it } from "vitest";
import { parseC5, type ParseContext } from "../src/chapter/c5-schema.js";
import { checkPromisedResolutions, crossCheckC5 } from "../src/chapter/c5-crosscheck.js";
import type { ForeshadowId } from "../src/types/primitives.js";

const chapterText = [
  "血刀客推开破庙的门，刀还在鞘里。",
  "李长风把断剑横过来，剑脊上那道细纹在光里泛白。",
  "账本从三叔的袖口滑出来，摊在地上，第三行写着他的名字。",
  "断剑崩成两截，半截落在草屑里。",
].join("\n");

let counter = 20;
const ctx: ParseContext = {
  chapter: 53,
  chapterText,
  knownCharacters: new Set(["C01", "C02", "C03"]),
  knownForeshadows: new Set(["F03", "F07", "F11"]),
  knownPlotLines: new Set(["P01", "P02", "P03"]),
  allocateForeshadowId: () => `F${String(++counter)}` as ForeshadowId,
};

const validRaw = {
  events: [
    {
      kind: "action",
      summary: "血刀客围住破庙，李长风以断剑接下第九式",
      weight: 3,
      plot_line: "P01",
      participants: ["C01", "C02"],
      quote: "血刀客推开破庙的门",
    },
    {
      kind: "info",
      summary: "账本第三行出现三叔的名字",
      weight: 2,
      plot_line: "P02",
      participants: ["C01"],
      quote: "第三行写着他的名字",
    },
    {
      kind: "resource",
      summary: "断剑崩成两截",
      weight: 2,
      plot_line: "P01",
      participants: ["C01"],
      quote: "断剑崩成两截",
    },
  ],
  foreshadow_planted: [
    {
      label: "三叔袖口的灰",
      intent: "灰是密室特有的石粉，第四卷用来证明三叔进过密室。",
      weight: "sub",
      visibility: "covert",
      expected_by: 70,
      quote: "账本从三叔的袖口滑出来",
    },
  ],
  foreshadow_resolved: [
    { foreshadow_id: "F03", completeness: "full", quote: "第三行写着他的名字" },
    { foreshadow_id: "F11", completeness: "partial", quote: "断剑崩成两截" },
  ],
  relations_changed: [
    { from: "C01", to: "C02", from_kind: "hostile", to_kind: "ally", note: "共同目标转为暂时结盟", quote: "刀还在鞘里" },
  ],
  character_states: [
    { character_id: "C01", field: "condition", from: "现居青州·养伤中", to: "断剑折断·孤身", quote: "断剑崩成两截" },
  ],
  character_presence: [
    { character_id: "C01", role: "pov" },
    { character_id: "C02", role: "major" },
  ],
};

describe("parseC5：正常输入", () => {
  it("完整解析六类声明", () => {
    const { declaration, warnings } = parseC5(validRaw, ctx);
    expect(declaration.events).toHaveLength(3);
    expect(declaration.foreshadowPlanted).toHaveLength(1);
    expect(declaration.foreshadowResolved).toHaveLength(2);
    expect(declaration.relationsChanged).toHaveLength(1);
    expect(declaration.characterStates).toHaveLength(1);
    expect(declaration.characterPresence).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  it("quote 被解析成可定位的锚点", () => {
    const { declaration } = parseC5(validRaw, ctx);
    for (const e of declaration.events) {
      expect(e.anchor.offsetHint).toBeGreaterThanOrEqual(0);
      expect(chapterText.slice(e.anchor.offsetHint)).toContain(e.anchor.quote);
    }
  });

  it("新伏笔的 ID 由代码分配，不取模型给的值", () => {
    const withFakeId = {
      ...validRaw,
      foreshadow_planted: [{ ...validRaw.foreshadow_planted[0], foreshadow_id: "F99" }],
    };
    const { declaration } = parseC5(withFakeId, ctx);
    expect(declaration.foreshadowPlanted[0]?.foreshadowId).not.toBe("F99");
  });
});

describe("parseC5：残缺与非法输入一律丢弃", () => {
  it("非对象输入整章作废而非崩溃", () => {
    const { declaration, warnings } = parseC5("不是对象", ctx);
    expect(declaration.events).toHaveLength(0);
    expect(warnings[0]).toContain("整章声明作废");
  });

  it("缺 intent 的伏笔被丢弃（否则永远无法判定收没收）", () => {
    const raw = {
      ...validRaw,
      foreshadow_planted: [{ ...validRaw.foreshadow_planted[0], intent: "" }],
    };
    const { declaration, warnings } = parseC5(raw, ctx);
    expect(declaration.foreshadowPlanted).toHaveLength(0);
    expect(warnings.some((w) => w.includes("intent"))).toBe(true);
  });

  it("expected_by 不在未来的伏笔被丢弃", () => {
    const raw = {
      ...validRaw,
      foreshadow_planted: [{ ...validRaw.foreshadow_planted[0], expected_by: 40 }],
    };
    const { declaration, warnings } = parseC5(raw, ctx);
    expect(declaration.foreshadowPlanted).toHaveLength(0);
    expect(warnings.some((w) => w.includes("expected_by"))).toBe(true);
  });

  it("收束不存在的伏笔被丢弃并告警", () => {
    const raw = {
      ...validRaw,
      foreshadow_resolved: [{ foreshadow_id: "F99", completeness: "full", quote: "断剑崩成两截" }],
    };
    const { declaration, warnings } = parseC5(raw, ctx);
    expect(declaration.foreshadowResolved).toHaveLength(0);
    expect(warnings.some((w) => w.includes("F99"))).toBe(true);
  });

  it("引用不存在的人物时丢弃该条", () => {
    const raw = {
      ...validRaw,
      character_states: [
        { character_id: "C99", field: "condition", from: null, to: "死", quote: "断剑崩成两截" },
      ],
    };
    const { declaration, warnings } = parseC5(raw, ctx);
    expect(declaration.characterStates).toHaveLength(0);
    expect(warnings.some((w) => w.includes("C99"))).toBe(true);
  });

  it("超过 4 个事件时截断并提示可能把描写当成了事件", () => {
    const many = Array.from({ length: 7 }, (_, i) => ({
      kind: "action",
      summary: `事件${i}`,
      weight: 1,
      plot_line: "P01",
      participants: ["C01"],
      quote: "刀还在鞘里",
    }));
    const { declaration, warnings } = parseC5({ ...validRaw, events: many }, ctx);
    expect(declaration.events).toHaveLength(4);
    expect(warnings.some((w) => w.includes("描写"))).toBe(true);
  });

  it("重复的出场声明被去重（presence 是章级布尔不是计数）", () => {
    const raw = {
      ...validRaw,
      character_presence: [
        { character_id: "C01", role: "pov" },
        { character_id: "C01", role: "major" },
      ],
    };
    const { declaration, warnings } = parseC5(raw, ctx);
    expect(declaration.characterPresence).toHaveLength(1);
    expect(warnings.some((w) => w.includes("重复"))).toBe(true);
  });

  it("引用不存在的情节线时置空并告警，但保留事件本身", () => {
    const raw = {
      ...validRaw,
      events: [{ ...validRaw.events[0], plot_line: "P99" }],
    };
    const { declaration, warnings } = parseC5(raw, ctx);
    expect(declaration.events).toHaveLength(1);
    expect(declaration.events[0]?.plotLine).toBeNull();
    expect(warnings.some((w) => w.includes("P99"))).toBe(true);
  });
});

describe("crossCheckC5：用自洽性抓虚报", () => {
  it("完整自洽的声明不产生 warn 级问题", () => {
    const { declaration } = parseC5(validRaw, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    expect(findings.filter((f) => f.level === "warn" || f.level === "block")).toHaveLength(0);
  });

  it("资源类事件没有状态变更时判为可能虚报", () => {
    const { declaration } = parseC5({ ...validRaw, character_states: [] }, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    expect(findings.some((f) => f.rule === "c5_resource_without_state")).toBe(true);
  });

  it("关系类事件没有关系变更时判为可能虚报", () => {
    const raw = {
      ...validRaw,
      events: [{ ...validRaw.events[0], kind: "relation" }],
      relations_changed: [],
    };
    const { declaration } = parseC5(raw, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    expect(findings.some((f) => f.rule === "c5_relation_without_change")).toBe(true);
  });

  it("weight-3 事件只涉及一条情节线时建议降权", () => {
    const raw = {
      ...validRaw,
      events: [validRaw.events[0], { ...validRaw.events[2], plot_line: "P01" }],
    };
    const { declaration } = parseC5(raw, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    expect(findings.some((f) => f.rule === "c5_weight3_single_line")).toBe(true);
  });

  it("锚点在正文里找不到时阻止采用（模型引用了没写出的内容）", () => {
    const raw = {
      ...validRaw,
      events: [{ ...validRaw.events[0], quote: "这句话根本不在正文里" }],
    };
    const { declaration } = parseC5(raw, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    expect(findings.find((f) => f.rule === "c5_anchor_unresolvable")?.level).toBe("block");
  });

  it("重核引文时检查实际正文，不信任旧偏移", () => {
    const { declaration } = parseC5(validRaw, ctx);
    const findings = crossCheckC5({ declaration, chapterText: "正文已全部改为另一场对话。" });
    expect(findings.find(f => f.rule === "c5_anchor_unresolvable")?.level).toBe("block");
  });

  it("事件参与者未出现在出场声明里时告警", () => {
    const raw = {
      ...validRaw,
      character_presence: [{ character_id: "C01", role: "pov" }],
    };
    const { declaration } = parseC5(raw, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    expect(findings.some((f) => f.rule === "c5_participant_not_present")).toBe(true);
  });

  it("多个视角人物直接 block（违反 POV 纪律）", () => {
    const raw = {
      ...validRaw,
      character_presence: [
        { character_id: "C01", role: "pov" },
        { character_id: "C02", role: "pov" },
      ],
    };
    const { declaration } = parseC5(raw, ctx);
    const findings = crossCheckC5({ declaration, chapterText });
    const pov = findings.find((f) => f.rule === "c5_pov_count");
    expect(pov?.level).toBe("block");
  });
});

describe("checkPromisedResolutions：节拍表承诺 vs 实际声明", () => {
  it("承诺的收束都被声明时无 block", () => {
    const { declaration } = parseC5(validRaw, ctx);
    const findings = checkPromisedResolutions(declaration, [
      { foreshadowId: "F03", completeness: "full" },
      { foreshadowId: "F11", completeness: "partial" },
    ]);
    expect(findings.filter((f) => f.level === "block")).toHaveLength(0);
  });

  it("承诺了但没收束 → block，且给出两条出路", () => {
    const { declaration } = parseC5(validRaw, ctx);
    const findings = checkPromisedResolutions(declaration, [
      { foreshadowId: "F07", completeness: "full" },
    ]);
    const blocked = findings.find((f) => f.rule === "resolution_missing");
    expect(blocked?.level).toBe("block");
    expect(blocked?.message).toContain("补写");
  });

  it("计划完全收束但只做到部分 → warn", () => {
    const { declaration } = parseC5(validRaw, ctx);
    const findings = checkPromisedResolutions(declaration, [
      { foreshadowId: "F11", completeness: "full" },
    ]);
    expect(findings.some((f) => f.rule === "resolution_downgraded")).toBe(true);
  });

  it("额外收束了未安排的伏笔 → info（合法但记录）", () => {
    const { declaration } = parseC5(validRaw, ctx);
    const findings = checkPromisedResolutions(declaration, [
      { foreshadowId: "F03", completeness: "full" },
    ]);
    const extra = findings.find((f) => f.rule === "resolution_unplanned");
    expect(extra?.level).toBe("info");
  });
});
