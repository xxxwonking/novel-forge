/**
 * 余额闸门（§28 待办 2，用户拍板的口径：只看余额正负，允许小幅超支）。
 *
 * 三条底线：
 * 1. 余额 ≤ 0 时模型调用**一次都不发出**，也不进账；
 * 2. 余额是全局的 —— 别的作品、回收站里的作品、资料读坏的作品花掉的都算；
 * 3. 被拦下不等于丢东西：写章保留草稿与原因，补足额度后从同一步继续。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { Workspace } from "../src/workspace/service.js";
import { workspaceApi } from "../src/server/workspace-api.js";
import { appendCreditEntry, readCreditEntries } from "../src/credits/ledger.js";
import { loadPricing } from "../src/credits/pricing.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, SINGLE_PASS_RULES, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";
import type { CallOptions, CallResult } from "../src/client/claude.js";
import type { ModelClient } from "../src/client/model.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const GRANT = loadPricing().signupGrant;

/** 直接记一笔已计价的消耗，用来把余额推到指定位置。 */
function spend(root: string, credits: number): void {
  appendCreditEntry(root, {
    at: new Date().toISOString(), model: "claude-opus-5", role: "creative", purpose: "chapter",
    tokens: { input: 0, output: 0, cacheWrite: null, cacheRead: null }, credits, priced: true,
  });
}

/** 按 claude-opus-5 计价的应答：1000 输入 + 500 输出 = 5.25 积分，足以把 1 积分的余额扣成负数。 */
function priced(text: string): CallResult {
  const message = modelMessage([{ type: "text", text, citations: [] } as never]);
  return { kind: "ok", message: { ...message, model: "claude-opus-5", usage: { ...message.usage, input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } as never };
}

function counting(answer: (options: CallOptions) => CallResult): { client: ModelClient; calls: CallOptions[] } {
  const calls: CallOptions[] = [];
  return { calls, client: { official: false, call: async (options) => { calls.push(options); return answer(options); } } };
}

function library(client: ModelClient): { root: string; workspace: Workspace } {
  const root = mkdtempSync(join(tmpdir(), "nf-credit-gate-"));
  roots.push(root);
  for (const id of ["book-a", "book-b"]) new ProjectStore(join(root, id)).save(writingSnapshot());
  return { root, workspace: new Workspace(root, { client }) };
}

function single(options: ConstructorParameters<typeof ProjectSession>[2], rules = NO_MODEL_REVIEW): { root: string; session: ProjectSession } {
  const root = mkdtempSync(join(tmpdir(), "nf-credit-gate-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, rules, options) };
}

describe("余额闸门", () => {
  it("余额用完后，模型调用一次都不发出，也不进账；对话照常回一句说明", async () => {
    const model = counting(() => priced("好的。"));
    const { root, workspace } = library(model.client);
    spend(join(root, "book-a"), GRANT);

    expect(workspace.credits()).toMatchObject({ balance: 0, exhausted: true });
    const reply = await workspace.project("book-b").converse("说说第 3 章怎么写。");

    expect(model.calls).toHaveLength(0);
    expect(reply.text).toContain("余额不足");
    expect(readCreditEntries(join(root, "book-b"))).toEqual([]);
  });

  it("只看正负：最后一次放行的调用可以把余额扣成负数，下一次再拦", async () => {
    const model = counting(() => priced("好的。"));
    const { root, workspace } = library(model.client);
    spend(join(root, "book-a"), GRANT - 1);
    const session = workspace.project("book-b");

    await session.converse("第一次。");
    expect(model.calls).toHaveLength(1);
    const after = workspace.credits();
    expect(after.balance).toBeLessThan(0);
    expect(after.exhausted).toBe(true);

    const reply = await session.converse("第二次。");
    expect(model.calls).toHaveLength(1);
    expect(reply.text).toContain("余额不足");
  });

  it("余额是全局的：回收站里的作品花掉的也算", async () => {
    const model = counting(() => priced("好的。"));
    const { root, workspace } = library(model.client);
    spend(join(root, "book-a"), GRANT / 2);
    workspace.remove({ id: "book-a" });
    spend(join(root, "book-b"), GRANT / 2);

    expect(workspace.credits()).toMatchObject({ spent: GRANT, balance: 0, exhausted: true });
    await workspace.project("book-b").converse("还能写吗？");
    expect(model.calls).toHaveLength(0);
  });

  it("作品资料读坏时，它花掉的积分照样从余额里扣 —— 摘要读不出来不能让余额变多", () => {
    const { root, workspace } = library(counting(() => priced("好的。")).client);
    spend(join(root, "book-a"), 120);
    writeFileSync(join(root, "book-a", "setting.json"), "{", "utf8");

    expect(workspace.list().find((work) => work.id === "book-a")?.error).not.toBeNull();
    expect(workspace.credits()).toMatchObject({ spent: 120, balance: GRANT - 120, exhausted: false });
  });

  it("工作区端点把「已用完」直接告诉界面，判据不在前端再写一遍", () => {
    const { root, workspace } = library(counting(() => priced("好的。")).client);
    const read = () => workspaceApi(workspace, { method: "GET", path: "/api/workspace", query: new URLSearchParams(), body: undefined })?.body as { credits: { exhausted: boolean } };
    expect(read().credits.exhausted).toBe(false);
    spend(join(root, "book-a"), GRANT);
    expect(read().credits.exhausted).toBe(true);
  });

  it("写章被拦时保留草稿并说明原因，补足额度后从同一步继续", async () => {
    let balance = 0;
    const model = counting((options) => modelText(options.outputSchema ? C5_JSON : PROSE));
    const { session } = single({ client: model.client, creditBalance: () => balance }, SINGLE_PASS_RULES);

    const blocked = await session.writeChapter({ chapter: 3 });
    expect(blocked.status).toBe("failed");
    expect(JSON.stringify(blocked.error)).toContain("余额不足");
    expect(model.calls).toHaveLength(0);

    balance = 100;
    const resumed = await session.writeChapter({ chapter: 3, draftId: blocked.draftId });
    // 同一份草稿接着走完正文与声明两步。之后停在 ready 还是 needs_revision 取决于
    // 夹具正文够不够字数，与闸门无关，这里不断言。
    expect(resumed).toMatchObject({ draftId: blocked.draftId, body: PROSE });
    expect(resumed.status).not.toBe("failed");
    expect(resumed.declaration).not.toBeNull();
    expect(model.calls.filter((call) => call.outputSchema === undefined)).toHaveLength(1);
    expect(model.calls.filter((call) => call.outputSchema !== undefined)).toHaveLength(1);
  });

  it("不经工作区单独打开的会话，按本作品自己的账判断", async () => {
    const model = counting(() => priced("好的。"));
    const { root, session } = single({ client: model.client });
    spend(root, GRANT);

    const reply = await session.converse("随便聊聊。");
    expect(model.calls).toHaveLength(0);
    expect(reply.text).toContain("余额不足");
  });
});
