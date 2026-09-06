/**
 * §13.8 的回归测试。
 *
 * 便宜，但能挡住绝大多数缓存事故 —— 缓存失效是静默的，只能靠
 * cache_read_input_tokens 掉到 0 才发现，而那时钱已经付了。
 */

import { describe, expect, it } from "vitest";
import { EXPECTED_TOOL_ORDER, WRITING_TOOLS } from "../src/context/tools.js";
import { L1_FORBIDDEN_PATTERN, renderL1 } from "../src/context/render-l1.js";
import { renderL2, renderL2Append } from "../src/context/render-l2.js";
import { buildL2Snapshot, type L2BuildInput } from "../src/context/build-l2.js";
import { renderL3, selectL3 } from "../src/context/select-l3.js";
import { renderVolatile } from "../src/context/render-volatile.js";
import { assemble } from "../src/context/assemble.js";
import { WRITING_DISCIPLINE } from "../src/context/discipline.js";
import {
  beat,
  chapterSynopses,
  characters,
  foreshadows,
  plotLines,
  previousChapterText,
  settings,
  volumeSummaries,
  workSetting,
} from "./fixtures.js";

const l1Input = { setting: workSetting, discipline: WRITING_DISCIPLINE };

const l2Input: L2BuildInput = {
  currentChapter: 52,
  characters,
  chapterSynopses,
  volumeSummaries: [...volumeSummaries],
  foreshadows,
  plotLines,
  pendingAppend: [],
};

const l3Input = {
  beat,
  characters: characters.filter((c) => beat.plan.characters.includes(c.id)),
  settings: settings.filter((s) => beat.plan.locations.includes(s.id)),
  volumeBoundary: null,
  plantedExcerpts: [
    {
      foreshadowId: "F03" as const,
      label: "生锈的钥匙",
      anchor: foreshadows[0]!.plantedAnchor,
      excerpt: "他把那把生锈的钥匙塞回怀里，铜锈在指腹上留了一道绿痕。",
    },
  ],
};

const volatileInput = {
  previous: { chapter: 52, headSummary: null, tailText: previousChapterText },
  beat,
  resolves: [
    {
      id: "F03" as const,
      label: "生锈的钥匙",
      intent: foreshadows[0]!.intent,
      weight: "main" as const,
      completeness: "full" as const,
    },
  ],
  avoid: [{ id: "F07" as const, label: "母亲的信" }],
  task: "写出第 53 章的第一场：破庙被围。",
};

function fullAssembleInput() {
  return {
    l1: l1Input,
    l2: buildL2Snapshot(l2Input),
    l3: selectL3(l3Input),
    volatile: volatileInput,
  };
}

describe("段 0：工具顺序固定", () => {
  it("工具名数组与期望顺序完全一致", () => {
    expect(WRITING_TOOLS.map((t) => t.name)).toEqual([...EXPECTED_TOOL_ORDER]);
  });

  it("工具定义里不含动态内容", () => {
    const json = JSON.stringify(WRITING_TOOLS);
    expect(json).not.toMatch(/\$\{|共\s*\d+\s*[人条章]|\d{4}-\d{2}-\d{2}/);
  });
});

describe("段 1：L1 不含动态内容", () => {
  it("渲染结果不含日期、章号、计数或进度", () => {
    expect(renderL1(l1Input)).not.toMatch(L1_FORBIDDEN_PATTERN);
  });

  it("同输入逐字节稳定", () => {
    expect(renderL1(structuredClone(l1Input))).toBe(renderL1(l1Input));
  });

  it("纪律条目变更会改变输出（确认纪律确实进了缓存前缀）", () => {
    const modified = {
      ...l1Input,
      discipline: { version: "d2", rules: [...WRITING_DISCIPLINE.rules.slice(1)] },
    };
    expect(renderL1(modified)).not.toBe(renderL1(l1Input));
  });
});

describe("段 2：L2 渲染逐字节稳定", () => {
  it("深拷贝快照渲染结果相同", () => {
    const snap = buildL2Snapshot(l2Input);
    expect(renderL2(structuredClone(snap))).toBe(renderL2(snap));
  });

  it("人物数组的输入顺序不影响输出（显式排序生效）", () => {
    const reversed = buildL2Snapshot({ ...l2Input, characters: [...characters].reverse() });
    expect(renderL2(reversed)).toBe(renderL2(buildL2Snapshot(l2Input)));
  });

  it("伏笔数组的输入顺序不影响输出", () => {
    const reversed = buildL2Snapshot({ ...l2Input, foreshadows: [...foreshadows].reverse() });
    expect(renderL2(reversed)).toBe(renderL2(buildL2Snapshot(l2Input)));
  });

  it("增量附加完全不影响 L2 稳定部分 —— bp2 挂在它之后", () => {
    const base = renderL2(buildL2Snapshot(l2Input));
    const appended = renderL2(
      buildL2Snapshot({
        ...l2Input,
        pendingAppend: [
          { chapter: 53, synopsis: "破庙被围，账本现名。", foreshadowDelta: ["F03 已收"], characterDelta: [] },
        ],
      }),
    );
    // 稳定部分逐字节相同，而非"前缀相同" —— 增量内容已被移出这个 block
    expect(appended).toBe(base);
  });

  it("增量区单独渲染，为空时输出空串（调用方不产生 block）", () => {
    expect(renderL2Append(buildL2Snapshot(l2Input))).toBe("");
    const withAppend = renderL2Append(
      buildL2Snapshot({
        ...l2Input,
        pendingAppend: [{ chapter: 53, synopsis: "一。", foreshadowDelta: [], characterDelta: [] }],
      }),
    );
    expect(withAppend).toContain("最新进展");
    expect(withAppend).toContain("ch53");
  });

  it("连续多次增量附加，稳定部分始终不变", () => {
    const base = renderL2(buildL2Snapshot(l2Input));
    let pending: { chapter: number; synopsis: string; foreshadowDelta: string[]; characterDelta: string[] }[] = [];
    for (let ch = 53; ch < 60; ch += 1) {
      pending = [...pending, { chapter: ch, synopsis: `第${ch}章。`, foreshadowDelta: [], characterDelta: [] }];
      expect(renderL2(buildL2Snapshot({ ...l2Input, pendingAppend: pending }))).toBe(base);
    }
  });

  it("已收伏笔不出现在未收清单里", () => {
    const out = renderL2(buildL2Snapshot(l2Input));
    expect(out).not.toContain("断剑的裂纹");
    expect(out).toContain("生锈的钥匙");
  });

  it("超出 20 章未出场的次要角色被裁剪，主要角色保留", () => {
    const out = renderL2(buildL2Snapshot(l2Input));
    // 玄机子 lastSeen=4，当前 52 章，超窗 → 裁掉
    expect(out).not.toContain("玄机子");
    // 茶摊老丈 lastSeen=51，在窗内 → 保留
    expect(out).toContain("茶摊老丈");
    // 苏晚晴 lastSeen=26 但 tier=major → 无论如何保留
    expect(out).toContain("苏晚晴");
  });

  it("章节梗概按距离衰减，近 8 章逐章、更早的分桶", () => {
    const snap = buildL2Snapshot(l2Input);
    const perChapter = snap.synopsis.filter((s) => s.granularity === "per_chapter");
    expect(perChapter).toHaveLength(8);
    expect(snap.synopsis.some((s) => s.granularity === "per_5")).toBe(true);
    expect(snap.synopsis.some((s) => s.granularity === "per_15")).toBe(true);
    // 52 章不衰减是 52 行；衰减后总行数应显著更少
    expect(snap.synopsis.length).toBeLessThan(30);
  });
});

describe("段 3：L3 渲染与裁剪", () => {
  it("同输入逐字节稳定", () => {
    expect(renderL3(selectL3(structuredClone(l3Input)))).toBe(renderL3(selectL3(l3Input)));
  });

  it("说话方式在压缩档下仍然保留（C6 依赖它）", () => {
    const tiny = selectL3(l3Input, 200);
    const out = renderL3(tiny);
    expect(tiny.trimStage).not.toBe("none");
    expect(out).toContain("说话方式");
    expect(out).toContain("句长");
  });

  it("压缩档去掉外貌与背景", () => {
    const compressed = selectL3(l3Input, 200);
    const out = renderL3(compressed);
    expect(out).not.toContain("外貌：");
    expect(out).not.toContain("背景：");
  });

  it("预算充足时不裁剪，且包含伏笔埋设原文", () => {
    const sel = selectL3(l3Input, 100_000);
    expect(sel.trimStage).toBe("none");
    expect(renderL3(sel)).toContain("生锈的钥匙");
  });

  it("预算极小时进 overflow 并给出可操作提示", () => {
    const sel = selectL3(l3Input, 1);
    expect(sel.trimStage).toBe("overflow");
    expect(sel.overflowNote).toContain("建议拆章");
  });
});

describe("段 4：易变区", () => {
  it("任务指令排在最后", () => {
    const out = renderVolatile(volatileInput);
    expect(out.lastIndexOf("# 任务")).toBeGreaterThan(out.indexOf("# 本章节拍"));
    expect(out.trimEnd().endsWith(volatileInput.task)).toBe(true);
  });

  it("上一章正文排在最前", () => {
    const out = renderVolatile(volatileInput);
    expect(out.indexOf("# 上一章")).toBe(0);
  });

  it("要收的伏笔带 intent 全文，暗线伏笔只给标签", () => {
    const out = renderVolatile(volatileInput);
    expect(out).toContain("这把钥匙开的是第三卷里三叔藏账本的密室");
    expect(out).toContain("母亲的信");
    expect(out).not.toContain("信里写明主角并非三叔亲侄");
  });

  it("预算阈值按 key 排序输出，不依赖对象构造顺序", () => {
    const reordered = {
      ...volatileInput,
      beat: {
        ...beat,
        budget: beat.budget === null ? null : { ...beat.budget },
      },
    };
    expect(renderVolatile(reordered)).toBe(renderVolatile(volatileInput));
  });
});

describe("装配：四段布局与 breakpoint", () => {
  it("装配输出逐字节稳定", () => {
    const a = assemble(fullAssembleInput());
    const b = assemble(fullAssembleInput());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("system 是数组形式的 text block 并挂了 cache_control", () => {
    const req = assemble(fullAssembleInput());
    expect(Array.isArray(req.system)).toBe(true);
    expect(req.system[0]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("breakpoint 总数不超过 4", () => {
    const req = assemble(fullAssembleInput());
    const inSystem = req.system.filter((b) => b.cache_control != null).length;
    const content = req.messages[0]?.content;
    const inMessages = Array.isArray(content)
      ? content.filter((b) => "cache_control" in b && b.cache_control != null).length
      : 0;
    expect(inSystem + inMessages).toBeLessThanOrEqual(4);
  });

  it("易变区是最后一个 block 且没有 cache_control", () => {
    const req = assemble(fullAssembleInput());
    const content = req.messages[0]?.content;
    expect(Array.isArray(content)).toBe(true);
    if (!Array.isArray(content)) return;
    const last = content[content.length - 1];
    expect(last && "cache_control" in last ? last.cache_control : undefined).toBeUndefined();
  });

  it("段 3 过短时与段 2 合并，避免浪费 breakpoint 在不会被缓存的段上", () => {
    const input = fullAssembleInput();
    const thin = assemble({
      ...input,
      l3: selectL3({ ...l3Input, characters: [], settings: [], plantedExcerpts: [] }),
    });
    const content = thin.messages[0]?.content;
    const blocks = Array.isArray(content) ? content.length : 0;
    // L3 为空 → 只有 L2 + 易变区两个 block
    expect(blocks).toBe(2);
  });
});
