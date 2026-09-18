/**
 * 连续创作（差距第 5 项上半场）：排后面 K 章 + 授权连写到第 M 章。
 *
 * 最要紧的三条断言：
 *   ① 连写里的自动采用只发生在「检查通过 + 没有关键变化」时；人物生死这类变化一出现
 *      就停在那一章，一条事实都不落 —— 这是「逐章采用」原则下唯一允许的例外。
 *   ② 停下只在章与章之间生效：当前章跑完、结果保留，作者点了停就不开下一章。
 *   ③ 运行状态落盘：重启后能看到停在哪、为什么。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handleAsync } from "../src/server/api.js";
import { deriveBudget } from "../src/beat/derive.js";
import { countWords } from "../src/text/measure.js";
import type { CallResult } from "../src/client/claude.js";
import type { ChapterBeat } from "../src/types/beat.js";
import { C5_JSON, NO_MODEL_REVIEW, PROSE, WRITE_BEAT, fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const rules = { ...NO_MODEL_REVIEW, task: { ...NO_MODEL_REVIEW.task, maxAutoRevisions: 0 } };

/** 第 4 章的计划：普通事件章，不收伏笔，免得与第 3 章的收束承诺纠缠。 */
const BEAT4: ChapterBeat = {
  ...WRITE_BEAT, chapter: 4,
  plan: { ...WRITE_BEAT.plan, chapterType: "event", coreEvent: "李长风循账本线索找到当铺", stageFeedback: "账本上的名字对上了当铺的暗记", hook: "当铺掌柜认出了那把断剑", events: [{ kind: "info", summary: "当铺暗记与账本对上", weight: 2, plotLine: "P01" }], resolves: [], plants: [] },
};
const PROSE4 = "李长风把账本摊在当铺柜台上。掌柜看了一眼暗记，脸色变了。他认出了那把断剑。";
const C5_JSON4 = JSON.stringify({
  events: [{ kind: "info", summary: "当铺暗记与账本对上", weight: 2, plot_line: "P01", participants: ["C01"], quote: "掌柜看了一眼暗记，脸色变了" }],
  foreshadow_planted: [], foreshadow_resolved: [], relations_changed: [], character_states: [],
  character_presence: [{ character_id: "C01", role: "pov" }],
});

const fill = (prose: string, beat: ChapterBeat): string => {
  const target = deriveBudget(beat.plan, writingSnapshot().profile, rules).words.sweet;
  return `${prose}\n${"风".repeat(Math.max(0, target - countWords(prose)))}`;
};
const BODY3 = fill(PROSE, WRITE_BEAT);
const BODY4 = fill(PROSE4, BEAT4);

/** 第 3 章里把血刀客写死了 —— 关键变化，连写必须停下让作者看。 */
const C5_DEATH = JSON.stringify({
  ...JSON.parse(C5_JSON) as Record<string, unknown>,
  character_states: [{ character_id: "C02", field: "vital", from: "alive", to: "dead", quote: "血刀客拿走了架上的旧账本" }],
});

function project(beats: readonly ChapterBeat[] = [WRITE_BEAT, BEAT4]): { root: string; store: ProjectStore } {
  const root = mkdtempSync(join(tmpdir(), "nf-run-"));
  roots.push(root);
  const store = new ProjectStore(root);
  const base = writingSnapshot();
  store.save({ ...base, beats: [base.beats[0]!, ...beats] });
  return { root, store };
}

function open(root: string, results: readonly CallResult[]) {
  const { client, calls } = fakeClient(results);
  return { session: new ProjectSession(root, rules, { client }), calls };
}

/** 等到循环停下（idle/stopped）。 */
async function settled(session: ProjectSession) {
  await expect.poll(() => session.run.view().status, { timeout: 5000 }).not.toBe("running");
  return session.run.view();
}

const api = (session: ProjectSession, method: "GET" | "POST", path: string, body?: unknown) =>
  handleAsync(session, { method, path, query: new URLSearchParams(), body });

describe("连写·自动采用与推进", () => {
  it("两章检查通过且无关键变化：逐章自动采用，写到授权的章号为止", async () => {
    const { root } = project();
    const { session, calls } = open(root, [modelText(BODY3), modelText(C5_JSON), modelText(BODY4), modelText(C5_JSON4)]);
    const started = session.run.start({ through: 4 });
    expect(started).toMatchObject({ status: "running", through: 4, adopted: [] });

    const view = await settled(session);
    expect(view).toMatchObject({ status: "idle", adopted: [3, 4], stopped: null });
    expect(session.currentChapter).toBe(4);
    expect(session.chapterText(4)).toBe(BODY4);
    expect(session.listDrafts(3)[0]?.status).toBe("adopted");
    expect(calls).toHaveLength(4);
    // 第 4 章的上下文里已经有第 3 章的正文 —— 连写是串行的，不是并行分片。
    expect(JSON.stringify(calls[2]?.messages)).toContain("宗门密库");
  });

  it("人物生死变化是关键变化：这一章留给作者，不采用，也不开下一章", async () => {
    const { root } = project();
    const { session, calls } = open(root, [modelText(BODY3), modelText(C5_DEATH)]);
    session.run.start({ through: 4 });

    const view = await settled(session);
    expect(view.status).toBe("stopped");
    expect(view.stopped).toMatchObject({ chapter: 3, reason: "key_change", draftId: "ch3d1" });
    expect(view.stopped?.detail).toContain("C02");
    expect(view.adopted).toEqual([]);
    expect(session.currentChapter).toBe(2);
    expect(session.listDrafts(3)[0]).toMatchObject({ status: "ready", acceptable: true });
    expect(calls).toHaveLength(2);
  });

  it("检查没过就停在那一章，草稿保留待修改", async () => {
    const { root } = project();
    const { session } = open(root, [modelText(PROSE), modelText(C5_JSON)]);
    session.run.start({ through: 4 });
    const view = await settled(session);
    expect(view.stopped).toMatchObject({ chapter: 3, reason: "needs_revision" });
    expect(session.listDrafts(3)[0]?.status).toBe("needs_revision");
    expect(session.currentChapter).toBe(2);
  });

  it("下一章没有已确认的计划：采用完前一章后停下，说清缺什么", async () => {
    const { root } = project([WRITE_BEAT]);
    const { session } = open(root, [modelText(BODY3), modelText(C5_JSON)]);
    session.run.start({ through: 4 });
    const view = await settled(session);
    expect(view.adopted).toEqual([3]);
    expect(view.stopped).toMatchObject({ chapter: 4, reason: "blocked" });
    expect(view.stopped?.detail).toContain("节拍");
  });

  it("模型调用失败：草稿记失败、连写停下、原因如实", async () => {
    const { root } = project();
    const failure: CallResult = { kind: "error", error: { type: "connection", status: null, message: "测试连接中断", retryable: true } };
    const { session } = open(root, [failure]);
    session.run.start({ through: 4 });
    const view = await settled(session);
    expect(view.stopped).toMatchObject({ chapter: 3, reason: "failed" });
    expect(view.stopped?.detail).toContain("测试连接中断");
  });
});

describe("连写·作者控制与状态", () => {
  it("作者中途停下：当前章跑完并采用，下一章不再开始", async () => {
    const { root } = project();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let n = 0;
    const results = [modelText(BODY3), modelText(C5_JSON), modelText(BODY4), modelText(C5_JSON4)];
    const session = new ProjectSession(root, rules, { client: { official: true, async call() { const i = n++; if (i === 1) await gate; return results[i]!; } } });
    session.run.start({ through: 4 });
    await expect.poll(() => n, { timeout: 2000 }).toBe(2);
    expect(session.run.stop()).toMatchObject({ status: "running", stopRequested: true });
    release();

    const view = await settled(session);
    expect(view).toMatchObject({ status: "stopped", adopted: [3] });
    expect(view.stopped).toMatchObject({ chapter: 4, reason: "author" });
    expect(n).toBe(2);
    expect(session.listDrafts(4)).toEqual([]);
  });

  it("停下的原因落盘：换一个进程读得到；确认知道了之后回到空闲", async () => {
    const { root } = project();
    const { session } = open(root, [modelText(BODY3), modelText(C5_DEATH)]);
    session.run.start({ through: 4 });
    await settled(session);

    const reopened = new ProjectSession(root, rules);
    expect(reopened.run.view()).toMatchObject({ status: "stopped", stopped: { chapter: 3, reason: "key_change" } });
    expect(reopened.run.acknowledge()).toMatchObject({ status: "idle", stopped: null });
  });

  it("进程重启时文件还说 running：报中断，不假装还在跑", async () => {
    const { root } = project();
    let n = 0;
    const session = new ProjectSession(root, rules, { client: { official: true, async call() { n++; return new Promise<CallResult>(() => undefined); } } });
    session.run.start({ through: 4 });
    await expect.poll(() => n, { timeout: 2000 }).toBe(1);
    // 不等它结束，直接用同一目录开新会话 —— 模拟进程被杀。
    const reopened = new ProjectSession(root, rules);
    expect(reopened.run.view()).toMatchObject({ status: "stopped", stopped: { reason: "interrupted" } });
  });

  it("授权范围校验：不能小于下一章、不能超过规则上限；运行中不能再启动", async () => {
    const { root } = project();
    const { session } = open(root, [modelText(BODY3), modelText(C5_JSON), modelText(BODY4), modelText(C5_JSON4)]);
    expect((await api(session, "POST", "/api/run/start", { through: 2 })).status).toBe(400);
    expect((await api(session, "POST", "/api/run/start", { through: 2 + rules.task.maxBatchChapters + 1 })).status).toBe(400);
    expect((await api(session, "POST", "/api/run/start", { through: "4" })).status).toBe(400);

    expect((await api(session, "POST", "/api/run/start", { through: 4 })).status).toBe(200);
    expect((await api(session, "POST", "/api/run/start", { through: 4 })).status).toBe(409);
    await settled(session);
    const view = (await api(session, "GET", "/api/run")).body as { status: string; adopted: number[]; maxThrough: number };
    expect(view.status).toBe("idle");
    expect(view.adopted).toEqual([3, 4]);
    expect(view.maxThrough).toBe(4 + rules.task.maxBatchChapters);
  });

  it("有稿件正在执行时不能启动连写", async () => {
    const { root } = project();
    let n = 0;
    const session = new ProjectSession(root, rules, { client: { official: true, async call() { n++; return new Promise<CallResult>(() => undefined); } } });
    session.startChapter({ chapter: 3 });
    await expect.poll(() => n, { timeout: 2000 }).toBe(1);
    expect(() => session.run.start({ through: 4 })).toThrow(/正在执行/u);
  });
});

describe("排章·一次排后面 K 章", () => {
  const toolUse = (name: string, input: unknown): CallResult => ({
    kind: "ok",
    message: modelMessage([{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock], "tool_use"),
  });

  it("起草 K 份连续章计划落成一份方案，作者确认一次后连写能一路走完", async () => {
    const { root } = project([WRITE_BEAT]);
    const probe = new ProjectSession(root, rules);
    const fingerprint = probe.preparation.view().fingerprint;
    const beats = [4, 5].map((chapter) => ({ chapter, volume: 2, plan: { ...BEAT4.plan, coreEvent: `第 ${chapter} 章的核心事件` } }));
    const { session, calls } = open(root, [
      toolUse("propose_preparation", { summary: "排第 4-5 章", baseFingerprint: fingerprint, changes: { beats } }),
      modelText("已排出第 4、5 章。"),
    ]);
    const result = await session.draftPreparation({ focus: "chapters", count: 2, apply: true });
    expect(result.proposalId).toBeDefined();
    // 请求里要说清排哪几章、只动章计划。
    const ask = JSON.stringify(calls[0]?.messages);
    expect(ask).toContain("第 4 章到第 5 章");
    expect(ask).toContain("changes.beats");
    const proposal = session.preparation.get(result.proposalId!);
    expect(proposal.changes.beats?.map((b) => b.chapter)).toEqual([4, 5]);
    expect(proposal.status).toBe("proposed");
    expect(session.meta.beats.some((b) => b.chapter === 5)).toBe(false);

    session.preparation.confirm(result.proposalId!);
    expect(session.meta.beats.filter((b) => b.chapter >= 4).map((b) => [b.chapter, b.provenance])).toEqual([[4, "committed"], [5, "committed"]]);
  });

  it("排章数量受同一条上限约束", async () => {
    const { root } = project([WRITE_BEAT]);
    const { session } = open(root, []);
    await expect(session.draftPreparation({ focus: "chapters", count: rules.task.maxBatchChapters + 1, apply: true })).rejects.toThrow(/上限|最多/u);
    await expect(session.draftPreparation({ focus: "chapters", count: 0, apply: true })).rejects.toThrow();
    expect((await api(session, "POST", "/api/preparation/draft", { focus: "chapters", count: 2.5 })).status).toBe(400);
  });
});
