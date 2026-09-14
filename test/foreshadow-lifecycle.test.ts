import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { ProjectSession } from "../src/server/state.js";
import { buildChapterReadSource, buildChapterRunInput } from "../src/server/chapter-input.js";
import { parseC5 } from "../src/chapter/c5-schema.js";
import { correctDeclaration, correctionValue } from "../src/chapter/c5-correction.js";
import { deriveBudget } from "../src/beat/derive.js";
import { buildStoryProgress } from "../src/alerts/progress.js";
import { countWords } from "../src/text/measure.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, PROSE, SINGLE_PASS_RULES, declaration, fakeClient, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const QUOTE = "暗格边露出另一册账本的封角";
const plan = { type: "foreshadow_planted" as const, foreshadowId: "F03" as const, label: "失落副本", intent: "揭露守夜人保存了另一册账本。", weight: "sub" as const, visibility: "covert" as const, expectedBy: 8, anchor: { chapter: 2, quote: "", offsetHint: -1, occurrence: 0 } };
function rawPlant(plannedId?: string) {
  return { label: plan.label, intent: plan.intent, weight: plan.weight, visibility: plan.visibility, expected_by: plan.expectedBy, quote: QUOTE, ...(plannedId === undefined ? {} : { planned_foreshadow_id: plannedId }) };
}
function rawDeclaration(plants: unknown[] = [rawPlant()]) { return { ...JSON.parse(C5_JSON), foreshadow_planted: plants }; }
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nf-foreshadow-lifecycle-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const responses: CallResult[] = [];
  const model = fakeClient(responses);
  const session = new ProjectSession(root, SINGLE_PASS_RULES, { client: model.client });
  session.appendEvents([{ chapter: 2, provenance: "authored", origin: "P4_outline", payload: plan }]);
  const beat = session.beatFor(3)!;
  session.putBeat({ ...beat, plan: { ...beat.plan, plants: [{ label: plan.label, weight: plan.weight }] } });
  const body = () => {
    const prefix = PROSE + QUOTE + "。";
    const target = deriveBudget(session.beatFor(3)!.plan, session.meta.profile, session.rules).words.sweet;
    return prefix + "风".repeat(target - countWords(prefix));
  };
  const write = async (raw: unknown) => {
    responses.push(modelText(body()), modelText(JSON.stringify(raw)));
    return session.writeChapter({ chapter: 3 });
  };
  return { root, session, body, write, model, store: new DraftStore(root) };
}

describe("作者规划进入正文的伏笔生命周期", () => {
  it("本章相关的规划意图进入写作上下文，但没有伪装成已埋设索引", () => {
    const { session } = fixture();
    const input = buildChapterRunInput(session, 3);
    expect(JSON.stringify(input.assembleInput.volatile)).toContain("F03");
    expect(JSON.stringify(input.assembleInput.volatile)).toContain(plan.intent);
    expect(JSON.stringify(input.assembleInput.l2)).not.toContain("F03");
  });

  it.each([undefined, "F03"])("通过唯一标签或明确规划编号 %s 关联原伏笔", plannedId => {
    const { session, body } = fixture();
    const parsed = parseC5(rawDeclaration([rawPlant(plannedId)]), { ...buildChapterRunInput(session, 3).parseContextBase, chapterText: body() });
    expect(parsed.declaration.foreshadowPlanted).toHaveLength(1);
    expect(parsed.declaration.foreshadowPlanted[0]).toMatchObject({ foreshadowId: "F03", plannedForeshadowId: "F03" });
  });

  it("候选仍保留规划态，采用后同一编号拥有真实埋设原文", async () => {
    const { session, write, root } = fixture();
    const draft = await write(rawDeclaration());
    expect(draft.status).toBe("ready");
    expect(session.derived.projections.foreshadows.find(f => f.id === "F03")?.status).toBe("planned");
    expect(draft.declaration?.foreshadowPlanted[0]?.foreshadowId).toBe("F03");
    session.adopt(3, draft.draftId);
    const reopened = new ProjectSession(root);
    const entries = reopened.derived.projections.foreshadows.filter(f => f.label === plan.label);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ id: "F03", status: "open", plantedAt: 3, plantedAnchor: { chapter: 3, quote: QUOTE } });
    expect(reopened.derived.views.foreshadows.find(f => f.id === "F03")?.planted.resolution.status).toBe("exact");
  });

  it("同名规划不能唯一定位时保留正文并停止声明，不另造伏笔", async () => {
    const { session, write, body } = fixture();
    session.appendEvents([{ chapter: 2, origin: "P4_outline", provenance: "authored", payload: { ...plan, foreshadowId: "F04" } }]);
    const draft = await write(rawDeclaration());
    expect(draft.status).toBe("failed");
    expect(draft.error?.step).toBe("C5");
    expect(draft.error?.detail).toMatch(/规划|同名/);
    expect(draft.body).toBe(body());
    expect(session.currentChapter).toBe(2);
  });

  it("明确引用不存在的规划时说明具体编号，不悄悄另分配", async () => {
    const { write } = fixture();
    const draft = await write(rawDeclaration([rawPlant("F99")]));
    expect(draft.status).toBe("failed");
    expect(draft.error?.step).toBe("C5");
    expect(draft.error?.detail).toContain("F99");
  });

  it("同一稿不能把同一个规划埋设两次", async () => {
    const { write } = fixture();
    const draft = await write(rawDeclaration([rawPlant(), rawPlant()]));
    expect(draft.status).toBe("failed");
    expect(draft.error?.step).toBe("C5");
  });

  it("同一稿不能对同一条伏笔同时提交两次兑现判断", async () => {
    const { write } = fixture();
    const raw = rawDeclaration();
    raw.foreshadow_resolved.push({ ...raw.foreshadow_resolved[0], completeness: "partial" });
    const draft = await write(raw);
    expect(draft.status).toBe("failed");
    expect(draft.error?.step).toBe("C5");
  });

  it("重写最新章时仍读取该章采用后确认的独立作者规划", () => {
    const { session } = fixture();
    session.putChapter(3, PROSE);
    session.appendEvents([{ chapter: 3, origin: "P4_outline", provenance: "authored", payload: { ...plan, foreshadowId: "F04", label: "夹层印记" } }]);
    const context = buildChapterRunInput(session, 3).parseContextBase;
    const parsed = parseC5(rawDeclaration([{ ...rawPlant("F04"), label: "夹层印记" }]), { ...context, chapterText: QUOTE });
    expect(parsed.errors).toEqual([]);
    expect(parsed.declaration.foreshadowPlanted[0]?.foreshadowId).toBe("F04");
  });

  it("尚未正式埋设的规划不能被声明为已兑现", async () => {
    const { write } = fixture();
    const raw = rawDeclaration([]);
    raw.foreshadow_resolved.push({ foreshadow_id: "F03", completeness: "full", quote: QUOTE });
    const draft = await write(raw);
    expect(draft.status).toBe("failed");
    expect(draft.error?.step).toBe("C5");
    expect(draft.error?.detail).toContain("F03");
  });

  it.each(["abandoned", "resolved"] as const)("已经 %s 的伏笔不能再次声明兑现", async status => {
    const { session, write } = fixture();
    const payload = status === "abandoned"
      ? { type: "foreshadow_abandoned" as const, foreshadowId: "F02" as const, reason: "不再兑现" }
      : { type: "foreshadow_resolved" as const, foreshadowId: "F02" as const, completeness: "full" as const, anchor: { chapter: 2, quote: "旧图", offsetHint: 0, occurrence: 0 } };
    session.appendEvents([{ chapter: 2, origin: "user_edit", provenance: "authored", payload }]);
    const raw = rawDeclaration([]);
    raw.foreshadow_resolved.push({ foreshadow_id: "F02", completeness: "full", quote: QUOTE });
    const draft = await write(raw);
    expect(draft.status).toBe("failed");
    expect(draft.error?.detail).toContain("F02");
  });

  it("后来写成正文不会覆盖作者已经确认的新期限", () => {
    const { session } = fixture();
    session.planning.apply({ kind: "reschedule", foreshadowId: "F03", expectedBy: 10 });
    session.commitDraftDeclaration(3, { ...declaration(), foreshadowPlanted: [{ ...plan, anchor: { chapter: 3, quote: QUOTE, offsetHint: 0, occurrence: 0 } }] });
    expect(session.derived.projections.foreshadows.find(f => f.id === "F03")).toMatchObject({ status: "open", plantedAt: 3, expectedBy: 10 });
  });

  it("撤回最新章的埋设后原规划仍在，作者改期也保留", async () => {
    const { session, write, store } = fixture();
    const draft = await write(rawDeclaration());
    expect(draft.status).toBe("ready");
    session.adopt(3, draft.draftId);
    session.planning.apply({ kind: "reschedule", foreshadowId: "F03", expectedBy: 10 });
    const replacement = savedDraft({ draftId: "ch3d2", baseVersion: store.workVersion(), baseAdoptedThrough: 3,
      body: draft.body.replace(QUOTE, "暗格里没有留下账本"), declaration: { ...draft.declaration!, foreshadowPlanted: [] } });
    store.saveDraft(replacement);
    session.adopt(3, replacement.draftId);
    expect(session.derived.projections.foreshadows.filter(f => f.label === plan.label)).toEqual([
      expect.objectContaining({ id: "F03", status: "planned", expectedBy: 10, plantedAnchor: expect.objectContaining({ quote: "" }) }),
    ]);
  });

  it("修正埋设引文时保留原规划关联和编号", () => {
    const { session, body } = fixture();
    const context = { ...buildChapterRunInput(session, 3).parseContextBase, chapterText: body() };
    const original = parseC5(rawDeclaration(), context).declaration;
    const entry = original.foreshadowPlanted[0]!;
    const corrected = correctDeclaration(original, [{ section: "foreshadowPlanted", index: 0, value: { ...correctionValue(entry), quote: "另一册账本的封角" } }], context);
    expect(corrected.foreshadowPlanted[0]).toMatchObject({ foreshadowId: "F03", plannedForeshadowId: "F03", anchor: { quote: "另一册账本的封角" } });
  });

  it("结构纠错不能追加与未改条目重复的规划编号，即使改用不同标签", () => {
    const { session, body } = fixture();
    const context = { ...buildChapterRunInput(session, 3).parseContextBase, chapterText: body() };
    const original = parseC5(rawDeclaration(), context).declaration;
    expect(() => correctDeclaration(original, [{ section: "foreshadowPlanted", index: 1,
      value: { ...correctionValue(original.foreshadowPlanted[0]!), label: "账本的另一种叫法" },
    }], context)).toThrow(/重复/);
  });

  it("结构纠错不能与未改条目重复兑现同一伏笔", () => {
    const { session, body } = fixture();
    const context = { ...buildChapterRunInput(session, 3).parseContextBase, chapterText: body() };
    const original = parseC5(rawDeclaration(), context).declaration;
    expect(() => correctDeclaration(original, [{ section: "foreshadowResolved", index: 1,
      value: { ...correctionValue(original.foreshadowResolved[0]!), completeness: "partial" },
    }], context)).toThrow(/重复/);
  });

  it("结构纠错可以删除旧数据里的重复记录，再验证整份声明", () => {
    const { session, body } = fixture();
    const context = { ...buildChapterRunInput(session, 3).parseContextBase, chapterText: body() };
    const original = parseC5(rawDeclaration(), context).declaration;
    const duplicate = { ...original, foreshadowResolved: [...original.foreshadowResolved, original.foreshadowResolved[0]!] };
    expect(correctDeclaration(duplicate, [{ section: "foreshadowResolved", index: 1, value: null }], context)).toEqual(original);
  });

  it("提前完整兑现后未来章节只执行剩余计划，不再重复要求回收", async () => {
    const { session, write, root } = fixture();
    const future = { ...session.beatFor(3)!, chapter: 4 };
    session.putBeat(future);
    const draft = await write(rawDeclaration());
    expect(draft.status).toBe("ready");
    expect(buildStoryProgress(session).find(p => p.id === "foreshadow:F01")?.arrangements).toHaveLength(2);
    session.adopt(3, draft.draftId);
    const reopened = new ProjectSession(root);
    const input = buildChapterRunInput(reopened, 4);
    expect(input.promisedResolutions).toEqual([]);
    expect(input.assembleInput.volatile.beat.plan.resolves).toEqual([]);
    expect(input.assembleInput.volatile.beat.plan.plants).toEqual([]);
    expect(input.assembleInput.volatile.fulfilledPlants).toEqual([{ id: "F03", label: plan.label, chapter: 3 }]);
    expect(input.assembleInput.volatile.beat.plan.chapterType).toBe("event");
    expect(input.assembleInput.volatile.beat.budget).toEqual(deriveBudget(input.assembleInput.volatile.beat.plan, reopened.meta.profile, reopened.rules, { now: future.updatedAt }));
    expect(reopened.beatFor(4)).toEqual(future);
    const progress = buildStoryProgress(reopened).find(p => p.id === "foreshadow:F01")!;
    expect(progress.state).toBe("resolved");
    expect(progress.arrangements).toEqual([]);
    expect(progress.history.some(h => h.chapter === 4 && h.state === "scheduled")).toBe(true);
  });

  it("最新章纠错撤回完整兑现后，未来原定回收自动恢复", async () => {
    const { session, write, root, store } = fixture();
    session.putBeat({ ...session.beatFor(3)!, chapter: 4 });
    const draft = await write(rawDeclaration());
    session.adopt(3, draft.draftId);
    expect(buildChapterRunInput(session, 4).promisedResolutions).toEqual([]);
    const replacement = savedDraft({ draftId: "ch3d2", body: draft.body, baseVersion: store.workVersion(), baseAdoptedThrough: 3,
      declaration: { ...draft.declaration!, foreshadowResolved: draft.declaration!.foreshadowResolved.map(r => ({ ...r, completeness: "partial" })) } });
    store.saveDraft(replacement);
    session.adopt(3, replacement.draftId);
    const reopened = new ProjectSession(root);
    expect(buildChapterRunInput(reopened, 4).promisedResolutions).toEqual([{ foreshadowId: "F01", completeness: "full" }]);
    expect(buildStoryProgress(reopened).find(p => p.id === "foreshadow:F01")).toMatchObject({ state: "partial", arrangements: [{ chapter: 4, goal: "完整兑现" }] });
  });

  it("最新章撤回埋设后，后续原定埋设要求恢复", async () => {
    const { session, write, root, store } = fixture();
    session.putBeat({ ...session.beatFor(3)!, chapter: 4 });
    const draft = await write(rawDeclaration());
    session.adopt(3, draft.draftId);
    expect(buildChapterRunInput(session, 4).assembleInput.volatile.beat.plan.plants).toEqual([]);
    const replacement = savedDraft({ draftId: "ch3d2", body: draft.body, baseVersion: store.workVersion(), baseAdoptedThrough: 3,
      declaration: { ...draft.declaration!, foreshadowPlanted: [] } });
    store.saveDraft(replacement);
    session.adopt(3, replacement.draftId);
    const input = buildChapterRunInput(new ProjectSession(root), 4);
    expect(input.assembleInput.volatile.beat.plan.plants).toEqual([{ label: plan.label, weight: plan.weight }]);
    expect(input.assembleInput.volatile.plannedForeshadows?.[0]?.id).toBe("F03");
  });

  it("部分兑现后仍进入下一章的未收清单与收束装配", async () => {
    const { session, write } = fixture();
    const beat = session.beatFor(3)!;
    session.putBeat({ ...beat, plan: { ...beat.plan, resolves: [{ foreshadowId: "F01", weight: "main", completeness: "partial" }] } });
    const raw = rawDeclaration();
    raw.foreshadow_resolved[0].completeness = "partial";
    const draft = await write(raw);
    expect(draft.status).toBe("ready");
    session.adopt(3, draft.draftId);
    const open = JSON.parse(buildChapterReadSource(session, 4).listOpenForeshadows("all"));
    expect(open).toContainEqual(expect.objectContaining({ id: "F01", status: "open", resolutions: [expect.objectContaining({ completeness: "partial" })] }));
    session.putBeat({ ...beat, chapter: 4 });
    expect(buildChapterRunInput(session, 4).promisedResolutions).toContainEqual({ foreshadowId: "F01", completeness: "full" });
  });
});
