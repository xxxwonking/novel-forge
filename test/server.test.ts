/**
 * JSON API（端点逻辑，不起端口）。
 *
 * 这批测试的重点是**一键动作的闭环**：POST 一次动作，响应里就该带上新的
 * 首页三条，而那条被处理掉的告警必须已经消失（§12.6.7 的"一次点击闭环"）。
 * 只测 handle()，因为 http.ts 那层只做收发与静态文件。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handle, type ApiRequest } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { EventStream } from "../src/store/event-stream.js";
import { deriveBudget } from "../src/beat/derive.js";
import { loadRules } from "../src/rules/load.js";
import { workProfile, workSetting } from "./fixtures.js";
import type { StructuralEventPayload } from "../src/types/events.js";
import type { ChapterBeat, ChapterPlan } from "../src/types/beat.js";
import type { CharacterCard } from "../src/types/character.js";
import type { ChapterNo } from "../src/types/primitives.js";

const rules = loadRules();
const NOW = "2026-09-07T00:00:00.000Z";
const LAST = 52;
const roots: string[] = [];

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

// ── 一个小项目：一条逾期主线伏笔 + 一条断线 + 一个消失的角色 ──────────────

function makeCard(
  id: `C${string}`,
  name: string,
  tier: CharacterCard["tier"],
  introducedAt: ChapterNo,
): Omit<CharacterCard, "state"> {
  return {
    id,
    name,
    aliases: [],
    tier,
    introducedAt,
    profile: {
      role: "测试人物",
      appearance: [{ key: "眼睛颜色", value: "浅褐", establishedAt: introducedAt, immutable: true }],
      traits: ["谨慎"],
      forbiddenBehaviors: [],
      wants: "查明真相",
      fears: "被牵连",
      background: "无",
    },
    speech: {
      sentenceLength: { min: 4, max: 16 },
      verbalTics: [],
      signatureLexicon: [],
      forbiddenLexicon: [],
      addressForms: [],
      syntaxBias: { question: 0.1, imperative: 0.2, elliptical: 0.3 },
      register: "colloquial",
      emotionalExpression: "suppressed",
      exemplars: ["我只问一次。"],
      counterExemplars: [],
    },
    provenance: "authored",
    updatedAt: NOW,
  };
}

const nextPlan: ChapterPlan = {
  chapterType: "event",
  coreEvent: "李长风撬开密室",
  secondaryThread: null,
  stageFeedback: "李长风确认账本被人先取走",
  hook: "门口的人手里也有一把钥匙",
  events: [{ kind: "action", summary: "撬开密室发现账本已被取走", weight: 2, plotLine: "P01" }],
  resolves: [],
  plants: [],
  characters: ["C01"],
  locations: [],
};

function seed(): string {
  const root = mkdtempSync(join(tmpdir(), "novel-forge-api-"));
  roots.push(root);

  const stream = new EventStream(() => NOW);
  const payloads: readonly { chapter: ChapterNo; payload: StructuralEventPayload }[] = [
    {
      chapter: 12,
      payload: {
        type: "foreshadow_planted",
        foreshadowId: "F07",
        label: "母亲的信",
        intent: "信里写明主角并非三叔亲侄。",
        weight: "main",
        visibility: "covert",
        expectedBy: LAST - 8,
        anchor: { chapter: 12, quote: "信纸边角被烧去一块", offsetHint: 0, occurrence: 0 },
      },
    },
    {
      chapter: 30,
      payload: {
        type: "plot_event",
        kind: "info",
        summary: "血刀客撕走刀谱最后一页",
        weight: 2,
        plotLine: "P03",
        participants: ["C01"],
        anchor: { chapter: 30, quote: "刀谱的最后一页", offsetHint: 0, occurrence: 0 },
      },
    },
    {
      chapter: LAST,
      payload: {
        type: "plot_event",
        kind: "info",
        summary: "查明账本所在",
        weight: 2,
        plotLine: "P01",
        participants: ["C01"],
        anchor: { chapter: LAST, quote: "账本就在那间密室里", offsetHint: 0, occurrence: 0 },
      },
    },
    { chapter: 26, payload: { type: "character_presence", characterId: "C05", role: "major" } },
    { chapter: LAST, payload: { type: "character_presence", characterId: "C01", role: "pov" } },
  ];
  for (const p of payloads) {
    stream.append({ chapter: p.chapter, origin: "C5_declaration", provenance: "proposed", payload: p.payload });
  }
  for (let c = 1; c <= LAST; c += 1) stream.decideChapter(c, "committed");

  const beats: ChapterBeat[] = [LAST, LAST + 1].map((chapter) => ({
    chapter,
    volume: 3,
    plan: nextPlan,
    budget: deriveBudget(nextPlan, workProfile, rules, { now: NOW }),
    // 动作闭环操作的是已确认计划；未确认方案的拦截另有业务用例。
    provenance: chapter === LAST ? "committed" : "authored",
    updatedAt: NOW,
  }));

  const chapters = new Map<ChapterNo, string>();
  chapters.set(12, "第12章\n信纸边角被烧去一块，剩下的字迹还认得出。");
  chapters.set(30, "第30章\n刀谱的最后一页被撕了下来。");
  chapters.set(LAST, `第${LAST}章\n账本就在那间密室里，他只差一把钥匙。`);

  new ProjectStore(root).save({
    setting: workSetting,
    profile: workProfile,
    characters: [makeCard("C01", "李长风", "protagonist", 1), makeCard("C05", "苏晚晴", "major", 3)],
    plotLines: [
      { id: "P01", label: "复仇主线", weight: "main" },
      { id: "P03", label: "血刀客的刀谱", weight: "sub" },
    ],
    beats,
    alertStates: [],
    events: stream.all(),
    chapters,
  });

  return root;
}

function session(): ProjectSession {
  return new ProjectSession(seed(), rules);
}

function get(s: ProjectSession, path: string, query = ""): { status: number; body: any } {
  return handle(s, req("GET", path, query));
}

function post(s: ProjectSession, path: string, body: unknown): { status: number; body: any } {
  return handle(s, { method: "POST", path, query: new URLSearchParams(), body });
}

function req(method: string, path: string, query = ""): ApiRequest {
  return { method, path, query: new URLSearchParams(query), body: undefined };
}

// ── 只读 ────────────────────────────────────────────────────────────────

describe("GET /api/overview", () => {
  it("给出当前章、下一章与首页三条", () => {
    const { status, body } = get(session(), "/api/overview");
    expect(status).toBe(200);
    expect(body.title).toBe(workSetting.title);
    // 当前章 = 有正文的最大章号，不是节拍表排到哪
    // （节拍表可以提前排好几章，而"逾期多少章"的参照必须是写到哪）。
    expect(body.currentChapter).toBe(LAST);
    expect(body.nextChapter).toBe(LAST + 1);
    expect(body.homepage.length).toBeGreaterThan(0);
    expect(body.counts.overdueForeshadows).toBe(1);
    expect(body.counts.brokenPlotLines).toBe(1);
  });

  it("下一章的节拍表带派生预算", () => {
    const { body } = get(session(), "/api/overview");
    expect(body.nextBeat.chapter).toBe(LAST + 1);
    expect(body.nextBeat.budget.words.min).toBeGreaterThan(0);
  });
});

describe("GET /api/views", () => {
  it("四张视图与共用横轴一起返回", () => {
    const { body } = get(session(), "/api/views");
    expect(body.axis.current).toBe(LAST);
    expect(body.foreshadows).toHaveLength(1);
    expect(body.plotTracks).toHaveLength(2);
    expect(body.arcs).toHaveLength(2);
    expect(body.relations.nodes).toEqual([]);
  });

  it("锚点已解析 —— 前端不必再发一次请求才知道能不能点", () => {
    const { body } = get(session(), "/api/views");
    expect(body.foreshadows[0].planted.resolution.status).toBe("exact");
  });
});

describe("GET /api/chapter 与 /api/anchor", () => {
  it("取一章正文", () => {
    const { body } = get(session(), "/api/chapter", `n=${LAST}`);
    expect(body.text).toContain("账本");
  });

  it("没有正文的章返回 404", () => {
    expect(get(session(), "/api/chapter", "n=99").status).toBe(404);
  });

  it("缺参数返回 400", () => {
    expect(get(session(), "/api/chapter").status).toBe(400);
  });

  it("锚点解析带上下文，供跳读页高亮", () => {
    const { body } = get(session(), "/api/anchor", `chapter=12&quote=${encodeURIComponent("信纸边角被烧去一块")}`);
    expect(body.resolution.status).toBe("exact");
    expect(body.context.hit).toBe("信纸边角被烧去一块");
  });

  it("引文被改写时返回 stale 而不是 404 —— 降级是一等状态", () => {
    const { status, body } = get(session(), "/api/anchor", "chapter=12&quote=已经不存在的句子");
    expect(status).toBe(200);
    expect(body.resolution).toEqual({ status: "stale", reason: "quote_not_found" });
    expect(body.context).toBeNull();
  });
});

describe("GET /api/health", () => {
  it("三段体检一起给：V2 节拍 + C6 章内 + C6 跨章", () => {
    const { body } = get(session(), "/api/health", `n=${LAST}`);
    expect(Array.isArray(body.plan)).toBe(true);
    expect(body.chapterGate.words).toBeGreaterThan(0);
    expect(Array.isArray(body.crossChapter)).toBe(true);
    // 这一章正文很短，字数必然不足 —— C6 该抓到。
    expect(body.chapterGate.findings.some((f: { rule: string }) => f.rule === "word_count_under")).toBe(true);
  });

  it("还没写正文的章只给规划期结论", () => {
    const { body } = get(session(), "/api/health", `n=${LAST + 1}`);
    expect(body.chapterGate).toBeNull();
    expect(Array.isArray(body.plan)).toBe(true);
  });

  it("已有正文且预算未持久化时仍返回章内体检，不改动作品资料", () => {
    const root = seed();
    const s = new ProjectSession(root, rules);
    s.putBeat({ ...s.beatFor(LAST)!, budget: null });
    const before = new ProjectStore(root).load();
    const { status, body } = get(s, "/api/health", `n=${LAST}`);
    expect(status).toBe(200);
    expect(body.chapterGate).not.toBeNull();
    expect(body.chapterGate.words).toBeGreaterThan(0);
    expect(body.chapterGate.findings.some((f: { rule: string }) => f.rule === "word_count_under")).toBe(true);
    expect(new ProjectStore(root).load()).toEqual(before);
  });

  it("没有节拍表的章返回 404", () => {
    expect(get(session(), "/api/health", "n=12").status).toBe(404);
  });
});

describe("未知端点", () => {
  it("GET 未知路径 404", () => {
    expect(get(session(), "/api/nope").status).toBe(404);
  });

  it("不支持的方法 405", () => {
    expect(handle(session(), { method: "DELETE", path: "/api/overview", query: new URLSearchParams(), body: undefined }).status).toBe(405);
  });
});

// ── 一键动作闭环 ────────────────────────────────────────────────────────

describe("POST /api/alerts/action —— 一次点击闭环（§12.6.7）", () => {
  it("加入回收后，那条告警在同一个响应里就已经消失", () => {
    const s = session();
    const before = get(s, "/api/overview").body;
    const alert = before.homepage.find((a: { id: string }) => a.id === "foreshadow_overdue:F07");
    expect(alert).toBeDefined();

    const action = alert.actions.find((x: { kind: string }) => x.kind === "add_resolution_to_beat");
    const { status, body } = post(s, "/api/alerts/action", { alertId: alert.id, action });

    expect(status).toBe(200);
    expect(body.changed).toBe(true);
    expect(body.beat.plan.resolves[0].foreshadowId).toBe("F07");
    // 响应自带新首页 —— 前端不需要再发一次 GET 才知道它消失了。
    expect(body.alerts.homepage.map((a: { id: string }) => a.id)).not.toContain("foreshadow_overdue:F07");
  });

  it("主线收束把目标章升级为回收章，预算随之放宽并回报", () => {
    const s = session();
    const alert = get(s, "/api/overview").body.homepage.find((a: { id: string }) => a.id === "foreshadow_overdue:F07");
    const widthBefore = get(s, "/api/overview").body.nextBeat.budget.words.max;

    const { body } = post(s, "/api/alerts/action", {
      alertId: alert.id,
      action: alert.actions.find((x: { kind: string }) => x.kind === "add_resolution_to_beat"),
    });

    expect(body.promotedToPayoff).toBe(true);
    expect(body.beat.plan.chapterType).toBe("payoff");
    expect(body.beat.budget.words.max).toBeGreaterThan(widthBefore);
  });

  it("改动落盘 —— 重开一个会话仍然看得到", () => {
    const root = seed();
    const first = new ProjectSession(root, rules);
    const alert = get(first, "/api/overview").body.homepage.find((a: { id: string }) => a.id === "foreshadow_overdue:F07");
    post(first, "/api/alerts/action", {
      alertId: alert.id,
      action: alert.actions.find((x: { kind: string }) => x.kind === "add_resolution_to_beat"),
    });

    const reopened = new ProjectSession(root, rules);
    expect(get(reopened, "/api/overview").body.nextBeat.plan.resolves[0].foreshadowId).toBe("F07");
    expect(get(reopened, "/api/overview").body.homepage.map((a: { id: string }) => a.id)).not.toContain(
      "foreshadow_overdue:F07",
    );
  });

  it("加入推进 → 断线告警消失", () => {
    const s = session();
    const alert = get(s, "/api/alerts").body.fullList.find((a: { id: string }) => a.id === "plotline_gap:P03");
    expect(alert).toBeDefined();

    const { body } = post(s, "/api/alerts/action", {
      alertId: alert.id,
      action: { kind: "add_advance_to_beat", targetChapter: LAST + 1, plotLine: "P03" },
    });
    expect(body.alerts.homepage.map((a: { id: string }) => a.id)).not.toContain("plotline_gap:P03");
  });

  it("加入出场 → 角色消失告警消失", () => {
    const s = session();
    const alert = get(s, "/api/alerts").body.fullList.find((a: { id: string }) => a.id === "character_missing:C05");
    const { body } = post(s, "/api/alerts/action", {
      alertId: alert.id,
      action: { kind: "add_character_to_beat", targetChapter: LAST + 1, characterId: "C05" },
    });
    expect(body.alerts.homepage.map((a: { id: string }) => a.id)).not.toContain("character_missing:C05");
  });

  it("废弃伏笔 → 事件流追加 abandoned，伏笔从未收清单里消失", () => {
    const s = session();
    const { body } = post(s, "/api/alerts/action", {
      alertId: "foreshadow_overdue:F07",
      action: { kind: "abandon", foreshadowId: "F07" },
      reason: "这条线不要了",
    });
    expect(body.changed).toBe(true);
    expect(get(s, "/api/views").body.foreshadows[0].status).toBe("abandoned");
    expect(get(s, "/api/overview").body.counts.openForeshadows).toBe(0);
  });

  it("改期 → expectedBy 变化，逾期消失", () => {
    const s = session();
    post(s, "/api/alerts/action", {
      alertId: "foreshadow_overdue:F07",
      action: { kind: "reschedule", foreshadowId: "F07", expectedBy: LAST + 20 },
    });
    const lane = get(s, "/api/views").body.foreshadows[0];
    expect(lane.expectedBy).toBe(LAST + 20);
    expect(lane.overdueSpan).toBeNull();
  });

  it("确认退场 → 角色状态改 missing 并静音", () => {
    const s = session();
    const { body } = post(s, "/api/alerts/action", {
      alertId: "character_missing:C05",
      action: { kind: "confirm_exit", characterId: "C05" },
    });
    expect(body.changed).toBe(true);
    const after = get(s, "/api/alerts").body;
    expect(after.homepage.map((a: { id: string }) => a.id)).not.toContain("character_missing:C05");
    expect(after.suppressed.some((x: { reason: string }) => x.reason === "acknowledged")).toBe(true);
  });

  it("纯导航动作不产生副作用", () => {
    const s = session();
    const { body } = post(s, "/api/alerts/action", {
      alertId: "plotline_gap:P03",
      action: { kind: "open_view", view: "plotline" },
    });
    expect(body.changed).toBe(false);
  });

  it("目标章没有节拍表时给 404 而不是静默失败", () => {
    const s = session();
    const { status, body } = post(s, "/api/alerts/action", {
      alertId: "foreshadow_overdue:F07",
      action: { kind: "add_resolution_to_beat", targetChapter: 999, foreshadowId: "F07", weight: "main", completeness: "full" },
    });
    expect(status).toBe(404);
    expect(body.error).toContain("999");
  });

  it("不在候选里的 alertId 给 404", () => {
    expect(post(session(), "/api/alerts/action", { alertId: "foreshadow_overdue:F99", action: { kind: "acknowledge" } }).status).toBe(404);
  });

  it("请求体不合法给 400", () => {
    const s = session();
    expect(post(s, "/api/alerts/action", "字符串").status).toBe(400);
    expect(post(s, "/api/alerts/action", { action: { kind: "acknowledge" } }).status).toBe(400);
    expect(post(s, "/api/alerts/action", { alertId: "x" }).status).toBe(400);
  });
});

describe("POST 忽略 / 静音", () => {
  it("忽略累加，达上限后退出首页但仍在完整列表", () => {
    const s = session();
    const id = "foreshadow_overdue:F07";
    for (let i = 0; i < rules.alerts.fatigueDropAt; i += 1) post(s, "/api/alerts/ignore", { alertId: id });

    const after = get(s, "/api/alerts").body;
    expect(after.homepage.map((a: { id: string }) => a.id)).not.toContain(id);
    expect(after.fullList.map((a: { id: string }) => a.id)).toContain(id);
    expect(after.suppressed.some((x: { reason: string }) => x.reason === "fatigued")).toBe(true);
  });

  it("静音后彻底不出现，取消静音后回来", () => {
    const s = session();
    const id = "character_missing:C05";
    post(s, "/api/alerts/acknowledge", { alertId: id });
    expect(get(s, "/api/alerts").body.fullList.map((a: { id: string }) => a.id)).not.toContain(id);

    post(s, "/api/alerts/unacknowledge", { alertId: id });
    expect(get(s, "/api/alerts").body.fullList.map((a: { id: string }) => a.id)).toContain(id);
  });
});

describe("会话缓存", () => {
  it("同一状态下两次读取返回同一份派生结果（不重复重放事件流）", () => {
    const s = session();
    expect(s.derived).toBe(s.derived);
  });

  it("写操作后缓存失效", () => {
    const s = session();
    const before = s.derived;
    post(s, "/api/alerts/ignore", { alertId: "foreshadow_overdue:F07" });
    expect(s.derived).not.toBe(before);
  });
});
