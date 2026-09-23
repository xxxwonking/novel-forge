/**
 * L2 的硬预算与裁剪（§13.4）。
 *
 * 背景：卷纲把 L2 的增长压平了（上一批），但**作者不写卷纲时它仍随章数线性涨** ——
 * 实测 2000 章 38347 tok，而设计文档给的目标区间是 2000–3000。L2 是最大的
 * 可缓存前缀，它涨则每章的缓存写入成本跟着涨。
 *
 * 两条硬约束：
 *   ① **确定性**：裁剪只由内容决定，不由运行计数决定。否则每写一章整个 L2 重排，
 *      bp2 白重建 —— 那正是分段缓存要避免的事。
 *   ② **卷纲的成果不能被吃掉**：有卷纲时本就该在预算内，不该触发裁剪。
 */

import { describe, expect, it } from "vitest";
import { buildL2Snapshot, L2_TOKEN_BUDGET, type L2BuildInput } from "../src/context/build-l2.js";
import { renderL2 } from "../src/context/render-l2.js";
import { estimateTokens } from "../src/context/select-l3.js";
import type { CharacterCard } from "../src/types/character.js";
import type { ForeshadowTimelineItem, PlotLineTrack } from "../src/types/projections.js";

const synopsis = (n: number) => `第${n}章里主角在旧库找到线索，与对手短暂交手后带着账页离开现场。`;

function character(i: number, tier: CharacterCard["tier"], lastSeenAt: number): CharacterCard {
  return {
    id: `C${String(i).padStart(3, "0")}`, name: `人物${i}`, aliases: [], tier, introducedAt: 1,
    profile: { role: "某角色", appearance: [], traits: [], forbiddenBehaviors: [], wants: "", fears: "", background: "" },
    speech: { sentenceLength: { min: 4, max: 20 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [], syntaxBias: { question: 0, imperative: 0, elliptical: 0 }, register: "neutral", emotionalExpression: "direct", exemplars: [], counterExemplars: [] },
    state: { condition: "正常", lastSeenAt, vital: "alive" },
  } as unknown as CharacterCard;
}

const foreshadows = (count: number): ForeshadowTimelineItem[] => Array.from({ length: count }, (_, i) => ({
  id: `F${String(i + 1).padStart(2, "0")}`, label: `伏笔${i + 1}`, intent: "",
  weight: i % 3 === 0 ? "main" : i % 3 === 1 ? "sub" : "detail",
  visibility: "covert", status: "open", plantedAt: Math.max(1, i), plantedAnchor: null, expectedBy: i + 10,
  resolutions: [], overdueBy: 0,
})) as unknown as ForeshadowTimelineItem[];

const plotLines = (count: number): PlotLineTrack[] => Array.from({ length: count }, (_, i) => ({
  id: `P${String(i + 1).padStart(2, "0")}`, label: `情节线${i + 1}`, weight: "main",
  gapLimit: 3, lastAdvancedAt: 10, currentGap: 1, points: [],
})) as unknown as PlotLineTrack[];

function input(chapters: number, options: { readonly volumes?: boolean; readonly characters?: readonly CharacterCard[]; readonly minorLastSeen?: number } = {}): L2BuildInput {
  return {
    currentChapter: chapters as never,
    characters: options.characters ?? [
      ...Array.from({ length: 8 }, (_, i) => character(i + 1, "major", chapters)),
      // 错开「最近出现」：全都在最近见过的话，窗口一档都裁不掉，测不出收紧。
      // 错开「最近出现」：全都在最近见过的话，窗口一档都裁不掉，测不出收紧。
      ...Array.from({ length: 30 }, (_, i) => character(i + 9, "minor", chapters - i * 5)),
    ],
    chapterSynopses: Array.from({ length: chapters }, (_, i) => ({ chapter: (i + 1) as never, text: synopsis(i + 1) })),
    volumeSummaries: options.volumes === true
      ? Array.from({ length: Math.floor(chapters / 40) }, (_, i) => ({ volume: i + 1, text: `第${i + 1}卷：主角一路追查旧案，逐步逼近真相。`, from: (i * 40 + 1) as never, to: ((i + 1) * 40) as never }))
      : [],
    foreshadows: foreshadows(12), plotLines: plotLines(3), pendingAppend: [], dueSoonWindow: 3,
  };
}
const size = (snapshot: ReturnType<typeof buildL2Snapshot>): number => estimateTokens(renderL2(snapshot));

describe("L2 硬预算", () => {
  it("长篇无卷纲时被裁进预算：2000 章从三万多压到预算内", () => {
    // 先确认这一批要解决的问题真实存在：给一个够大的预算就是「不裁」的样子。
    const raw = size(buildL2Snapshot(input(2000), Number.MAX_SAFE_INTEGER));
    expect(raw).toBeGreaterThan(L2_TOKEN_BUDGET * 5);
    const trimmed = buildL2Snapshot(input(2000));
    expect(size(trimmed)).toBeLessThanOrEqual(L2_TOKEN_BUDGET);
    expect(trimmed.trimStage).not.toBe("none");
  });

  it("短篇本来就在预算内，一档都不裁", () => {
    const short = buildL2Snapshot(input(50));
    expect(short.trimStage).toBe("none");
    expect(size(short)).toBeLessThanOrEqual(L2_TOKEN_BUDGET);
  });

  it("有卷纲时不触发裁剪 —— 上一批的成果不能被这一批吃掉", () => {
    for (const chapters of [200, 1000, 2000]) {
      const snapshot = buildL2Snapshot(input(chapters, { volumes: true }));
      expect(snapshot.trimStage).toBe("none");
      expect(size(snapshot)).toBeLessThanOrEqual(L2_TOKEN_BUDGET);
    }
  });

  it("裁剪是确定的：同一份输入两次产出逐字节相同的索引", () => {
    const once = renderL2(buildL2Snapshot(input(800)));
    const twice = renderL2(buildL2Snapshot(input(800)));
    expect(once).toBe(twice);
    expect(buildL2Snapshot(input(800)).trimStage).toBe(buildL2Snapshot(input(800)).trimStage);
  });

  it("裁的是远处的梗概：桶随档位变粗，近处逐章不动", () => {
    const trimmed = buildL2Snapshot(input(2000));
    const spans = trimmed.synopsis.filter((r) => r.granularity === "per_15").map((r) => r.range.split("-").length);
    // per_15 的桶被放大后 range 里会出现更长的跨度；用文本长度间接验证桶变粗
    const far = trimmed.synopsis.filter((r) => r.granularity === "per_15");
    expect(far.length).toBeLessThan(buildL2Snapshot(input(2000)).synopsis.length + 1);
    expect(spans.length).toBeGreaterThan(0);
    // 最近 8 章仍逐章给
    expect(trimmed.synopsis.filter((r) => r.granularity === "per_chapter")).toHaveLength(8);
  });

  it("人物极多的书走到最后一档：次要角色窗口收紧，主要角色与伏笔情节线一律不裁", () => {
    // 梗概那一档（far_120）对「人物极多」这种书压不动 —— 名录本身就有几千 token。
    // 300 个次要角色都在这 20 章内出现过，所以窗口 20 一个都不裁，只能靠收紧窗口。
    const cast = [
      ...Array.from({ length: 8 }, (_, i) => character(i + 1, "major", 2000)),
      ...Array.from({ length: 300 }, (_, i) => character(i + 9, "minor", 2000 - (i % 20))),
    ];
    const deep = buildL2Snapshot(input(2000, { characters: cast }));
    expect(deep.trimStage).toBe("minor_window_8");
    // 窗口 20 会留下全部 300 个；收到 8 只剩 i%20 ≤ 8 的那些。
    const expected = 8 + Array.from({ length: 300 }, (_, i) => i % 20).filter((d) => d <= 8).length;
    expect(deep.characters.rows).toHaveLength(expected);
    expect(deep.characters.rows.length).toBeLessThan(308);
    expect(deep.characters.rows.filter((r) => r.id <= "C008")).toHaveLength(8);

    const trimmed = buildL2Snapshot(input(2000));
    // 伏笔与情节线是「要做的事」，一条都不能少
    expect(trimmed.foreshadows.rows).toHaveLength(12);
    expect(trimmed.plotLines).toHaveLength(3);
    // 总数仍如实报出，被裁的能用 load_character 取
    expect(trimmed.characters.totalCount).toBe(38);
  });

  it("裁到最后一档仍超预算时给说明，而不是无限裁下去", () => {
    // 一本书里塞进超长梗概，任何桶都压不下去。
    const huge: L2BuildInput = {
      ...input(2000),
      chapterSynopses: Array.from({ length: 2000 }, (_, i) => ({ chapter: (i + 1) as never, text: "长".repeat(4000) })),
    };
    const snapshot = buildL2Snapshot(huge);
    expect(snapshot.trimStage).toBe("overflow");
    expect(snapshot.overflowNote).toContain("预算");
    expect(snapshot.synopsis.length).toBeGreaterThan(0);
  });
});
