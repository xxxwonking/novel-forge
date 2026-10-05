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

  /**
   * 规模用例的替身来源。
   *
   * `searchWork` 只要 `meta` / `events` / `chapterNumbers` / `chapterText` 四项，所以
   * **不必为了量扫描速度去真写 2000 个文件** —— 旧版走 `seeded()` 即 `ProjectStore.save()`，
   * 2000 章就是 2000 个文件，而 `withFileTransaction` 会为每个文件在日志里记
   * `before`+`after` 全文，一次搭夹具在内存里攒下约两份 600 万字。那是 §51 记录的
   * worker 崩溃的来源，而它量的也不是检索本身。
   */
  const scanOf = (session: ProjectSession, count: number) => {
    const chapters = new Map<number, string>();
    for (let n = 1; n <= count; n++) chapters.set(n, `${"风从旧库的缝里吹进来。".repeat(272)}钥匙在第 ${n} 章。`);
    return { meta: session.meta, events: () => session.events(),
      chapterNumbers: () => [...chapters.keys()], chapterText: (n: number) => chapters.get(n) };
  };

  /**
   * 线性扫描用**相对基准**守，不用绝对墙钟（§51 → §52 的结论）。
   *
   * 旧版断言 `elapsed < 1000`，量的其实是「这台机器这一刻有多闲」：同一台机器上
   * 单跑必过、并行全量必败，后来测试套更大了反而三次全过。一条随环境翻面的断言
   * 比没有断言更坏 —— 它会教人忽略红灯。
   *
   * 章数翻 10 倍，线性实现的耗时也该约 10 倍。两个规模在**同一进程里紧挨着量**，
   * 机器快慢会同时缩放掉，剩下的就是复杂度。余量给到 25 倍：真退化成平方是 100 倍量级，
   * 抓得住；而 GC 抖动进不来。
   *
   * ⚠ **计时必须用一个扫不到的词。** `MAX_CHAPTERS = 50` 会让常见词在第 51 章就
   * `break` —— 实测「钥匙」在 200 章和 2000 章下都只访问 **51 章**，两档做的是同样的活，
   * 比值恒为 1。旧版标题写着「2000 章 600 万字」，其实从来没扫过 2000 章；
   * 那条绝对阈值量到的是搭夹具的副作用与机器负载。扫不到的词才走满全程（实测 200 / 2000）。
   *
   * **这条守不住的东西**（写明白，别误以为它管）：每次查询多出来的**固定**开销
   * （比如每次现建一份索引）会让比值变小而不是变大，这里看不出来。它守的是
   * 「不许超线性退化」这一件事。
   *
   * ⚠ **取 N 次重复里的最小值，不是一次的耗时。** 相对基准解决了"机器快慢"，
   * 没解决"噪声"：全量并行下连跑 7 次红 3 次，单跑 9/9 全过。实测分布（全量负载下，
   * 单位毫秒，`small`/`large` 各 7 个样本）：
   *
   *     small: 0.27 0.56 0.21 0.21 0.24 0.20 0.21   ← 稳，极差 2.8 倍
   *     large: 3.63 5.11 12.92 2.93 1.89 14.09 8.19 ← 噪，极差 **7.5 倍**
   *     单次比值: 13.4 9.1 61.5 14.0 7.9 70.5 39.0  ← 过半超 25
   *     取各自最小: 0.20 / 1.89 → 比值 **9.4**，正好贴着章数比 10
   *
   * 所以噪声在大档那边，不在小档的计时精度上（这一点与直觉相反，是量出来的）。
   * **min-of-N 的根据**：GC 停顿与被调度器抢走只会让耗时**变大**，不会变小 ——
   * 所以最小值收敛到真实开销，而单次/均值会被最差的那次带跑。
   * 样本要**短而多**（不是长而少）：长样本更可能整段都压上一次 GC，就没有干净的那次了。
   * 这是修量程，不是放阈值 —— 阈值仍是 25 倍，而真实比值 9.4。
   */
  it("长篇下是线性扫描：章数翻 10 倍，耗时不该翻几十倍", () => {
    const session = seeded();
    const small = scanOf(session, 200);
    const large = scanOf(session, 2000);
    const MISS = "整本书都不会出现的检索词";
    /** 一个样本：短（5 次查询），好让噪声有机会落在样本之外。 */
    const sample = (source: ReturnType<typeof scanOf>): number => {
      const started = performance.now();
      for (let i = 0; i < 5; i++) searchWork(source, MISS);
      return performance.now() - started;
    };
    // 先确认计时用的词确实走满全程（没命中即没有提前 break），常见词则照常截断。
    expect(searchWork(large, MISS).chapters).toEqual([]);
    expect(searchWork(large, "钥匙").truncated).toBe(true);
    expect(searchWork(large, "钥匙").chapters.length).toBe(50);

    // 预热两档：第一次要付 JIT 与首次分配的账，不该记在任何一档头上。
    searchWork(small, MISS);
    searchWork(large, MISS);

    // 交替量：一次负载尖峰不会只砸在其中一档上。各自取最小。
    let smallMs = Infinity;
    let largeMs = Infinity;
    for (let round = 0; round < 9; round++) {
      smallMs = Math.min(smallMs, sample(small));
      largeMs = Math.min(largeMs, sample(large));
    }

    expect(smallMs).toBeGreaterThan(0); // 计时器分辨率兜底：为 0 时比值无意义。
    expect(largeMs / smallMs).toBeLessThan(25);
  });

  it("端点返回与服务同形，查询词原样回显", () => {
    const session = seeded();
    const res = get(session, "/api/search", { q: "钥匙" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual(searchWork(session, "钥匙"));
    expect((res.body as { query: string }).query).toBe("钥匙");
  });
});
