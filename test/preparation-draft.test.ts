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
import { MaterialStore } from "../src/import/materials.js";
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
  it("整项目资料整理归并人物与大纲节点，只保存候选且不能夹带正文/设定变更",async()=>{
    const setup=fresh([]);new MaterialStore(setup.root).save("大纲.md","林舟发现旧账。");
    const baseFingerprint=setup.session.preparation.fingerprint();
    const model=fakeClient([
      toolUse("propose_preparation",{summary:"越界",baseFingerprint,changes:{setting:{premise:"另一本书"}}}),
      toolUse("propose_preparation",{summary:"归并人物",baseFingerprint,changes:{characters:[drafted("C_Lin","林舟")]}}),modelText("人物已汇总。"),
      toolUse("propose_preparation",{summary:"整理大纲",baseFingerprint,changes:{plotLines:[{id:"P_Main",label:"查账",weight:"main"}],outlineNodes:[{id:"N_First",plotLine:"P_Main",chapter:null,order:1,summary:"林舟发现旧账",kind:"info",characters:[],source:{file:"大纲.md",quote:"林舟发现旧账。"}}]}}),modelText("剧情已汇总。")]);
    const session=new ProjectSession(setup.root,undefined,{client:model.client});
    const result=await session.draftPreparation({focus:"materials",apply:true});
    expect(session.preparation.get(result.proposalId!).changes.outlineNodes).toHaveLength(1);
    expect(session.preparation.get(result.proposalId!).changes.outlineNodes?.[0]?.characters).toEqual(["C_Lin"]);
    expect(session.preparation.view().proposals).toHaveLength(1);
    expect(session.preparation.view().confirmed.characters).toEqual([]);expect(session.events()).toEqual([]);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("只能整理人物");
  });
  it("大纲整理只读上传资料，不把正文抽样混成资料出处",async()=>{
    const {root,session,calls}=fresh([]);new MaterialStore(root).save("大纲.md","主角沿旧案追查真相。");
    session.imports.apply({files:[{name:"第一章.txt",text:"第一章 雨夜\n这是只能出现在正文抽样的细节：青铜钟裂开了。"}]});
    await session.draftPreparation({focus:"outline",apply:true}).catch(()=>{});
    const ask=String(calls[0]?.messages[0]?.content);expect(ask).toContain("主角沿旧案追查真相");expect(ask).not.toContain("青铜钟裂开了");
  });
  it("人物表中的命名条目必须归并或说明排除原因，不能静默漏掉",async()=>{
    const setup=fresh([]);new MaterialStore(setup.root).save("人物档案.md","| 角色名称 | 身份 |\n|---|---|\n| 林舟 | 记者 |\n| 茶铺老者 | 老人 |\n");
    const baseFingerprint=setup.session.preparation.fingerprint();
    const model=fakeClient([toolUse("propose_preparation",{summary:"归并人物",baseFingerprint,changes:{characters:[drafted("C_Lin","林舟")]}}),toolUse("propose_preparation",{summary:"归并两位人物",baseFingerprint,changes:{characters:[drafted("C_Lin","林舟"),drafted("C_Elder","茶铺老者")]}}),modelText("已归并全部条目。")]);
    const session=new ProjectSession(setup.root,undefined,{client:model.client});const result=await session.draftPreparation({focus:"materials",apply:false});
    expect(session.preparation.view().proposals).toHaveLength(0);expect(result.characters).toHaveLength(2);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("尚未交代：茶铺老者");
  });
  it("第二步大纲整理失败时不确认或写入第一步人物，原资料和正文保留",async()=>{
    const setup=fresh([]);new MaterialStore(setup.root).save("大纲.md","林舟发现旧账。");const baseFingerprint=setup.session.preparation.fingerprint();
    const model=fakeClient([toolUse("propose_preparation",{summary:"人物",baseFingerprint,changes:{characters:[drafted("C_Lin","林舟")]}}),modelText("人物已整理。")]);
    const session=new ProjectSession(setup.root,undefined,{client:model.client});await expect(session.draftPreparation({focus:"materials",apply:true})).rejects.toThrow();
    expect(session.preparation.view().proposals).toHaveLength(0);expect(session.meta.characters).toEqual([]);expect(new MaterialStore(setup.root).read("大纲.md")).toBe("林舟发现旧账。");
  });
  it("人物覆盖清单遵守资料上下文上限，不要求模型编写未读取的人物",async()=>{
    const setup=fresh([]);new MaterialStore(setup.root).save("人物档案.md","字".repeat(60000)+"\n| 角色名称 | 身份 |\n|---|---|\n| 未读取人物 | 记者 |\n");
    const baseFingerprint=setup.session.preparation.fingerprint();
    const model=fakeClient([toolUse("propose_preparation",{summary:"本次资料有截断，未读取部分需分批整理",baseFingerprint,changes:{characters:[]}}),modelText("已整理可读取部分。")]);
    const session=new ProjectSession(setup.root,undefined,{client:model.client});
    await expect(session.draftPreparation({focus:"materials",apply:false})).resolves.toMatchObject({characters:[]});
    expect(JSON.stringify(model.calls[0]?.messages)).not.toContain("未读取人物");
  });
  it("模型即使伪造未提供的确认工具，也不能在起草时确认候选",async()=>{
    const setup=fresh([]);const p=setup.session.preparation.propose({summary:"等待作者确认",baseFingerprint:setup.session.preparation.fingerprint(),changes:{characters:[drafted("C_Lin","林舟")]}});
    const model=fakeClient([toolUse("confirm_preparation",{proposalId:p.id}),modelText("已处理。")]);const session=new ProjectSession(setup.root,undefined,{client:model.client});
    await session.draftPreparation({focus:"characters",apply:true}).catch(()=>{});
    expect(session.preparation.get(p.id).status).toBe("proposed");expect(session.meta.characters).toEqual([]);
  });
  it("分步整理期间资料换版时不保存混合来源方案",async()=>{
    const setup=fresh([]);const store=new MaterialStore(setup.root);store.save("大纲.md","林舟发现旧账。");
    const baseFingerprint=setup.session.preparation.fingerprint();
    const model=fakeClient([
      toolUse("propose_preparation",{summary:"人物",baseFingerprint,changes:{characters:[]}}),modelText("人物完成。"),
      toolUse("propose_preparation",{summary:"剧情",baseFingerprint,changes:{plotLines:[]}}),modelText("剧情完成。"),
    ]);
    const client=Object.create(model.client) as typeof model.client;
    client.call=async options=>{const result=await model.client.call(options);if(model.calls.length===2)store.save("大纲.md","作者在两步之间修订了资料。");return result;};
    const session=new ProjectSession(setup.root,undefined,{client});
    await expect(session.draftPreparation({focus:"materials",apply:true})).rejects.toThrow(/资料发生变化/u);
    expect(session.preparation.view().proposals).toEqual([]);expect(session.meta.characters).toEqual([]);
  });
  it("没有上传资料时，大纲整理在模型调用前说明缺项",async()=>{
    const {session,calls}=fresh([]);await expect(session.draftPreparation({focus:"outline",apply:true})).rejects.toThrow(/上传.*资料/u);expect(calls).toHaveLength(0);
  });
  it("分章大纲有具体内容时不能静默漏掉终章，标题目录则不强制编满节点",async()=>{
    const setup=fresh([]);new MaterialStore(setup.root).save("分章大纲.md","第一章 雨夜\n林舟收到当票。\n第5000章 归还\n林舟归还当票，结束调查。");
    const baseFingerprint=setup.session.preparation.fingerprint();
    const first={id:"N_First",plotLine:null,chapter:1,order:1,summary:"林舟收到当票",kind:"info",characters:[],source:{file:"分章大纲.md",quote:"第一章 雨夜\n林舟收到当票。"}};
    const last={...first,id:"N_Last",chapter:5000,order:2,summary:"林舟结束调查",source:{file:"分章大纲.md",quote:"第5000章 归还\n林舟归还当票，结束调查。"}};
    const model=fakeClient([toolUse("propose_preparation",{summary:"只提交开篇",baseFingerprint,changes:{outlineNodes:[first]}}),toolUse("propose_preparation",{summary:"完整覆盖",baseFingerprint,changes:{outlineNodes:[first,last]}}),modelText("已补齐。")]);
    const session=new ProjectSession(setup.root,undefined,{client:model.client});const result=await session.draftPreparation({focus:"outline",apply:true});
    expect(session.preparation.get(result.proposalId!).changes.outlineNodes).toHaveLength(2);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("第5000章 归还");expect(session.chapterNumbers()).toEqual([]);
  });

  it("起草参数缺少根级摘要时明确返回完整根对象示例，不把卷纲摘要当成提案摘要", async () => {
    const setup = fresh([]);
    const baseFingerprint = setup.session.preparation.fingerprint();
    const changes = { plotLines: [{ id: "P_Investigation", label: "旧案调查", weight: "main" }] };
    const model = fakeClient([
      toolUse("propose_preparation", { baseFingerprint, changes, volume: { summary: "卷纲" } }),
      toolUse("propose_preparation", { summary: "识别旧案主线", baseFingerprint, changes }),
      modelText("已保存主线方案。"),
    ]);
    const session = new ProjectSession(setup.root, undefined, { client: model.client });
    const result = await session.draftPreparation({ focus: "plotlines", apply: true });
    expect(result.proposalId).toBeTruthy();
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("summary 必须放在根对象");
    expect(session.preparation.view().confirmed.plotLines).toEqual([]);
  });
  it("整份补齐不能重写作者已有想法，错误回喂后只保存缺失资料", async () => {
    const setup = fresh([]);
    const bad = { summary: "改写已有想法", baseFingerprint: setup.session.preparation.fingerprint(), changes: { setting: { premise: "另一部作品的开篇" } } };
    const good = { summary: "补录空白冲突", baseFingerprint: bad.baseFingerprint, changes: { setting: { centralConflict: "记者追查旧票据" } } };
    const model = fakeClient([toolUse("propose_preparation",bad),toolUse("propose_preparation",good),modelText("已补齐缺失项。")]);
    const session = new ProjectSession(setup.root,undefined,{client:model.client});
    const result = await session.draftPreparation({focus:"full",apply:true});
    expect(session.preparation.view().proposals).toHaveLength(1);
    expect(session.preparation.get(result.proposalId!).changes).toEqual(good.changes);
    expect(JSON.stringify(model.calls[1]?.messages)).toContain("只能补齐空白");
  });
  it("整份起草也读取导入材料与末章正文，不凭书名另造主角", async () => {
    const { session, calls } = fresh([]);
    session.imports.apply({ files: [
      { name: "角色档案.txt", text: "唯一主角许临川，拒绝被认入第七。" },
      { name: "1章.txt", text: "第一章 雨夜\n许临川交出当票。" },
      { name: "2章.txt", text: "第二章 停雨\n顾以南在井口收起最后一截黑线。" },
    ] });
    await session.draftPreparation({ focus: "full", apply: true }).catch(() => undefined);
    const ask = JSON.stringify(calls[0]?.messages);
    expect(ask).toContain("唯一主角许临川");
    expect(ask).toContain("最后一截黑线");
    expect(ask).toContain("第 3 章");
  });

  it("缺少正式人物和地点时排章先说明前置条件，不产生模型费用", async () => {
    const { session, calls } = fresh([]);
    await expect(session.draftPreparation({ focus: "chapters", count: 3, apply: true })).rejects.toThrow(/人物.*地点|地点.*人物/u);
    expect(calls).toHaveLength(0);
  });
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
    // 账本是唯一的例外：试填真的调用了模型、真的花了钱，不记才是错的。
    expect(readdirSync(root).filter((name) => name !== "credits.jsonl").sort()).toEqual(before.filter((name) => name !== "credits.jsonl"));
    expect(run.credits().calls).toBeGreaterThan(0);
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
