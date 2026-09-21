import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type ServeOptions } from "../src/server/http.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { Workspace } from "../src/workspace/service.js";
import { loadPricing } from "../src/credits/pricing.js";
import { C5_JSON, PROSE, fakeClient, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";
import type { CallResult } from "../src/client/claude.js";

const roots: string[] = [];
const servers: ReturnType<typeof serve>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(): string {
  const root = mkdtempSync(join(tmpdir(), "nf-workspace-"));
  roots.push(root);
  return root;
}

async function start(root = directory(), projectRoot?: string) {
  const model = fakeClient([]);
  const options = { workspaceRoot: root, ...(projectRoot === undefined ? {} : { projectRoot }), port: 0, client: model.client };
  const server = serve(options as ServeOptions);
  servers.push(server);
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  async function request(path: string, work?: string, body?: unknown) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { ...(work === undefined ? {} : { "x-novel-project": work }), ...(body === undefined ? {} : { "content-type": "application/json" }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: response.status, body: await response.json() as any };
  }
  return { root, model, request };
}

const grant = loadPricing().signupGrant;
const idea = { title: "雨城来信", idea: "一个邮差追查来自未来的信件。", genre: "mystery", platform: "unpublished", targetWords: 120000 };

describe("作品工作区", () => {
  it("空目录可启动；查看列表不创建演示、不调用模型", async () => {
    const root = join(directory(), "empty-library");
    const { request, model } = await start(root);
    expect(await request("/api/workspace")).toEqual({ status: 200, body: { projects: [], defaultProjectId: null, removed: [], credits: { granted: grant, spent: 0, balance: grant, unpricedCalls: 0 } } });
    expect(existsSync(root)).toBe(false);
    expect(model.calls).toHaveLength(0);
    expect((await request("/api/overview")).status).toBe(409);
  });

  it("从想法创建独立作品，保留作者输入且不编造人物或章节", async () => {
    const { root, request, model } = await start();
    const response = await request("/api/works", undefined, idea);
    expect(response.status).toBe(201);
    expect(response.body.id).toMatch(/^work-[0-9a-f-]+$/u);
    const snapshot = new ProjectStore(join(root, response.body.id)).load();
    expect(snapshot.setting.title).toBe(idea.title);
    expect(snapshot.setting.premise).toBe(idea.idea);
    expect(snapshot.setting.centralConflict).toBe("");
    expect(snapshot.profile).toEqual({ genre: "mystery", platform: "unpublished", targetWords: 120000 });
    expect(snapshot.characters).toEqual([]);
    expect(snapshot.beats).toEqual([]);
    expect(snapshot.events).toEqual([]);
    expect(snapshot.chapters.size).toBe(0);
    expect((await request("/api/overview", response.body.id)).body.title).toBe(idea.title);
    expect((await request("/api/workspace")).body.projects).toHaveLength(1);
    expect(model.calls).toHaveLength(0);
  });

  it("还没想好写什么也能建作品：想法留空，其余照常，谋篇缺项非空", async () => {
    const { root, request, model } = await start();
    const response = await request("/api/works", undefined, { ...idea, idea: "   " });
    expect(response.status).toBe(201);
    const snapshot = new ProjectStore(join(root, response.body.id)).load();
    expect(snapshot.setting.premise).toBe("");
    expect(snapshot.setting.title).toBe(idea.title);
    // 想法为空时筹备缺项非空，对话页切进谋篇后会走「从零筹备」那条带法。
    const preparation = await request("/api/preparation", response.body.id);
    expect(preparation.body.readiness.ready).toBe(false);
    expect(preparation.body.readiness.missing.length).toBeGreaterThan(0);
    expect(model.calls).toHaveLength(0);
  });

  it("同一创建请求重试只建一本，不覆盖不同请求内容", async () => {
    const { root, request } = await start();
    const payload = { ...idea, requestId: "11111111-1111-4111-8111-111111111111" };
    const first = await request("/api/works", undefined, payload);
    const retry = await request("/api/works", undefined, payload);
    expect(retry.body.id).toBe(first.body.id);
    expect(readdirSync(root)).toHaveLength(1);
    const conflict = await request("/api/works", undefined, { ...payload, idea: "换了一个故事" });
    expect(conflict.status).toBe(409);
    expect(new ProjectStore(join(root, first.body.id)).load().setting.premise).toBe(idea.idea);
  });

  it("重启后仍能列出和打开新建作品", async () => {
    const first = await start();
    const created = await first.request("/api/works", undefined, idea);
    const reopened = await start(first.root);
    expect((await reopened.request("/api/workspace")).body.projects[0].id).toBe(created.body.id);
    expect((await reopened.request("/api/overview", created.body.id)).body.currentChapter).toBe(0);
  });

  it("兼容既有作品，列表只读，坏项目有明确提示", async () => {
    const root = directory();
    const legacy = join(root, "previous-book");
    new ProjectStore(legacy).save(writingSnapshot());
    const broken = join(root, "broken-book");
    new ProjectStore(broken).save(writingSnapshot());
    writeFileSync(join(broken, "setting.json"), "{broken", "utf8");
    const before = readFileSync(join(legacy, "setting.json"), "utf8");
    const { request } = await start(root, legacy);
    const listing = (await request("/api/workspace")).body;
    expect(listing.defaultProjectId).toBe("previous-book");
    expect(listing.projects.find((p: any) => p.id === "previous-book").currentChapter).toBe(2);
    expect(listing.projects.find((p: any) => p.id === "broken-book").error).toContain("JSON");
    expect((await request("/api/overview")).body.currentChapter).toBe(2);
    expect(readFileSync(join(legacy, "setting.json"), "utf8")).toBe(before);
  });

  it("每个请求明确选择作品，采用 A 不会改动另一个页面的 B", async () => {
    const root = directory();
    for (const id of ["book-a", "book-b"]) {
      const snapshot = writingSnapshot();
      new ProjectStore(join(root, id)).save({ ...snapshot, setting: { ...snapshot.setting, title: id } });
    }
    new DraftStore(join(root, "book-a")).saveDraft(savedDraft());
    const { request } = await start(root);
    const overviews = await Promise.all([request("/api/overview", "book-a"), request("/api/overview", "book-b")]);
    expect(overviews.map((r) => r.body.title)).toEqual(["book-a", "book-b"]);
    expect((await request("/api/chapter/adopt", "book-a", { chapter: 3, draftId: "ch3d1" })).status).toBe(200);
    expect((await request("/api/overview", "book-a")).body.currentChapter).toBe(3);
    expect((await request("/api/overview", "book-b")).body.currentChapter).toBe(2);
    expect((await request("/api/chapter?n=3", "book-b")).status).toBe(404);
  });

  it.runIf(process.platform === "win32")("Windows 大小写不同的作品地址共享最新资料，不用旧会话覆盖作者修改", async () => {
    const root = directory();
    new ProjectStore(join(root, "case-book")).save(writingSnapshot());
    const { request } = await start(root);
    const lower = (await request("/api/preparation", "case-book")).body;
    await request("/api/preparation", "CASE-BOOK");
    expect((await request("/api/preparation/author", "case-book", { summary: "修改风格", baseFingerprint: lower.fingerprint, changes: { setting: { styleKeywords: ["保留这次修改"] } } })).status).toBe(200);
    const upper = (await request("/api/preparation", "CASE-BOOK")).body;
    expect(upper.confirmed.setting.styleKeywords).toEqual(["保留这次修改"]);
    expect((await request("/api/preparation/author", "CASE-BOOK", { summary: "修改书名", baseFingerprint: upper.fingerprint, changes: { setting: { title: "新书名" } } })).status).toBe(200);
    expect(new ProjectStore(join(root, "case-book")).load().setting).toMatchObject({ title: "新书名", styleKeywords: ["保留这次修改"] });
    expect((await request("/api/overview", "case-book")).body.title).toBe("新书名");
  });

  it.each(["../outside", "..\\outside", "C:\\outside", ".", "..", "%2e%2e%2foutside"])("拒绝越界作品 ID %s", async (id) => {
    const { request } = await start();
    expect((await request("/api/overview", id)).status).toBe(400);
  });

  it("未知作品不会回退成默认作品", async () => {
    const root = directory();
    const legacy = join(root, "default-book");
    new ProjectStore(legacy).save(writingSnapshot());
    const { request } = await start(root, legacy);
    expect((await request("/api/overview", "missing-book")).status).toBe(404);
  });

  // `{}`、只有书名、想法留空都是合法的空白作品（谋篇模式接手），不在这份清单里。
  it.each([null, [], { ...idea, genre: "invalid" }, { ...idea, targetWords: -1 }, { ...idea, requestId: "../../outside" }])("非法新建参数 %j 不产生作品文件", async (input) => {
    const { request, root } = await start();
    expect((await request("/api/works", undefined, input)).status).toBe(400);
    expect(readdirSync(root)).toEqual([]);
  });
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("作品删除与恢复", () => {
  it("删除把作品整体移进回收站：列表不再列出，归档内容一字不改", async () => {
    const { root, request } = await start();
    const created = await request("/api/works", undefined, idea);
    const before = readFileSync(join(root, created.body.id, "setting.json"), "utf8");

    const removed = await request("/api/works/delete", undefined, { id: created.body.id });
    expect(removed.status).toBe(200);
    expect(removed.body.id).toBe(created.body.id);

    const listing = (await request("/api/workspace")).body;
    expect(listing.projects).toEqual([]);
    expect(listing.removed).toHaveLength(1);
    expect(listing.removed[0]).toMatchObject({ id: created.body.id, title: idea.title, archive: removed.body.archive });
    expect(Date.parse(listing.removed[0].deletedAt)).not.toBeNaN();

    // 归档就是那本作品本身：一字不改，拷出去也能用。
    expect(readdirSync(root)).toEqual([".trash"]);
    expect(readFileSync(join(root, ".trash", removed.body.archive, "setting.json"), "utf8")).toBe(before);
    expect((await request("/api/overview", created.body.id)).status).toBe(404);
  });

  it("恢复回原 ID，页面照常打开", async () => {
    const root = directory();
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());
    const { request } = await start(root);
    await request("/api/works/delete", undefined, { id: "book-a" });
    const restored = await request("/api/works/restore", undefined, { id: "book-a" });
    expect(restored.status).toBe(200);
    expect(restored.body.id).toBe("book-a");
    expect((await request("/api/workspace")).body).toMatchObject({ removed: [] });
    expect((await request("/api/overview", "book-a")).body.currentChapter).toBe(2);
    expect(readdirSync(join(root, "book-a"))).toContain("setting.json");
  });

  it("原 ID 已被新作品占用时恢复被拒，归档不动", async () => {
    const root = directory();
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());
    const { request } = await start(root);
    const removed = await request("/api/works/delete", undefined, { id: "book-a" });
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());

    const restored = await request("/api/works/restore", undefined, { id: "book-a" });
    expect(restored.status).toBe(409);
    expect(existsSync(join(root, ".trash", removed.body.archive, "setting.json"))).toBe(true);
    expect((await request("/api/workspace")).body.removed).toHaveLength(1);
  });

  it("任务正在执行时不能删除，任务结束后可以", async () => {
    const root = directory();
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());
    const waiting = deferred<CallResult>();
    let calls = 0;
    const workspace = new Workspace(root, { client: { official: false, call: async () => ++calls === 1 ? waiting.promise : modelText(C5_JSON) } });
    const session = workspace.project("book-a");
    const started = session.startChapter({ chapter: 3 });

    expect(() => workspace.remove({ id: "book-a" })).toThrow(/尚未停稳/u);
    expect(existsSync(join(root, "book-a"))).toBe(true);

    // pause/end 只是在当前模型调用返回后生效；pausing/ending 期间仍可能落盘，
    // 不能因为状态不再叫 running 就提前把目录移走。
    expect(session.controlChapter(3, started.draftId, "pause").status).toBe("pausing");
    expect(() => workspace.remove({ id: "book-a" })).toThrow(/尚未停稳/u);
    expect(session.controlChapter(3, started.draftId, "end").status).toBe("ending");
    expect(() => workspace.remove({ id: "book-a" })).toThrow(/尚未停稳/u);

    const completed = session.writeChapter({ chapter: 3, draftId: started.draftId });
    waiting.resolve(modelText(PROSE));
    await completed.catch(() => undefined);
    expect(() => workspace.remove({ id: "book-a" })).not.toThrow();
  });

  it("以 --project 打开的作品不能在这里删除：它的路径由启动参数定，删掉服务就指空", async () => {
    const root = directory();
    const inside = join(root, "previous-book");
    new ProjectStore(inside).save(writingSnapshot());
    const opened = await start(root, inside);
    expect((await opened.request("/api/works/delete", undefined, { id: "previous-book" })).status).toBe(400);
    expect(existsSync(join(inside, "setting.json"))).toBe(true);

    const outside = join(directory(), "previous-book");
    new ProjectStore(outside).save(writingSnapshot());
    const external = await start(directory(), outside);
    expect((await external.request("/api/works/delete", undefined, { id: "opened-project" })).status).toBe(400);
    expect(existsSync(join(outside, "setting.json"))).toBe(true);
  });

  it("删除后同 ID 新建是另一本书，不会读到上一本的缓存", async () => {
    const root = directory();
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());
    const { request } = await start(root);
    expect((await request("/api/overview", "book-a")).body.currentChapter).toBe(2);
    await request("/api/works/delete", undefined, { id: "book-a" });

    new ProjectStore(join(root, "book-a")).save({
      setting: { ...writingSnapshot().setting, title: "另一本书" }, discipline: writingSnapshot().discipline,
      settings: [], profile: writingSnapshot().profile, characters: [], plotLines: [], volumes: [], beats: [],
      alertStates: [], events: [], chapters: new Map(),
    });
    const overview = await request("/api/overview", "book-a");
    expect(overview.body.title).toBe("另一本书");
    expect(overview.body.currentChapter).toBe(0);
  });

  it("同名归档不会互相覆盖：冲突时拒绝，旧归档与新作品都原样保留", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-19T10:00:00.000Z"));
      const root = directory();
      new ProjectStore(join(root, "book-a")).save(writingSnapshot());
      const workspace = new Workspace(root);
      const removed = workspace.remove({ id: "book-a" });
      // 同一个 ID 又建了一本，再删一次 —— 时钟没走，归档名会撞上前一份。
      new ProjectStore(join(root, "book-a")).save(writingSnapshot());
      expect(() => workspace.remove({ id: "book-a" })).toThrow(/同名归档/u);
      expect(existsSync(join(root, "book-a", "setting.json"))).toBe(true);
      expect(readdirSync(join(root, ".trash"))).toEqual([removed.archive]);
    } finally { vi.useRealTimers(); }
  });

  it("未知作品删除与恢复都是 404，参数缺失是 400", async () => {
    const { request } = await start();
    expect((await request("/api/works/delete", undefined, { id: "missing-book" })).status).toBe(404);
    expect((await request("/api/works/restore", undefined, { id: "missing-book" })).status).toBe(404);
    expect((await request("/api/works/delete", undefined, {})).status).toBe(400);
    expect((await request("/api/works/delete", undefined, { id: "../outside" })).status).toBe(400);
  });
});
