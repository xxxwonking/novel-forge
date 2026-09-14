import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { buildChapterReadSource } from "../src/server/chapter-input.js";
import { handle } from "../src/server/api.js";
import { DraftStore } from "../src/task/draft-store.js";
import type { CallResult } from "../src/client/claude.js";
import type { PlanningAction } from "../src/planning/service.js";
import { PROSE, WRITE_BEAT, declaration, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture(results: readonly CallResult[] = []) {
  const root = mkdtempSync(join(tmpdir(), "nf-story-progress-")); roots.push(root);
  const snapshot = writingSnapshot();
  const future = { ...WRITE_BEAT, provenance: "authored" as const, plan: { ...WRITE_BEAT.plan, chapterType: "event" as const, resolves: [] } };
  new ProjectStore(root).save({ ...snapshot, beats: [snapshot.beats[0]!, future, { ...future, chapter: 4 }] });
  const model = fakeClient(results);
  return { root, model, session: new ProjectSession(root, undefined, { client: model.client }) };
}
function action(session: ProjectSession, value: unknown, alertId = "foreshadow_overdue:F01", reason?: string) {
  return handle(session, { method: "POST", path: "/api/alerts/action", query: new URLSearchParams(), body: { alertId, action: value, ...(reason === undefined ? {} : { reason }) } });
}
const resolution = { kind: "add_resolution_to_beat", targetChapter: 3, foreshadowId: "F01", weight: "main", completeness: "full" };
const reschedule = { kind: "reschedule", foreshadowId: "F01", expectedBy: 6 };
const abandon = { kind: "abandon", foreshadowId: "F01" };

describe("故事安排的写入边界与重试", () => {
  it("不能借 F01 的告警去改动另一个已存在的伏笔", () => {
    const { session, root } = fixture();
    const before = new ProjectStore(root).load();
    expect(action(session, { ...reschedule, foreshadowId: "F02" }).status).toBe(400);
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("不能通过提示按钮改写已采用章节的计划", () => {
    const { session, root } = fixture();
    const before = new ProjectStore(root).load();
    expect(action(session, { ...resolution, targetChapter: 2 }).status).toBe(409);
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("单项安排不能把尚未确认的整个计划变为正式计划", () => {
    const { session } = fixture();
    session.putBeat({ ...session.beatFor(3)!, provenance: "proposed" });
    expect(action(session, resolution).status).toBe(409);
    expect(session.beatFor(3)?.provenance).toBe("proposed");
    expect(session.beatFor(3)?.plan.resolves).toEqual([]);
  });

  it("不能用错误权重给已知伏笔重算预算", () => {
    const { session } = fixture();
    expect(action(session, { ...resolution, weight: "detail" }).status).toBe(400);
    expect(session.beatFor(3)?.plan.resolves).toEqual([]);
  });

  it("同一伏笔改成部分兑现时更新已安排目标，保留一个条目", () => {
    const { session } = fixture();
    expect(action(session, resolution).status).toBe(200);
    const fullBudget = session.beatFor(3)!.budget!.words.max;
    expect(action(session, { ...resolution, completeness: "partial" }).status).toBe(200);
    expect(session.beatFor(3)?.plan.resolves).toEqual([{ foreshadowId: "F01", weight: "main", completeness: "partial" }]);
    expect(session.beatFor(3)!.budget!.words.max).toBeLessThan(fullBudget);
    expect(session.derived.projections.foreshadows.find(f => f.id === "F01")?.resolutions).toEqual([]);
  });

  it.each([0, 2, -1, 2.5])("改期到 %s 不是有效未来期限，拒绝且不保存事件", expectedBy => {
    const { session, root } = fixture();
    const before = new ProjectStore(root).load();
    expect(action(session, { ...reschedule, expectedBy }).status).toBe(400);
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("改期后告警消失也能重试同一操作，重开后不重复事件", () => {
    const { session, root } = fixture();
    expect(action(session, reschedule).status).toBe(200);
    const reopened = new ProjectSession(root);
    const retry = action(reopened, reschedule);
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ changed: false });
    expect(reopened.events().filter(e => e.payload.type === "foreshadow_rescheduled")).toHaveLength(1);
    expect(reopened.derived.projections.foreshadows.find(f => f.id === "F01")?.status).toBe("open");
  });

  it("放弃清理未来回收安排并重算预算，保留过去计划与正文", () => {
    const { session, root } = fixture();
    const past = session.beatFor(2);
    const prose = session.chapterText(2);
    expect(action(session, resolution).status).toBe(200);
    expect(action(session, { ...resolution, targetChapter: 4 }).status).toBe(200);
    expect(action(session, abandon, undefined, "这条线不再兑现").status).toBe(200);
    for (const chapter of [3, 4]) {
      expect(session.beatFor(chapter)?.plan.resolves).toEqual([]);
      expect(session.beatFor(chapter)?.plan.chapterType).toBe("event");
      expect(session.beatFor(chapter)?.budget).not.toBeNull();
    }
    expect(session.beatFor(2)).toEqual(past);
    expect(session.chapterText(2)).toBe(prose);
    const retry = action(new ProjectSession(root), abandon, undefined, "这条线不再兑现");
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ changed: false });
    expect(new ProjectStore(root).load().events.filter(e => e.payload.type === "foreshadow_abandoned")).toHaveLength(1);
  });

  it("放弃保存中途失败时回滚事件、计划与预算，之后可重试", () => {
    const { session, root } = fixture();
    action(session, resolution);
    const before = new ProjectStore(root).load();
    const original = ProjectStore.prototype.writeBeats;
    vi.spyOn(ProjectStore.prototype, "writeBeats").mockImplementationOnce(function (this: ProjectStore, beats) {
      original.call(this, beats);
      throw new Error("模拟未来计划保存中断");
    });
    expect(action(session, abandon).status).toBe(400);
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(session.derived.projections.foreshadows.find(f => f.id === "F01")?.status).toBe("open");
    expect(session.beatFor(3)?.plan.resolves).toHaveLength(1);
    expect(action(session, abandon).status).toBe(200);
  });

  it("对话中的未知对象或已结束伏笔不能产生成功副作用", async () => {
    const calls = [
      { id: "unknown", name: "plan_reschedule_foreshadow", input: { foreshadowId: "F99", expectedBy: 9 } },
      { id: "bad-character", name: "plan_add_to_next_chapter", input: { what: "character", characterId: "C99" } },
      { id: "bad-line", name: "plan_add_to_next_chapter", input: { what: "advance", plotLine: "P99" } },
      { id: "closed", name: "plan_add_to_next_chapter", input: { what: "resolution", foreshadowId: "F01", weight: "main", completeness: "full" } },
    ];
    const { session, model, root } = fixture([
      { kind: "ok", message: modelMessage(calls.map(call => ({ type: "tool_use", ...call })) as Anthropic.ContentBlock[], "tool_use") },
      modelText("这些安排未生效。"),
    ]);
    session.appendEvents([{ chapter: 2, origin: "user_edit", provenance: "authored", payload: { type: "foreshadow_abandoned", foreshadowId: "F01", reason: "不再兑现" } }]);
    const before = new ProjectStore(root).load();
    await session.converse("核对这些安排，找不到对象或已经结束时不能保存。");
    expect(new ProjectStore(root).load()).toEqual(before);
    const results = model.calls[1]!.messages.flatMap(message => typeof message.content === "string" ? [] : message.content).filter(block => block.type === "tool_result");
    expect(results).toHaveLength(4);
    expect(results.every(block => block.is_error)).toBe(true);
  });

  it("确认退场的事件与提示状态必须一起保存", () => {
    const { session, root } = fixture();
    session.putChapter(50, "第五十章，其他人物继续调查。");
    const before = new ProjectStore(root).load();
    vi.spyOn(ProjectStore.prototype, "writeAlertStates").mockImplementationOnce(() => { throw new Error("模拟提示状态保存失败"); });
    expect(action(session, { kind: "confirm_exit", characterId: "C01" }, "character_missing:C01").status).toBe(400);
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(session.events().filter(e => e.payload.type === "character_state_changed" && e.payload.field === "vital")).toEqual([]);
    expect(action(session, { kind: "confirm_exit", characterId: "C01" }, "character_missing:C01").status).toBe(200);
    expect(action(session, { kind: "confirm_exit", characterId: "C01" }, "character_missing:C01").body).toMatchObject({ changed: false });
  });
});

interface Progress {
  id: string; state: string; detail: string; expectedBy?: number;
  arrangements: { chapter: number; goal: string }[];
  evidence: { chapter: number; label: string }[];
  history: { chapter: number; state: string; detail: string }[];
  actions?: PlanningAction[];
}
function progress(session: ProjectSession): Progress[] {
  const result = handle(session, { method: "GET", path: "/api/issues", query: new URLSearchParams(), body: null });
  expect(result.status).toBe(200);
  return result.body as Progress[];
}

describe("作者可见的处理进度", () => {
  it("退出告警列表后仍能从进度入口改期，重复请求不新增记录", () => {
    const { session, root } = fixture();
    session.planning.apply({ ...reschedule, expectedBy: 50 });
    expect(session.derived.candidates.some(c => c.alert.subject.kind === "foreshadow" && c.alert.subject.id === "F01")).toBe(false);
    expect(progress(session).find(p => p.id === "foreshadow:F01")?.actions ?? []).toContainEqual({ kind: "reschedule", foreshadowId: "F01", expectedBy: 50 });
    const request = { method: "POST", path: "/api/planning/action", query: new URLSearchParams(), body: { action: reschedule } };
    expect(handle(session, request)).toMatchObject({ status: 200, body: { changed: true } });
    expect(handle(new ProjectSession(root), request)).toMatchObject({ status: 200, body: { changed: false } });
    expect(new ProjectStore(root).load().events.filter(e => e.payload.type === "foreshadow_rescheduled")).toHaveLength(2);
  });

  it("进度卡片提供下一章完整/部分回收动作，直接入口仍校验计划与对象", () => {
    const { session, root } = fixture();
    const entry = progress(session).find(p => p.id === "foreshadow:F01")!;
    expect(entry.actions ?? []).toContainEqual(resolution);
    expect(entry.actions ?? []).toContainEqual({ ...resolution, completeness: "partial" });
    const before = new ProjectStore(root).load();
    const request = { method: "POST", path: "/api/planning/action", query: new URLSearchParams(), body: { action: { ...resolution, weight: "detail" } } };
    expect(handle(session, request).status).toBe(400);
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("安排与改期都有明确状态，不能显示正文已经兑现，查询不写文件", () => {
    const { session, root } = fixture();
    expect(progress(session).find(p => p.id === "foreshadow:F01")?.state).toBe("pending");
    action(session, resolution);
    expect(progress(session).find(p => p.id === "foreshadow:F01")).toMatchObject({ state: "scheduled", evidence: [], arrangements: [{ chapter: 3, goal: "完整兑现" }] });
    action(session, reschedule);
    const before = new ProjectStore(root).load();
    expect(progress(session).find(p => p.id === "foreshadow:F01")).toMatchObject({ state: "rescheduled", expectedBy: 6, evidence: [] });
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("未确认的章节安排不能让问题显示已安排或退出当前提示", () => {
    const { session } = fixture();
    session.putBeat({ ...session.beatFor(3)!, provenance: "proposed", plan: { ...session.beatFor(3)!.plan, resolves: [{ foreshadowId: "F01", weight: "main", completeness: "full" }] } });
    expect(session.derived.selection.fullList.some(alert => alert.subject.kind === "foreshadow" && alert.subject.id === "F01")).toBe(true);
    expect(progress(session).find(p => p.id === "foreshadow:F01")?.state).toBe("pending");
  });

  it("候选兑现不生效，采用部分兑现后仍跟踪剩余目标", () => {
    const { session, root } = fixture();
    const draft = savedDraft({ declaration: { ...declaration(), foreshadowResolved: [{ type: "foreshadow_resolved", foreshadowId: "F01", completeness: "partial", anchor: { chapter: 3, quote: "钥匙的齿缝与锁眼严丝合缝", offsetHint: 0, occurrence: 0 } }] } });
    new DraftStore(root).saveDraft(draft);
    session.appendEvents([{ chapter: 3, provenance: "proposed", origin: "C5_declaration", payload: draft.declaration!.foreshadowResolved[0]! }]);
    expect(progress(session).find(p => p.id === "foreshadow:F01")?.state).toBe("pending");
    session.adopt(3, draft.draftId);
    expect(progress(session).find(p => p.id === "foreshadow:F01")).toMatchObject({ state: "partial", evidence: [{ chapter: 3 }] });
    expect(session.derived.projections.foreshadows.find(f => f.id === "F01")?.status).toBe("open");
    session.planning.apply({ ...resolution, targetChapter: 4 });
    expect(progress(session).find(p => p.id === "foreshadow:F01")).toMatchObject({ state: "partial", arrangements: [{ chapter: 4, goal: "完整兑现" }] });
    const fourth = savedDraft({ chapter: 4, draftId: "ch4d1", body: "钥匙上的秘密终于全部解开。", baseVersion: 1, baseAdoptedThrough: 3,
      declaration: { ...declaration(), foreshadowResolved: [{ type: "foreshadow_resolved", foreshadowId: "F01", completeness: "full", anchor: { chapter: 4, quote: "钥匙上的秘密终于全部解开", offsetHint: 0, occurrence: 0 } }] } });
    new DraftStore(root).saveDraft(fourth);
    session.adopt(4, fourth.draftId);
    const final = progress(new ProjectSession(root)).find(p => p.id === "foreshadow:F01");
    expect(final?.state).toBe("resolved");
    expect(final?.evidence.map(e => e.chapter)).toEqual([3, 4]);
    expect(final?.history.map(h => h.state)).toEqual(expect.arrayContaining(["partial", "resolved"]));
  });

  it("已放弃保留理由和历史，不列成已解决", () => {
    const { session, root } = fixture();
    action(session, abandon, undefined, "改用另一条线索");
    const entry = progress(new ProjectSession(root)).find(p => p.id === "foreshadow:F01");
    expect(entry?.state).toBe("abandoned");
    expect(entry?.detail).toContain("改用另一条线索");
    expect(entry?.evidence).toEqual([]);
  });

  it("情节与人物安排需要采用真实推进和出场后才显示完成", () => {
    const { session, root } = fixture();
    session.putBeat({ ...session.beatFor(4)!, provenance: "proposed" });
    const before = progress(session);
    for (const id of ["plotline:P01", "character:C01"]) expect(before.find(p => p.id === id)?.state).toBe("scheduled");
    const draft = savedDraft({ declaration: { ...declaration(),
      events: [{ type: "plot_event", kind: "action", summary: "李长风打开密库", plotLine: "P01", weight: 2, participants: ["C01"], anchor: { chapter: 3, quote: "李长风用青铜钥匙打开了宗门密库", offsetHint: 0, occurrence: 0 } }],
      characterPresence: [{ type: "character_presence", characterId: "C01", role: "pov" }],
    } });
    new DraftStore(root).saveDraft(draft);
    session.adopt(3, draft.draftId);
    const after = progress(session);
    for (const id of ["plotline:P01", "character:C01"]) expect(after.find(p => p.id === id)).toMatchObject({ state: "resolved", evidence: [expect.objectContaining({ chapter: 3 })] });
  });

  it("只有规划中的推进或出场不算正式完成", () => {
    const { session } = fixture();
    const before = JSON.parse(buildChapterReadSource(session, 3).loadCharacter("C01")!);
    session.putBeat({ ...session.beatFor(4)!, provenance: "proposed" });
    session.appendEvents([
      { chapter: 3, origin: "P4_outline", provenance: "authored", payload: { type: "plot_event", kind: "action", summary: "未来调查", plotLine: "P01", weight: 2, participants: ["C01"], anchor: { chapter: 3, quote: "李长风", offsetHint: 0, occurrence: 0 } } },
      { chapter: 3, origin: "P4_outline", provenance: "authored", payload: { type: "character_presence", characterId: "C01", role: "pov" } },
      { chapter: 3, origin: "P4_outline", provenance: "authored", payload: { type: "character_state_changed", characterId: "C01", field: "condition", from: null, to: "未来规划中的痊愈", anchor: { chapter: 3, quote: "", offsetHint: -1, occurrence: 0 } } },
      { chapter: 3, origin: "P4_outline", provenance: "authored", payload: { type: "relation_changed", from: "C01", to: "C02", fromKind: null, toKind: "hostile", note: "未来规划中的决裂", anchor: { chapter: 3, quote: "李长风", offsetHint: 0, occurrence: 0 } } },
    ]);
    session.putChapter(3, PROSE);
    const entries = progress(session);
    for (const id of ["plotline:P01", "character:C01"]) expect(entries.find(p => p.id === id)?.state).toBe("pending");
    expect(session.derived.projections.plotLines[0]?.points.some(p => p.chapter === 3)).toBe(false);
    expect(session.derived.projections.arcs.find(a => a.characterId === "C01")?.presence.some(p => p.chapter === 3)).toBe(false);
    expect(JSON.parse(buildChapterReadSource(session, 4).loadCharacter("C01")!).state).toEqual(before.state);
    expect(session.derived.projections.relations).toEqual([]);
  });

  it("关系再次变化后，当前关系的原文入口随最新记录更新", () => {
    const { session } = fixture();
    const first = { chapter: 1, quote: "收起钥匙", offsetHint: 0, occurrence: 0 };
    const latest = { chapter: 2, quote: "密库位置的旧图", offsetHint: 0, occurrence: 0 };
    session.appendEvents([
      { chapter: 1, origin: "C5_declaration", provenance: "authored", payload: { type: "relation_changed", from: "C01", to: "C02", fromKind: null, toKind: "hostile", note: "互相提防", anchor: first } },
      { chapter: 2, origin: "C5_declaration", provenance: "authored", payload: { type: "relation_changed", from: "C01", to: "C02", fromKind: "hostile", toKind: "ally", note: "交出旧图达成合作", anchor: latest } },
    ]);
    expect(session.derived.projections.relations[0]).toMatchObject({ kind: "ally", changedAt: 2, anchor: latest });
  });

  it("兑现引文已丢失时提示核对，不能把缺乏正文依据的记录当成已解决", () => {
    const { session } = fixture();
    session.appendEvents([{ chapter: 2, origin: "C5_declaration", provenance: "authored", payload: { type: "foreshadow_resolved", foreshadowId: "F01", completeness: "full", anchor: { chapter: 2, quote: "正文里没有这段话", offsetHint: 0, occurrence: 0 } } }]);
    const entry = progress(session).find(p => p.id === "foreshadow:F01");
    expect(entry?.state).toBe("pending");
    expect(entry?.detail).toContain("核对");
  });

  it("作者确认退场单独显示，不宣称已补写出场或角色死亡", () => {
    const { session } = fixture();
    session.putChapter(50, "其他人物继续调查。");
    action(session, { kind: "confirm_exit", characterId: "C01" }, "character_missing:C01");
    const entry = progress(session).find(p => p.id === "character:C01");
    expect(entry).toMatchObject({ state: "exited", evidence: [] });
    expect(entry?.detail).toContain("作者");
  });

  it("确认退场时明确指出仍保留的后续出场安排，不隐藏计划冲突", () => {
    const { session } = fixture();
    const result = session.planning.apply({ kind: "confirm_exit", characterId: "C01" });
    expect(result.message).toMatch(/第 3、4 章.*出场安排/);
    expect(progress(session).find(p => p.id === "character:C01")).toMatchObject({ state: "exited", arrangements: [{ chapter: 3, goal: "人物出场" }, { chapter: 4, goal: "人物出场" }] });
    expect(progress(session).find(p => p.id === "character:C01")?.detail).toContain("核对");
  });

  it("作者确认退场后正文重新出场，以新正文展示本次安排已完成", () => {
    const { session, root } = fixture();
    session.putBeat({ ...session.beatFor(4)!, provenance: "proposed" });
    session.planning.apply({ kind: "confirm_exit", characterId: "C01" });
    new DraftStore(root).saveDraft(savedDraft({ declaration: { ...declaration(), characterStates: [], characterPresence: [{ type: "character_presence", characterId: "C01", role: "pov" }] } }));
    session.adopt(3, "ch3d1");
    const entry = progress(new ProjectSession(root)).find(p => p.id === "character:C01");
    expect(entry).toMatchObject({ state: "resolved", evidence: [{ chapter: 3 }] });
    expect(entry?.history).toContainEqual(expect.objectContaining({ state: "exited", chapter: 2 }));
  });

  it("主 Agent 在同一轮安排后能查询相同的处理状态", async () => {
    const { session, model } = fixture([
      { kind: "ok", message: modelMessage([
        { type: "tool_use", id: "schedule", name: "plan_add_to_next_chapter", input: { what: "resolution", foreshadowId: "F01", weight: "main", completeness: "full" } },
        { type: "tool_use", id: "progress", name: "get_story_progress", input: {} },
      ] as Anthropic.ContentBlock[], "tool_use") }, modelText("已安排，尚未兑现。"),
    ]);
    await session.converse("把钥匙伏笔安排进下一章，再告诉我处理状态。");
    const blocks = model.calls[1]!.messages.flatMap(message => typeof message.content === "string" ? [] : message.content);
    const result = blocks.find(block => block.type === "tool_result" && block.tool_use_id === "progress");
    expect(result?.type).toBe("tool_result");
    if (result?.type !== "tool_result" || typeof result.content !== "string") throw new Error("没有进度工具结果");
    expect(result.is_error).not.toBe(true);
    expect(JSON.parse(result.content)).toContainEqual(expect.objectContaining({ id: "foreshadow:F01", state: "scheduled" }));
  });
});
