/**
 * 资料页「让 AI 起草」的服务端行为。
 *
 * 起草是一次**没有人坐在旁边**的自动回合（作者只按了一个按钮），所以这里盯住三件事：
 *   ① 它只落候选方案，不替作者确认、不写章（受限工具集）；
 *   ② 它不往对话历史里塞一条作者没打过的字；
 *   ③ schema 不合规时校验错误回喂给模型让它自己改，而不是直接失败或放宽闸门。
 *
 * 全部用脚本化假客户端，不调用真实模型。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { EXPECTED_PREPARATION_DRAFT_TOOL_ORDER } from "../src/agent/tools.js";
import type { CallResult } from "../src/client/claude.js";
import { fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** 只有一句想法的空作品：人物、地点、情节线、节拍、正文全都还没有。 */
function fresh(results: readonly CallResult[]) {
  const root = mkdtempSync(join(tmpdir(), "nf-draft-"));
  roots.push(root);
  const store = new ProjectStore(root);
  const base = writingSnapshot();
  store.save({
    ...base,
    setting: { ...base.setting, centralConflict: "", openingSituation: "" },
    characters: [], settings: [], plotLines: [], beats: [], events: [], chapters: new Map(),
  });
  const { client, calls } = fakeClient(results);
  return { root, client, calls, session: new ProjectSession(root, undefined, { client }) };
}

const toolUse = (name: string, input: unknown): CallResult => ({
  kind: "ok",
  message: modelMessage(
    [{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
    "tool_use",
  ),
});

/** 一份 schema 合法的人物。 */
function drafted(id: string, name: string) {
  return {
    id, name, aliases: [], tier: "protagonist",
    profile: {
      role: "年轻账房，负责核对河运旧账", appearance: [], traits: ["谨慎", "认死理"],
      forbiddenBehaviors: [], wants: "在旧账清空前找到失踪的账页", fears: "查到最后发现父亲也在其中",
      background: "十四岁入账房，师父三年前失踪。",
    },
    speech: {
      sentenceLength: { min: 4, max: 14 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [],
      syntaxBias: { question: 0.1, imperative: 0.2, elliptical: 0.4 },
      register: "colloquial", emotionalExpression: "suppressed",
      exemplars: ["这本账对不上。"], counterExemplars: [],
    },
  };
}
const proposedInput = (session: ProjectSession, characters: unknown[]) => ({
  summary: "起草人物档案", baseFingerprint: session.preparation.view().fingerprint, changes: { characters },
});

describe("资料页的 AI 起草", () => {
  it("起草的工具集只读与提案，拿不到确认、写章与采用", () => {
    // 起草无人盯着，拿到这三类工具就是越权：替作者拍板，或动用他并没要求的创作产能。
    for (const forbidden of ["confirm_preparation", "record_author_details", "write_next_chapter", "adopt_chapter", "revise_chapter_draft"]) {
      expect(EXPECTED_PREPARATION_DRAFT_TOOL_ORDER).not.toContain(forbidden);
    }
    expect(EXPECTED_PREPARATION_DRAFT_TOOL_ORDER).toContain("propose_preparation");
    expect(EXPECTED_PREPARATION_DRAFT_TOOL_ORDER).toContain("get_preparation");
  });

  it("apply=true 只落候选方案：不确认、不写对话历史、不产生正文", async () => {
    const { root, session, calls } = fresh([toolUse("propose_preparation", {}), modelText("已起草沈砚。")]);
    const input = proposedInput(session, [drafted("C_ShenYan", "沈砚")]);
    calls.length = 0; // 上面那次只用于取指纹，这里重来一遍完整的脚本
    const scripted = fakeClient([toolUse("propose_preparation", input), modelText("已起草沈砚，性格与说话方式都补上了。")]);
    const run = new ProjectSession(root, undefined, { client: scripted.client });

    const result = await run.draftPreparation({ focus: "characters", apply: true });

    expect(result.proposalId).toBeDefined();
    expect(result.proposalId).toMatch(/^proposal-/u);
    const proposal = run.preparation.get(result.proposalId!);
    expect(proposal.status).toBe("proposed");
    expect(proposal.source).toBe("assistant");
    expect(proposal.content.characters[0]?.name).toBe("沈砚");
    // 作者只按了按钮，没在对话里说过话 —— 历史必须是空的。
    expect(run.conversationTurns()).toEqual([]);
    // 起草不是创作：没有正文，正式资料也没变。
    expect(run.meta.characters).toEqual([]);
    expect(run.currentChapter).toBe(0);
    // 受限工具集真的装到了这次调用上。
    expect(scripted.calls[0]!.tools!.map((t) => t.name)).toEqual([...EXPECTED_PREPARATION_DRAFT_TOOL_ORDER]);
  });

  it("apply=false 是试填：交出草稿人物，一个文件都不落", async () => {
    const { root, session } = fresh([modelText("略")]);
    const input = proposedInput(session, [drafted("C_ShenYan", "沈砚")]);
    const scripted = fakeClient([toolUse("propose_preparation", input), modelText("试填完成。")]);
    const run = new ProjectSession(root, undefined, { client: scripted.client });
    const before = readdirSync(root).sort();

    const result = await run.draftPreparation({ focus: "characters", apply: false });

    expect(result.characters.map((c) => c.name)).toEqual(["沈砚"]);
    expect(result.proposalId).toBeUndefined();
    // 试填只是在表单里填上，作者还没点头 —— 方案目录都不该存在，更不能有方案。
    expect(run.preparation.view().proposals).toEqual([]);
    expect(readdirSync(root).sort()).toEqual(before);
    expect(run.conversationTurns()).toEqual([]);
  });

  it("schema 不合规时把校验错误回喂给模型，模型改好即通过（不靠放宽闸门）", async () => {
    const { root, session } = fresh([modelText("略")]);
    const incomplete = { id: "C_X", name: "无名", aliases: [], tier: "major", profile: { role: "人", appearance: [], traits: [], forbiddenBehaviors: [], wants: "", fears: "", background: "" } };
    const good = proposedInput(session, [drafted("C_ShenYan", "沈砚")]);
    const scripted = fakeClient([
      toolUse("propose_preparation", { summary: "草稿", baseFingerprint: good.baseFingerprint, changes: { characters: [incomplete] } }),
      toolUse("propose_preparation", good),
      modelText("补上说话方式后保存了方案。"),
    ]);
    const run = new ProjectSession(root, undefined, { client: scripted.client });

    const result = await run.draftPreparation({ focus: "characters", apply: true });

    expect(result.proposalId).toBeDefined();
    expect(run.preparation.view().proposals).toHaveLength(1);
    // 第二次调用必须看到第一次的报错，否则模型无从知道要补什么。
    const blocks = scripted.calls[1]!.messages.flatMap((m) => Array.isArray(m.content) ? m.content : []);
    const toolResults = blocks.filter((b) => (b as { type: string }).type === "tool_result") as unknown as { content: string; is_error?: boolean }[];
    expect(toolResults[0]?.is_error).toBe(true);
    expect(toolResults[0]?.content).toContain("speech");
  });

  it("模型一个方案都没提时明确报错，不假装起草成功", async () => {
    const { root } = fresh([modelText("这个想法还太模糊，我再想想。")]);
    const scripted = fakeClient([modelText("这个想法还太模糊，我再想想。")]);
    const run = new ProjectSession(root, undefined, { client: scripted.client });

    await expect(run.draftPreparation({ focus: "characters", apply: true })).rejects.toThrow(/没有保存出方案/u);
    expect(run.preparation.view().proposals).toEqual([]);
  });

  it("试填模式下模型什么都没交时同样明确报错", async () => {
    const { root } = fresh([modelText("略")]);
    const scripted = fakeClient([modelText("我建议你先自己想想。")]);
    const run = new ProjectSession(root, undefined, { client: scripted.client });

    await expect(run.draftPreparation({ focus: "characters", apply: false })).rejects.toThrow(/没有产出可用的资料/u);
  });
});
