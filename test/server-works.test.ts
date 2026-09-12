/**
 * 作品端点（Stage 2·切片 2）：列表 / 新建即激活 / 切换 / 无活动作品 409。
 * 只测 handleWorkspace()，不起端口。既有端点经「活动作品」照旧工作。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handleWorkspace, type ApiRequest } from "../src/server/api.js";
import { Workspace } from "../src/server/workspace.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function ws(): Workspace {
  const root = mkdtempSync(join(tmpdir(), "novel-forge-works-"));
  roots.push(root);
  return new Workspace(root);
}

const get = (path: string): ApiRequest => ({ method: "GET", path, query: new URLSearchParams(), body: undefined });
const post = (path: string, body: unknown): ApiRequest => ({ method: "POST", path, query: new URLSearchParams(), body });

const SEED = { title: "青州旧事", genre: "xuanhuan", platform: "fanqie" };

describe("作品端点", () => {
  it("空工作区列表为空", async () => {
    const res = await handleWorkspace(ws(), get("/api/works"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ works: [], activeId: null });
  });

  it("未选择作品时其余端点回 409", async () => {
    const res = await handleWorkspace(ws(), get("/api/overview"));
    expect(res.status).toBe(409);
  });

  it("新建作品即激活，并能经活动作品访问 overview", async () => {
    const workspace = ws();
    const created = await handleWorkspace(workspace, post("/api/works", SEED));
    expect(created.status).toBe(200);
    const body = created.body as { id: string; activeId: string; works: unknown[] };
    expect(body.id).toBeTruthy();
    expect(body.activeId).toBe(body.id);
    expect(body.works).toHaveLength(1);

    const ov = await handleWorkspace(workspace, get("/api/overview"));
    expect(ov.status).toBe(200);
    expect((ov.body as { title: string }).title).toBe("青州旧事");
  });

  it("新作品的 /api/prep 列出全部缺项；建人物后缺项减少", async () => {
    const workspace = ws();
    await handleWorkspace(workspace, post("/api/works", SEED));
    const before = (await handleWorkspace(workspace, get("/api/prep"))).body as { gaps: string[]; characters: unknown[] };
    expect(before.gaps).toEqual(["前提", "核心冲突", "人物", "情节线", "第 1 章节拍"]);
    expect(before.characters).toEqual([]);

    workspace.active()?.upsertCharacter({
      id: "C01", name: "李长风", aliases: [], tier: "protagonist", introducedAt: 0,
      profile: { role: "捕快", appearance: [], traits: [], forbiddenBehaviors: [], wants: "", fears: "", background: "" },
      speech: { sentenceLength: { min: 4, max: 20 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [], syntaxBias: { question: 0.2, imperative: 0.2, elliptical: 0.2 }, register: "neutral", emotionalExpression: "direct", exemplars: [], counterExemplars: [] },
      provenance: "authored", updatedAt: "2026-09-11T00:00:00.000Z",
    });
    const after = (await handleWorkspace(workspace, get("/api/prep"))).body as { gaps: string[]; characters: { id: string; role: string }[] };
    expect(after.gaps).not.toContain("人物");
    expect(after.characters).toEqual([{ id: "C01", name: "李长风", tier: "protagonist", role: "捕快" }]);
  });

  it("题材非法回 400", async () => {
    const res = await handleWorkspace(ws(), post("/api/works", { ...SEED, genre: "wuxia" }));
    expect(res.status).toBe(400);
  });

  it("切换作品：未知 id 回 404，有效 id 更新活动", async () => {
    const workspace = ws();
    const a = (await handleWorkspace(workspace, post("/api/works", SEED))).body as { id: string };
    const b = (await handleWorkspace(workspace, post("/api/works", { ...SEED, title: "另一本" }))).body as { id: string };

    const bad = await handleWorkspace(workspace, post("/api/works/select", { id: "无此作品" }));
    expect(bad.status).toBe(404);

    const okSel = await handleWorkspace(workspace, post("/api/works/select", { id: a.id }));
    expect(okSel.status).toBe(200);
    expect((okSel.body as { activeId: string }).activeId).toBe(a.id);

    const list = await handleWorkspace(workspace, get("/api/works"));
    expect((list.body as { works: unknown[] }).works).toHaveLength(2);
    expect(b.id).not.toBe(a.id);
  });
});
