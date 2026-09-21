/**
 * 积分记账（差距第 10 项）。
 *
 * 一条底线：**每一次模型调用都要进账**。计量点如果留在写章服务里，对话、反推、
 * 返修定位这些同样花钱的路径就成了黑账 —— 余额会慢慢变成一个说谎的数字。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handle, type ApiRequest } from "../src/server/api.js";
import { loadPricing, creditsFor } from "../src/credits/pricing.js";
import { appendCreditEntry, readCreditEntries, summarize, type CreditEntry } from "../src/credits/ledger.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";
import type { ModelClient } from "../src/client/model.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function fixture(client: ModelClient) {
  const root = mkdtempSync(join(tmpdir(), "nf-credits-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, NO_MODEL_REVIEW, { client }) };
}
const get = (session: ProjectSession, path: string) =>
  handle(session, { method: "GET", path, query: new URLSearchParams(), body: null } satisfies ApiRequest);

/** 带模型名与四档用量的响应；测试要按真实模型计价，不能只用 test-model。 */
function priced(text: string, usage: Partial<Record<"input_tokens" | "output_tokens" | "cache_creation_input_tokens" | "cache_read_input_tokens", number | null>> = {}) {
  const message = modelMessage([{ type: "text", text } as never]);
  return { kind: "ok" as const, message: { ...message, model: "claude-opus-5", usage: { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage } } as never };
}

describe("积分记账", () => {
  it("写章与对话都进账，各自记下用途 —— 计量在客户端层，不在写章服务里", async () => {
    let judge = 0;
    const { root, session } = fixture({ official: false, call: async (options) => {
      if (options.role === "judge") return ++judge === 1 ? modelText("好的。") : modelText("好的。");
      return modelText(options.outputSchema ? C5_JSON : PROSE);
    } });
    await session.converse("说说第 3 章怎么写。");
    await session.writeChapter({ chapter: 3 });

    const purposes = new Set(readCreditEntries(root).map((e) => e.purpose));
    expect(purposes.has("conversation")).toBe(true);
    expect(purposes.has("chapter")).toBe(true);
    expect(readCreditEntries(root).every((e) => e.at !== "" && e.model !== "")).toBe(true);
  });

  it("四档 token 分别计价：缓存读比原样输入便宜一个量级", () => {
    const pricing = loadPricing();
    const price = pricing.models["claude-opus-5"];
    expect(price).toBeDefined();
    const million = { input: 1_000_000, output: 0, cacheWrite: 0, cacheRead: 0 };
    const plain = creditsFor(price, million, pricing)!;
    const cached = creditsFor(price, { ...million, input: 0, cacheRead: 1_000_000 }, pricing)!;
    const written = creditsFor(price, { ...million, input: 0, cacheWrite: 1_000_000 }, pricing)!;
    expect(cached).toBeLessThan(plain / 5);
    expect(written).toBeGreaterThan(plain);
    // 合并成一个 inputTokens 就折不出这三个数 —— 这正是不能沿用 TaskUsage 的理由。
    expect(new Set([plain, cached, written]).size).toBe(3);
  });

  it("端点没报缓存字段时记 null，不当成 0", async () => {
    const { root, session } = fixture({ official: false, call: async () => priced("好的。", { cache_creation_input_tokens: null, cache_read_input_tokens: null }) });
    await session.converse("随便聊聊。");
    const entry = readCreditEntries(root)[0]!;
    expect(entry.tokens.cacheRead).toBeNull();
    expect(entry.tokens.cacheWrite).toBeNull();
    expect(entry.tokens.input).toBe(1000);
    expect(entry.credits).toBeGreaterThan(0);
  });

  it("价格表里没有的模型照记用量，但不折积分", async () => {
    const { root, session } = fixture({ official: false, call: async () => modelText("好的。") });
    await session.converse("随便聊聊。");
    const entry = readCreditEntries(root)[0]!;
    expect(entry.priced).toBe(false);
    expect(entry.credits).toBe(0);
    expect(entry.tokens.output).toBeGreaterThan(0);
  });

  it("调用失败不凭空计费：抛出与 kind:error 都不进账", async () => {
    const thrown = fixture({ official: false, call: async () => { throw new Error("端点炸了"); } });
    await expect(thrown.session.converse("随便聊聊。")).rejects.toThrow();
    expect(readCreditEntries(thrown.root)).toEqual([]);

    // 没拿到用量就不知道花了多少；「发生过一次没量到的调用」由 TaskUsage 那一侧记着。
    const failed = fixture({ official: false, call: async () => ({
      kind: "error" as const,
      error: { type: "status" as const, status: 500, message: "上游 500", retryable: true, timing: { monotonicMs: 1, wallMs: 1 } },
    }) });
    // 上游报错由对话层照常兜住；记账不能在这条路上自己炸（那会是一个 TypeError）。
    await expect(failed.session.converse("随便聊聊。")).resolves.toBeDefined();
    expect(readCreditEntries(failed.root)).toEqual([]);
  });

  it("账本是 append-only，汇总可以从它完整重建", async () => {
    const { root, session } = fixture({ official: false, call: async () => priced("好的。") });
    await session.converse("第一次。");
    const first = readCreditEntries(root);
    await session.converse("第二次。");
    const second = readCreditEntries(root);
    expect(second.slice(0, first.length)).toEqual(first);
    const total = summarize(second);
    expect(total.calls).toBe(second.length);
    expect(total.credits).toBeCloseTo(second.reduce((sum, e: CreditEntry) => sum + e.credits, 0), 6);
    expect(total.byPurpose["conversation"]?.calls).toBe(second.length);
  });

  it("账目里 priced:false 却带积分的条目，读入时按 0 计 —— 不变量不靠写入方自觉", async () => {
    const { root } = fixture({ official: false, call: async () => priced("好的。") });
    appendCreditEntry(root, { at: new Date().toISOString(), model: "unknown-model", role: "creative", purpose: "chapter", tokens: { input: 1, output: 1, cacheWrite: null, cacheRead: null }, credits: 99, priced: false });
    const entries = readCreditEntries(root);
    expect(entries[0]?.credits).toBe(0);
    expect(summarize(entries).unpricedCalls).toBe(1);
    expect(summarize(entries).credits).toBe(0);
  });

  it("端点给出本作品的消耗与用途分组", async () => {
    const { session } = fixture({ official: false, call: async () => priced("好的。") });
    await session.converse("随便聊聊。");
    const res = get(session, "/api/credits");
    expect(res.status).toBe(200);
    const body = res.body as { credits: number; calls: number; byPurpose: Record<string, { calls: number }> };
    expect(body.calls).toBeGreaterThan(0);
    expect(body.credits).toBeGreaterThan(0);
    expect(body.byPurpose["conversation"]?.calls).toBe(body.calls);
  });
});
