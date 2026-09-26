/**
 * 导入旧稿后，人物弧线的出场轴由代码扫正文补出。
 *
 * 背景：弧线的横轴读 `character_presence`，而它只在写章 / 采用结构声明 / 逐章反推
 * 时产生。于是导完一本旧稿，人物档案是满的，弧线上却每个人都是 0 次出场。
 *
 * 四条判断：
 *   ① **出场记录由代码扫正文得出**，不问模型 —— 与「首次出场章由代码扫」同源，
 *      那一批已经在扫"第一次"，扫"每一章"是同一个循环。确定性、零消耗。
 *   ② **代码只能确认「这一章提到了他」**，所以一律记 `mentioned`。声称是视角人物
 *      要读懂那一章，那是模型的活儿。
 *   ③ **扫描只补缺口**：同一人同一章另有声明（写章 / 反推），扫描那条让位，与先后
 *      无关 —— 声明读过那一章、给得出档位，扫描只知道名字出现过。
 *   ④ **扫描结果派生自正文，正文一换就作废**；而它没有锚点、不指向原文任何位置，
 *      所以也不该像真正的结构记录那样锁住「覆盖导入」。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { project, projectCharacterState } from "../src/store/project.js";
import { loadRules } from "../src/rules/load.js";
import { MaterialStore } from "../src/import/materials.js";
import { handleAsync, type ApiRequest } from "../src/server/api.js";
import type Anthropic from "@anthropic-ai/sdk";
import type { CallResult } from "../src/client/claude.js";
import type { ProjectSnapshot } from "../src/store/persist.js";
import type { StructuralEvent } from "../src/types/events.js";
import { CH2, NOW, declaration, fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/**
 * 两章正文、两个人物的作品（见 writing-fixtures）：
 *   第 1 章出现「李长风」「守夜人」，第 2 章出现「李长风」「血刀客」。
 *   事件流里已有一条 C01 第 2 章的 `pov` 出场声明。
 */
function seeded(patch: (base: ProjectSnapshot) => ProjectSnapshot = (b) => b) {
  const root = mkdtempSync(join(tmpdir(), "nf-arc-"));
  roots.push(root);
  new ProjectStore(root).save(patch(writingSnapshot()));
  return { root, session: new ProjectSession(root, undefined) };
}
/** 刚导入的旧稿：正文与人物都在，一条结构记录都没有 —— 这一批要补的正是它。 */
const imported = () => seeded((base) => ({ ...base, events: [] }));

/** 提交一份只动人物的方案并确认。人物卡的派生字段由代码补，不能由调用方送。 */
function reconfirm(session: ProjectSession, index = 0, edit: (card: Record<string, unknown>) => Record<string, unknown> = (c) => c) {
  const card = session.meta.characters[index]!;
  const { provenance: _p, introducedAt: _i, updatedAt: _u, state: _s, ...rest } = card as Record<string, unknown>;
  return session.preparation.recordAuthor({
    summary: "作者确认人物资料",
    changes: { characters: [edit(rest)] },
    baseFingerprint: session.preparation.view().fingerprint,
  });
}

const arcOf = (session: ProjectSession, id: string) => session.derived.views.arcs.find((a) => a.characterId === id);
const chaptersOf = (session: ProjectSession, id: string) => arcOf(session, id)?.presence.map((p) => p.chapter);
const scanned = (session: ProjectSession) => session.events()
  .filter((e) => e.payload.type === "character_presence" && e.envelope.origin === "text_scan" && e.envelope.provenance === "committed");

describe("出场轴由代码扫正文补出", () => {
  it("确认人物方案后，弧线上出现正文里提到他的每一章", () => {
    const { session } = imported();
    // 起点：血刀客在正文第 2 章出现过，但弧线上一次出场都没有。
    expect(arcOf(session, "C02")?.presence).toHaveLength(0);

    expect(reconfirm(session, 1).status).toBe("confirmed");

    expect(arcOf(session, "C02")?.presence).toEqual([{ chapter: 2, role: "mentioned" }]);
  });

  it("一个人在多章出现就记多章，按章号有序", () => {
    const { session } = imported();
    reconfirm(session);
    expect(chaptersOf(session, "C01")).toEqual([1, 2]);
  });

  it("别名也算 —— 作者常把化名写在 aliases 里", () => {
    const { session } = seeded();
    // 本名「厉无咎」正文里从未出现，只有「守夜人」这个称呼（第 1 章）：
    // 只扫 name 会把整个人漏掉。新建的人物不触及既有正文，所以能直接确认。
    reconfirm(session, 0, (card) => ({ ...card, id: "C03", name: "厉无咎", aliases: ["守夜人"] }));
    expect(chaptersOf(session, "C03")).toEqual([1]);
  });

  it("移除别名后，旧别名扫出的出场不再留在轴上", () => {
    const { root, session } = imported();
    reconfirm(session, 0);
    reconfirm(session, 0, (card) => ({ ...card, id: "C03", name: "厉无咎", aliases: ["守夜人"] }));
    expect(chaptersOf(session, "C03")).toEqual([1]);

    expect(reconfirm(session, 2, (card) => ({ ...card, aliases: [] })).status).toBe("confirmed");
    expect(chaptersOf(session, "C03")).toEqual([]);
    expect(chaptersOf(session, "C01")).toEqual([1, 2]);
    expect(chaptersOf(new ProjectSession(root, undefined), "C03")).toEqual([]);
  });

  it("已有的出场声明不被扫描覆盖，也不重复记一条", () => {
    const { session } = seeded();
    // C01 第 2 章已由 C5 声明为 pov —— 那是读懂正文后的判断，比「提到」重。
    reconfirm(session);
    expect(arcOf(session, "C01")?.presence).toEqual([{ chapter: 1, role: "mentioned" }, { chapter: 2, role: "pov" }]);
    // 让位的那一章连写都不写：事件流里不留一条注定被遮住的记录。
    expect(scanned(session).map((e) => e.envelope.chapter)).toEqual([1]);
  });

  it("重复确认同一份方案不会把出场加两遍", () => {
    const { session } = imported();
    const first = reconfirm(session);
    expect(session.preparation.confirm(first.id).changed).toBe(false);
    reconfirm(session);
    expect(chaptersOf(session, "C01")).toEqual([1, 2]);
    expect(scanned(session)).toHaveLength(2);
  });

  it("未确认的方案不产生出场 —— 建议不是事实", () => {
    const { session } = imported();
    const card = session.meta.characters[1]!;
    const { provenance: _p, introducedAt: _i, updatedAt: _u, state: _s, ...rest } = card as Record<string, unknown>;
    // 改了身份且正文里有这个名字 → 触及已有正文，方案停在待确认。
    const proposal = session.preparation.propose({
      summary: "模型建议的人物", baseFingerprint: session.preparation.view().fingerprint,
      changes: { characters: [{ ...rest, profile: { ...(rest["profile"] as object), role: "改写过的定位" } }] },
    });
    expect(proposal.status).toBe("proposed");
    expect(scanned(session)).toHaveLength(0);
  });

  it("还没有正文的作品不产生出场记录", () => {
    const { session } = seeded((base) => ({ ...base, events: [], chapters: new Map() }));
    reconfirm(session, 1);
    expect(scanned(session)).toHaveLength(0);
  });

  it("只扫本方案动过的人 —— 确认一份无关方案不翻动所有人的出场轴", () => {
    const { session } = imported();
    session.preparation.recordAuthor({
      summary: "作者改设定", changes: { setting: { styleKeywords: ["冷硬"] } },
      baseFingerprint: session.preparation.view().fingerprint,
    });
    expect(scanned(session)).toHaveLength(0);
  });

  it("归因记成代码扫描、直接生效，不冒充模型反推", () => {
    const { session } = imported();
    reconfirm(session, 1);
    const events = scanned(session);
    expect(events).toHaveLength(1);
    expect(events[0]?.envelope).toMatchObject({ chapter: 2, provenance: "committed" });
  });

  it("扫出来的出场不算「已写进正式事件」，删人物仍走候选而不是硬拒", () => {
    const { session } = seeded();
    // 扫描把「正文里提到这个名字」变成了事件。若把它当结构引用，删除的判断就会从
    // 「落候选、改完正文自己消失」翻成硬拒 —— 那是作者绕不过去的死路。
    // 用一个节拍表没点名的人物：那条闸门是另一回事，拦在这里会盖住要测的东西。
    reconfirm(session, 0, (card) => ({ ...card, id: "C03", name: "厉无咎", aliases: ["守夜人"] }));
    expect(scanned(session)).toHaveLength(1);

    const removal = session.preparation.recordAuthor({
      summary: "作者删除人物", changes: { removals: { characters: ["C03"] } },
      baseFingerprint: session.preparation.view().fingerprint,
    });
    expect(removal.status).toBe("proposed");
    expect(removal.impacts.map((i) => i.message).join("")).toMatch(/正文里出现过/u);
  });
});

describe("扫描只补缺口，声明优先", () => {
  it("先扫描、后反推：确认反推后这一章以反推为准，不叠出两条", () => {
    const { session } = imported();
    reconfirm(session);
    expect(chaptersOf(session, "C01")).toEqual([1, 2]);

    // 反推读懂了第 2 章，判他是视角人物。反推的确认不经过「正文替换」，扫描那条还在流里。
    session.replaceInference(2, { ...declaration(), characterPresence: [{ type: "character_presence", characterId: "C01", role: "pov" }] });
    session.decideInference(2, "committed");

    expect(arcOf(session, "C01")?.presence).toEqual([{ chapter: 1, role: "mentioned" }, { chapter: 2, role: "pov" }]);
  });

  it("与先后无关，且出场章数不重复计", () => {
    const rules = loadRules();
    const presence = (seq: number, origin: "text_scan" | "import_inference", role: "mentioned" | "pov"): StructuralEvent => ({
      envelope: { id: `ch2-${seq}`, seq, chapter: 2, origin, provenance: "committed", createdAt: NOW },
      payload: { type: "character_presence", characterId: "C01", role },
    });
    const scan = presence(1, "text_scan", "mentioned");
    const declared = presence(2, "import_inference", "pov");
    for (const events of [[scan, declared], [declared, scan]]) {
      const { arcs } = project({
        events, currentChapter: 2, plotLineDefs: [], plotLineGap: rules.crossChapter.plotLineGap,
        characterProfiles: [{ id: "C01", name: "李长风", tier: "protagonist", introducedAt: 1 }],
      });
      expect(arcs[0]?.presence).toEqual([{ chapter: 2, role: "pov" }]);
      expect(projectCharacterState(events, "C01", 1).appearanceCount).toBe(1);
    }
  });
});

describe("扫描随正文作废", () => {
  it("正文被替换后，旧正文扫出的出场作废", () => {
    const { session } = imported();
    reconfirm(session, 1);
    expect(chaptersOf(session, "C02")).toEqual([2]);

    session.putChapter(2, "李长风独自下山，一路无话。");

    expect(chaptersOf(session, "C02")).toEqual([]);
    // 别人的那一章也作废 —— 他仍在新正文里，但那条记录是从旧正文扫出来的。
    expect(scanned(session)).toHaveLength(0);
  });

  it("逐字相同的重写不算替换，扫描结果保留", () => {
    const { session } = imported();
    reconfirm(session, 1);
    session.putChapter(2, CH2);
    expect(chaptersOf(session, "C02")).toEqual([2]);
  });

  it("扫描结果不锁住覆盖导入：它没有锚点，不指向原文的任何位置", () => {
    const { session } = imported();
    reconfirm(session);
    expect(chaptersOf(session, "C01")).toEqual([1, 2]);

    const result = session.imports.apply({ text: "第1章 夜\n\n守夜人放下钥匙就走了。", overwrite: true });

    expect(result).toMatchObject({ replaced: [1] });
    expect(chaptersOf(session, "C01")).toEqual([2]);
  });
});

describe("从资料识别情节线", () => {
  const OUTLINE = "主线：沈叙追查十年前的失踪案。支线：林见秋与沈叙之间迟迟没说开的旧事。";
  const toolUse = (name: string, input: unknown): CallResult => ({
    kind: "ok",
    message: modelMessage([{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock], "tool_use"),
  });
  const lines = [{ id: "P01", label: "失踪案", weight: "main" }, { id: "P02", label: "林见秋的旧事", weight: "sub" }];

  /** 导入后的书：正文与大纲都在，还没有一条情节线。方案要带当时的指纹，所以脚本按它来排。 */
  function withOutline(plan: (fingerprint: string) => CallResult[]) {
    const root = mkdtempSync(join(tmpdir(), "nf-plot-"));
    roots.push(root);
    const base = writingSnapshot();
    new ProjectStore(root).save({ ...base, plotLines: [], beats: [], events: [] });
    new MaterialStore(root).save("大纲.txt", OUTLINE);
    const fingerprint = new ProjectSession(root, undefined).preparation.view().fingerprint;
    const { client, calls } = fakeClient(plan(fingerprint));
    return { calls, session: new ProjectSession(root, undefined, { client }) };
  }
  const proposing = (fingerprint: string) => [
    toolUse("propose_preparation", { summary: "从大纲认出情节线", baseFingerprint: fingerprint, changes: { plotLines: lines } }),
    modelText("认出两条线。"),
  ];

  it("把资料与抽样正文交给模型、只要情节线，产出待确认方案", async () => {
    const { calls, session } = withOutline(proposing);
    const result = await session.draftPreparation({ focus: "plotlines", apply: true });

    const ask = JSON.stringify(calls[0]?.messages);
    expect(ask).toContain("changes.plotLines");
    expect(ask).toContain(OUTLINE);
    // 认情节线不碰人物卡：人物卡的完整性要求不该出现在这次请求里。
    expect(ask).not.toContain("人物 profile 与 speech 必须是完整的");

    const proposal = session.preparation.get(result.proposalId!);
    expect(proposal.status).toBe("proposed");
    expect(proposal.changes.plotLines?.map((p) => p.id)).toEqual(["P01", "P02"]);
    expect(session.meta.plotLines).toEqual([]);
  });

  it("确认后情节线视图出现轨道：还没有节点，也不算断线", async () => {
    const { session } = withOutline(proposing);
    const result = await session.draftPreparation({ focus: "plotlines", apply: true });
    session.preparation.confirm(result.proposalId!);

    const tracks = session.derived.views.plotTracks;
    expect(tracks.map((t) => [t.id, t.weight])).toEqual([["P01", "main"], ["P02", "sub"]]);
    expect(tracks.every((t) => t.nodes.length === 0 && t.gapSpan === null)).toBe(true);
    // 从未推进过的线是「还没开始」，不是「断了」—— 首页不能因为刚认出来就报断线。
    expect(session.derived.candidates.some((c) => c.alert.category === "plotline_gap")).toBe(false);
  });

  it("接口收 plotlines，其他值说清能填什么", async () => {
    const { session } = withOutline(proposing);
    const post = (body: unknown) => handleAsync(session, { method: "POST", path: "/api/preparation/draft", query: new URLSearchParams(), body } satisfies ApiRequest);
    const wrong = await post({ focus: "plots" });
    expect(wrong.status).toBe(400);
    expect(JSON.stringify(wrong.body)).toContain("plotlines");
    expect((await post({ focus: "plotlines" })).status).toBe(200);
  });
});
