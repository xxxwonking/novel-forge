/**
 * 已完结作品：伏笔期限可以落在已写的章节里（用户 2026-09-30 拍板「允许」）。
 *
 * 原规则「期限必须晚于已写完的章」是给连载写的 —— 给一个过去的章号，等于一条生下来就
 * 逾期的规划。可对一本已经写完、从大纲反推伏笔的旧稿，伏笔本来就兑现在书里，逼着期限
 * 落在「未来」只会让模型编出一串全书之外的章号（真机：100 章的书，9 条期限落在 110–135 章）。
 *
 * 三条断言：
 *   ① 「已完结」按作品存，默认关；关着时原规则一字不改。
 *   ② 开着时资料里的伏笔规划与改期都可以指向已写的章，模型拿到的起草要求也跟着变。
 *   ③ 它不进来源指纹：拨一下开关不作废任何方案或草稿。
 *   ④ 已完结时**不再报「写作前沿」类告警**（§60）：那四类（伏笔逾期 / 埋了很久没动静 /
 *      情节线断了 / 人物缺席）都在拿当前章当"还会往前走的前沿"来量，而这本书没有前沿。
 *      真机上 113 条伏笔报出 76 条逾期。拨开关必须**当场**生效 —— 告警是派生缓存，
 *      忘了作废就是一个不报错的失效。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handle, type ApiRequest } from "../src/server/api.js";
import { fakeClient, modelText, writingSnapshot } from "./writing-fixtures.js";
import { computeAlerts } from "../src/alerts/compute.js";
import { loadRules } from "../src/rules/load.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** fixture 写到第 2 章，已有 F01「青铜钥匙」、F02「钥匙上的红泥」。 */
function seeded(results: Parameters<typeof fakeClient>[0] = []) {
  const root = mkdtempSync(join(tmpdir(), "nf-completed-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const model = fakeClient(results);
  return { root, calls: model.calls, session: new ProjectSession(root, undefined, { client: model.client }) };
}
const author = (session: ProjectSession, changes: Record<string, unknown>) =>
  session.preparation.recordAuthor({ summary: "作者手改资料", changes, baseFingerprint: session.preparation.view().fingerprint });
const claim = (label: string, expectedBy: number) => ({ label, intent: `${label}在第 ${expectedBy} 章兑现。`, weight: "sub", expectedBy });
const request = (method: "GET" | "POST", path: string, body?: unknown): ApiRequest => ({ method, path, query: new URLSearchParams(), body });

describe("已完结作品的伏笔期限", () => {
  it("默认未完结，原规则不变：期限落在已写章被挡", () => {
    const { session } = seeded();
    expect(session.workCompleted).toBe(false);
    expect(() => author(session, { foreshadows: [claim("旧稿里的安排", 2)] })).toThrow(/已经写完/u);
  });

  it("标记已完结后，资料里的伏笔期限可以落在已写的章；仍是规划态、不报逾期", () => {
    const { session } = seeded();
    session.setWorkCompleted(true);
    expect(author(session, { foreshadows: [claim("旧稿里的安排", 2)] }).status).toBe("confirmed");

    const lane = session.derived.views.foreshadows.find((f) => f.label === "旧稿里的安排");
    expect(lane).toMatchObject({ status: "planned", expectedBy: 2, planted: null, overdueSpan: null });
    expect(session.derived.candidates.filter((a) => JSON.stringify(a).includes("旧稿里的安排"))).toHaveLength(0);
  });

  it("「已完结」按作品存，重开仍在；它不进来源指纹，拨开关不作废方案", () => {
    const { root, session } = seeded();
    const before = session.preparation.view().fingerprint;
    const pending = session.preparation.propose({ summary: "候选", baseFingerprint: before, changes: { foreshadows: [claim("候选里的安排", 9)] } });
    session.setWorkCompleted(true);

    expect(session.preparation.view().fingerprint).toBe(before);
    expect(session.preparation.view().proposals.find((p) => p.id === pending.id)?.stale).toBe(false);
    expect(new ProjectSession(root).workCompleted).toBe(true);
    session.setWorkCompleted(false);
    expect(new ProjectSession(root).workCompleted).toBe(false);
  });

  it("改期：未完结时不能改到已写的章；已完结时可以", () => {
    const { session } = seeded();
    expect(() => session.planning.apply({ kind: "reschedule", foreshadowId: "F01", expectedBy: 2 })).toThrow(/未来/u);
    session.setWorkCompleted(true);
    expect(session.planning.apply({ kind: "reschedule", foreshadowId: "F01", expectedBy: 2 }).changed).toBe(true);
    expect(session.derived.projections.foreshadows.find((f) => f.id === "F01")?.expectedBy).toBe(2);
    // 章号仍须是正整数。
    expect(() => session.planning.apply({ kind: "reschedule", foreshadowId: "F01", expectedBy: 0 })).toThrow();
  });

  it("起草要求随状态变：已完结时不再要求模型把期限推到全书之外", async () => {
    const open = seeded([modelText("没有认出伏笔。")]);
    await open.session.draftPreparation({ focus: "foreshadows", apply: true }).catch(() => undefined);
    const openAsk = JSON.stringify(open.calls[0]?.messages);
    expect(openAsk).toContain("必须大于第 2 章");

    const done = seeded([modelText("没有认出伏笔。")]);
    done.session.setWorkCompleted(true);
    await done.session.draftPreparation({ focus: "foreshadows", apply: true }).catch(() => undefined);
    const doneAsk = JSON.stringify(done.calls[0]?.messages);
    expect(doneAsk).not.toContain("必须大于第 2 章");
    expect(doneAsk).toContain("已经完结");
  });

  it("接口：读写「已完结」，拒绝非布尔值；首页概览带上它", () => {
    const { session } = seeded();
    expect(handle(session, request("GET", "/api/work-status")).body).toEqual({ completed: false });
    expect(handle(session, request("POST", "/api/work-status", { completed: true }))).toMatchObject({ status: 200, body: { completed: true } });
    for (const bad of [null, { completed: "yes" }, {}]) expect(handle(session, request("POST", "/api/work-status", bad)).status).toBe(400);
    expect(session.workCompleted).toBe(true);
    expect(handle(session, request("GET", "/api/overview")).body).toMatchObject({ completed: true });
  });
});

describe("已完结作品不再报「写作前沿」类告警", () => {
  /** 一条逾期的伏笔：第 1 章埋、第 2 章前该收，而 fixture 写到第 2 章。 */
  const overdue = () => ({
    foreshadows: [{
      id: "F01" as never, label: "青铜钥匙", intent: "证明钥匙能打开宗门密库。",
      weight: "main" as const, visibility: "covert" as const, status: "open" as const,
      plantedAt: 1 as never, plantedAnchor: { chapter: 1 as never, quote: "一枚青铜钥匙放在桌上", offsetHint: 0, occurrence: 0 },
      expectedBy: 2 as never, resolutions: [], overdueBy: 40 as never,
    }],
  });

  it("未完结时照报，已完结时一条不报 —— 同一份输入", () => {
    const base = {
      currentChapter: 42 as never, nextChapter: 43 as never, plotLines: [], arcs: [],
      states: new Map(), now: "2026-10-04T00:00:00.000Z" as never, ...overdue(),
    };
    const rules = loadRules();
    expect(computeAlerts({ ...base, completed: false }, rules).length).toBeGreaterThan(0);
    // 不是改措辞 ——「逾期」「断线」「缺席」说的都是"你还没写到"，
    // 对一本写完的书，换个说法也还是在问一个不存在的问题。
    expect(computeAlerts({ ...base, completed: true }, rules)).toEqual([]);
  });

  it("拨开关当场生效，不用重开会话 —— 告警是派生缓存，忘了作废就是个不报错的失效", () => {
    const { session } = seeded();
    // fixture 的 F01 期限是第 3 章、写到第 2 章，所以先把当前章推到逾期区间之外不好造；
    // 直接用投影里的真实伏笔：把期限改到已写的章，它就逾期了。
    session.setWorkCompleted(true);
    author(session, { foreshadows: [claim("旧稿里的安排", 1)] });
    session.setWorkCompleted(false);
    const before = session.derived.candidates.length;
    expect(before).toBeGreaterThan(0);

    // 关键：**同一个 session 实例**上拨开关。
    session.setWorkCompleted(true);
    expect(session.derived.candidates).toEqual([]);

    // 拨回去要能恢复 —— 不是单向的。
    session.setWorkCompleted(false);
    expect(session.derived.candidates.length).toBe(before);
  });

  it("压掉的只是告警，事实仍在视图里 —— 没兑现的伏笔照样是 open", () => {
    const { session } = seeded();
    session.setWorkCompleted(true);
    author(session, { foreshadows: [claim("旧稿里的安排", 1)] });
    expect(session.derived.candidates).toEqual([]);
    // 伏笔时间线、情节线图、故事进度页读的都不是告警，所以一条都没少。
    const lane = session.derived.views.foreshadows.find((f) => f.label === "旧稿里的安排");
    expect(lane?.status).toBe("planned");
    expect(session.derived.views.foreshadows.length).toBeGreaterThan(0);
  });
});
