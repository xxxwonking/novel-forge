/**
 * 主 Agent 服务的单测：假客户端脚本化四条主线（查询 / 写章 / 含糊“继续”不自动采用 /
 * 采用），并验证对话历史落盘。ctx 用假实现，不触真实写章内部。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { MainAgentService } from "../src/agent/service.js";
import { ConversationStore } from "../src/agent/conversation-store.js";
import type { MainAgentToolContext } from "../src/agent/tool-exec.js";
import type { MainAgentContextInfo } from "../src/agent/system-prompt.js";
import type { CallOptions } from "../src/client/claude.js";
import { fakeClient, modelMessage, modelText } from "./writing-fixtures.js";

const INFO: MainAgentContextInfo = {
  title: "雨夜账册",
  genre: "xuanhuan",
  platform: "fanqie",
  currentChapter: 2,
  nextChapter: 3,
  nextPlanReady: true,
  pendingDrafts: 0,
};

it("显式重发只重试未执行写工具的失败，重复请求返回原收据", async () => {
  const root=mkdtempSync(join(tmpdir(),"nf-retry-"));
  try {
    let calls=0;
    const client={official:false,call:async()=>++calls===1?{kind:"error" as const,error:{type:"connection" as const,status:null,message:"暂时不可达",retryable:true}}:modelText("已恢复")};
    const store=new ConversationStore(root);
    const service=new MainAgentService({client,store,ctx:ctxWith(),contextInfo:()=>INFO,maxRounds:8,maxPlanningRounds:8});
    const failed=await service.send("看看进度",undefined,{requestId:"r1"});
    expect(failed.status).toBe("failed"); expect(failed.retryable).toBe(true);
    const reply=await service.send("看看进度",undefined,{requestId:"r2",retryOf:"r1"});
    expect(reply.text).toBe("已恢复"); expect(store.load().turns.filter(t=>t.role==="user")).toHaveLength(1);
    expect((await service.send("看看进度",undefined,{requestId:"r2",retryOf:"r1"})).text).toBe("已恢复");
    expect(calls).toBe(2);
    await expect(service.send("不同内容",undefined,{requestId:"r2"})).rejects.toThrow();
  } finally { rmSync(root,{recursive:true,force:true}); }
});

it("执行写工具后再失败保留真实effect，禁止整轮重放；中断收据阻止重启后重复执行",async()=>{
  const root=mkdtempSync(join(tmpdir(),"nf-unsafe-retry-"));
  try {
    const store=new ConversationStore(root);
    const failure={kind:"error" as const,error:{type:"connection" as const,status:null,message:"断线",retryable:true}};
    const {client,calls}=fakeClient([toolUse("record_alternative_idea",{text:"方向A"}),failure]);
    const service=new MainAgentService({client,store,ctx:ctxWith(),contextInfo:()=>INFO,maxRounds:8,maxPlanningRounds:8});
    const reply=await service.send("记下这个方向",undefined,{requestId:"write1"});
    expect(reply).toMatchObject({status:"failed",retryable:false,effects:[{kind:"idea_recorded"}]});
    await expect(service.send("记下这个方向",undefined,{requestId:"write2",retryOf:"write1"})).rejects.toThrow();expect(calls).toHaveLength(2);
    store.beginRequest("unfinished","执行状态未知");
    await expect(service.send("新的指令",undefined,{requestId:"write3"})).rejects.toThrow("尚未确定");
  } finally {rmSync(root,{recursive:true,force:true});}
});

it("模型连接中断时保留已经收到的可见片段与失败标记",async()=>{
  const root=mkdtempSync(join(tmpdir(),"nf-partial-chat-"));try {
    const {client}=fakeClient([{kind:"error",partialText:"这段回复已经收到。",error:{type:"connection",status:null,message:"连接中断",retryable:true}}]);
    const service=new MainAgentService({client,store:new ConversationStore(root),ctx:ctxWith(),contextInfo:()=>INFO,maxRounds:8,maxPlanningRounds:8});
    const reply=await service.send("说说方向",undefined,{requestId:"partial"});
    expect(reply.text).toContain("这段回复已经收到。");expect(reply.status).toBe("failed");
  }finally{rmSync(root,{recursive:true,force:true});}
});

function toolUse(name: string, input: unknown) {
  return {
    kind: "ok" as const,
    message: modelMessage(
      [{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
      "tool_use",
    ),
  };
}

function ctxWith(over: Partial<MainAgentToolContext> = {}): MainAgentToolContext {
  return {
    reviseDraft: async () => ({ message: "已启动修订", effect: { kind: "chapter_revised", chapter: 3, draftId: "ch3d2", status: "writing", acceptable: false } }),
    getChapterDraft: () => "DRAFT",
    correctDraft: async () => ({ message: "已保存新记录", effect: { kind: "chapter_revised", chapter: 3, draftId: "ch3d2", status: "pending_check", acceptable: false } }),
    checkDraft: async (draftId) => ({ message: "已开始检查", effect: { kind: "task_updated", chapter: 3, draftId, status: "running" } }),
    getPreparation: () => "PREPARATION",
    listChapterTasks: () => "[]",
    controlChapterTask: async (draftId) => ({ message: "已暂停", effect: { kind: "task_updated", chapter: 3, draftId, status: "paused" } }),
    proposePreparation: async () => ({ message: "方案已保存", effect: { kind: "preparation_proposed", proposalId: "proposal-test", summary: "开篇" } }),
    confirmPreparation: async (proposalId) => ({ message: "已确认", effect: { kind: "preparation_confirmed", proposalId, summary: "开篇" } }),
    getOverview: () => "OVERVIEW",
    getStoryProgress: () => "PROGRESS",
    prepareTextExport: async () => ({ message: "EXPORT", effect: { kind: "export_prepared", exportId: "export-test", chapters: 1 } }),
    listChapterDrafts: () => "DRAFTS",
    getChapterText: () => "TEXT",
    getCharacter: () => "CARD",
    listOpenForeshadows: () => "FS",
    getNextPlan: () => "PLAN",
    addToNextChapter: async () => ({ message: "计划已更新", effect: { kind: "plan_updated", chapter: 3, promotedToPayoff: false } }),
    rescheduleForeshadow: async (foreshadowId, expectedBy) => ({ message: "已改期", effect: { kind: "foreshadow_rescheduled", foreshadowId, expectedBy } }),
    abandonForeshadow: async (foreshadowId) => ({ message: "已废弃", effect: { kind: "foreshadow_abandoned", foreshadowId } }),
    recordIdea: async (text) => ({ message: "已记录", effect: { kind: "idea_recorded", id: "idea1", text } }),
    writeNextChapter: async () => ({ message: "已写草稿", effect: { kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true } }),
    adoptChapter: async (draftId) => ({ message: "已采用", effect: { kind: "chapter_adopted", chapter: 3, draftId, superseded: 0, staleMarked: [] } }),
    ...over,
  };
}

let root: string;
let store: ConversationStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nf-agent-"));
  store = new ConversationStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service(results: Parameters<typeof fakeClient>[0], ctx: MainAgentToolContext = ctxWith()): MainAgentService {
  const { client } = fakeClient(results);
  return new MainAgentService({ client, store, ctx, contextInfo: () => INFO, maxRounds: 8, maxPlanningRounds: 12, clock: () => "2026-09-11T00:00:00.000Z" });
}

describe("MainAgentService.send", () => {
  it("真实工具目录中的编号回填并落盘；跨回合可复用，原模型消息不被改写", async () => {
    const body = "他停在巷子尽头，那里本该只有一堵墙。";
    const calls: CallOptions[] = [];
    let ref = "";
    const client = { official: false, conversationKey: "quotes-target", call: async (opts: CallOptions) => {
      calls.push(opts);
      if (calls.length === 1) return toolUse("get_chapter_text", { chapter: 1 });
      if (calls.length === 2) {
        const results = opts.messages.flatMap(m => typeof m.content === "string" ? [] : m.content);
        const result = results.find(b => b.type === "tool_result");
        if (result?.type === "tool_result" && typeof result.content === "string") ref = result.content.match(/\[\[quote:[^\]]+\]\]/u)![0];
      }
      return modelText(ref);
    } };
    const svc = new MainAgentService({ client, store, ctx: ctxWith({ getChapterText: () => body }), contextInfo: () => INFO, maxRounds: 8, maxPlanningRounds: 12 });
    expect((await svc.send("读第一章并引用原句")).text).toContain(body);
    expect(store.load().turns[1]?.text).not.toContain("[[quote:");
    const history = store.load().modelHistory!.messages;
    expect(history).toContainEqual(expect.objectContaining({ role: "assistant", content: expect.arrayContaining([expect.objectContaining({ type: "text", text: ref })]) }));
    expect(history.at(-1)).toMatchObject({ role: "user", content: expect.stringContaining("程序核验") });
    expect((await svc.send("再引用一次")).text).toContain(body);
    expect(calls).toHaveLength(3);
  });
  it("错误的原文引句不进入可见历史，不因校验再花一轮模型调用", async () => {
    const source = "他停在巷子尽头，那里本该只有一堵墙。";
    const invented = "许临川停在巷子尽头，那里本该只有一堵墙。";
    const { client, calls } = fakeClient([toolUse("get_chapter_text", { chapter: 1 }), modelText(`> “${invented}”`)]);
    const svc = new MainAgentService({ client, store, ctx: ctxWith({ getChapterText: () => source }), contextInfo: () => INFO, maxRounds: 8, maxPlanningRounds: 12 });
    const reply = await svc.send("引用第一章的原文");
    expect(reply.text).toContain("隐藏");
    expect(store.load().turns[1]?.text).not.toContain(invented);
    expect(calls).toHaveLength(2);
  });
  it("纯查询：返回文本、无 effect，两条记录落盘", async () => {
    const reply = await service([modelText("现在写到第 2 章。")]).send("写到哪了？");
    expect(reply.text).toBe("现在写到第 2 章。");
    expect(reply.effects).toEqual([]);
    const turns = store.load().turns;
    expect(turns).toHaveLength(2);
    expect(turns[0]).toMatchObject({ role: "user", text: "写到哪了？" });
    expect(turns[1]).toMatchObject({ role: "agent", text: "现在写到第 2 章。" });
    expect(turns[1]?.effects).toBeUndefined();
  });

  it("写章：产 chapter_written，ctx.writeNextChapter 被调用", async () => {
    const writeNextChapter = vi.fn(ctxWith().writeNextChapter);
    const reply = await service([toolUse("write_next_chapter", {}), modelText("第 3 章草稿写好了。")], ctxWith({ writeNextChapter })).send(
      "按计划写下一章",
    );
    expect(writeNextChapter).toHaveBeenCalledOnce();
    expect(reply.effects).toEqual([{ kind: "chapter_written", chapter: 3, draftId: "ch3d1", status: "ready", acceptable: true }]);
    expect(store.load().turns[1]?.effects).toHaveLength(1);
  });

  it("含糊“继续”：模型只回文本时不采用任何草稿", async () => {
    const adoptChapter = vi.fn(ctxWith().adoptChapter);
    const reply = await service([modelText("你是指采用第 3 章的哪一版？目前有 ch3d1 待采用。")], ctxWith({ adoptChapter })).send("继续");
    expect(adoptChapter).not.toHaveBeenCalled();
    expect(reply.effects).toEqual([]);
  });

  it("采用：产 chapter_adopted，带上 draftId", async () => {
    const adoptChapter = vi.fn(ctxWith().adoptChapter);
    const reply = await service([toolUse("adopt_chapter", { draftId: "ch3d1" }), modelText("已采用。")], ctxWith({ adoptChapter })).send(
      "采用 ch3d1",
    );
    expect(adoptChapter).toHaveBeenCalledWith("ch3d1");
    expect(reply.effects).toEqual([{ kind: "chapter_adopted", chapter: 3, draftId: "ch3d1", superseded: 0, staleMarked: [] }]);
  });

  it("多轮对话：历史累积落盘", async () => {
    await service([modelText("好的。")]).send("第一句");
    await service([modelText("收到。")]).send("第二句");
    const turns = store.load().turns;
    expect(turns.map((t) => t.text)).toEqual(["第一句", "好的。", "第二句", "收到。"]);
  });

  it("第二轮把历史作为消息带给模型", async () => {
    await service([modelText("好的。")]).send("第一句");
    const { client, calls } = fakeClient([modelText("收到。")]);
    const svc = new MainAgentService({ client, store, ctx: ctxWith(), contextInfo: () => INFO, maxRounds: 8, maxPlanningRounds: 12 });
    await svc.send("第二句");
    // 历史两条 + 本轮一条
    const messages = calls[0]?.messages ?? [];
    expect(messages).toHaveLength(3);
    expect(messages.map((m) => m.content)).toEqual(["第一句", "好的。", "第二句"]);
  });

  it("空消息被拒", async () => {
    await expect(service([modelText("x")]).send("   ")).rejects.toThrow();
  });

  it("同一个 store 的并发回合有序执行，后发消息包含先前已完成的回复", async () => {
    const { client, calls } = fakeClient([modelText("第一轮完成"), modelText("第二轮完成")]);
    const first = new MainAgentService({ client, store, ctx: ctxWith(), contextInfo: () => INFO, maxRounds: 8, maxPlanningRounds: 12 });
    const second = new MainAgentService({ client, store, ctx: ctxWith(), contextInfo: () => INFO, maxRounds: 8, maxPlanningRounds: 12 });
    await Promise.all([first.send("第一条"), second.send("第二条")]);
    expect(calls[1]?.messages).toEqual([
      { role: "user", content: "第一条" }, { role: "assistant", content: "第一轮完成" }, { role: "user", content: "第二条" },
    ]);
    expect(store.load().turns.map((turn) => turn.text)).toEqual(["第一条", "第一轮完成", "第二条", "第二轮完成"]);
  });
});
