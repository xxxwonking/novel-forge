/**
 * 谋篇模式的端到端：切模式 → 谋篇回合出方案（作品不动）→ 读方案 → 采纳落盘。
 *
 * 经真实 ProjectSession + 注入假客户端，重点是「采纳时才展开」这条不变量：
 * 出方案那一回合，人物/情节线/节拍一个都不该多出来。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { handle, handleAsync, type ApiResponse } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { loadRules } from "../src/rules/load.js";
import type { ClaudeClient } from "../src/client/claude.js";
import type { Proposal } from "../src/agent/proposal-types.js";
import type { ConversationReply } from "../src/agent/types.js";
import { fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seed(client?: ClaudeClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-plan-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, loadRules(), client === undefined ? {} : { client }) };
}

const get = (session: ProjectSession, path: string, query = ""): ApiResponse =>
  handle(session, { method: "GET", path, query: new URLSearchParams(query), body: null });

const post = (session: ProjectSession, path: string, body: unknown): Promise<ApiResponse> =>
  handleAsync(session, { method: "POST", path, query: new URLSearchParams(), body });

function toolUse(name: string, input: unknown) {
  return {
    kind: "ok" as const,
    message: modelMessage(
      [{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
      "tool_use",
    ),
  };
}

/** 一份两条的方案：新建人物 + 定情节线，第二条引用不到第一条，各自独立。 */
const DRAFT = {
  summary: "把守夜人立成明面上的对手，另开一条信任崩塌的支线。",
  impact: ["F02（钥匙上的红泥）将由守夜人这条线承接"],
  items: [
    { ref: "守夜人", tool: "upsert_character", input: { name: "守夜人", tier: "major", role: "密库看守" }, note: "新建守夜人" },
    { tool: "define_plotline", input: { label: "信任崩塌", weight: "sub" }, note: "新增一条支线" },
  ],
};

describe("对话模式", () => {
  it("默认 normal；切到 planning 后 GET /api/conversation 带上它", async () => {
    const { session } = seed();
    expect((get(session, "/api/conversation").body as { mode: string }).mode).toBe("normal");
    const res = await post(session, "/api/conversation/mode", { mode: "planning" });
    expect(res.status).toBe(200);
    expect((get(session, "/api/conversation").body as { mode: string }).mode).toBe("planning");
  });

  it("模式落在会话文件里，新建 session 也读得到 —— 刷新页面不会把锁打开", async () => {
    const { root, session } = seed();
    await post(session, "/api/conversation/mode", { mode: "planning" });
    expect(new ProjectSession(root, loadRules()).conversationMode()).toBe("planning");
  });

  it("非法 mode 回 400", async () => {
    const { session } = seed();
    expect((await post(session, "/api/conversation/mode", { mode: "谋篇" })).status).toBe(400);
  });
});

describe("谋篇回合", () => {
  it("出方案落 proposals.json，但作品一个字没动", async () => {
    const model = fakeClient([toolUse("propose_plan", DRAFT), modelText("方案在中间区，你看看。")]);
    const { root, session } = seed(model.client);
    await post(session, "/api/conversation/mode", { mode: "planning" });

    const before = { characters: session.meta.currentChapter, plotLines: get(session, "/api/prep").body };
    const res = await post(session, "/api/conversation", { text: "我想给守夜人加条线" });

    expect(res.status).toBe(200);
    const reply = res.body as ConversationReply;
    expect(reply.mode).toBe("planning");
    expect(reply.effects).toContainEqual(
      expect.objectContaining({ kind: "proposal_ready", id: "p1", version: 1, items: 2 }),
    );
    expect(existsSync(join(root, "proposals.json"))).toBe(true);
    // 「采纳时才展开」：这一回合筹备资料与进度都不变。
    expect(get(session, "/api/prep").body).toEqual(before.plotLines);
    expect(session.meta.currentChapter).toBe(before.characters);
  });

  it("谋篇模式下模型直接调写类工具：被兜底挡下，作品不变", async () => {
    const model = fakeClient([
      toolUse("upsert_character", { name: "守夜人", tier: "major" }),
      modelText("这个模式下我改不了，我把它写进方案里。"),
    ]);
    const { session } = seed(model.client);
    await post(session, "/api/conversation/mode", { mode: "planning" });

    const res = await post(session, "/api/conversation", { text: "直接把守夜人建了" });
    expect(res.status).toBe(200);
    expect((res.body as ConversationReply).effects).toEqual([]);
    const prep = get(session, "/api/prep").body as { characters: unknown[] };
    expect(prep.characters).toHaveLength(2); // 仍是 fixture 里的 C01/C02
  });

  it("方案入参不合法：回合里没有 effect，作者那边不留噪声", async () => {
    const model = fakeClient([
      toolUse("propose_plan", { summary: "s", items: [{ tool: "write_next_chapter", input: {}, note: "写章" }] }),
      modelText("我重新整理一下。"),
    ]);
    const { session } = seed(model.client);
    await post(session, "/api/conversation/mode", { mode: "planning" });
    const res = await post(session, "/api/conversation", { text: "出个方案" });
    expect((res.body as ConversationReply).effects).toEqual([]);
    expect((get(session, "/api/proposals").body as unknown[])).toHaveLength(0);
  });
});

describe("/api/proposal", () => {
  async function withProposal() {
    const model = fakeClient([toolUse("propose_plan", DRAFT), modelText("方案好了。")]);
    const seeded = seed(model.client);
    await post(seeded.session, "/api/conversation/mode", { mode: "planning" });
    await post(seeded.session, "/api/conversation", { text: "出个方案" });
    return seeded;
  }

  it("列表与详情", async () => {
    const { session } = await withProposal();
    expect((get(session, "/api/proposals").body as Proposal[]).map((p) => p.id)).toEqual(["p1"]);
    const one = get(session, "/api/proposal", "id=p1");
    expect(one.status).toBe(200);
    expect((one.body as Proposal).items).toHaveLength(2);
    expect(get(session, "/api/proposal", "id=p9").status).toBe(404);
    expect(get(session, "/api/proposal").status).toBe(400);
  });

  it("采纳：按顺序执行，编号由代码分配，资料真的落盘", async () => {
    const { root, session } = await withProposal();
    const res = await post(session, "/api/proposal/adopt", { id: "p1" });

    expect(res.status).toBe(200);
    const { proposal, messages } = res.body as { proposal: Proposal; messages: string[] };
    expect(proposal.status).toBe("adopted");
    expect(messages).toHaveLength(2);
    expect(proposal.appliedEffects).toEqual([
      { kind: "character_upserted", id: "C03", name: "守夜人", created: true },
      { kind: "plotline_defined", id: "P02", label: "信任崩塌", created: true },
    ]);

    const prep = get(session, "/api/prep").body as { characters: { id: string }[]; plotLines: { id: string }[] };
    expect(prep.characters.map((c) => c.id)).toEqual(["C01", "C02", "C03"]);
    expect(prep.plotLines.map((p) => p.id)).toEqual(["P01", "P02"]);
    // 重启也读得到。
    expect(new ProjectSession(root, loadRules()).getProposal("p1")?.status).toBe("adopted");
  });

  it("重复采纳回 409，不会执行两遍", async () => {
    const { session } = await withProposal();
    await post(session, "/api/proposal/adopt", { id: "p1" });
    const again = await post(session, "/api/proposal/adopt", { id: "p1" });
    expect(again.status).toBe(409);
    const prep = get(session, "/api/prep").body as { characters: unknown[] };
    expect(prep.characters).toHaveLength(3);
  });

  it("不存在的方案回 404，缺 id 回 400", async () => {
    const { session } = seed();
    expect((await post(session, "/api/proposal/adopt", { id: "p9" })).status).toBe(404);
    expect((await post(session, "/api/proposal/adopt", {})).status).toBe(400);
  });

  it("采纳后再出方案是 p2 —— 已处理的那份留着不动", async () => {
    const model = fakeClient([
      toolUse("propose_plan", DRAFT),
      modelText("方案好了。"),
      toolUse("propose_plan", { summary: "再补一条细节线", items: [{ tool: "define_plotline", input: { label: "旧伤" }, note: "补线" }] }),
      modelText("第二份方案好了。"),
    ]);
    const { session } = seed(model.client);
    await post(session, "/api/conversation/mode", { mode: "planning" });
    await post(session, "/api/conversation", { text: "出个方案" });
    await post(session, "/api/proposal/adopt", { id: "p1" });
    await post(session, "/api/conversation", { text: "再来一份" });

    const all = get(session, "/api/proposals").body as Proposal[];
    expect(all.map((p) => [p.id, p.status, p.version])).toEqual([
      ["p1", "adopted", 1],
      ["p2", "open", 1],
    ]);
  });

  it("proposals.json 与事件流分开 —— 方案不入 events", async () => {
    const { root } = await withProposal();
    expect(readFileSync(join(root, "proposals.json"), "utf8")).toContain("信任崩塌");
    expect(readFileSync(join(root, "events.jsonl"), "utf8")).not.toContain("信任崩塌");
  });
});
