/**
 * 工作区：多作品列表/新建/切换 + 单作品回兼（Stage 2·切片 2）。
 *
 * 重点：
 * ① 新建产出的 scaffold 必须能被 ProjectSession 直接打开 —— 否则「新建后进不去」。
 * ② 单作品回兼：root 自身是作品时不支持新建、活动恒为它，保证 `serve data/demo` 照旧。
 * ③ 会话按 id 懒建且缓存 —— 同一作品拿到同一实例（缓存失效才有意义）。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { tmpdir } from "node:os";
import { Workspace, scaffoldSnapshot, type WorkSeed } from "../src/server/workspace.js";
import { ProjectStore } from "../src/store/persist.js";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "novel-forge-ws-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

const SEED: WorkSeed = { title: "青州旧事", genre: "xuanhuan", platform: "fanqie" };

describe("Workspace 多作品", () => {
  it("空工作区：无作品、无活动", () => {
    const ws = new Workspace(tempRoot());
    const { works, activeId } = ws.list();
    expect(works).toEqual([]);
    expect(activeId).toBeNull();
  });

  it("新建作品即激活，且 scaffold 能被会话打开", () => {
    const ws = new Workspace(tempRoot());
    const id = ws.create(SEED);

    const listed = ws.list();
    expect(listed.works).toHaveLength(1);
    expect(listed.activeId).toBe(id);
    expect(listed.works[0]).toMatchObject({ id, title: "青州旧事", genre: "xuanhuan", platform: "fanqie", currentChapter: 0, chapterCount: 0 });

    const session = ws.active();
    expect(session).not.toBeNull();
    expect(session?.meta.setting.title).toBe("青州旧事");
    // scaffold 的留白由对话补全，不编造内容
    expect(session?.meta.setting.premise).toBe("");
    expect(session?.meta.discipline.version).toBe("d1");
    expect(session?.meta.characters).toEqual([]);
  });

  it("同名作品生成不冲突的 id", () => {
    const ws = new Workspace(tempRoot());
    const a = ws.create(SEED);
    const b = ws.create(SEED);
    expect(b).not.toBe(a);
    expect(ws.list().works.map((w) => w.id).sort()).toEqual([a, b].sort());
  });

  it("select 切换活动作品；未知 id 抛错", () => {
    const ws = new Workspace(tempRoot());
    const a = ws.create(SEED);
    const b = ws.create({ ...SEED, title: "另一本" });
    expect(ws.activeWorkId()).toBe(b); // 新建即活动
    ws.select(a);
    expect(ws.activeWorkId()).toBe(a);
    expect(() => ws.select("不存在")).toThrow(/作品不存在/u);
  });

  it("同一作品的会话懒建且缓存为同一实例", () => {
    const ws = new Workspace(tempRoot());
    const id = ws.create(SEED);
    expect(ws.session(id)).toBe(ws.session(id));
  });

  it("空标题不能新建", () => {
    const ws = new Workspace(tempRoot());
    expect(() => ws.create({ ...SEED, title: "  " })).toThrow(/标题不能为空/u);
  });
});

describe("Workspace 单作品回兼", () => {
  it("root 自身是作品时：活动恒为它、列出一本、不支持新建", () => {
    const root = tempRoot();
    new ProjectStore(root).save(scaffoldSnapshot({ title: "单本书", genre: "urban", platform: "qidian" }));

    const ws = new Workspace(root);
    const { works, activeId } = ws.list();
    expect(works).toHaveLength(1);
    expect(activeId).toBe(basename(root));
    expect(works[0]?.title).toBe("单本书");
    expect(ws.active()?.meta.setting.title).toBe("单本书");
    expect(() => ws.create(SEED)).toThrow(/单作品模式/u);
  });
});
