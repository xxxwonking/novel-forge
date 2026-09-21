/**
 * 全文检索（差距第 9 项）。
 *
 * 一条链路必须闭合：检索给出的片段要能被锚点**原样解析回来**，而且落在命中的
 * 那一处。否则「跳到原文」会静默落到别处或报 stale —— 那是这条链路唯一会
 * 悄悄坏掉的地方。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handle, type ApiRequest } from "../src/server/api.js";
import { searchWork } from "../src/search/service.js";
import { NO_MODEL_REVIEW, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function seeded(snapshot = writingSnapshot()) {
  const root = mkdtempSync(join(tmpdir(), "nf-search-"));
  roots.push(root);
  new ProjectStore(root).save(snapshot);
  return new ProjectSession(root, NO_MODEL_REVIEW);
}
const get = (session: ProjectSession, path: string, params: Record<string, string> = {}) =>
  handle(session, { method: "GET", path, query: new URLSearchParams(params), body: null } satisfies ApiRequest);

describe("全文检索", () => {
  it("正文命中按章号升序，给出该章命中数与片段", () => {
    const session = seeded();
    const result = searchWork(session, "钥匙");
    expect(result.chapters.map((c) => c.chapter)).toEqual([1]);
    // CH1 里「钥匙」出现三次：青铜钥匙 / 钥匙的齿缝 / 收起钥匙。
    expect(result.chapters[0]?.count).toBe(3);
    // 片段切到句读边界 —— 从句子中间切开的片段读不通，也难在正文里认出来。
    expect(result.chapters[0]?.snippets.map((s) => s.quote)).toEqual([
      "守夜人将一枚青铜钥匙放在桌上。", "钥匙的齿缝沾着红泥。", "李长风收起钥匙，记住了守夜人的面容。",
    ]);
  });

  it("片段能被锚点原样解析回来，并落在它自己那一处", () => {
    const session = seeded();
    const hit = searchWork(session, "钥匙").chapters[0]!;
    const text = session.chapterText(1)!;
    for (const snippet of hit.snippets) {
      // 片段必须是正文的逐字子串，否则锚点无从定位。
      expect(text).toContain(snippet.quote);
      const res = get(session, "/api/anchor", { chapter: "1", quote: snippet.quote });
      expect(res.status).toBe(200);
      const resolution = (res.body as { resolution: { status: string; offset?: number } }).resolution;
      expect(resolution.status).not.toBe("stale");
      expect(resolution.offset).toBe(snippet.offset);
    }
  });

  it("结构也进检索：人物、地点、情节线、章计划、伏笔与事件", () => {
    const session = seeded();
    const kinds = new Set(searchWork(session, "钥匙").entities.map((e) => e.kind));
    expect(kinds.has("beat")).toBe(true);
    expect(kinds.has("event")).toBe(true);

    const place = searchWork(session, "青州城");
    expect(place.entities.some((e) => e.kind === "setting" && e.title.includes("青州城"))).toBe(true);
    const person = searchWork(session, "李长风");
    expect(person.entities.some((e) => e.kind === "character" && e.title === "李长风")).toBe(true);
    const line = searchWork(session, "追查旧案");
    expect(line.entities.some((e) => e.kind === "plotLine")).toBe(true);
    // 结构命中要说清命中在哪个字段，否则作者看不出为什么它算命中。
    expect(person.entities.every((e) => e.field !== "" && e.excerpt !== "")).toBe(true);
    // 一个实体只给一行：「城」在青州城的名称、描述、要点里都出现，不该刷出三条。
    const many = searchWork(session, "城").entities.filter((e) => e.kind === "setting" && e.title === "青州城");
    expect(many).toHaveLength(1);
    expect(many[0]?.field).toBe("名称");
  });

  it("西文不分大小写，中文精确匹配 —— 不做模糊，假命中比漏掉更伤", () => {
    const base = writingSnapshot();
    const session = seeded({ ...base, chapters: new Map([[1, "他在信封上写了 Keyframe，又划掉改成 KEY。"]]) });
    const latin = searchWork(session, "key").chapters[0]!;
    expect(latin.count).toBe(2);
    // 同一句里的两处命中只给一条片段，不把同一行抄两遍。
    expect(latin.snippets).toHaveLength(1);
    expect(searchWork(session, "KEYFRAME").chapters[0]?.count).toBe(1);
    expect(searchWork(session, "钥").chapters).toEqual([]);
  });

  it("只搜已确认的事件：待确认的候选还不是故事事实", () => {
    const base = writingSnapshot();
    const proposed = base.events.map((event) => ({ ...event, envelope: { ...event.envelope, provenance: "proposed" as const } }));
    const session = seeded({ ...base, events: proposed });
    expect(searchWork(session, "钥匙").entities.some((e) => e.kind === "event")).toBe(false);
    expect(searchWork(session, "钥匙").chapters.length).toBeGreaterThan(0);
  });

  it("空查询与纯空白不检索", () => {
    const session = seeded();
    expect(() => searchWork(session, "   ")).toThrow(/检索词/u);
    expect(get(session, "/api/search").status).toBe(400);
    expect(get(session, "/api/search", { q: " " }).status).toBe(400);
  });

  it("命中过多时截断并标出来，不把一整本书倒给界面", () => {
    const base = writingSnapshot();
    const chapters = new Map<number, string>();
    for (let n = 1; n <= 200; n++) chapters.set(n, "钥匙。".repeat(20));
    const session = seeded({ ...base, chapters });
    const result = searchWork(session, "钥匙");
    expect(result.truncated).toBe(true);
    expect(result.chapters.length).toBeLessThan(200);
    // 每章片段也有上限 —— 一章 20 次命中不该铺满结果页。
    expect(result.chapters[0]?.count).toBe(20);
    expect(result.chapters[0]?.snippets.length).toBeLessThan(20);
  });

  it("长篇下是线性扫描：2000 章 600 万字一次查询不塌", () => {
    const base = writingSnapshot();
    const chapters = new Map<number, string>();
    for (let n = 1; n <= 2000; n++) chapters.set(n, `${"风从旧库的缝里吹进来。".repeat(272)}钥匙在第 ${n} 章。`);
    const session = seeded({ ...base, chapters });
    const started = performance.now();
    const result = searchWork(session, "钥匙");
    const elapsed = performance.now() - started;
    expect(result.chapters.length).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(1000);
  });

  it("端点返回与服务同形，查询词原样回显", () => {
    const session = seeded();
    const res = get(session, "/api/search", { q: "钥匙" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(searchWork(session, "钥匙"));
    expect((res.body as { query: string }).query).toBe("钥匙");
  });
});
