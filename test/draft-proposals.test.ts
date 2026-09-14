import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import { handle, handleAsync } from "../src/server/api.js";
import { buildChapterReadSource, buildChapterRunInput, chapterInputFingerprint } from "../src/server/chapter-input.js";
import { parseC5 } from "../src/chapter/c5-schema.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import type { ChapterDraft, DraftProposal } from "../src/task/types.js";
import type { ModelClient } from "../src/client/model.js";
import { C5_JSON, PROSE, WRITE_BEAT, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const proposals: readonly DraftProposal[] = [
  { kind: "character_update", name: "李长风", field: "profile.background", value: "曾为密库抄书人", reason: "李长风认出了自己当年抄写的字迹。" },
  { kind: "foreshadow", label: "失落的副本", intent: "后来揭露另一份账本掌握在守夜人手中。", weight: "sub", expectedBy: 8 },
  { kind: "character_update", name: "李长风", field: "profile.fears", value: "怕旧身份被揭露", reason: "保留为另一个方向。" },
];
type View = ChapterDraft & { revisionToken: string; proposalOptions: { index: number; available: boolean; problem: string | null; from: string | null; to: string; status: string }[] };
const req = (path: string, body: unknown) => ({ method: "POST", path, body, query: new URLSearchParams() });
function view(session: ProjectSession, draftId = "ch3d1"): View {
  const result = handle(session, { method: "GET", path: "/api/chapter/draft", body: null, query: new URLSearchParams({ n: "3", id: draftId }) });
  expect(result.status).toBe(200);
  return result.body as View;
}
function fixture(client?: ModelClient, entries = proposals) {
  const root = mkdtempSync(join(tmpdir(), "nf-draft-proposals-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const session = new ProjectSession(root, undefined, client === undefined ? {} : { client });
  const store = new DraftStore(root);
  const target = deriveBudget(WRITE_BEAT.plan, session.meta.profile, session.rules).words.sweet;
  const start = PROSE + "李长风认出了自己当年抄写的字迹。";
  const body = start + "风".repeat(target - countWords(start));
  const input = buildChapterRunInput(session, 3);
  const declaration = parseC5(JSON.parse(C5_JSON), { ...input.parseContextBase, chapterText: body }).declaration;
  store.saveDraft(savedDraft({ body, declaration, proposals: entries,
    writeContext: { fingerprint: chapterInputFingerprint(session, 3), autoRevisionLimit: 0 },
  }));
  return { root, session, store, body };
}
function adopt(session: ProjectSession, selectedProposals?: unknown, token = view(session).revisionToken) {
  return handle(session, req("/api/chapter/adopt", { chapter: 3, draftId: "ch3d1",
    ...(selectedProposals === undefined ? {} : { selectedProposals, revisionToken: token }),
  }));
}

describe("写作建议的具体选择与采用", () => {
  it("查看建议展示人物原值和新值，不改资料、规划或正文", () => {
    const { session, root } = fixture();
    const before = new ProjectStore(root).load();
    const draft = view(session);
    expect(draft.proposalOptions).toHaveLength(3);
    expect(draft.proposalOptions[0]).toMatchObject({ index: 0, available: true, status: "suggested", to: "曾为密库抄书人" });
    expect(draft.proposalOptions[0]?.from).toBe(session.meta.characters[0]?.profile.background);
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("选择的资料和未来伏笔与正文同时采用，未选择的建议不生效", () => {
    const { session, store, root, body } = fixture();
    const beforeFears = session.meta.characters[0]?.profile.fears;
    const source = view(session);
    const result = adopt(session, [0, 1], source.revisionToken);
    expect(result.status, JSON.stringify(result.body)).toBe(200);
    expect(session.meta.characters[0]?.profile.background).toBe("曾为密库抄书人");
    expect(session.meta.characters[0]?.profile.fears).toBe(beforeFears);
    expect(session.chapterText(3)).toBe(body);
    const planned = session.derived.projections.foreshadows.find(f => f.label === "失落的副本");
    expect(planned).toMatchObject({ status: "planned", expectedBy: 8 });
    expect(buildChapterReadSource(session, 4).listOpenForeshadows("all")).not.toContain("失落的副本");
    expect(buildChapterReadSource(session, 4).loadCharacter("李长风")).toContain("曾为密库抄书人");
    expect(view(session).proposalOptions.map(p => p.status)).toEqual(["applied", "applied", "not_selected"]);
    expect(view(session).proposalOptions[0]?.from).toBe(source.proposalOptions[0]?.from);
    const reopened = new ProjectSession(root);
    expect(reopened.meta.characters[0]?.profile.background).toBe("曾为密库抄书人");
    expect(reopened.derived.projections.foreshadows.find(f => f.id === planned?.id)?.status).toBe("planned");
    expect(store.workVersion()).toBe(1);
    const events = session.events();
    expect(adopt(session, [0, 1], source.revisionToken).status).toBe(200);
    expect(session.events()).toEqual(events);
    expect(store.workVersion()).toBe(1);
    expect(adopt(session, [2], source.revisionToken).status).toBe(409);
  });

  it("只采用正文时不自动接受写作建议", () => {
    const { session } = fixture();
    const characters = session.meta.characters;
    expect(adopt(session).status).toBe(200);
    expect(session.meta.characters).toEqual(characters);
    expect(session.derived.projections.foreshadows.some(f => f.label === "失落的副本")).toBe(false);
    expect(view(session).proposalOptions.every(p => p.status === "not_selected")).toBe(true);
  });

  it("伏笔建议不能重复创建本稿已经声明埋设的同一条线索", () => {
    const { session, store } = fixture();
    const draft = store.loadDraft(3, "ch3d1")!;
    store.saveDraft({ ...draft, declaration: { ...draft.declaration!, foreshadowPlanted: [{
      type: "foreshadow_planted", foreshadowId: "F03", label: "失落的副本", intent: "副本在守夜人手中", weight: "sub", visibility: "covert", expectedBy: 8,
      anchor: { chapter: 3, quote: "旧账本", offsetHint: 0, occurrence: 0 },
    }] } });
    expect(view(session).proposalOptions[1]?.problem).toMatch(/本稿.*埋设/u);
    expect(adopt(session, [1]).status).toBe(400);
    expect(session.currentChapter).toBe(2);
  });

  it("规划编号避开未采用草稿占用的伏笔编号", () => {
    const { session, store } = fixture();
    const draft = store.loadDraft(3, "ch3d1")!;
    store.saveDraft({ ...draft, draftId: "ch3d2", declaration: { ...draft.declaration!, foreshadowPlanted: [{
      type: "foreshadow_planted", foreshadowId: "F77", label: "另一版的线索", intent: "留在另一稿", weight: "sub", visibility: "covert", expectedBy: 8,
      anchor: { chapter: 3, quote: "旧账本", offsetHint: 0, occurrence: 0 },
    }] } });
    expect(adopt(session, [1]).status).toBe(200);
    expect(session.derived.projections.foreshadows.find(f => f.label === "失落的副本")?.id).toBe("F78");
    expect(session.preparation.view().plannedForeshadows).toMatchObject([{ id: "F78", label: "失落的副本" }]);
  });

  it("同一字段的冲突建议不能靠选择顺序静默覆盖", () => {
    const { session } = fixture(undefined, [proposals[0]!, { ...proposals[0], value: "从未去过密库" } as DraftProposal]);
    const before = session.meta.characters;
    expect(adopt(session, [0, 1]).status).toBe(400);
    expect(session.meta.characters).toEqual(before);
    expect(session.currentChapter).toBe(2);
  });

  it("试写依赖和所选建议在同一次采用中确认", () => {
    const { session, store } = fixture();
    const prep = session.preparation.propose({ summary: "试写新偏好", baseFingerprint: session.preparation.fingerprint(), changes: { writingRules: ["第三人称有限视角。", "保留线索的具体细节。"] } });
    const source = session.chapterSource(prep.id);
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, writeContext: { fingerprint: chapterInputFingerprint(source, 3), proposalId: prep.id } });
    expect(adopt(session, [0, 1]).status).toBe(200);
    expect(session.preparation.get(prep.id).status).toBe("confirmed");
    expect(session.meta.discipline.rules).toContain("保留线索的具体细节。");
    expect(session.meta.characters[0]?.profile.background).toBe("曾为密库抄书人");
  });

  it("只检查的请求不能携带隐藏的建议采用意图", async () => {
    const { session } = fixture(); const draft = view(session);
    const response = await handleAsync(session, req("/api/chapter/check", { chapter: 3, draftId: draft.draftId, revisionToken: draft.revisionToken, adoptOnSuccess: false, selectedProposals: [0] }));
    expect(response.status).toBe(400);
    expect(session.getDraft(3, draft.draftId)?.review).toBeUndefined();
    expect(session.currentChapter).toBe(2);
  });

  it.each([[3], [-1], [0, 0], [0.5], ["0"], "all"].map(selection => ({ selection })))("非法建议选择 $selection 不会先采用正文", ({ selection }) => {
    const { session } = fixture();
    expect(adopt(session, selection).status).toBe(400);
    expect(session.currentChapter).toBe(2);
    expect(session.getDraft(3, "ch3d1")?.status).toBe("ready");
  });

  it("旧凭据与已变化的资料都不能被选择请求覆盖", () => {
    const { session } = fixture();
    expect(adopt(session, [0], "a".repeat(64)).status).toBe(409);
    const token = view(session).revisionToken;
    session.putDiscipline({ version: "changed", rules: ["保留作者新设定"] });
    expect(adopt(session, [0], token).status).toBe(409);
    expect(session.currentChapter).toBe(2);
  });

  it.each([
    { ...proposals[0], field: "state.vital", value: "dead" },
    { ...proposals[0], field: "__proto__.polluted", value: "yes" },
    { ...proposals[0], name: "不存在的人" },
    { ...proposals[0], field: "speech.addressForms", value: '[{"target":"C99","form":"先生"}]' },
    { ...proposals[1], expectedBy: 2 },
  ])("无法安全应用的建议只显示问题，选择时整次拒绝：%j", (proposal) => {
    const { session } = fixture(undefined, [proposal as DraftProposal]);
    expect(view(session).proposalOptions[0]).toMatchObject({ available: false });
    expect(view(session).proposalOptions[0]?.problem).toBeTruthy();
    expect(adopt(session, [0]).status).toBe(400);
    expect(session.currentChapter).toBe(2);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("既有不可变外貌冲突不可直接覆盖，但可确认此前未记录的属性", () => {
    const { root, store } = fixture(undefined, [{ ...proposals[0], field: "profile.appearance.惯用手", value: "左手" } as DraftProposal]);
    const snapshot = new ProjectStore(root).load();
    new ProjectStore(root).save({ ...snapshot, characters: snapshot.characters.map(card => ({ ...card, profile: { ...card.profile,
      appearance: card.profile.appearance.map(attribute => attribute.key === "惯用手" ? { ...attribute, establishedAt: 1 } : attribute),
    } })) });
    const reopened = new ProjectSession(root);
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, writeContext: { fingerprint: chapterInputFingerprint(reopened, 3) } });
    expect(view(reopened).proposalOptions[0]?.problem).toMatch(/不可变/u);
    expect(adopt(reopened, [0]).status).toBe(400);
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, proposals: [{ ...proposals[0], field: "profile.appearance.旧伤", value: "左手腕有浅疤" } as DraftProposal] });
    expect(adopt(reopened, [0]).status).toBe(200);
    expect(reopened.meta.characters[0]?.profile.appearance.find(a => a.key === "旧伤")).toMatchObject({ value: "左手腕有浅疤", establishedAt: 3 });
  });

  it("选择人物资料时仍执行本章闸门，不凭旧 ready 状态跳过检查", () => {
    const { session, store } = fixture();
    store.saveDraft({ ...store.loadDraft(3, "ch3d1")!, body: PROSE });
    const before = session.meta.characters;
    expect(adopt(session, [0]).status).toBe(409);
    expect(session.meta.characters).toEqual(before);
    expect(session.chapterText(3)).toBeUndefined();
  });

  it("建议应用后保存失败会回滚所有状态，重试不重复规划", () => {
    const { session, store, root } = fixture();
    const before = new ProjectStore(root).load();
    const token = view(session).revisionToken;
    const original = ProjectStore.prototype.writePreparation;
    vi.spyOn(ProjectStore.prototype, "writePreparation").mockImplementationOnce(function (this: ProjectStore, content) {
      original.call(this, content);
      throw new Error("模拟资料保存中断");
    });
    expect(adopt(session, [0, 1], token).status).toBe(400);
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(session.meta.characters).toEqual(before.characters);
    expect(store.loadDraft(3, "ch3d1")?.status).toBe("ready");
    expect(store.workVersion()).toBe(0);
    expect(adopt(session, [0, 1], token).status).toBe(200);
    expect(session.derived.projections.foreshadows.filter(f => f.label === "失落的副本")).toHaveLength(1);
    expect(readFileSync(join(root, "characters.json"), "utf8")).toContain("曾为密库抄书人");
  });

  it("检查并采用冻结明确选择，重开后收据仍能证明选中了哪些建议", async () => {
    const model = fakeClient([modelText(C5_JSON)]); const { session, root, body } = fixture(model.client);
    const source = view(session);
    const changed = session.editDraft({ chapter: 3, draftId: source.draftId, revisionToken: source.revisionToken, body });
    const draft = view(session, changed.draftId);
    const response = await handleAsync(session, req("/api/chapter/check", { chapter: 3, draftId: draft.draftId, revisionToken: draft.revisionToken, adoptOnSuccess: true, selectedProposals: [0, 1] }));
    expect(response.status).toBe(200);
    await session.writeChapter({ chapter: 3, draftId: draft.draftId });
    const reopened = new ProjectSession(root);
    expect(reopened.meta.characters[0]?.profile.background).toBe("曾为密库抄书人");
    expect(view(reopened, draft.draftId).proposalOptions[1]?.status).toBe("applied");
  });

  it("再修订最新正式章不会把已应用建议再次带入，未选建议仍保留", async () => {
    const { session, body } = fixture(fakeClient([modelText(C5_JSON)]).client);
    expect(adopt(session, [0, 1]).status).toBe(200);
    const source = view(session);
    const edited = session.editDraft({ chapter: 3, draftId: source.draftId, revisionToken: source.revisionToken, body: body + "夜色沉了。" });
    expect(edited.proposals).toEqual([proposals[2]]);
    session.checkDraft({ chapter: 3, draftId: edited.draftId, revisionToken: view(session, edited.draftId).revisionToken, adoptOnSuccess: true });
    await session.writeChapter({ chapter: 3, draftId: edited.draftId });
    expect(session.derived.projections.foreshadows.filter(f => f.label === "失落的副本")).toHaveLength(1);
  });

  it("自然语言选择通过同一采用入口，后续读取立即看到新资料", async () => {
    let call = 0; let token = "";
    const model: ModelClient = { official: false, call: async options => {
      call += 1;
      if (call === 1) return { kind: "ok", message: modelMessage([{ type: "tool_use", id: "adopt", name: "adopt_chapter", caller: { type: "direct" }, input: { draftId: "ch3d1", revisionToken: token, selectedProposals: [0, 1] } }], "tool_use") };
      if (call === 2) return { kind: "ok", message: modelMessage([{ type: "tool_use", id: "read", name: "get_character", caller: { type: "direct" }, input: { name: "李长风" } }], "tool_use") };
      expect(JSON.stringify(options.messages)).toContain("曾为密库抄书人");
      return modelText("已采用正文和选定建议；副本仍是未来规划。");
    } };
    const { session } = fixture(model); token = view(session).revisionToken;
    const reply = await session.converse("采用 ch3d1，并确认第 1、2 条建议。");
    expect(reply.effects.some(e => e.kind === "chapter_adopted")).toBe(true);
    expect(session.meta.characters[0]?.profile.background).toBe("曾为密库抄书人");
  });
});
