/**
 * 逐章反推结构（差距第 2 项下半场）。
 *
 * 第 29 节把旧稿正文放进了库里，这一批从正文反推出结构声明。最要紧的三条断言：
 *   ① 反推产出**只落 proposed**，投影一动不动 —— 正文是作者的，但对正文的结构
 *      判断是模型的，作者确认才成为事实。
 *   ② **必须顺序进行**：第 N 章要兑现的伏笔编号是第 1..N-1 章分配出来的，
 *      跳章反推拿不到它们，所以服务端直接拒绝。
 *   ③ **引文必须真的在正文里**。旧稿反推最容易出的错是模型复述而不是逐字引用，
 *      那种记录采用后锚点全是死的。
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handleAsync } from "../src/server/api.js";
import { EventStream } from "../src/store/event-stream.js";
import { NO_MODEL_REVIEW, fakeClient, modelText, writingSnapshot } from "./writing-fixtures.js";
import type { CallResult } from "../src/client/claude.js";
import { estimateTokens } from "../src/context/select-l3.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** 旧稿三章。引文断言都从这里逐字取，写得长一点才测得出「复述而非引用」。 */
const OLD1 = "守夜人把一枚青铜钥匙放在桌上，齿缝里沾着干透的红泥。李长风收起钥匙，记住了那张脸。";
const OLD2 = "李长风的毒伤仍未痊愈。血刀客把他带到青云门山脚，交给他一张画着密库位置的旧图。";
const OLD3 = "李长风用青铜钥匙打开了宗门密库，钥匙的齿缝与锁眼严丝合缝。架上的旧账本被血刀客拿走。";

/** 只有资料没有正文的空作品：导入旧稿的常规起点。 */
function project(chapters: readonly string[] = []): { root: string; store: ProjectStore } {
  const root = mkdtempSync(join(tmpdir(), "nf-infer-"));
  roots.push(root);
  const store = new ProjectStore(root);
  store.save({
    ...writingSnapshot(),
    events: [],
    beats: [],
    chapters: new Map(chapters.map((text, index) => [index + 1, text])),
  });
  return { root, store };
}

function session(root: string, results: readonly CallResult[] = []): { session: ProjectSession; calls: ReturnType<typeof fakeClient>["calls"] } {
  const { client, calls } = fakeClient(results);
  return { session: new ProjectSession(root, NO_MODEL_REVIEW, { client }), calls };
}

/** 一份合法的反推输出：埋一条伏笔、记一次出场。 */
const INFER1 = modelText(JSON.stringify({
  events: [{ kind: "action", summary: "李长风收下守夜人的青铜钥匙", weight: 2, plot_line: "P01", participants: ["C01"], quote: "李长风收起钥匙，记住了那张脸" }],
  foreshadow_planted: [{ label: "青铜钥匙", intent: "这把钥匙将来要打开宗门密库。", weight: "main", visibility: "covert", expected_by: 3, quote: "一枚青铜钥匙放在桌上" }],
  foreshadow_resolved: [], relations_changed: [], character_states: [],
  character_presence: [{ character_id: "C01", role: "pov" }],
}));

/** 第三章兑现第一章埋下的伏笔 —— 跨章引用只有顺序反推才拿得到编号。 */
const INFER3 = modelText(JSON.stringify({
  events: [], foreshadow_planted: [],
  foreshadow_resolved: [{ foreshadow_id: "F01", completeness: "full", quote: "钥匙的齿缝与锁眼严丝合缝" }],
  relations_changed: [], character_states: [],
  character_presence: [{ character_id: "C01", role: "pov" }],
}));

const infer = (project: ProjectSession, chapter: number): ReturnType<typeof handleAsync> =>
  handleAsync(project, { method: "POST", path: "/api/import/infer", query: new URLSearchParams(), body: { chapter } });

const post = (project: ProjectSession, path: string, body: unknown): ReturnType<typeof handleAsync> =>
  handleAsync(project, { method: "POST", path, query: new URLSearchParams(), body });

const view = (project: ProjectSession): ReturnType<typeof handleAsync> =>
  handleAsync(project, { method: "GET", path: "/api/import/inference", query: new URLSearchParams(), body: undefined });

const estimate = (project: ProjectSession): ReturnType<typeof handleAsync> =>
  handleAsync(project, { method: "GET", path: "/api/import/inference/estimate", query: new URLSearchParams(), body: undefined });

describe("逐章反推结构·产出待确认声明", () => {
  it("反推只落 proposed 事件，投影不变", async () => {
    const { root } = project([OLD1]);
    const { session: s, calls } = session(root, [INFER1]);
    const result = await s.inference.infer({ chapter: 1 });

    expect(result.state).toBe("pending");
    expect(result.declaration?.foreshadowPlanted[0]).toMatchObject({ foreshadowId: "F01", label: "青铜钥匙" });
    // 事实不变：没有确认就没有伏笔时间线。
    expect(s.derived.projections.foreshadows).toEqual([]);
    expect(s.events().every((e) => e.envelope.provenance === "proposed")).toBe(true);
    expect(s.events()[0]?.envelope.origin).toBe("import_inference");
    // 反推不是同会话第二轮，正文要整段给模型。
    expect(JSON.stringify(calls[0]?.messages)).toContain("齿缝里沾着干透的红泥");
    expect(calls[0]?.outputSchema).toBeDefined();
  });

  it("确认后才进入伏笔时间线，且换一个进程读得到", async () => {
    const { root } = project([OLD1]);
    const { session: s } = session(root, [INFER1]);
    await s.inference.infer({ chapter: 1 });
    const confirmed = s.inference.confirm({ chapter: 1 });

    expect(confirmed.committed).toBeGreaterThan(0);
    expect(s.derived.projections.foreshadows.map((f) => f.id)).toEqual(["F01"]);
    const reopened = new ProjectSession(root, NO_MODEL_REVIEW);
    expect(reopened.derived.projections.foreshadows[0]).toMatchObject({ id: "F01", status: "open" });
    expect(reopened.inference.view().chapters[0]?.state).toBe("confirmed");
  });

  it("丢弃一章的反推不留事实，也不挡后面的章", async () => {
    const { root } = project([OLD1, OLD2]);
    const { session: s } = session(root, [INFER1]);
    await s.inference.infer({ chapter: 1 });
    s.inference.reject({ chapter: 1 });

    expect(s.derived.projections.foreshadows).toEqual([]);
    expect(s.events().every((e) => e.envelope.provenance === "rejected")).toBe(true);
    expect(s.inference.view().chapters[0]?.state).toBe("skipped");
    expect(s.inference.view().nextChapter).toBe(2);
  });
});

describe("逐章反推结构·跨章累积", () => {
  it("后面的章能兑现前面章反推出的伏笔，哪怕它还没确认", async () => {
    const { root } = project([OLD1, OLD2, OLD3]);
    const empty = modelText(JSON.stringify({ events: [], foreshadow_planted: [], foreshadow_resolved: [], relations_changed: [], character_states: [], character_presence: [{ character_id: "C01", role: "pov" }] }));
    const { session: s, calls } = session(root, [INFER1, empty, INFER3]);
    await s.inference.infer({ chapter: 1 });
    await s.inference.infer({ chapter: 2 });
    const third = await s.inference.infer({ chapter: 3 });

    expect(third.state).toBe("pending");
    expect(third.declaration?.foreshadowResolved[0]?.foreshadowId).toBe("F01");
    // 待兑现清单要写进提示词，否则模型只能猜编号。
    expect(JSON.stringify(calls[2]?.messages)).toContain("F01");
    expect(JSON.stringify(calls[2]?.messages)).toContain("这把钥匙将来要打开宗门密库。");
  });

  it("新伏笔编号跨章递增，不与前面章撞号", async () => {
    const { root } = project([OLD1, OLD2]);
    const second = modelText(JSON.stringify({
      events: [], foreshadow_planted: [{ label: "密库旧图", intent: "旧图上的位置第九章才被证伪。", weight: "sub", visibility: "overt", expected_by: 9, quote: "一张画着密库位置的旧图" }],
      foreshadow_resolved: [], relations_changed: [], character_states: [], character_presence: [{ character_id: "C01", role: "pov" }],
    }));
    const { session: s } = session(root, [INFER1, second]);
    await s.inference.infer({ chapter: 1 });
    const result = await s.inference.infer({ chapter: 2 });

    expect(result.declaration?.foreshadowPlanted[0]?.foreshadowId).toBe("F02");
  });

  it("跳过前面没反推的章直接反推后面的章会被拒绝", async () => {
    const { root } = project([OLD1, OLD2]);
    const { session: s } = session(root, [INFER1]);
    const response = await infer(s, 2);

    expect(response.status).toBe(409);
    expect(String((response.body as { error: string }).error)).toContain("第 1 章");
  });

  it("前面还有待确认的章时不能先确认后面的章", async () => {
    const { root } = project([OLD1, OLD2]);
    const empty = modelText(JSON.stringify({ events: [], foreshadow_planted: [], foreshadow_resolved: [], relations_changed: [], character_states: [], character_presence: [{ character_id: "C01", role: "pov" }] }));
    const { session: s } = session(root, [INFER1, empty]);
    await s.inference.infer({ chapter: 1 });
    await s.inference.infer({ chapter: 2 });

    expect(() => s.inference.confirm({ chapter: 2 })).toThrow(/第 1 章/u);
  });
});

describe("逐章反推结构·认领资料里的伏笔规划", () => {
  /** 先用资料反推的路子落一条 planned 伏笔，再逐章反推正文 —— 两条路的交汇点。 */
  const planned = (s: ProjectSession, label: string, expectedBy = 9) =>
    s.preparation.recordAuthor({
      summary: "资料里写明的伏笔", baseFingerprint: s.preparation.view().fingerprint,
      changes: { foreshadows: [{ label, intent: `${label}将来要有个交代。`, weight: "main", expectedBy }] },
    });

  it("待埋设的规划要写进提示词，并说清怎么认领", async () => {
    const { root } = project([OLD1]);
    const { session: s, calls } = session(root, [INFER1]);
    planned(s, "守夜人的来历");
    await s.inference.infer({ chapter: 1 });

    const prompt = JSON.stringify(calls[0]?.messages);
    // 不告诉模型，它就按自己的说法另起一条 label，同一个安排在时间线上出现两次。
    expect(prompt).toContain("守夜人的来历");
    expect(prompt).toContain("planned_foreshadow_id");
    // 两张表必须分开：还没埋下的东西不能被"兑现"。
    expect(prompt).toContain("还没埋下的东西谈不上兑现");
  });

  it("模型填了 planned_foreshadow_id 就沿用原编号，不另建一条", async () => {
    const { root } = project([OLD1]);
    const claim = modelText(JSON.stringify({
      events: [], foreshadow_resolved: [], relations_changed: [], character_states: [],
      character_presence: [{ character_id: "C01", role: "pov" }],
      foreshadow_planted: [{ planned_foreshadow_id: "F01", label: "守夜人的来历", intent: "守夜人的来历将来要有个交代。", weight: "main", visibility: "covert", expected_by: 9, quote: "记住了那张脸" }],
    }));
    const { session: s } = session(root, [claim]);
    planned(s, "守夜人的来历");
    const result = await s.inference.infer({ chapter: 1 });

    expect(result.state).toBe("pending");
    const declared = result.declaration?.foreshadowPlanted[0];
    expect(declared?.foreshadowId).toBe("F01");
    expect(declared?.plannedForeshadowId).toBe("F01");
  });

  it("认领之后这条不再是规划：虚线变实线，有了正文出处", async () => {
    const { root } = project([OLD1]);
    const claim = modelText(JSON.stringify({
      events: [], foreshadow_resolved: [], relations_changed: [], character_states: [],
      character_presence: [{ character_id: "C01", role: "pov" }],
      foreshadow_planted: [{ planned_foreshadow_id: "F01", label: "守夜人的来历", intent: "守夜人的来历将来要有个交代。", weight: "main", visibility: "covert", expected_by: 9, quote: "记住了那张脸" }],
    }));
    const { session: s } = session(root, [claim]);
    planned(s, "守夜人的来历");
    expect(s.derived.views.foreshadows.find(f => f.id === "F01")).toMatchObject({ status: "planned", planted: null });

    await s.inference.infer({ chapter: 1 });
    s.inference.confirm({ chapter: 1 });

    const lane = s.derived.views.foreshadows.find(f => f.id === "F01");
    expect(lane?.status).toBe("open");
    expect(lane?.planted?.chapter).toBe(1);
    // 同一个安排只留一条 —— 认领的意义就在这里。
    expect(s.derived.views.foreshadows.filter(f => f.label === "守夜人的来历")).toHaveLength(1);
  });

  it("规划的编号不能被当成可兑现的伏笔", async () => {
    const { root } = project([OLD1]);
    const wrong = modelText(JSON.stringify({
      events: [], foreshadow_planted: [], relations_changed: [], character_states: [],
      character_presence: [{ character_id: "C01", role: "pov" }],
      foreshadow_resolved: [{ foreshadow_id: "F01", completeness: "full", quote: "记住了那张脸" }],
    }));
    const { session: s } = session(root, [wrong]);
    planned(s, "守夜人的来历");
    const result = await s.inference.infer({ chapter: 1 });

    // 还没埋下就"兑现"，`knownForeshadows` 里没有它，整章不落。
    expect(result.state).toBe("problem");
    expect(s.derived.views.foreshadows.find(f => f.id === "F01")?.status).toBe("planned");
  });
});

describe("逐章反推结构·不放行残缺记录", () => {
  it("引文不在正文里的一章记为待处理，一条事件都不落", async () => {
    const { root } = project([OLD1]);
    const paraphrase = modelText(JSON.stringify({
      events: [{ kind: "action", summary: "李长风拿到钥匙", weight: 2, plot_line: "P01", participants: ["C01"], quote: "他把钥匙揣进怀里转身离开" }],
      foreshadow_planted: [], foreshadow_resolved: [], relations_changed: [], character_states: [],
      character_presence: [{ character_id: "C01", role: "pov" }],
    }));
    const { session: s } = session(root, [paraphrase]);
    const result = await s.inference.infer({ chapter: 1 });

    expect(result.state).toBe("problem");
    expect(result.problems.join("")).toContain("引文");
    expect(s.events()).toEqual([]);
  });

  it("引用未登记人物的一章记为待处理，补上人物后重跑能过", async () => {
    const { root, store } = project([OLD1]);
    const stranger = JSON.stringify({
      events: [{ kind: "action", summary: "守夜人交出钥匙", weight: 2, plot_line: "P01", participants: ["C09"], quote: "李长风收起钥匙，记住了那张脸" }],
      foreshadow_planted: [], foreshadow_resolved: [], relations_changed: [], character_states: [],
      character_presence: [{ character_id: "C01", role: "pov" }],
    });
    const { session: s } = session(root, [modelText(stranger)]);
    const first = await s.inference.infer({ chapter: 1 });

    expect(first.state).toBe("problem");
    expect(first.problems.join("")).toContain("C09");
    expect(s.events()).toEqual([]);
    // 视图要把这一章的问题留住，作者据此回资料页补人物。
    expect(s.inference.view().chapters[0]).toMatchObject({ state: "problem" });

    const base = store.load();
    const nightWatch = { ...base.characters[0]!, id: "C09" as const, name: "守夜人", aliases: [] };
    store.save({ ...base, characters: [...base.characters, nightWatch] });
    const { session: retried } = session(root, [modelText(stranger)]);
    const second = await retried.inference.infer({ chapter: 1 });

    expect(second.state).toBe("pending");
    expect(second.declaration?.events[0]?.participants).toEqual(["C09"]);
  });

  it("模型输出不是合法 JSON 时记为失败，不落事件也不吞掉原因", async () => {
    const { root } = project([OLD1]);
    const { session: s } = session(root, [modelText("这一章讲的是……")]);
    const result = await s.inference.infer({ chapter: 1 });

    expect(result.state).toBe("failed");
    expect(result.problems.join("")).toContain("JSON");
    expect(s.events()).toEqual([]);
  });

  it("重跑同一章会作废上一轮的待确认声明，不叠加", async () => {
    const { root } = project([OLD1]);
    const { session: s } = session(root, [INFER1, INFER1]);
    await s.inference.infer({ chapter: 1 });
    await s.inference.infer({ chapter: 1 });

    const proposed = s.events().filter((e) => e.envelope.provenance === "proposed");
    const rejected = s.events().filter((e) => e.envelope.provenance === "rejected");
    expect(proposed).toHaveLength(3);
    expect(rejected).toHaveLength(3);
    // 作废的编号不回收：同一个编号在日志里指两条不同的伏笔会让归因彻底失真，
    // 所以重跑拿到的是下一个号，而不是复用上一轮那个。
    expect(s.inference.view().chapters[0]?.declaration?.foreshadowPlanted[0]?.foreshadowId).toBe("F02");
  });
});

describe("逐章反推结构·边界与接口", () => {
  it("没有正文的章反推不了", async () => {
    const { root } = project([OLD1]);
    const { session: s } = session(root);
    expect((await infer(s, 4)).status).toBe(404);
  });

  it("已有正式结构的章不再反推，改写要走稿件修订", async () => {
    const { root, store } = project([OLD1]);
    const stream = EventStream.restore([]);
    stream.append({ chapter: 1, origin: "C5_declaration", provenance: "proposed", payload: { type: "character_presence", characterId: "C01", role: "pov" } });
    stream.decideChapter(1, "committed");
    store.save({ ...store.load(), events: stream.all() });

    const { session: s } = session(root);
    const response = await infer(s, 1);
    expect(response.status).toBe(409);
    expect(s.inference.view().chapters[0]?.state).toBe("written");
  });

  it("扫正文得出的出场不算正式结构：确认人物之后每一章仍然可以反推", async () => {
    // 真机撞出来的（100 章旧稿）：确认人物时代码扫正文落下 committed 的 text_scan 出场，
    // 旧判据把它当成「这一章已有正式结构」—— 100 章全显示「已有记录」、预估 0 次调用，
    // 逐章反推根本开不了头，情节线因此永远有轨无点。
    const { root } = project([OLD1, OLD2, OLD3]);
    const { session: s, calls } = session(root, [INFER1]);
    s.appendPresence([{ characterId: "C01" as never, chapters: [1, 2, 3] as never }]);
    expect(s.events().filter((e) => e.envelope.origin === "text_scan" && e.envelope.provenance === "committed")).toHaveLength(3);

    expect(s.inference.view().chapters.map((c) => c.state)).toEqual(["none", "none", "none"]);
    expect(s.inference.view().nextChapter).toBe(1);
    const body = (await estimate(s)).body as { modes: readonly { key: string; calls: { min: number; max: number } }[] };
    expect(body.modes[1]?.calls).toEqual({ min: 3, max: 3 });

    expect((await s.inference.infer({ chapter: 1 })).state).toBe("pending");
    expect(calls).toHaveLength(1);
    expect(s.inference.confirm({ chapter: 1 }).committed).toBeGreaterThan(0);
    expect(s.inference.view().chapters[0]?.state).toBe("confirmed");
  });

  it("还没有人物档案时先说清要补什么，不去空跑模型", async () => {
    const { root, store } = project([OLD1]);
    store.save({ ...store.load(), characters: [] });
    const { session: s, calls } = session(root);
    const response = await infer(s, 1);

    expect(response.status).toBe(409);
    expect(String((response.body as { error: string }).error)).toContain("人物");
    expect(calls).toHaveLength(0);
  });

  it("还没有情节线时同样先拦住 —— 它不报错，但后果一样是永久的", async () => {
    const { root, store } = project([OLD1]);
    store.save({ ...store.load(), plotLines: [] });
    const { session: s, calls } = session(root);
    const response = await infer(s, 1);

    // §59 真机撞出来的：没有情节线时反推照常跑完、不报错，但产出的 `plot_event`
    // 全部 `plotLine = null`，情节线永远没节点 —— 而确认之后 `infer()` 就拦住了，
    // 补不回来。所以这一条比人物那条更该拦：它是安静的。
    expect(response.status).toBe(409);
    expect(String((response.body as { error: string }).error)).toContain("情节线");
    expect(calls).toHaveLength(0);
  });

  it("人物与情节线都齐备才放行 —— 两条拦截是分别判的", async () => {
    const { root, store } = project([OLD1]);
    store.save({ ...store.load(), characters: [], plotLines: [] });
    const { session: s } = session(root, [INFER1]);
    // 两样都缺时先报人物（它是第一条），不该把两条并成一句含糊的话。
    expect(String(((await infer(s, 1)).body as { error: string }).error)).toContain("人物");

    const restored = new ProjectStore(root);
    restored.save({ ...restored.load(), characters: writingSnapshot().characters });
    const second = session(root, [INFER1]);
    expect(String(((await infer(second.session, 1)).body as { error: string }).error)).toContain("情节线");

    restored.save({ ...restored.load(), plotLines: writingSnapshot().plotLines });
    const third = session(root, [INFER1]);
    expect((await infer(third.session, 1)).status).toBe(200);
  });

  it("端点校验章号，并按章给出进度视图", async () => {
    const { root } = project([OLD1, OLD2]);
    const { session: s } = session(root, [INFER1]);
    expect((await infer(s, 0)).status).toBe(400);
    expect((await post(s, "/api/import/inference/confirm", { chapter: "1" })).status).toBe(400);

    await s.inference.infer({ chapter: 1 });
    const payload = (await view(s)).body as { chapters: { chapter: number; state: string; words: number }[]; nextChapter: number | null };
    expect(payload.chapters.map((c) => [c.chapter, c.state])).toEqual([[1, "pending"], [2, "none"]]);
    expect(payload.chapters[0]?.words).toBeGreaterThan(0);
    expect(payload.nextChapter).toBe(2);
  });

  it("模型调用失败时如实记下失败原因，不落半份记录", async () => {
    const { root } = project([OLD1]);
    const { session: s } = session(root, [{ kind: "error", error: { type: "status", status: 429, retryable: true, message: "限流" } }]);
    const result = await s.inference.infer({ chapter: 1 });

    expect(result.state).toBe("failed");
    expect(result.problems.join("")).toContain("限流");
    expect(s.events()).toEqual([]);
  });

  it("未配置模型时明确报未配置，且不发出任何请求", async () => {
    const { root } = project([OLD1]);
    // 凭证置空后 createModelClient 直接失败 —— 这一条绝不能真的打到网络上。
    vi.stubEnv("NOVEL_MODEL_PROVIDER", "claude");
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
    const response = await infer(new ProjectSession(root, NO_MODEL_REVIEW), 1);
    expect(response.status).toBe(503);
    vi.unstubAllEnvs();
  });
});

describe("逐章反推结构·费用预估", () => {
  it("两档都给出来，逐章那档的次数等于还没反推的章数", async () => {
    const { root } = project([OLD1, OLD2, OLD3]);
    const { session: s } = session(root);
    const body = (await estimate(s)).body as { modes: readonly { key: string; calls: { min: number; max: number } }[] };

    expect(body.modes.map((m) => m.key)).toEqual(["materials", "chapters"]);
    expect(body.modes[1]?.calls).toEqual({ min: 3, max: 3 });
  });

  it("反推并确认过的章不再计费 —— 次数随进度减少", async () => {
    const { root } = project([OLD1, OLD2, OLD3]);
    const { session: s } = session(root, [INFER1]);
    await s.inference.infer({ chapter: 1 });
    s.inference.confirm({ chapter: 1 });
    const body = (await estimate(s)).body as { modes: readonly { key: string; calls: { min: number; max: number } }[] };

    expect(body.modes[1]?.calls).toEqual({ min: 2, max: 2 });
  });

  it("正文逐章精确计入，固定开销按次数摊 —— 长短章不是一个价", async () => {
    const longText = OLD1.repeat(60);
    const short = session(project([OLD1]).root).session;
    const long = session(project([longText]).root).session;
    const tokensOf = (s: ProjectSession) => s.inference.estimateFacts("cheap", 0).inputTokens.min;

    // 两者的固定开销相同（同一份任务说明、ID 清单、输出 schema），差额应当正好是正文之差。
    expect(tokensOf(long) - tokensOf(short)).toBe(estimateTokens(longText) - estimateTokens(OLD1));
    // 而开销本身不小：短章下它就是大头，所以不能只按章数乘一个单价。
    expect(tokensOf(short) - estimateTokens(OLD1)).toBeGreaterThan(500);
  });

  it("次数含重试：账本里的调用比留过记录的章多，就按这个比例放大", async () => {
    const { root } = project([OLD1, OLD2, OLD3]);
    const { session: s } = session(root, [INFER1]);
    await s.inference.infer({ chapter: 1 });   // 1 章留下记录
    // 真机上引文闸门挡掉约三分之一的章，每挡一次要重跑一次 —— §58 实测 1.4 次/章。
    // 按一章一次报数会让整条路线低报四成，而那正是作者据以决定跑不跑的数字。
    const plain = s.inference.estimateFacts("cheap", 1).calls.max;
    const withRetries = s.inference.estimateFacts("cheap", 2).calls.max;
    expect(withRetries).toBe(plain * 2);
  });

  it("没有历史时不替作者拍一个重试率 —— 承认不知道比编一个经验值好", async () => {
    const { session: s } = session(project([OLD1, OLD2]).root);
    // 一次都没跑过：分母是 0，比例只能是 1。
    expect(s.inference.estimateFacts("cheap", 0).calls).toEqual({ min: 2, max: 2 });
    // 账本比章数少（上一轮崩在半路）也不能算出小于 1 的比例，那会反向低报。
    expect(s.inference.estimateFacts("cheap", 1).calls).toEqual({ min: 2, max: 2 });
  });

  it("跳过的章仍算待办 —— 它们可以重跑，结构还没落下来", async () => {
    const { root } = project([OLD1, OLD2, OLD3]);
    const { session: s } = session(root, [INFER1]);
    await s.inference.infer({ chapter: 1 });
    s.inference.reject({ chapter: 1 });               // 作者跳过第 1 章
    // 只数 state==="none" 会报 2 章。§58 真机上中转故障把 42 章打进 skipped，
    // 估价当场从 49 章缩成 7 章 —— 与"低报"是同一类错误。
    expect(s.inference.estimateFacts("cheap", 0).calls).toEqual({ min: 3, max: 3 });
  });

  it("没有正文时逐章那档是 0 次，不报一个凭空的数", async () => {
    const { session: s } = session(project().root);
    const body = (await estimate(s)).body as { modes: readonly { key: string; calls: { min: number; max: number }; credits: unknown }[] };

    expect(body.modes[1]?.calls).toEqual({ min: 0, max: 0 });
  });
});

describe("逐章反推结构·与章节修订的关系", () => {
  it("旧稿章被重写采用后，反推出的旧结构事实一并作废", async () => {
    const { root } = project([OLD1]);
    const { session: s } = session(root, [INFER1]);
    await s.inference.infer({ chapter: 1 });
    s.inference.confirm({ chapter: 1 });
    expect(s.derived.projections.foreshadows).toHaveLength(1);

    // 章节修订采用新稿：旧的结构事实必须一起翻掉，否则同一章两份事实并存。
    const superseded = s.commitDraftDeclaration(1, {
      events: [], foreshadowPlanted: [], foreshadowResolved: [], relationsChanged: [],
      characterStates: [], characterPresence: [{ type: "character_presence", characterId: "C01", role: "pov" }],
    });
    expect(superseded).toBe(3);
    expect(s.derived.projections.foreshadows).toEqual([]);
  });
});
