/**
 * 资料里的伏笔进时间线。
 *
 * 背景：与关系图同一个病 —— 伏笔的唯一数据源是事件流里的 `foreshadow_planted`，
 * 而那个只有写章 / 采用结构声明 / 逐章反推时才产生。导完一本有大纲的书，
 * 大纲里写明的安排一条都不在时间线上，而作者明明已经把它们写下来过。
 *
 * 三条判断：
 *   ① **伏笔随同一份方案确认**，不另造一套拍板路径。
 *   ② **没有正文出处的伏笔要看得出来**：`planted === null` 即「尚未埋设」，
 *      图上画虚线且不可跳转。给它编一个章号等于声称正文里已经写了这一笔。
 *   ③ **标签必须能唯一认领**：正文写到那里时 C5 靠 label 把埋设对上这条规划
 *      （见 `c5-schema.ts` 的 planned 匹配），重名会让认领失败。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** fixture 写到第 2 章，已有 F01「青铜钥匙」、F02「钥匙上的红泥」。 */
function seeded() {
  const root = mkdtempSync(join(tmpdir(), "nf-fs-mat-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return { root, session: new ProjectSession(root, undefined) };
}
const author = (session: ProjectSession, changes: Record<string, unknown>) =>
  session.preparation.recordAuthor({ summary: "作者手改资料", changes, baseFingerprint: session.preparation.view().fingerprint });
const claim = (label: string, expectedBy: number, weight = "sub") => ({ label, intent: `${label}要在第 ${expectedBy} 章前兑现。`, weight, expectedBy });

describe("资料里的伏笔进时间线", () => {
  it("确认后时间线上出现这条伏笔，状态是规划、没有埋设出处", () => {
    const { session } = seeded();
    expect(author(session, { foreshadows: [claim("守夜人的旧伤", 12, "main")] }).status).toBe("confirmed");

    const lane = session.derived.views.foreshadows.find((f) => f.label === "守夜人的旧伤");
    expect(lane).toMatchObject({ id: "F03", status: "planned", weight: "main", expectedBy: 12, planted: null });
    // 编号由服务端分配，接着已有的 F02 往下走。
    expect(session.derived.projections.foreshadows.find((f) => f.id === "F03")?.plantedAt).toBe(0);
  });

  it("没有埋设出处的规划仍留在时间线上 —— 空白的时间线正是它要填的东西", () => {
    const { session } = seeded();
    author(session, { foreshadows: [claim("密库的第二把钥匙", 20)] });
    expect(session.derived.views.foreshadows.map((f) => f.id)).toContain("F03");
  });

  it("未确认的方案不产生伏笔 —— 建议不是事实", () => {
    const { session } = seeded();
    const proposal = session.preparation.propose({
      summary: "模型建议的伏笔", baseFingerprint: session.preparation.view().fingerprint,
      changes: { foreshadows: [claim("血刀客的来历", 30)] },
    });
    expect(proposal.status).toBe("proposed");
    expect(session.derived.views.foreshadows.map((f) => f.label)).not.toContain("血刀客的来历");
  });

  it("同一份方案里标签重复要挡掉 —— 正文写到时无法唯一认领", () => {
    const { session } = seeded();
    expect(() => author(session, { foreshadows: [claim("同名的安排", 9), claim("同名的安排", 15)] })).toThrow(/标签不能重复/u);
  });

  it("标签撞上已有伏笔要挡掉，并指出是哪一条", () => {
    const { session } = seeded();
    expect(() => author(session, { foreshadows: [claim("青铜钥匙", 9)] })).toThrow(/F01/u);
  });

  it("预期兑现章落在已写完的章里要挡掉 —— 规划只能指向未来", () => {
    const { session } = seeded();
    expect(() => author(session, { foreshadows: [claim("已经过期的安排", 2)] })).toThrow(/已经写完/u);
    expect(author(session, { foreshadows: [claim("刚好落在下一章", 3)] }).status).toBe("confirmed");
  });

  it("同一份方案重复确认不会把伏笔加两遍", () => {
    const { session } = seeded();
    const proposal = author(session, { foreshadows: [claim("锁眼里的铁屑", 11)] });
    expect(session.preparation.confirm(proposal.id).changed).toBe(false);
    expect(session.derived.views.foreshadows.filter((f) => f.label === "锁眼里的铁屑")).toHaveLength(1);
  });

  it("伏笔与关系可以同批提交，落的是各自的事件", () => {
    const { session } = seeded();
    author(session, {
      relations: [{ from: "C01", to: "C02", fromKind: null, toKind: "hostile", note: "互相试探" }],
      foreshadows: [claim("试探背后的交易", 18)],
    });
    expect(session.derived.views.relations.edges).toHaveLength(1);
    expect(session.derived.views.foreshadows.map((f) => f.label)).toContain("试探背后的交易");
  });

  it("规划态不报逾期告警 —— 它还没埋，谈不上拖", () => {
    const { session } = seeded();
    author(session, { foreshadows: [claim("永远不兑现的安排", 3)] });
    expect(session.derived.candidates.filter((a) => JSON.stringify(a).includes("永远不兑现的安排"))).toHaveLength(0);
  });
});
