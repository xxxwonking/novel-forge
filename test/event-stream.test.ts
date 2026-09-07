/**
 * 事件流与投影的测试。
 *
 * 两条不变量是重点：append-only（payload 不可变）、proposed 不进视图。
 */

import { describe, expect, it } from "vitest";
import {
  EventStream,
  commitDeclaration,
  type AppendInput,
  type Clock,
} from "../src/store/event-stream.js";
import { project, projectCharacterState } from "../src/store/project.js";
import { parseC5, type ParseContext } from "../src/chapter/c5-schema.js";
import { loadRules } from "../src/rules/load.js";
import type { ForeshadowId } from "../src/types/primitives.js";

let tick = 0;
const fixedClock: Clock = () => `2026-09-06T00:00:${String(tick++).padStart(2, "0")}.000Z`;

function freshStream(): EventStream {
  tick = 0;
  return new EventStream(fixedClock);
}

/**
 * 播种已提交的历史事件。
 *
 * 必须走 append → decide 两步，因为 append() 在类型上拒绝 committed ——
 * 事件只能以 proposed/authored 进入，经用户裁决才成为 committed（§12.0）。
 * 测试不该绕过这条不变量。
 */
function seedCommitted(stream: EventStream, input: Omit<AppendInput, "provenance">): void {
  const e = stream.append({ ...input, provenance: "proposed" });
  stream.decide(e.envelope.id, "committed");
}

const chapterText = [
  "血刀客推开破庙的门，刀还在鞘里。",
  "账本从三叔的袖口滑出来，第三行写着他的名字。",
  "断剑崩成两截。",
].join("\n");

let fsCounter = 20;
const ctx: ParseContext = {
  chapter: 53,
  chapterText,
  knownCharacters: new Set(["C01", "C02", "C03"]),
  knownForeshadows: new Set(["F03", "F07"]),
  knownPlotLines: new Set(["P01", "P02"]),
  allocateForeshadowId: () => `F${String(++fsCounter)}` as ForeshadowId,
};

const raw = {
  events: [
    {
      kind: "action",
      summary: "血刀客围住破庙",
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
  ],
  foreshadow_planted: [
    {
      label: "三叔袖口的灰",
      intent: "灰是密室石粉，第四卷证明三叔进过密室。",
      weight: "sub",
      visibility: "covert",
      expected_by: 70,
      quote: "账本从三叔的袖口滑出来",
    },
  ],
  foreshadow_resolved: [{ foreshadow_id: "F03", completeness: "full", quote: "第三行写着他的名字" }],
  relations_changed: [
    { from: "C01", to: "C02", from_kind: "hostile", to_kind: "ally", note: "暂时结盟", quote: "刀还在鞘里" },
  ],
  character_states: [
    { character_id: "C01", field: "condition", from: "养伤中", to: "断剑折断", quote: "断剑崩成两截" },
    { character_id: "C01", field: "location", from: null, to: "S01", quote: "血刀客推开破庙的门" },
  ],
  character_presence: [
    { character_id: "C01", role: "pov" },
    { character_id: "C02", role: "major" },
  ],
};

const profiles = [
  { id: "C01" as const, name: "李长风", tier: "protagonist" as const, introducedAt: 1 },
  { id: "C02" as const, name: "血刀客", tier: "major" as const, introducedAt: 9 },
  { id: "C03" as const, name: "苏晚晴", tier: "major" as const, introducedAt: 3 },
];

const plotDefs = [
  { id: "P01" as const, label: "复仇主线", weight: "main" as const },
  { id: "P02" as const, label: "师门内应", weight: "sub" as const },
];

/** 断线阈值从 rules.yaml 来 —— 投影不自带缺省值（见 ProjectionInput 注释）。 */
const GAP = loadRules().crossChapter.plotLineGap;

describe("EventStream：append-only", () => {
  it("seq 单调递增，ID 按章内序号可读", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    const events = commitDeclaration(s, 53, declaration);
    expect(events.map((e) => e.envelope.seq)).toEqual(events.map((_, i) => i + 1));
    expect(events[0]?.envelope.id).toBe("ch53-1");
    expect(events[1]?.envelope.id).toBe("ch53-2");
  });

  it("展开顺序固定：事件 → 埋 → 收 → 关系 → 状态 → 出场", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    const types = commitDeclaration(s, 53, declaration).map((e) => e.payload.type);
    expect(types).toEqual([
      "plot_event",
      "plot_event",
      "foreshadow_planted",
      "foreshadow_resolved",
      "relation_changed",
      "character_state_changed",
      "character_state_changed",
      "character_presence",
      "character_presence",
    ]);
  });

  it("不产生 plot_advance（它是派生的，§11.6）", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    const types = commitDeclaration(s, 53, declaration).map((e) => e.payload.type);
    expect(types).not.toContain("plot_advance");
  });

  it("裁决只换信封，payload 引用不变（append-only）", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    const [first] = commitDeclaration(s, 53, declaration);
    const before = first!.payload;
    const after = s.decide(first!.envelope.id, "committed");
    expect(after?.payload).toBe(before);
    expect(after?.envelope.provenance).toBe("committed");
    expect(after?.envelope.decidedAt).toBeDefined();
  });

  it("重复裁决不覆盖首次决定", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    const [first] = commitDeclaration(s, 53, declaration);
    s.decide(first!.envelope.id, "committed");
    const again = s.decide(first!.envelope.id, "rejected");
    expect(again?.envelope.provenance).toBe("committed");
  });

  it("整章批量接受", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    expect(s.pending(53)).toHaveLength(9);
    s.decideChapter(53, "committed");
    expect(s.pending(53)).toHaveLength(0);
    expect(s.effective()).toHaveLength(9);
  });

  it("reviewNote 落在信封上，供 C5 prompt 校准", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    const [first] = commitDeclaration(s, 53, declaration);
    const r = s.decide(first!.envelope.id, "rejected", "这不算事件，只是氛围");
    expect(r?.envelope.reviewNote).toBe("这不算事件，只是氛围");
  });
});

describe("投影：proposed 不进视图", () => {
  it("未接受时四张视图都是空的", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    const p = project({
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    expect(p.foreshadows).toHaveLength(0);
    expect(p.relations).toHaveLength(0);
    expect(p.plotLines.every((l) => l.points.length === 0)).toBe(true);
  });

  it("接受后视图才有数据", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    s.decideChapter(53, "committed");
    const p = project({
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    expect(p.foreshadows).toHaveLength(1);
    expect(p.relations).toHaveLength(1);
    expect(p.plotLines.find((l) => l.id === "P01")?.points).toHaveLength(1);
  });
});

describe("投影：伏笔时间线", () => {
  function resolved(completeness: "full" | "partial") {
    const s = freshStream();
    // ch5 埋，ch53 收
    seedCommitted(s, {
      chapter: 5,
      origin: "C5_declaration",
      payload: {
        type: "foreshadow_planted",
        foreshadowId: "F03" as ForeshadowId,
        label: "生锈的钥匙",
        intent: "开第三卷密室",
        weight: "main",
        visibility: "overt",
        expectedBy: 55,
        anchor: { chapter: 5, quote: "生锈的钥匙", offsetHint: 10, occurrence: 0 },
      },
    });
    seedCommitted(s, {
      chapter: 53,
      origin: "C5_declaration",
      payload: {
        type: "foreshadow_resolved",
        foreshadowId: "F03" as ForeshadowId,
        completeness,
        anchor: { chapter: 53, quote: "钥匙插进锁孔", offsetHint: 20, occurrence: 0 },
      },
    });
    return project({
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    }).foreshadows[0];
  }

  it("完全收束把状态改为 resolved", () => {
    expect(resolved("full")?.status).toBe("resolved");
  });

  it("部分收束记录 resolution 但状态仍为 open", () => {
    const f = resolved("partial");
    expect(f?.status).toBe("open");
    expect(f?.resolutions).toHaveLength(1);
  });

  it("已收束的伏笔 overdueBy 归零，未收的按当前章计算", () => {
    expect(resolved("full")?.overdueBy).toBe(0);
    expect(resolved("partial")?.overdueBy).toBe(53 - 55);
  });

  it("P4 规划的伏笔状态是 planned，不是 open", () => {
    const s = freshStream();
    s.append({
      chapter: 0,
      origin: "P4_outline",
      provenance: "authored",
      payload: {
        type: "foreshadow_planted",
        foreshadowId: "F01" as ForeshadowId,
        label: "预埋",
        intent: "第二卷用",
        weight: "main",
        visibility: "overt",
        expectedBy: 30,
        anchor: { chapter: 0, quote: "", offsetHint: -1, occurrence: 0 },
      },
    });
    const p = project({
      events: s.effective(),
      currentChapter: 1,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    expect(p.foreshadows[0]?.status).toBe("planned");
  });
});

describe("投影：情节线断线阈值按权重派生", () => {
  it("主线 3 章、支线 12 章", () => {
    const s = freshStream();
    const p = project({
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    expect(p.plotLines.find((l) => l.id === "P01")?.gapLimit).toBe(3);
    expect(p.plotLines.find((l) => l.id === "P02")?.gapLimit).toBe(12);
  });

  it("currentGap 从最近推进章算起", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    s.decideChapter(53, "committed");
    const p = project({
      events: s.effective(),
      currentChapter: 60,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    expect(p.plotLines.find((l) => l.id === "P01")?.currentGap).toBe(7);
  });
});

describe("投影：人物弧线与状态", () => {
  it("presence 只存有出场的章，不是稠密数组", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    s.decideChapter(53, "committed");
    const p = project({
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    const arc = p.arcs.find((a) => a.characterId === "C01");
    expect(arc?.presence).toHaveLength(1);
    expect(arc?.lastSeenAt).toBe(53);
    // 从未出场的角色回落到 introducedAt
    expect(p.arcs.find((a) => a.characterId === "C03")?.presence).toHaveLength(0);
  });

  it("state 块由事件流算出，location 只接受设定 ID", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    s.decideChapter(53, "committed");
    const st = projectCharacterState(s.effective(), "C01", 1);
    expect(st.condition).toBe("断剑折断");
    expect(st.location).toBe("S01");
    expect(st.appearanceCount).toBe(1);
  });

  it("location 收到自由文本时置空而非污染 state", () => {
    const s = freshStream();
    seedCommitted(s, {
      chapter: 10,
      origin: "C5_declaration",
      payload: {
        type: "character_state_changed",
        characterId: "C01",
        field: "location",
        from: null,
        to: "青州城外的破庙",
        anchor: { chapter: 10, quote: "破庙", offsetHint: 0, occurrence: 0 },
      },
    });
    expect(projectCharacterState(s.effective(), "C01", 1).location).toBeNull();
  });
});

describe("投影：关系图保留沿革", () => {
  it("同一对人物多次变更时保留 history，kind 取最新", () => {
    const s = freshStream();
    for (const [chapter, kind, note] of [
      [9, "hostile", "初次交手"],
      [30, "acquaintance", "暂时休战"],
      [53, "ally", "暂时结盟"],
    ] as const) {
      seedCommitted(s, {
        chapter,
        origin: "C5_declaration",
        payload: {
          type: "relation_changed",
          from: "C01",
          to: "C02",
          fromKind: null,
          toKind: kind,
          note,
          anchor: { chapter, quote: note, offsetHint: 0, occurrence: 0 },
        },
      });
    }
    const p = project({
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    });
    const edge = p.relations[0];
    expect(edge?.kind).toBe("ally");
    expect(edge?.changedAt).toBe(53);
    expect(edge?.history).toHaveLength(3);
  });
});

describe("投影：全量重放确定性", () => {
  it("同一事件流两次投影结果完全相同", () => {
    const s = freshStream();
    const { declaration } = parseC5(raw, ctx);
    commitDeclaration(s, 53, declaration);
    s.decideChapter(53, "committed");
    const input = {
      events: s.effective(),
      currentChapter: 53,
      characterProfiles: profiles,
      plotLineDefs: plotDefs,
      plotLineGap: GAP,
    };
    expect(JSON.stringify(project(input))).toBe(JSON.stringify(project(input)));
  });
});
