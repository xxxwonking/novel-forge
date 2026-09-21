/**
 * 资料里的关系进关系图。
 *
 * 背景：关系图的唯一数据源是事件流里的 `relation_changed`，而那个只有写章 / 采用
 * 结构声明 / 逐章反推时才产生。于是导完一本有角色档案的书，人物档案是满的，
 * 关系图却是空的 —— 而作者明明已经把关系写下来过。
 *
 * 两条判断：
 *   ① **关系随人物一起抽、随同一份方案确认**，不另造一套确认流程。
 *   ② **没有正文出处的边要看得出来**：`anchor` 缺席即「尚未写进正文」，图上画虚线，
 *      且不能当作可跳转的点。把它画成实线等于声称正文里有这一笔。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { EventStream } from "../src/store/event-stream.js";
import { writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** 有两个人物的作品：C01 李长风、C02 血刀客（见 fixtures）。 */
function seeded() {
  const root = mkdtempSync(join(tmpdir(), "nf-rel-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, undefined) };
}
const author = (session: ProjectSession, changes: Record<string, unknown>) =>
  session.preparation.recordAuthor({ summary: "作者手改资料", changes, baseFingerprint: session.preparation.view().fingerprint });
const relation = (from: string, to: string, toKind: string, note: string) => ({ from, to, fromKind: null, toKind, note });

describe("资料里的关系进关系图", () => {
  it("确认后图上出现这条边，并标明尚未写进正文", () => {
    const { session } = seeded();
    expect(session.derived.views.relations.edges).toHaveLength(0);

    expect(author(session, { relations: [relation("C01", "C02", "hostile", "互相试探，尚未撕破")] }).status).toBe("confirmed");

    const edges = session.derived.views.relations.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ from: "C01", to: "C02", kind: "hostile", note: "互相试探，尚未撕破", declared: true, point: null });
    // 节点表跟着出现 —— 否则边画不出来。
    expect(session.derived.views.relations.nodes.map((n) => n.id).sort()).toEqual(["C01", "C02"]);
  });

  it("未确认的方案不产生边 —— 建议不是事实", () => {
    const { session } = seeded();
    // 直接影响已采用正文的改动只会留下候选（见既有行为），这里借用它造一份未确认方案。
    const proposal = session.preparation.propose({
      summary: "模型建议的关系", baseFingerprint: session.preparation.view().fingerprint,
      changes: { relations: [relation("C01", "C02", "ally", "结盟")] },
    });
    expect(proposal.status).toBe("proposed");
    expect(session.derived.views.relations.edges).toHaveLength(0);
  });

  it("正文里有出处的边仍是实线，同一个方向以正文为准", () => {
    // 正式事件要经事件流造：appendEvents 只收 authored/proposed，committed 由裁决产生。
    const root = mkdtempSync(join(tmpdir(), "nf-rel-anchored-"));
    roots.push(root);
    const base = writingSnapshot();
    const stream = EventStream.restore(base.events);
    const appended = stream.append({
      chapter: 2, origin: "C5_declaration", provenance: "proposed",
      payload: { type: "relation_changed", from: "C01", to: "C02", fromKind: null, toKind: "ally", note: "正文写到他们联手",
        anchor: { chapter: 2, quote: "血刀客交出密库旧图", offsetHint: 0, occurrence: 0 } },
    });
    stream.decide(appended.envelope.id, "committed");
    new ProjectStore(root).save({ ...base, events: stream.all() });
    const session = new ProjectSession(root, undefined);

    author(session, { relations: [relation("C01", "C02", "hostile", "资料说的")] });
    const edges = session.derived.views.relations.edges;
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({ kind: "ally", note: "正文写到他们联手", declared: false });
    expect(edges[0]?.point?.chapter).toBe(2);
  });

  it("声明的关系必须指向已有人物，否则 400", () => {
    const { session } = seeded();
    expect(() => author(session, { relations: [relation("C01", "C99", "ally", "幽灵")] })).toThrow(/不存在/u);
    expect(() => author(session, { relations: [relation("C99", "C01", "ally", "幽灵")] })).toThrow(/不存在/u);
  });

  it("同一份方案重复确认不会把边加两遍", () => {
    const { session } = seeded();
    const proposal = author(session, { relations: [relation("C01", "C02", "kin", "叔侄")] });
    expect(session.preparation.confirm(proposal.id).changed).toBe(false);
    expect(session.derived.views.relations.edges).toHaveLength(1);
  });

  it("关系与人物可以同批提交：一份方案里既建人物又声明关系", () => {
    const { session } = seeded();
    const before = session.preparation.view().fingerprint;
    const card = session.meta.characters[0]!;
    const proposal = session.preparation.propose({
      summary: "同批", baseFingerprint: before,
      changes: {
        characters: [{ ...card, tier: "protagonist" }].map(({ provenance: _p, introducedAt: _i, updatedAt: _u, ...rest }) => rest),
        relations: [relation("C01", "C02", "mentor", "亦师亦敌")],
      },
    });
    session.preparation.confirm(proposal.id);
    expect(session.derived.views.relations.edges).toHaveLength(1);
  });
});
