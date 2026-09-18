/**
 * 跨多章返修（差距第 5 项下半场）。
 *
 * 这一批要补的窟窿写在旧代码的报错文案里：`draft-revisions.ts` 原先直接挡死早章
 * 返修，理由是「更早章节需先分析后续影响」—— 分析就是这里要做的东西。
 *
 * 三条最要紧的断言：
 *   ① **硬矛盾由代码判定，不问模型**：悬空兑现、死人再出场、状态/关系链断裂，
 *      判据全在结构事实里，免费且确定。
 *   ② **不靠情节线把后面所有章都圈进来**。改一章的事件不足以指认第 40 章受影响；
 *      圈一堆无关章等于没圈，作者会关掉整个功能。正文层面的牵连交给模型逐章查。
 *   ③ **同一章再被改一次，已处理的标记要重新亮起**。指纹变了就是新的一次影响。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import { EventStream } from "../src/store/event-stream.js";
import { draftRevisionToken } from "../src/task/revision.js";
import { diffDeclarations, impactedChapters, type LaterChapter } from "../src/revise/impact.js";
import { parseLocateVerdict } from "../src/revise/locate.js";
import { ChapterWriteError } from "../src/server/chapter-input.js";
import type { C5Declaration, StructuralEventPayload } from "../src/types/events.js";
import type { ChapterNo } from "../src/types/primitives.js";
import { CH1, CH2, NO_MODEL_REVIEW, PROSE, fakeClient, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const anchor = (chapter: ChapterNo, quote: string): { chapter: ChapterNo; quote: string; offsetHint: number; occurrence: number } =>
  ({ chapter, quote, offsetHint: 0, occurrence: 0 });

function decl(parts: Partial<C5Declaration> = {}): C5Declaration {
  return {
    events: [], foreshadowPlanted: [], foreshadowResolved: [],
    relationsChanged: [], characterStates: [], characterPresence: [],
    ...parts,
  };
}

const planted = (id: string, chapter: ChapterNo, label = "青铜钥匙"): C5Declaration["foreshadowPlanted"][number] => ({
  type: "foreshadow_planted", foreshadowId: id as never, label, intent: "这把钥匙将来要打开宗门密库。",
  weight: "main", visibility: "covert", expectedBy: (chapter + 2) as ChapterNo, anchor: anchor(chapter, "青铜钥匙放在桌上"),
});

const later = (chapter: ChapterNo, payloads: readonly StructuralEventPayload[]): LaterChapter => ({ chapter, payloads });

// ── 代码通道：结构差异与受影响章 ────────────────────────────────────────

describe("跨章返修·代码判定的硬矛盾", () => {
  it("删掉伏笔埋设后，后面兑现它的章是悬空兑现", () => {
    const changes = diffDeclarations(decl({ foreshadowPlanted: [planted("F01", 1)] }), decl());
    expect(changes).toMatchObject([{ kind: "foreshadow_planted", direction: "removed", subject: "F01" }]);

    const impacts = impactedChapters(1, changes, [
      later(2, [{ type: "character_presence", characterId: "C01" as never, role: "pov" }]),
      later(3, [{ type: "foreshadow_resolved", foreshadowId: "F01" as never, completeness: "full", anchor: anchor(3, "严丝合缝") }]),
    ]);

    const third = impacts.find((i) => i.chapter === 3);
    expect(third?.severity).toBe("conflict");
    expect(third?.reasons.map((r) => r.rule)).toContain("dangling_resolution");
    // 紧接的下一章总要复核，但那是 review 不是 conflict。
    expect(impacts.find((i) => i.chapter === 2)?.severity).toBe("review");
  });

  it("改了生死状态，而后面章节里这个人还有戏份", () => {
    const before = decl();
    const after = decl({
      characterStates: [{ type: "character_state_changed", characterId: "C02" as never, field: "vital", from: "活着", to: "死亡", anchor: anchor(5, "血刀客倒下") }],
    });
    const impacts = impactedChapters(5, diffDeclarations(before, after), [
      later(6, [{ type: "character_presence", characterId: "C01" as never, role: "pov" }]),
      later(8, [{ type: "character_presence", characterId: "C02" as never, role: "major" }]),
    ]);

    const eighth = impacts.find((i) => i.chapter === 8);
    expect(eighth?.severity).toBe("conflict");
    expect(eighth?.reasons.map((r) => r.rule)).toContain("vital_changed");
    expect(eighth?.reasons.find((r) => r.rule === "vital_changed")?.text).toContain("C02");
  });

  it("后面章节的状态变化接在被改掉的那个值上，链就断了", () => {
    const state = (to: string): C5Declaration => decl({
      characterStates: [{ type: "character_state_changed", characterId: "C01" as never, field: "condition", from: null, to, anchor: anchor(5, "毒伤") }],
    });
    const impacts = impactedChapters(5, diffDeclarations(state("毒伤未愈"), state("毒已解")), [
      later(7, [{ type: "character_state_changed", characterId: "C01" as never, field: "condition", from: "毒伤未愈", to: "痊愈", anchor: anchor(7, "痊愈") }]),
    ]);

    const seventh = impacts.find((i) => i.chapter === 7);
    expect(seventh?.severity).toBe("conflict");
    expect(seventh?.reasons.map((r) => r.rule)).toContain("state_chain_broken");
  });

  it("后面章节的关系变化接在被改掉的那一档上，链也断了", () => {
    const relation = (toKind: "ally" | "hostile"): C5Declaration => decl({
      relationsChanged: [{ type: "relation_changed", from: "C01" as never, to: "C02" as never, fromKind: null, toKind, note: "结盟", anchor: anchor(5, "并肩") }],
    });
    const impacts = impactedChapters(5, diffDeclarations(relation("ally"), relation("hostile")), [
      later(9, [{ type: "relation_changed", from: "C01" as never, to: "C02" as never, fromKind: "ally", toKind: "hostile", note: "翻脸", anchor: anchor(9, "拔剑") }]),
    ]);

    expect(impacts.find((i) => i.chapter === 9)?.reasons.map((r) => r.rule)).toContain("relation_chain_broken");
  });
});

describe("跨章返修·不把无关的后续章圈进来", () => {
  it("只改了事件叙述，不因为同一条情节线就圈住远处的章", () => {
    const event = (summary: string): C5Declaration => decl({
      events: [{ type: "plot_event", kind: "action", summary, weight: 2, plotLine: "P01" as never, participants: ["C01" as never], anchor: anchor(5, "夺剑") }],
    });
    const changes = diffDeclarations(event("李长风夺下断剑"), event("李长风让血刀客夺走断剑"));
    expect(changes.map((c) => c.kind)).toContain("plot_event");

    const impacts = impactedChapters(5, changes, [
      later(6, []),
      later(20, [{ type: "plot_event", kind: "action", summary: "断剑再现", weight: 2, plotLine: "P01" as never, participants: ["C01" as never], anchor: anchor(20, "断剑") }]),
    ]);

    // 紧接的第 6 章要复核；第 20 章只是同一条线上的事件，代码指认不了，交给作者自行点查。
    expect(impacts.map((i) => i.chapter)).toEqual([6]);
    expect(impacts[0]?.reasons.map((r) => r.rule)).toEqual(["next_chapter"]);
  });

  it("结构事实没有变化就没有影响", () => {
    const same = decl({ foreshadowPlanted: [planted("F01", 1)] });
    expect(diffDeclarations(same, decl({ foreshadowPlanted: [planted("F01", 1)] }))).toEqual([]);
    expect(impactedChapters(1, [], [later(2, []), later(3, [])])).toEqual([]);
  });
});

// ── 模型通道：定位受影响段落 ────────────────────────────────────────────

describe("跨章返修·定位受影响段落", () => {
  const TEXT = "李长风摸出那把青铜钥匙，齿缝里的红泥还在。他把钥匙递给守夜人，转身走进雨里。";

  it("引文逐字在正文里才算数", () => {
    const result = parseLocateVerdict({
      passages: [{ quote: "他把钥匙递给守夜人", why: "第 5 章已经改成钥匙当场被夺走", suggestion: "改为他摸了个空，钥匙已经不在身上。" }],
    }, TEXT);

    expect(result.passages).toEqual([{
      quote: "他把钥匙递给守夜人",
      why: "第 5 章已经改成钥匙当场被夺走",
      suggestion: "改为他摸了个空，钥匙已经不在身上。",
    }]);
    expect(result.notes).toEqual([]);
  });

  it("引文在正文里找不到就丢弃，并说清丢了几条", () => {
    const result = parseLocateVerdict({
      passages: [
        { quote: "他将钥匙交给了守夜人", why: "复述而非逐字引用", suggestion: "改掉" },
        { quote: "转身走进雨里", why: "这一段依赖被改掉的事实", suggestion: "补一句交代" },
      ],
    }, TEXT);

    expect(result.passages.map((p) => p.quote)).toEqual(["转身走进雨里"]);
    expect(result.notes.join("")).toContain("1");
  });

  it("输出不成形时不编造结果", () => {
    const result = parseLocateVerdict({ passages: "x" }, TEXT);
    expect(result.passages).toEqual([]);
    expect(result.notes.length).toBe(1);
  });
});

// ── 清单、解锁与连写闸门 ────────────────────────────────────────────────

/** 三章已采用的作品：第 1 章埋 F01/F02，第 3 章兑现 F01。 */
function project(): { root: string; session: ProjectSession; drafts: DraftStore } {
  const root = mkdtempSync(join(tmpdir(), "nf-revise-"));
  roots.push(root);
  const base = writingSnapshot();
  const stream = EventStream.restore([...base.events]);
  stream.append({ chapter: 3, origin: "C5_declaration", provenance: "proposed", payload: { type: "foreshadow_resolved", foreshadowId: "F01" as never, completeness: "full", anchor: anchor(3, "钥匙的齿缝与锁眼严丝合缝") } });
  stream.append({ chapter: 3, origin: "C5_declaration", provenance: "proposed", payload: { type: "character_presence", characterId: "C01" as never, role: "pov" } });
  stream.decideChapter(3, "committed");
  new ProjectStore(root).save({ ...base, events: stream.all(), chapters: new Map([[1, CH1], [2, CH2], [3, PROSE]]) });

  const drafts = new DraftStore(root);
  drafts.saveDraft(savedDraft({ chapter: 1, draftId: "ch1d1", status: "adopted", body: CH1, baseAdoptedThrough: 1 }));
  drafts.saveDraft(savedDraft({ chapter: 2, draftId: "ch2d1", status: "adopted", body: CH2, baseAdoptedThrough: 2 }));
  return { root, session: new ProjectSession(root, NO_MODEL_REVIEW), drafts };
}

/** 第 1 章的又一稿：把 F01 补回去，但改了当初的意图 —— 第 3 章的兑现要跟着重看。 */
function replantedF01(draftId: string, baseVersion: number): Parameters<DraftStore["saveDraft"]>[0] {
  const revised = { ...planted("F01", 1), intent: "这把钥匙改为打开守夜人自己的箱子。" };
  return savedDraft({
    chapter: 1, draftId, status: "ready", acceptable: true, baseVersion, baseAdoptedThrough: 1,
    body: `${CH1}钥匙被守夜人当场收了回去，又塞回他手里。`,
    declaration: decl({ foreshadowPlanted: [revised, planted("F02", 1, "钥匙上的红泥")] }),
  });
}

/** 第 1 章的新稿：不再埋下 F01。 */
function withoutF01(draftId: string, baseVersion: number): Parameters<DraftStore["saveDraft"]>[0] {
  return savedDraft({
    chapter: 1, draftId, status: "ready", acceptable: true, baseVersion, baseAdoptedThrough: 1,
    body: `${CH1}钥匙被守夜人当场收了回去。`,
    declaration: decl({ foreshadowPlanted: [planted("F02", 1, "钥匙上的红泥")] }),
  });
}

describe("跨章返修·清单与解锁", () => {
  it("改早章会落下返修清单，改最新章不会", () => {
    const { session, drafts } = project();
    drafts.saveDraft(withoutF01("ch1d2", 0));
    session.adopt(1, "ch1d2", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d2")!) });

    const view = session.revise.view();
    expect(view.conflicts).toBe(1);
    const third = view.chapters.find((c) => c.chapter === 3);
    expect(third?.state).toBe("pending");
    expect(third?.severity).toBe("conflict");
    expect(third?.triggers.map((t) => t.chapter)).toEqual([1]);
    expect(third?.changes.join("")).toContain("青铜钥匙");

    // 最新章（第 3 章）没有下游，采用它不产生新的返修项。
    drafts.saveDraft(savedDraft({ chapter: 3, draftId: "ch3d9", status: "ready", acceptable: true, body: `${PROSE}他合上密库的门。`, baseVersion: drafts.workVersion(), baseAdoptedThrough: 3, declaration: decl() }));
    const before = session.revise.view().chapters.length;
    session.adopt(3, "ch3d9", { revisionToken: draftRevisionToken(drafts.loadDraft(3, "ch3d9")!) });
    expect(session.revise.view().chapters.length).toBe(before);
  });

  it("采用前可以预览影响，预览不落盘", () => {
    const { session, drafts } = project();
    drafts.saveDraft(withoutF01("ch1d2", 0));

    const preview = session.revise.preview({ chapter: 1, draftId: "ch1d2" });
    expect(preview.chapters.find((c) => c.chapter === 3)?.severity).toBe("conflict");
    expect(session.revise.view().chapters).toEqual([]);
  });

  it("标记已处理之后，同一章再被改一次要重新亮起", () => {
    const { session, drafts } = project();
    drafts.saveDraft(withoutF01("ch1d2", 0));
    session.adopt(1, "ch1d2", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d2")!) });

    expect(session.revise.resolve({ chapter: 3 }).state).toBe("resolved");
    expect(session.revise.view().conflicts).toBe(0);

    drafts.saveDraft(replantedF01("ch1d3", 1));
    session.adopt(1, "ch1d3", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d3")!) });
    const again = session.revise.view().chapters.find((c) => c.chapter === 3);
    expect(again?.state).toBe("pending");
    // 伏笔补回去了，硬矛盾随之消失，但意图变了仍要作者再读一遍。
    expect(again?.severity).toBe("review");
  });

  it("只改正文不改结构，也要让紧接的下一章复核", () => {
    const { session, drafts } = project();
    drafts.saveDraft(savedDraft({
      chapter: 1, draftId: "ch1d2", status: "ready", acceptable: true, baseVersion: 0, baseAdoptedThrough: 1,
      body: `${CH1}雨从屋檐上落下来。`,
      declaration: session.revise.adoptedDeclaration(1),
    }));
    session.adopt(1, "ch1d2", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d2")!) });

    const view = session.revise.view();
    expect(view.chapters.map((c) => c.chapter)).toEqual([2]);
    expect(view.conflicts).toBe(0);
    expect(view.chapters[0]?.changes.join("")).toContain("正文有改动");
    // 代码圈不出的章由作者自己点；latest 就是那条线索。
    expect(view.latest?.chapter).toBe(1);
  });

  it("有未处理的硬矛盾时，连写拒绝开始", () => {
    const { session, drafts } = project();
    drafts.saveDraft(withoutF01("ch1d2", 0));
    session.adopt(1, "ch1d2", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d2")!) });

    expect(() => session.run.start({ through: 4 })).toThrow(ChapterWriteError);
    try { session.run.start({ through: 4 }); } catch (error) { expect((error as Error).message).toContain("第 3 章"); }

    session.revise.resolve({ chapter: 3 });
    // 处理过之后闸门放行；这里只验证不再被返修挡下（后续前置条件另行报错）。
    try { session.run.start({ through: 4 }); } catch (error) { expect((error as Error).message).not.toContain("返修"); }
  });

  it("更早章节的已采用稿现在可以直接返修", () => {
    const { session, drafts } = project();
    const source = drafts.loadDraft(2, "ch2d1")!;
    const revised = session.editDraft({
      chapter: 2, draftId: "ch2d1", revisionToken: draftRevisionToken(source),
      body: `${CH2}他把旧图折好收进怀里。`, summary: "补一句收图的动作",
    });
    expect(revised.chapter).toBe(2);
    expect(revised.draftId).not.toBe("ch2d1");
  });

  it("代码圈不到的章，作者也能自己点查", async () => {
    const { root, session: base, drafts } = project();
    // 第 4 章与第 1 章没有任何结构关联，也不紧接着它 —— 代码指认不出来。
    base.putChapter(4, "李长风把旧账本摊在灯下，钥匙的事他一个字没提。");
    drafts.saveDraft(withoutF01("ch1d2", 0));
    base.adopt(1, "ch1d2", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d2")!) });
    expect(base.revise.view().chapters.map((c) => c.chapter)).toEqual([2, 3]);

    const { client, calls } = fakeClient([modelText(JSON.stringify({ passages: [] }))]);
    const session = new ProjectSession(root, NO_MODEL_REVIEW, { client });
    const located = await session.revise.locate({ chapter: 4 });

    expect(located.state).toBe("located");
    expect(located.reasons).toEqual([]);
    // 手动点查同样要把「前面改了什么」交给模型，否则它无从判断。
    expect(JSON.stringify(calls[0]?.messages)).toContain("青铜钥匙");
  });

  it("定位受影响段落把变化清单交给模型，并落进清单", async () => {
    const { root, session: base, drafts } = project();
    drafts.saveDraft(withoutF01("ch1d2", 0));
    base.adopt(1, "ch1d2", { revisionToken: draftRevisionToken(drafts.loadDraft(1, "ch1d2")!) });

    const { client, calls } = fakeClient([modelText(JSON.stringify({
      passages: [{ quote: "钥匙的齿缝与锁眼严丝合缝", why: "第 1 章已经不再埋下这把钥匙", suggestion: "改为他另寻他法打开密库，或在前文补回钥匙的来历。" }],
    }))]);
    const session = new ProjectSession(root, NO_MODEL_REVIEW, { client });
    const located = await session.revise.locate({ chapter: 3 });

    expect(JSON.stringify(calls[0]?.messages)).toContain("青铜钥匙");
    expect(JSON.stringify(calls[0]?.messages)).toContain(PROSE);
    expect(located.state).toBe("located");
    expect(located.passages[0]?.suggestion).toContain("密库");
    expect(session.revise.view().chapters.find((c) => c.chapter === 3)?.passages.length).toBe(1);
  });
});
