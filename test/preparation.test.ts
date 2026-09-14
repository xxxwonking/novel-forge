import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { buildChapterRunInput } from "../src/server/chapter-input.js";
import { C5_JSON, PROSE, declaration, fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";
import type { PreparationChanges } from "../src/preparation/types.js";
import { DraftStore } from "../src/task/draft-store.js";
import { deriveBudget } from "../src/beat/derive.js";
import { loadRules } from "../src/rules/load.js";
import { countWords } from "../src/text/measure.js";
import { handle } from "../src/server/api.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fresh(client?: ReturnType<typeof fakeClient>["client"]) {
  const root = mkdtempSync(join(tmpdir(), "nf-preparation-"));
  roots.push(root);
  const base = writingSnapshot();
  const store = new ProjectStore(root);
  store.save({ ...base, setting: { ...base.setting, centralConflict: "", openingSituation: "" }, characters: [], settings: [], plotLines: [], beats: [], events: [], chapters: new Map() });
  return { root, store, session: new ProjectSession(root, undefined, client === undefined ? {} : { client }) };
}
export function firstChapterChanges(): PreparationChanges {
  const source = writingSnapshot();
  return {
    setting: { centralConflict: source.setting.centralConflict, openingSituation: source.setting.openingSituation },
    characters: source.characters.map(({ provenance: _p, introducedAt: _i, updatedAt: _u, ...card }) => card),
    settings: source.settings, plotLines: source.plotLines,
    beats: [{ chapter: 1, volume: 1, plan: { ...source.beats[0]!.plan, chapterType: "event", resolves: [] } }],
  };
}
function propose(session: ProjectSession, changes: PreparationChanges = firstChapterChanges()) {
  return session.preparation.propose({ summary: "密库开篇方案", changes, baseFingerprint: session.preparation.view().fingerprint });
}

describe("作品资料与章节方案", () => {
  it("提出建议不改变正式资料，重开保留方案，确认后首章可装配且不产生故事事实", () => {
    const { root, store, session } = fresh();
    const before = store.load();
    expect(session.preparation.view().readiness.ready).toBe(false);
    const proposal = propose(session);
    expect(proposal.status).toBe("proposed");
    expect(store.load()).toEqual(before);
    const reopened = new ProjectSession(root);
    expect(reopened.preparation.view().proposals[0]?.id).toBe(proposal.id);
    expect(reopened.preparation.confirm(proposal.id).changed).toBe(true);
    expect(reopened.preparation.confirm(proposal.id).changed).toBe(false);
    expect(reopened.preparation.view().readiness.ready).toBe(true);
    const input = buildChapterRunInput(reopened, 1);
    expect(input.assembleInput.volatile.beat.plan.characters).toContain("C01");
    expect(input.assembleInput.volatile.beat.budget?.words.min).toBeGreaterThan(0);
    expect(store.loadEvents()).toEqual([]);
    expect(reopened.currentChapter).toBe(0);
    expect(new ProjectSession(root).meta.characters.map((c) => c.name)).toEqual(writingSnapshot().characters.map((c) => c.name));
  });

  it("同内容同来源的重试复用方案；来源改变后不覆盖作者新选择", () => {
    const { session } = fresh();
    const first = propose(session);
    expect(propose(session).id).toBe(first.id);
    const preference = propose(session, { writingRules: ["台词少用感叹号。"] });
    session.preparation.confirm(preference.id);
    expect(() => session.preparation.confirm(first.id)).toThrow(/较早版本|发生变化/u);
    expect(session.preparation.view().proposals.find((p) => p.id === first.id)?.stale).toBe(true);
    expect(session.meta.discipline.rules).toEqual(["台词少用感叹号。"]);
    expect(session.meta.characters).toEqual([]);
  });

  it("作者直接指定的内容可立即记录；空讨论不写方案或正式资料", () => {
    const { store, session } = fresh();
    const before = store.load();
    session.preparation.view();
    expect(session.preparation.view().proposals).toEqual([]);
    expect(store.load()).toEqual(before);
    const proposal = session.preparation.recordAuthor({ summary: "以后少用感叹号", changes: { writingRules: ["台词少用感叹号。"] }, baseFingerprint: session.preparation.view().fingerprint });
    expect(proposal.status).toBe("confirmed");
    expect(session.meta.discipline.rules).toEqual(["台词少用感叹号。"]);
  });

  it("对已出现人物的设定变更保留候选与受影响章节，不直接改掉既有依据", () => {
    const { root, store } = fresh();
    store.save(writingSnapshot());
    const session = new ProjectSession(root);
    const character = firstChapterChanges().characters![0]!;
    const proposal = propose(session, { characters: [{ ...character, profile: { ...character.profile, background: "另一个身世" } }] });
    expect(proposal.impacts.some((impact) => impact.chapters.includes(1))).toBe(true);
    expect(() => session.preparation.confirm(proposal.id)).toThrow(/已采用正文/u);
    expect(store.load().characters).toEqual(writingSnapshot().characters);
  });

  it.each([
    { characters: [{ id: "../bad", name: "越界" }] },
    { events: [{ type: "plot_event" }] },
    { beats: [{ chapter: 1, volume: 1, plan: { ...firstChapterChanges().beats![0]!.plan, characters: ["missing"] } }] },
    { beats: [{ chapter: 1, volume: 1, plan: { ...firstChapterChanges().beats![0]!.plan, stageFeedback: "继续铺垫" } }] },
    { profile: { targetWords: -1 } },
  ])("非法或不可用的方案不落盘：%j", (changes) => {
    const { session, store } = fresh();
    const before = store.load();
    expect(() => propose(session, { ...firstChapterChanges(), ...changes } as PreparationChanges)).toThrow();
    expect(session.preparation.view().proposals).toEqual([]);
    expect(store.load()).toEqual(before);
  });

  it("旧来源的模型输出不能被标成新来源；损坏方案文件不会被确认覆盖", () => {
    const { root, session } = fresh();
    expect(() => session.preparation.propose({ summary: "旧请求", changes: firstChapterChanges(), baseFingerprint: "0".repeat(64) })).toThrow(/来源|版本/u);
    const proposal = propose(session);
    const path = join(root, "preparation", `${proposal.id}.json`);
    writeFileSync(path, "{broken", "utf8");
    expect(() => session.preparation.confirm(proposal.id)).toThrow();
    expect(readFileSync(path, "utf8")).toBe("{broken");
  });

  it("确认选中方案不会顺带确认已有的无关人物与章节候选", () => {
    const { root, store } = fresh();
    const before = store.load();
    store.save({ ...before, characters: [{ ...writingSnapshot().characters[0]!, id: "C99", name: "未选中的人物", provenance: "proposed" }], beats: [{ ...writingSnapshot().beats[0]!, chapter: 9, provenance: "proposed" }] });
    const session = new ProjectSession(root);
    const proposal = propose(session);
    session.preparation.confirm(proposal.id);
    expect(session.meta.characters.find((c) => c.id === "C99")?.provenance).toBe("proposed");
    expect(session.beatFor(9)?.provenance).toBe("proposed");
    expect(buildChapterRunInput(session, 1).parseContextBase.knownCharacters.has("C99")).toBe(false);
  });

  it("资料就绪提示也检查真实写章条件，过期的伏笔安排不能显示可开写", () => {
    const { root, store } = fresh();
    const source = writingSnapshot();
    store.save({ ...source, events: source.events.filter((e) => e.payload.type !== "foreshadow_planted") });
    const session = new ProjectSession(root);
    expect(session.preparation.view().readiness.ready).toBe(false);
    expect(session.preparation.view().readiness.missing.join(" ")).toContain("F01");
  });

  it("HTTP 与对话共用方案服务，跨作品确认和过期请求不改变资料", () => {
    const first = fresh();
    const other = fresh();
    const post = (session: ProjectSession, path: string, body: unknown) => handle(session, { method: "POST", path, body, query: new URLSearchParams() });
    const proposed = post(first.session, "/api/preparation/propose", { summary: "HTTP 方案", changes: firstChapterChanges(), baseFingerprint: first.session.preparation.view().fingerprint });
    expect(proposed.status).toBe(200);
    const proposal = proposed.body as { id: string };
    expect(post(other.session, "/api/preparation/confirm", { proposalId: proposal.id }).status).toBe(404);
    expect(other.session.meta.characters).toEqual([]);
    expect(post(first.session, "/api/preparation/confirm", { proposalId: proposal.id }).status).toBe(200);
    expect(post(first.session, "/api/preparation/confirm", { proposalId: proposal.id }).body).toMatchObject({ changed: false });
    expect(post(first.session, "/api/preparation/propose", { summary: "旧请求", changes: firstChapterChanges(), baseFingerprint: "0".repeat(64) }).status).toBe(409);
    expect(post(first.session, "/api/preparation/propose", { changes: { events: [] } }).status).toBe(400);
  });

  it("对话能提出并确认具体方案，后续读工具看到已应用资料", async () => {
    const { client, calls } = fakeClient([]);
    const { session } = fresh(client);
    let proposalId = "";
    let round = 0;
    client.call = async (options) => {
      calls.push(options);
      round += 1;
      if (round === 1) return { kind: "ok", message: modelMessage([{ type: "tool_use", caller: { type: "direct" }, id: "proposal-call", name: "propose_preparation", input: { summary: "密库开篇方案", changes: firstChapterChanges(), baseFingerprint: session.preparation.view().fingerprint } }], "tool_use") };
      if (round === 2) { proposalId = session.preparation.view().proposals[0]!.id; return modelText("已保存建议，尚未确认。"); }
      if (round === 3) return { kind: "ok", message: modelMessage([{ type: "tool_use", caller: { type: "direct" }, id: "confirm-call", name: "confirm_preparation", input: { proposalId } }, { type: "tool_use", caller: { type: "direct" }, id: "read-call", name: "get_preparation", input: {} }], "tool_use") };
      return modelText("已确认开篇方案，可以写第一章。");
    };
    const proposed = await session.converse("整理一个开篇方案，先让我看看");
    expect(proposed.effects[0]?.kind).toBe("preparation_proposed");
    expect(session.meta.characters).toEqual([]);
    const confirmed = await session.converse("就按这个方案准备");
    expect(confirmed.effects[0]?.kind).toBe("preparation_confirmed");
    expect(session.preparation.view().readiness.ready).toBe(true);
    expect(JSON.stringify(calls.at(-1)?.messages.at(-1))).toContain("李长风");
    expect(session.events()).toEqual(declaration().events);
  });
});

const TRIAL_C5 = JSON.stringify({ ...JSON.parse(C5_JSON), foreshadow_resolved: [] });
function trialProse(): string {
  const target = deriveBudget(firstChapterChanges().beats![0]!.plan, writingSnapshot().profile, loadRules()).words.sweet;
  let text = PROSE;
  // 仅用于工程闸门验证，真实创作质量另做模型验收。
  while (countWords(text) < target) text += "\n他沿着石壁逐一查看架上的木匣，把封口和旧图上的记号对照，随后记下匣底的编号。";
  return text;
}

describe("方案试写与打包采用", () => {
  it("试写只使用候选资料，采用时把同一方案、正文和声明一起确认", async () => {
    const model = fakeClient([modelText(trialProse()), modelText(TRIAL_C5)]);
    const { root, store, session } = fresh(model.client);
    const before = store.load();
    const proposal = propose(session);
    const draft = await session.writeChapter({ chapter: 1, proposalId: proposal.id });
    expect(draft.status, JSON.stringify(draft.findings)).toBe("ready");
    expect(draft.writeContext?.proposalId).toBe(proposal.id);
    expect(JSON.stringify(model.calls[0])).toContain("李长风");
    expect(store.load()).toEqual(before);
    expect(session.preparation.get(proposal.id).status).toBe("proposed");
    const view = handle(session, { method: "GET", path: "/api/chapter/draft", query: new URLSearchParams({ n: "1", id: draft.draftId }), body: undefined });
    expect(view.body).toMatchObject({ preparationProposalId: proposal.id });
    expect(session.adopt(1, draft.draftId).changed).toBe(true);
    const reopened = new ProjectSession(root);
    expect(reopened.preparation.get(proposal.id).status).toBe("confirmed");
    expect(reopened.chapterText(1)).toBe(draft.body);
    expect(reopened.events().some((e) => e.envelope.chapter === 1 && e.envelope.provenance === "committed")).toBe(true);
    expect(reopened.adopt(1, draft.draftId).changed).toBe(false);
  });

  it("C5 失败后重开只恢复声明，仍保留未确认的方案依赖", async () => {
    const first = fakeClient([modelText(trialProse()), { kind: "error", error: { type: "connection", status: null, message: "test disconnect", retryable: true } }]);
    const { root, session } = fresh(first.client);
    const proposal = propose(session);
    const failed = await session.writeChapter({ chapter: 1, proposalId: proposal.id });
    expect(failed.error?.step).toBe("C5");
    const next = fakeClient([modelText(TRIAL_C5)]);
    const reopened = new ProjectSession(root, undefined, { client: next.client });
    const resumed = await reopened.writeChapter({ chapter: 1, draftId: failed.draftId });
    expect(resumed.status).toBe("ready");
    expect(next.calls).toHaveLength(1);
    expect(resumed.body).toBe(failed.body);
    expect(reopened.meta.characters).toEqual([]);
    expect(reopened.preparation.get(proposal.id).status).toBe("proposed");
  });

  it("试写后另一个方案改变资料时，旧试写稿不能覆盖新选择", async () => {
    const model = fakeClient([modelText(trialProse()), modelText(TRIAL_C5)]);
    const { session } = fresh(model.client);
    const proposal = propose(session);
    const draft = await session.writeChapter({ chapter: 1, proposalId: proposal.id });
    session.preparation.recordAuthor({ summary: "更新偏好", changes: { writingRules: ["对话少用感叹号"] }, baseFingerprint: session.preparation.view().fingerprint });
    expect(() => session.adopt(1, draft.draftId)).toThrow(/发生变化|较早版本/u);
    expect(session.preparation.get(proposal.id).status).toBe("proposed");
    expect(session.currentChapter).toBe(0);
  });

  it("打包采用正文保存失败时，候选资料和方案状态一起撤回", async () => {
    const model = fakeClient([modelText(trialProse()), modelText(TRIAL_C5)]);
    const { root, store, session } = fresh(model.client);
    const before = store.load();
    const proposal = propose(session);
    const draft = await session.writeChapter({ chapter: 1, proposalId: proposal.id });
    const obstacle = join(root, "chapters", "ch1.txt");
    mkdirSync(obstacle, { recursive: true });
    expect(() => session.adopt(1, draft.draftId)).toThrow();
    rmSync(obstacle, { recursive: true });
    expect(store.load()).toEqual(before);
    expect(session.meta.characters).toEqual([]);
    expect(session.preparation.get(proposal.id).status).toBe("proposed");
    expect(new DraftStore(root).loadDraft(1, draft.draftId)?.status).toBe("ready");
    expect(session.adopt(1, draft.draftId).changed).toBe(true);
  });
});
