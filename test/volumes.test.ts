/**
 * 卷/部结构（差距第 6 项）。
 *
 * 这一批的实质不是「补个入口」：`Beat.volume` 早就有，但**卷纲既没有存储、
 * 在 L2 里也是叠加而不是顶替** —— 加了卷纲 L2 反而更大，正好与它的用意相反。
 * 所以测试的重心在两处：卷纲确实顶替掉那几章，以及边界只有一份真相。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildL2Snapshot, type L2BuildInput } from "../src/context/build-l2.js";
import { renderL2 } from "../src/context/render-l2.js";
import { estimateTokens } from "../src/context/select-l3.js";
import { volumeRanges, volumeOf } from "../src/beat/volumes.js";
import { loadRules } from "../src/rules/load.js";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { buildChapterRunInput } from "../src/server/chapter-input.js";
import type { ChapterBeat } from "../src/types/beat.js";
import { NO_MODEL_REVIEW, WRITE_BEAT, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const due = loadRules().crossChapter.foreshadowDueSoon;
const synopses = (n: number) => Array.from({ length: n }, (_, i) => ({ chapter: (i + 1) as never, text: `第 ${i + 1} 章：李长风又查到一条线索。` }));
const base = (n: number): L2BuildInput => ({
  currentChapter: n as never, characters: [], chapterSynopses: synopses(n),
  volumeSummaries: [], foreshadows: [], plotLines: [], pendingAppend: [], dueSoonWindow: due,
});
const beat = (chapter: number, volume: number): ChapterBeat => ({ ...WRITE_BEAT, chapter: chapter as never, volume });

describe("卷纲顶替远距离梗概", () => {
  it("有卷纲的章段不再逐桶列出，L2 因此变小", () => {
    const input = base(100);
    const without = renderL2(buildL2Snapshot(input));
    const with_ = renderL2(buildL2Snapshot({ ...input, volumeSummaries: [
      { volume: 1, text: "被逐出师门到查明师父死于内应之手。", from: 1, to: 30 },
      { volume: 2, text: "结识血刀客，得知青云门灭门旧案。", from: 31, to: 60 },
    ] }));
    // 回归的靶子：改之前两者是叠加的，加了卷纲反而更长。
    expect(estimateTokens(with_)).toBeLessThan(estimateTokens(without));
    expect(with_).toContain("卷1");
    // 被顶替的章不再单独出现，没被顶替的仍在。
    expect(with_).not.toContain("第 5 章：");
    expect(with_).toContain("第 95 章：");
  });

  it("卷纲是空串就不顶替 —— 否则等于把那几章直接抹掉", () => {
    const input = base(100);
    const snap = buildL2Snapshot({ ...input, volumeSummaries: [{ volume: 1, text: "   ", from: 1, to: 30 }] });
    expect(renderL2(snap)).toContain("第 5 章：");
  });

  it("一卷横跨远距离与中距离时不顶替 —— 否则同一卷会出现两次且粒度不同", () => {
    // currentChapter=100，中距离从第 71 章起。卷 3 覆盖 61-90，跨了界。
    const snap = buildL2Snapshot({ ...base(100), volumeSummaries: [{ volume: 3, text: "卷三纲。", from: 61, to: 90 }] });
    const text = renderL2(snap);
    expect(text).not.toContain("卷3");
    expect(text).toContain("第 75 章：");
  });

  it("多卷按卷号排，顺序稳定（缓存前缀不能因传入顺序而变）", () => {
    const vols = [
      { volume: 2, text: "卷二纲。", from: 31, to: 60 },
      { volume: 1, text: "卷一纲。", from: 1, to: 30 },
    ];
    const a = renderL2(buildL2Snapshot({ ...base(100), volumeSummaries: vols }));
    const b = renderL2(buildL2Snapshot({ ...base(100), volumeSummaries: [...vols].reverse() }));
    expect(a).toBe(b);
    expect(a.indexOf("卷一纲")).toBeLessThan(a.indexOf("卷二纲"));
  });
});

describe("卷的边界只有一份真相", () => {
  it("章号范围由节拍表推出，卷号不连续、章号有缺口都算得对", () => {
    expect(volumeRanges([beat(1, 1), beat(2, 1), beat(9, 3), beat(5, 3)])).toEqual([
      { volume: 1, from: 1, to: 2 }, { volume: 3, from: 5, to: 9 },
    ]);
  });

  it("没有节拍表的章不猜它属于哪一卷", () => {
    expect(volumeOf([beat(1, 1)], 1 as never)).toBe(1);
    expect(volumeOf([beat(1, 1)], 7 as never)).toBeNull();
  });
});

/** 第 2 章属卷 1、第 3 章属卷 2 —— 写第 3 章就是跨卷第一章。正文只写到第 2 章。 */
function project(volumes: readonly { volume: number; title: string; summary: string; updatedAt: string }[]) {
  const root = mkdtempSync(join(tmpdir(), "nf-volumes-"));
  roots.push(root);
  const snapshot = writingSnapshot();
  new ProjectStore(root).save({
    ...snapshot, volumes,
    beats: snapshot.beats.map((b) => ({ ...b, volume: b.chapter >= 3 ? 2 : 1 })),
  });
  return new ProjectSession(root, NO_MODEL_REVIEW);
}

describe("卷纲进入写章上下文", () => {
  const card = (summary: string) => [{ volume: 1, title: "风起青州", summary, updatedAt: "2026-09-18T00:00:00.000Z" }];

  it("跨卷第一章用卷纲，而不是把上一卷每章梗概拼一遍", () => {
    const input = buildChapterRunInput(project(card("被逐出师门到查明内应。")), 3 as never);
    expect(input.assembleInput.l3.volumeBoundary?.summary).toBe("被逐出师门到查明内应。");
  });

  it("没写卷纲时退回拼逐章梗概 —— 兜底仍在，不是把功能撤掉", () => {
    const summary = buildChapterRunInput(project(card("")), 3 as never).assembleInput.l3.volumeBoundary?.summary ?? "";
    expect(summary).toContain("第 2 章：");
  });

  it("还没写完的卷不拿去顶替 L2：那一段会缺掉最近发生的事", () => {
    // 卷 2 只有第 3 章，而第 3 章还没写出来（chapters 只到 2）。
    const session = project([{ volume: 2, title: "落子", summary: "卷二纲。", updatedAt: "2026-09-18T00:00:00.000Z" }]);
    const input = buildChapterRunInput(session, 3 as never);
    expect(input.assembleInput.l2.synopsis.some((row) => row.range === "卷2")).toBe(false);
  });
});

describe("卷纲的落盘与确认", () => {
  const draft = (session: ProjectSession, changes: unknown) =>
    session.preparation.propose({ summary: "改卷", baseFingerprint: session.preparation.fingerprint(), changes });

  it("卷名与卷纲存进 volumes.json，重开仍在", () => {
    const session = project([]);
    const proposal = draft(session, { volumes: [{ volume: 1, title: "风起青州", summary: "被逐出师门到查明内应。" }] });
    session.preparation.confirm(proposal.id);
    const reopened = new ProjectSession((session as unknown as { root: string }).root, NO_MODEL_REVIEW);
    expect(reopened.meta.volumes).toEqual([
      expect.objectContaining({ volume: 1, title: "风起青州", summary: "被逐出师门到查明内应。" }),
    ]);
  });

  it("给还没写到的卷写卷纲会被退回 —— 那是把规划当成已发生的事", () => {
    // 卷 2 只有第 3 章，正文还没写到。
    expect(() => draft(project([]), { volumes: [{ volume: 2, title: "落子", summary: "卷二纲。" }] }))
      .toThrow(/一章都还没写出来/u);
  });

  it("空卷纲可以先占个卷名，不受「已写完」限制", () => {
    expect(() => draft(project([]), { volumes: [{ volume: 2, title: "落子", summary: "" }] })).not.toThrow();
  });

  it("改卷界会提示按旧范围写的卷纲要重写", () => {
    const session = project([{ volume: 1, title: "风起青州", summary: "被逐出师门到查明内应。", updatedAt: "2026-09-18T00:00:00.000Z" }]);
    const beat = session.meta.beats.find((b) => b.chapter === 2)!;
    const proposal = draft(session, { beats: [{ chapter: 2, volume: 2, plan: beat.plan }] });
    expect(proposal.impacts.map((i) => i.message).join("｜")).toMatch(/卷 1 的范围变了/u);
  });
});
