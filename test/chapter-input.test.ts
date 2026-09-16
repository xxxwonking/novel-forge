import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectSession } from "../src/server/state.js";
import { buildChapterRunInput, buildChapterReadSource } from "../src/server/chapter-input.js";
import { ProjectStore } from "../src/store/persist.js";
import { EventStream } from "../src/store/event-stream.js";
import { DraftStore } from "../src/task/draft-store.js";
import { deriveBudget } from "../src/beat/derive.js";
import { assemble } from "../src/context/assemble.js";
import { C4_TASK } from "../src/chapter/pipeline.js";
import type { ChapterPlan } from "../src/types/beat.js";
import { CH1, CH2, WRITE_BEAT, declaration, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function seed(snapshot = writingSnapshot()): { root: string; session: ProjectSession } {
  const root = mkdtempSync(join(tmpdir(), "nf-write-input-"));
  roots.push(root);
  new ProjectStore(root).save(snapshot);
  return { root, session: new ProjectSession(root) };
}

describe("buildChapterRunInput", () => {
  it("装配已落盘的 L1、正式剧情与人物状态，并按节拍顺序选择 L3", () => {
    const snapshot = writingSnapshot();
    const { session } = seed(snapshot);
    const input = buildChapterRunInput(session, 3, { maxOutputTokens: 9000 });
    const { l1, l2, l3, volatile } = input.assembleInput;

    expect(l1).toEqual({ setting: snapshot.setting, discipline: snapshot.discipline });
    expect(l2.characters.rows.find((c) => c.id === "C01")?.condition).toBe("毒伤尚未痊愈");
    expect(l2.synopsis.map((s) => s.text)).toEqual(["李长风收下青铜钥匙", "血刀客交出密库旧图"]);
    expect(l3.characters.map((c) => c.card.id)).toEqual(["C02", "C01"]);
    expect(l3.settings.map((s) => s.id)).toEqual(["S02", "S01"]);
    expect(l3.characters.find((c) => c.card.id === "C01")?.card.speech).toEqual(snapshot.characters[0]?.speech);
    expect(volatile.previous).toEqual({ chapter: 2, headSummary: null, tailText: CH2 });
    expect(volatile.task).toBe(C4_TASK);
    expect(volatile.beat.budget).toEqual(deriveBudget(WRITE_BEAT.plan, snapshot.profile, session.rules, { now: WRITE_BEAT.updatedAt }));
    // 声音检查拿到的人物卡必须与 L3 装配的是同一批（节拍点名），
    // 否则会出现「模型没被告知这个人物，却被按他的声音表打分」。
    expect(input.gate?.profile).toEqual(snapshot.profile);
    expect(input.gate?.rules).toBe(session.rules);
    expect(input.gate?.characters?.map((c) => c.id)).toEqual(l3.characters.map((c) => c.card.id));
    expect(input.gate?.characters?.find((c) => c.id === "C01")?.speech).toEqual(snapshot.characters[0]?.speech);
    expect(input.maxOutputTokens).toBe(9000);
  });

  it("待收伏笔带意图、完整度与真实埋设原文，暗线只提示不要直接提及", () => {
    const { session } = seed();
    const input = buildChapterRunInput(session, 3);
    expect(input.promisedResolutions).toEqual([{ foreshadowId: "F01", completeness: "full" }]);
    expect(input.assembleInput.volatile.resolves).toEqual([{ id: "F01", label: "青铜钥匙", intent: "证明钥匙能打开宗门密库。", weight: "main", completeness: "full" }]);
    expect(input.assembleInput.l3.plantedExcerpts[0]?.excerpt).toBe(CH1);
    expect(input.assembleInput.volatile.avoid).toEqual([{ id: "F02", label: "钥匙上的红泥" }]);
    expect(JSON.stringify(input.assembleInput)).not.toContain("留到第八章揭露");
  });

  it("重写当前章时不泄漏本章、后续章、候选及否决事件", () => {
    const snapshot = writingSnapshot();
    const stream = EventStream.restore(snapshot.events);
    for (const [chapter, provenance, value] of [[1, "proposed", "候选毒伤痊愈"], [2, "rejected", "否决的复活"], [3, "committed", "旧版本已痊愈"], [4, "authored", "未来登基"]] as const) {
      stream.append({ chapter, origin: "user_edit", provenance: provenance === "authored" ? "authored" : "proposed", payload: { type: "character_state_changed", characterId: "C01", field: "condition", from: null, to: value, anchor: { chapter, quote: value, offsetHint: 0, occurrence: 0 } } });
      if (provenance === "committed" || provenance === "rejected") stream.decideChapter(chapter, provenance);
    }
    const { session } = seed({ ...snapshot, events: stream.all() });
    const input = buildChapterRunInput(session, 3);
    const rendered = JSON.stringify(assemble(input.assembleInput));
    expect(rendered).toContain("毒伤尚未痊愈");
    for (const wrong of ["候选毒伤痊愈", "否决的复活", "旧版本已痊愈", "未来登基"]) expect(rendered).not.toContain(wrong);
  });

  it("跨卷只汇总已发生剧情，不把后续节拍写成上卷梗概", () => {
    const { session } = seed();
    const boundary = buildChapterRunInput(session, 3).assembleInput.l3.volumeBoundary;
    expect(boundary?.volume).toBe(1);
    expect(boundary?.summary).toContain("血刀客交出密库旧图");
    expect(boundary?.summary).not.toContain(WRITE_BEAT.plan.coreEvent);
    expect(boundary?.endState).toContain("毒伤尚未痊愈");
  });

  it("重算过期预算而不修改存盘节拍，重复装配保持缓存前缀稳定", () => {
    const { root, session } = seed();
    const first = buildChapterRunInput(session, 3);
    const second = buildChapterRunInput(new ProjectSession(root), 3);
    expect(assemble(first.assembleInput)).toEqual(assemble(second.assembleInput));
    expect(new ProjectStore(root).load().beats.find((b) => b.chapter === 3)?.budget).toBeNull();
  });

  it("首章不要求前章正文", () => {
    const snap = writingSnapshot();
    const plan = { ...WRITE_BEAT.plan, chapterType: "event" as const, resolves: [] };
    const { session } = seed({ ...snap, events: [], chapters: new Map(), beats: [{ ...WRITE_BEAT, chapter: 1, volume: 1, plan }] });
    const input = buildChapterRunInput(session, 1);
    expect(input.assembleInput.volatile.previous).toBeNull();
    expect(input.assembleInput.l2.synopsis).toEqual([]);
    expect(input.assembleInput.l3.volumeBoundary).toBeNull();
  });

  it("ID 分配避开否决事件和其他章节的草稿；它们仍不成为已知伏笔", () => {
    const snapshot = writingSnapshot();
    const stream = EventStream.restore(snapshot.events);
    const planted = snapshot.events.find((e) => e.payload.type === "foreshadow_planted")!.payload;
    if (planted.type !== "foreshadow_planted") throw new Error("夹具缺伏笔");
    stream.append({ chapter: 1, origin: "C5_declaration", provenance: "proposed", payload: { ...planted, foreshadowId: "F80" } });
    stream.decideChapter(1, "rejected");
    const { root, session } = seed({ ...snapshot, events: stream.all() });
    new DraftStore(root).saveDraft(savedDraft({ chapter: 4, draftId: "ch4d1", status: "discarded", declaration: { ...declaration(), foreshadowPlanted: [{ ...planted, foreshadowId: "F99" }] } }));
    const { parseContextBase } = buildChapterRunInput(session, 3);
    expect([...parseContextBase.knownForeshadows]).toEqual(["F01", "F02"]);
    expect(parseContextBase.allocateForeshadowId()).toBe("F100");
    expect(parseContextBase.allocateForeshadowId()).toBe("F101");
    expect(session.events()).toHaveLength(writingSnapshot().events.length + 1);
  });

  it.each([0, -1, 1.5, NaN, Infinity])("非法章号 %s 在取文件前拒绝", (chapter) => {
    const { session } = seed();
    expect(() => buildChapterRunInput(session, chapter)).toThrow(/章号/u);
  });

  it("缺节拍、缺上一章和无效节拍均给出明确错误", () => {
    const { session } = seed();
    expect(() => buildChapterRunInput(session, 8)).toThrow(/节拍/u);
    const absent = seed({ ...writingSnapshot(), chapters: new Map([[1, CH1]]) }).session;
    expect(() => buildChapterRunInput(absent, 3)).toThrow(/第 2 章/u);
    session.putBeat({ ...WRITE_BEAT, plan: { ...WRITE_BEAT.plan, stageFeedback: "继续铺垫" } });
    expect(() => buildChapterRunInput(session, 3)).toThrow(/阶段反馈/u);
  });

  it.each([
    ["人物", { characters: ["C99"] }],
    ["设定", { locations: ["S99"] }],
    ["情节线", { events: [{ kind: "action", summary: "取走账本", weight: 2, plotLine: "P99" }] }],
    ["伏笔", { resolves: [{ foreshadowId: "F99", weight: "main", completeness: "full" }] }],
  ] as const)("节拍引用缺失%s时停止装配", (_label, change) => {
    const { session } = seed();
    session.putBeat({ ...WRITE_BEAT, plan: { ...WRITE_BEAT.plan, ...change } as ChapterPlan });
    expect(() => buildChapterRunInput(session, 3)).toThrow(new RegExp(_label, "u"));
  });

  it.each(["abandoned", "planned"] as const)("%s 伏笔不能作为已经埋设的待收伏笔", (status) => {
    const snapshot = writingSnapshot();
    // 只有规划、没有真实埋设；追加 P4 不能覆盖已经发生的正文事实。
    const { session } = seed(status === "planned" ? {
      ...snapshot,
      events: snapshot.events.map(event => event.payload.type === "foreshadow_planted" && event.payload.foreshadowId === "F01"
        ? { ...event, envelope: { ...event.envelope, origin: "P4_outline" as const } } : event),
    } : snapshot);
    if (status === "planned") {
      expect(session.derived.projections.foreshadows.find(f => f.id === "F01")?.status).toBe("planned");
    } else {
      const payload = { type: "foreshadow_abandoned" as const, foreshadowId: "F01" as const, reason: "改线" };
      session.appendEvents([{ chapter: 2, origin: "user_edit", provenance: "authored", payload }]);
    }
    expect(() => buildChapterRunInput(session, 3)).toThrow(/伏笔/u);
  });

  it("缺少正文依据的兑现记录不能让未来回收要求静默消失", () => {
    const { session } = seed();
    session.appendEvents([{ chapter: 2, origin: "user_edit", provenance: "authored", payload: {
      type: "foreshadow_resolved", foreshadowId: "F01", completeness: "full",
      anchor: { chapter: 2, quote: "正文中不存在的兑现依据", offsetHint: 0, occurrence: 0 },
    } }]);
    expect(() => buildChapterRunInput(session, 3)).toThrow(/伏笔|依据/u);
  });

  it("埋设原文已删除时要求修正依据，不能把旧 quote 当作现有正文", () => {
    const { session } = seed();
    session.putChapter(1, "这一版没有钥匙。");
    expect(() => buildChapterRunInput(session, 3)).toThrow(/原文|锚点/u);
  });

  it("仅在规划中出现的伏笔不进入已埋设索引或 C5 已知事实", () => {
    const { session } = seed();
    const planted = session.events().find((e) => e.payload.type === "foreshadow_planted")!.payload;
    if (planted.type !== "foreshadow_planted") throw new Error("夹具缺伏笔");
    session.appendEvents([{ chapter: 2, origin: "P4_outline", provenance: "authored", payload: { ...planted, foreshadowId: "F03", label: "仅是未来安排" } }]);
    const input = buildChapterRunInput(session, 3);
    expect(input.parseContextBase.knownForeshadows.has("F03")).toBe(false);
    expect(input.assembleInput.l2.foreshadows.rows.some((f) => f.id === "F03")).toBe(false);
  });
});

describe("写作工具读取", () => {
  it("按姓名、别名或 ID 读真实人物，按名称或 ID 读地点/组织", () => {
    const { session } = seed();
    const source = buildChapterReadSource(session, 3);
    const person = JSON.parse(source.loadCharacter("断剑少年")!);
    expect(person.id).toBe("C01");
    expect(person.state.condition).toBe("毒伤尚未痊愈");
    expect(source.loadCharacter("李长风")).toBe(source.loadCharacter("C01"));
    expect(JSON.parse(source.loadSetting("青云门")!).kind).toBe("organization");
    expect(source.loadSetting("S02")).toBe(source.loadSetting("青云门"));
    expect(source.loadCharacter("不存在")).toBeNull();
    expect(source.loadSetting("不存在")).toBeNull();
  });

  it("只读目标章之前的正式正文，head/tail 按工具定义返回三分之一", () => {
    const { session } = seed();
    session.putChapter(3, "当前章旧版");
    session.putChapter(4, "后续章正文");
    const source = buildChapterReadSource(session, 3);
    expect(source.loadChapter(1, "full")).toBe(CH1);
    expect(source.loadChapter(1, "head")).toBe(CH1.slice(0, Math.ceil(CH1.length / 3)));
    expect(source.loadChapter(1, "tail")).toBe(CH1.slice(-Math.ceil(CH1.length / 3)));
    for (const n of [0, 1.2, 3, 4]) expect(source.loadChapter(n, "full")).toBeNull();
  });

  it("按权重列出未收伏笔意图，工具使用启动时的作品快照", () => {
    const { session } = seed();
    const source = buildChapterReadSource(session, 3);
    expect(JSON.parse(source.listOpenForeshadows("main")).map((f: { id: string }) => f.id)).toEqual(["F01"]);
    expect(source.listOpenForeshadows("sub")).toContain("留到第八章揭露");
    session.putChapter(2, "生成期间被改过的正文");
    expect(source.loadChapter(2, "full")).toBe(CH2);
  });
});
