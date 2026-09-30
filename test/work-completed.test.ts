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
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handle, type ApiRequest } from "../src/server/api.js";
import { fakeClient, modelText, writingSnapshot } from "./writing-fixtures.js";

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
