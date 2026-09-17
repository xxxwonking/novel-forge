/**
 * 谋篇模式：作者在对话栏切进去的只读讨论态。
 *
 * 锁有两道：工具集本身裁掉写类（模型看不到它们），`executeMainTool` 再按 mode 兜一次
 * （将来有人改错工具集也漏不过去）。两道都验，外加：服务按模式换工具集与角色、
 * 提示按筹备缺项分两条路、模式持久化在会话文件里、谋篇回合出方案但正式资料不动。
 * 全部脚本化假客户端，0 次真实调用。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { EXPECTED_PLANNING_MODE_TOOL_ORDER, MAIN_AGENT_TOOLS, PLANNING_ALLOWED_TOOLS, PLANNING_MODE_TOOLS } from "../src/agent/tools.js";
import { executeMainTool, type MainAgentToolContext } from "../src/agent/tool-exec.js";
import { buildMainAgentSystem, planningScopeOf, type MainAgentContextInfo } from "../src/agent/system-prompt.js";
import { ConversationStore } from "../src/agent/conversation-store.js";
import { MainAgentService } from "../src/agent/service.js";
import { handle, handleAsync, type ApiResponse } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import type { CallResult } from "../src/client/claude.js";
import type { ConversationReply } from "../src/agent/types.js";
import type { PreparationChanges } from "../src/preparation/types.js";
import { NO_MODEL_REVIEW, fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const toolUse = (name: string, input: unknown): CallResult => ({
  kind: "ok",
  message: modelMessage([{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock], "tool_use"),
});

function block(name: string, input: unknown): Anthropic.ToolUseBlock {
  return { type: "tool_use", id: "t1", name, input } as unknown as Anthropic.ToolUseBlock;
}

function fakeCtx(over: Partial<MainAgentToolContext> = {}): MainAgentToolContext {
  const stub = async (): Promise<never> => { throw new Error("谋篇模式下不该走到写入入口"); };
  return {
    prepareTextExport: stub, reviseDraft: stub, getChapterDraft: () => "DRAFT", correctDraft: stub, checkDraft: stub,
    listChapterTasks: () => "[]", controlChapterTask: stub, getPreparation: () => "PREPARATION",
    proposePreparation: async () => ({ message: "方案已保存", effect: { kind: "preparation_proposed", proposalId: "proposal-1", summary: "开篇" } }),
    confirmPreparation: stub, getOverview: () => "OVERVIEW", getStoryProgress: () => "PROGRESS", listChapterDrafts: () => "DRAFTS",
    getChapterText: () => "TEXT", getCharacter: () => "CARD", listOpenForeshadows: () => "FS", getNextPlan: () => "PLAN",
    addToNextChapter: stub, rescheduleForeshadow: stub, abandonForeshadow: stub,
    recordIdea: async (text) => ({ message: "已记录", effect: { kind: "idea_recorded", id: "idea1", text } }),
    writeNextChapter: stub, adoptChapter: stub,
    ...over,
  };
}

describe("PLANNING_MODE_TOOLS", () => {
  it("顺序与 EXPECTED_PLANNING_MODE_TOOL_ORDER 逐位一致", () => {
    expect(PLANNING_MODE_TOOLS.map((t) => t.name)).toEqual([...EXPECTED_PLANNING_MODE_TOOL_ORDER]);
  });

  it("不含任何会改动作品或启动任务的工具 —— 只读锁是结构性的", () => {
    const names = new Set(PLANNING_MODE_TOOLS.map((t) => t.name));
    for (const t of ["confirm_preparation", "record_author_details", "write_next_chapter", "adopt_chapter", "revise_chapter_draft",
      "correct_draft_structure", "check_chapter_draft", "control_chapter_task", "prepare_text_export",
      "plan_add_to_chapter", "plan_reschedule_foreshadow", "plan_abandon_foreshadow"]) expect(names.has(t)).toBe(false);
    expect(names.has("propose_preparation")).toBe(true);
  });

  it("定义与常规工具集同一份对象，允许名单与工具集一致", () => {
    const main = new Map(MAIN_AGENT_TOOLS.map((t) => [t.name, t]));
    for (const t of PLANNING_MODE_TOOLS) expect(t).toBe(main.get(t.name));
    expect([...PLANNING_ALLOWED_TOOLS].sort()).toEqual([...EXPECTED_PLANNING_MODE_TOOL_ORDER].sort());
  });
});

describe("executeMainTool 的模式兜底", () => {
  it("谋篇模式下命中写类工具：回 is_error、不产 effect、不碰受控入口", async () => {
    const confirm = vi.fn();
    const r = await executeMainTool(block("confirm_preparation", { proposalId: "proposal-1" }), fakeCtx({ confirmPreparation: confirm as never }), "planning");
    expect(r.result.is_error).toBe(true);
    expect(r.result.content).toContain("propose_preparation");
    expect(r.effect).toBeUndefined();
    expect(confirm).not.toHaveBeenCalled();
  });

  it("谋篇模式下读类、备选、出方案照常", async () => {
    expect((await executeMainTool(block("get_preparation", {}), fakeCtx(), "planning")).result.content).toBe("PREPARATION");
    expect((await executeMainTool(block("record_alternative_idea", { text: "师父是反派" }), fakeCtx(), "planning")).effect).toMatchObject({ kind: "idea_recorded" });
    expect((await executeMainTool(block("propose_preparation", { summary: "s" }), fakeCtx(), "planning")).effect).toMatchObject({ kind: "preparation_proposed" });
  });

  it("缺省模式是 normal —— 锁要显式打开", async () => {
    const adopt = vi.fn(async (draftId: string) => ({ message: "已采用", effect: { kind: "chapter_adopted" as const, chapter: 3, draftId, superseded: 0, staleMarked: [] } }));
    const r = await executeMainTool(block("adopt_chapter", { draftId: "ch3d1" }), fakeCtx({ adoptChapter: adopt as never }));
    expect(r.effect).toMatchObject({ kind: "chapter_adopted" });
  });
});

const EMPTY: MainAgentContextInfo = {
  title: "新书", genre: "mystery", platform: "fanqie", currentChapter: 0, nextChapter: 1, nextPlanReady: false, pendingDrafts: 0,
  readinessMissing: ["核心冲突", "故事起点", "已确认的主角档案", "第 1 章的已确认计划"],
};
const WRITING: MainAgentContextInfo = { ...EMPTY, currentChapter: 12, nextChapter: 13, nextPlanReady: true, readinessMissing: [] };
const planning = (info: MainAgentContextInfo): string => buildMainAgentSystem(info, "planning")[0]?.text ?? "";

describe("谋篇模式的系统提示", () => {
  it("scope 由筹备缺项判定，不让模型选", () => {
    expect(planningScopeOf(EMPTY)).toBe("preparation");
    expect(planningScopeOf(WRITING)).toBe("revision");
    const { readinessMissing: _m, ...bare } = EMPTY;
    expect(planningScopeOf(bare)).toBe("revision");
  });

  it("开宗明义说清改不动作品、不许假装做过；缺项列在提示里", () => {
    const t = planning(EMPTY);
    expect(t).toContain("谋篇模式");
    expect(t).toContain("改不动作品");
    expect(t).toContain("不要说“我已经建好了/已经改成了”");
    expect(t).toContain("核心冲突、故事起点");
  });

  it("筹备未齐：从零带，不追问核心冲突；已在写作：先读再提", () => {
    expect(planning(EMPTY)).toContain("一句话冲动");
    expect(planning(EMPTY)).not.toContain("先读再提");
    expect(planning(WRITING)).toContain("先读再提");
    expect(planning(WRITING)).toContain("list_open_foreshadows");
    expect(planning(WRITING)).not.toContain("一句话冲动");
  });

  it("常规提示没有谋篇指令，但告诉作者有这个模式且自己切不了", () => {
    const normal = buildMainAgentSystem(WRITING)[0]?.text ?? "";
    expect(normal).toContain("谋篇模式");
    expect(normal).toContain("你自己切不了模式");
    expect(normal).not.toContain("一句话冲动");
  });
});

describe("MainAgentService 按模式选工具集与角色", () => {
  it("planning：creative 角色、只读工具集、轮数取 maxPlanningRounds、回复带 mode", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-plan-svc-"));
    roots.push(root);
    const store = new ConversationStore(root);
    store.setMode("planning");
    const { client, calls } = fakeClient([modelText("先聊聊主角。")]);
    const svc = new MainAgentService({ client, store, ctx: fakeCtx(), contextInfo: () => EMPTY, maxRounds: 8, maxPlanningRounds: 12 });
    const reply = await svc.send("我不知道写什么");
    expect(reply.mode).toBe("planning");
    expect(calls[0]?.role).toBe("creative");
    expect(calls[0]?.tools?.map((t) => t.name)).toEqual([...EXPECTED_PLANNING_MODE_TOOL_ORDER]);
    expect(calls[0]?.system?.[0]?.text).toContain("谋篇模式");
    // 模式随回合落盘，不因 appendExchange 整份重写而丢。
    expect(store.load().mode).toBe("planning");
  });

  it("normal：judge 角色与完整工具集", async () => {
    const root = mkdtempSync(join(tmpdir(), "nf-plan-svc-"));
    roots.push(root);
    const { client, calls } = fakeClient([modelText("好的。")]);
    const svc = new MainAgentService({ client, store: new ConversationStore(root), ctx: fakeCtx(), contextInfo: () => WRITING, maxRounds: 8, maxPlanningRounds: 12 });
    expect((await svc.send("写到哪了")).mode).toBe("normal");
    expect(calls[0]?.role).toBe("judge");
    expect(calls[0]?.tools).toBe(MAIN_AGENT_TOOLS);
  });
});

/** 只有一句想法的空作品：人物、地点、情节线、节拍、正文全都还没有。 */
function fresh(results: readonly CallResult[] = []) {
  const root = mkdtempSync(join(tmpdir(), "nf-plan-api-"));
  roots.push(root);
  const store = new ProjectStore(root);
  const base = writingSnapshot();
  store.save({ ...base, setting: { ...base.setting, centralConflict: "", openingSituation: "" }, characters: [], settings: [], plotLines: [], beats: [], events: [], chapters: new Map() });
  const { client, calls } = fakeClient(results);
  return { root, store, calls, client, session: new ProjectSession(root, NO_MODEL_REVIEW, { client }) };
}
/** 一份能过校验的首章方案：把 fixture 里的人物/地点/情节线/首章计划整体提出来。 */
function firstChapterChanges(): PreparationChanges {
  const source = writingSnapshot();
  return {
    setting: { centralConflict: source.setting.centralConflict, openingSituation: source.setting.openingSituation },
    characters: source.characters.map(({ provenance: _p, introducedAt: _i, updatedAt: _u, ...card }) => card),
    settings: source.settings, plotLines: source.plotLines,
    beats: [{ chapter: 1, volume: 1, plan: { ...source.beats[0]!.plan, chapterType: "event", resolves: [] } }],
  };
}
const get = (session: ProjectSession, path: string): ApiResponse => handle(session, { method: "GET", path, query: new URLSearchParams(), body: null });
const post = (session: ProjectSession, path: string, body: unknown): Promise<ApiResponse> => handleAsync(session, { method: "POST", path, query: new URLSearchParams(), body });

describe("/api/conversation/mode 与谋篇回合", () => {
  it("默认 normal；切换后 GET 带上；落在会话文件里，新建 session 也读得到", async () => {
    const { root, session } = fresh();
    expect((get(session, "/api/conversation").body as { mode: string }).mode).toBe("normal");
    expect((await post(session, "/api/conversation/mode", { mode: "planning" })).body).toEqual({ mode: "planning" });
    expect((get(session, "/api/conversation").body as { mode: string }).mode).toBe("planning");
    expect(new ProjectSession(root, NO_MODEL_REVIEW).conversationMode()).toBe("planning");
    expect((await post(session, "/api/conversation/mode", { mode: "谋篇" })).status).toBe(400);
  });

  it("谋篇回合出方案：候选落盘、正式资料一字不动、回复带 mode 与 preparation_proposed", async () => {
    const { store, session, calls, client } = fresh();
    await post(session, "/api/conversation/mode", { mode: "planning" });
    const before = store.load();
    let round = 0;
    // 指纹要在回合内现算：propose 会核对它与当前资料一致。
    vi.mocked(client.call).mockImplementation(async (options) => {
      calls.push(options);
      round += 1;
      if (round === 1) return toolUse("propose_preparation", { summary: "密库开篇方案", changes: firstChapterChanges(), baseFingerprint: session.preparation.view().fingerprint });
      return modelText("方案在资料页，你看看。");
    });
    const res = await post(session, "/api/conversation", { text: "把这个方向定下来" });
    expect(res.status).toBe(200);
    const reply = res.body as ConversationReply;
    expect(reply.mode).toBe("planning");
    expect(reply.effects).toContainEqual(expect.objectContaining({ kind: "preparation_proposed" }));
    expect(store.load()).toEqual(before);
    expect(session.preparation.view().proposals).toHaveLength(1);
    expect(calls[0]).toMatchObject({ role: "creative" });
  });

  it("谋篇模式下模型直接确认方案：被兜底挡下，资料不变，回合无 effect", async () => {
    const { store, session } = fresh([toolUse("confirm_preparation", { proposalId: "proposal-x" }), modelText("这个模式下我改不了。")]);
    await post(session, "/api/conversation/mode", { mode: "planning" });
    const before = store.load();
    const res = await post(session, "/api/conversation", { text: "直接确认" });
    expect(res.status).toBe(200);
    expect((res.body as ConversationReply).effects).toEqual([]);
    expect(store.load()).toEqual(before);
  });
});
