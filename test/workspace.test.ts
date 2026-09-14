import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve, type ServeOptions } from "../src/server/http.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { fakeClient, savedDraft, writingSnapshot } from "./writing-fixtures.js";

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

const idea = { title: "雨城来信", idea: "一个邮差追查来自未来的信件。", genre: "mystery", platform: "unpublished", targetWords: 120000 };

describe("作品工作区", () => {
  it("空目录可启动；查看列表不创建演示、不调用模型", async () => {
    const root = join(directory(), "empty-library");
    const { request, model } = await start(root);
    expect(await request("/api/workspace")).toEqual({ status: 200, body: { projects: [], defaultProjectId: null } });
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

  it.each([null, [], {}, { title: "只有书名" }, { idea: "   " }, { ...idea, genre: "invalid" }, { ...idea, targetWords: -1 }, { ...idea, requestId: "../../outside" }])("非法新建参数 %j 不产生作品文件", async (input) => {
    const { request, root } = await start();
    expect((await request("/api/works", undefined, input)).status).toBe(400);
    expect(readdirSync(root)).toEqual([]);
  });
});
