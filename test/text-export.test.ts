import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { DraftStore } from "../src/task/draft-store.js";
import { handle } from "../src/server/api.js";
import * as transaction from "../src/store/transaction.js";
import type { TextExportPreview, TextExportFile } from "../src/export/types.js";
import { CH1, CH2, PROSE, fakeClient, modelMessage, modelText, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "nf-text-export-")); roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const drafts = new DraftStore(root);
  drafts.saveDraft(savedDraft());
  drafts.saveDraft(savedDraft({ chapter: 4, draftId: "ch4d1", body: "第四章尚未采用的候选正文。" }));
  return { root, drafts, session: new ProjectSession(root) };
}
function preview(session: ProjectSession, selection: unknown = { scope: "all" }): TextExportPreview {
  const response = handle(session, { method: "POST", path: "/api/export/preview", query: new URLSearchParams(), body: selection });
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as TextExportPreview;
}
function get(session: ProjectSession, id: string, file = false) {
  return handle(session, { method: "GET", path: file ? "/api/export/file" : "/api/export", query: new URLSearchParams({ id }), body: null });
}
function file(session: ProjectSession, id: string): TextExportFile {
  const response = get(session, id, true);
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  return response.body as TextExportFile;
}

describe("固定正式版本的文本导出", () => {
  it("按章号列出正式版本，历史正文有内容指纹，未采用稿只列提示", () => {
    const { session, drafts } = fixture();
    session.adopt(3, "ch3d1");
    drafts.saveDraft(savedDraft({ draftId: "ch3d2", body: "第三章尚未采用的另一版。", baseVersion: 1, baseAdoptedThrough: 3 }));
    const result = preview(session);
    expect(result.chapters.map(c => c.chapter)).toEqual([1, 2, 3]);
    expect(result.chapters[0]).toMatchObject({ draftId: null, version: expect.stringMatching(/^legacy:[a-f0-9]{64}$/) });
    expect(result.chapters[2]).toMatchObject({ draftId: "ch3d1", version: "ch3d1" });
    expect(result.pendingDrafts).toEqual([{ chapter: 3, count: 1 }, { chapter: 4, count: 1 }]);
    expect(result.omitted).toEqual([{ from: 4, to: 4 }]);
    const output = file(session, result.id!);
    expect(output.text.startsWith("\uFEFF")).toBe(true);
    for (const body of [CH1, CH2, PROSE]) expect(output.text).toContain(body);
    expect(output.text).not.toContain("尚未采用");
    expect(output.text.indexOf(CH1)).toBeLessThan(output.text.indexOf(CH2));
    expect(output.text.indexOf(CH2)).toBeLessThan(output.text.indexOf(PROSE));
    expect(output.sha256).toBe(createHash("sha256").update(output.text).digest("hex"));
  });

  it("连续范围包含已采用章节，同时列出范围内未采用章节", () => {
    const { session } = fixture();
    const result = preview(session, { scope: "range", from: 2, to: 4 });
    expect(result.selection).toEqual({ scope: "range", from: 2, to: 4 });
    expect(result.chapters.map(c => c.chapter)).toEqual([2]);
    expect(result.omitted).toEqual([{ from: 3, to: 4 }]);
    expect(result.pendingDrafts).toEqual([{ chapter: 3, count: 1 }, { chapter: 4, count: 1 }]);
    expect(file(session, result.id!).text).toContain(CH2);
    expect(file(session, result.id!).text).not.toContain(CH1);
  });

  it("空范围给出可调整的预览，不创建空下载或改写故事", () => {
    const { session, root, drafts } = fixture();
    const before = new ProjectStore(root).load();
    const result = preview(session, { scope: "range", from: 3, to: 5 });
    expect(result).toMatchObject({ id: null, filename: null, chapters: [], omitted: [{ from: 3, to: 5 }], totalWords: 0 });
    expect(result.message).toMatch(/没有.*已采用/);
    expect(existsSync(join(root, "exports"))).toBe(false);
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(drafts.workVersion()).toBe(0);
  });

  it("预览后新采用旧章修订和新章，重开下载仍是原版本集合", () => {
    const { session, root, drafts } = fixture();
    session.adopt(3, "ch3d1");
    const original = preview(session);
    const originalFile = file(session, original.id!);
    drafts.saveDraft(savedDraft({ draftId: "ch3d2", body: "修订后的第三章，人物决定保留钥匙。", baseVersion: 1, baseAdoptedThrough: 3 }));
    session.adopt(3, "ch3d2");
    drafts.saveDraft(savedDraft({ chapter: 4, draftId: "ch4d2", body: "新采用的第四章。", baseVersion: 2, baseAdoptedThrough: 3 }));
    session.adopt(4, "ch4d2");
    const reopened = new ProjectSession(root);
    expect(get(reopened, original.id!).body).toEqual(original);
    expect(file(reopened, original.id!)).toEqual(originalFile);
    expect(originalFile.text).not.toContain("修订后的第三章");
    expect(originalFile.text).not.toContain("新采用的第四章");
    const latest = preview(reopened);
    expect(latest.id).not.toBe(original.id);
    expect(latest.chapters.map(c => [c.chapter, c.draftId])).toEqual([[1, null], [2, null], [3, "ch3d2"], [4, "ch4d2"]]);
    expect(file(reopened, latest.id!).text).toContain("修订后的第三章");
  });

  it("同一选择重试复用原快照，读取与下载不改变正文、事件或采用版本", () => {
    const { session, root, drafts } = fixture();
    const before = new ProjectStore(root).load();
    const first = preview(session);
    expect(preview(new ProjectSession(root))).toEqual(first);
    expect(readdirSync(join(root, "exports")).sort()).toEqual([`${first.id}.json`, `${first.id}.txt`]);
    file(session, first.id!);
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(drafts.workVersion()).toBe(0);
  });

  it("巨大但合法范围用遗漏区间表达，不逐章分配内存", () => {
    const { session } = fixture();
    const result = preview(session, { scope: "range", from: 1, to: Number.MAX_SAFE_INTEGER });
    expect(result.chapters.map(c => c.chapter)).toEqual([1, 2]);
    expect(result.omitted).toEqual([{ from: 3, to: Number.MAX_SAFE_INTEGER }]);
  });

  it.each([null, {}, { scope: "drafts" }, { scope: "range", from: 2 }, { scope: "range", from: 0, to: 3 },
    { scope: "range", from: 1.5, to: 3 }, { scope: "range", from: 3, to: 2 }, { scope: "range", from: 1, to: Infinity },
    { scope: "all", from: 1, to: 3 }])("非法范围 %j 在保存前拒绝", selection => {
    const { session, root } = fixture();
    expect(handle(session, { method: "POST", path: "/api/export/preview", query: new URLSearchParams(), body: selection }).status).toBe(400);
    expect(existsSync(join(root, "exports"))).toBe(false);
  });

  it("正文与正式版本映射不一致时停止导出，不冒充该版本", () => {
    const { session } = fixture();
    session.adopt(3, "ch3d1");
    session.putChapter(3, "未经版本采用覆盖的正文。");
    const response = handle(session, { method: "POST", path: "/api/export/preview", query: new URLSearchParams(), body: { scope: "all" } });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ error: expect.stringMatching(/版本|不一致/) });
  });

  it.each(["../../work-meta", "export-../outside", "export-x:stream", ""]) ("导出标识 %s 不能用于越界文件读取", id => {
    const { session } = fixture();
    expect(get(session, id).status).toBe(400);
    expect(get(session, id, true).status).toBe(400);
  });

  it("快照限于当前作品，不能从另一作品下载相同编号", () => {
    const one = fixture(); const two = fixture();
    const result = preview(one.session);
    expect(get(two.session, result.id!).status).toBe(404);
  });

  it.each(["json", "txt"])("保存的 %s 损坏时不重取当前正文来冒充原快照", extension => {
    const { session, root } = fixture();
    const result = preview(session);
    const path = join(root, "exports", `${result.id}.${extension}`);
    writeFileSync(path, extension === "json" ? '{"version":1}' : "被改过的导出文本", "utf8");
    expect(get(new ProjectSession(root), result.id!).status).toBe(409);
    expect(get(session, result.id!, true).status).toBe(409);
  });

  it.each(["json", "txt"])("保存的 %s 缺失时读取和同范围重试都不重建原快照", extension => {
    const { session, root } = fixture();
    const result = preview(session);
    const path = join(root, "exports", `${result.id}.${extension}`);
    rmSync(path);
    expect(get(new ProjectSession(root), result.id!).status).toBe(409);
    expect(get(session, result.id!, true).status).toBe(409);
    expect(handle(session, { method: "POST", path: "/api/export/preview", query: new URLSearchParams(), body: { scope: "all" } }).status).toBe(409);
    expect(existsSync(path)).toBe(false);
  });

  it("文件成组保存中断后无半份快照，原故事不变且可重试", () => {
    const { session, root } = fixture();
    const before = new ProjectStore(root).load();
    const original = transaction.writeProjectFile;
    vi.spyOn(transaction, "writeProjectFile").mockImplementation((directory, path, text) => {
      original(directory, path, text);
      if (path.startsWith("exports/") && path.endsWith(".txt")) throw new Error("模拟导出保存中断");
    });
    expect(() => preview(session)).toThrow(/模拟导出保存中断/);
    expect(existsSync(join(root, "exports")) ? readdirSync(join(root, "exports")) : []).toEqual([]);
    expect(new ProjectStore(root).load()).toEqual(before);
    vi.restoreAllMocks();
    expect(preview(session).chapters).toHaveLength(2);
  });

  it("中文书名生成可在 Windows 使用的文件名，TXT 保留原书名", () => {
    const { root } = fixture();
    const snapshot = new ProjectStore(root).load();
    const title = 'CON:山海/旧事?*<>|\\';
    new ProjectStore(root).save({ ...snapshot, setting: { ...snapshot.setting, title } });
    const session = new ProjectSession(root);
    const result = preview(session);
    expect(result.filename).toMatch(/\.txt$/);
    expect(result.filename).not.toMatch(/[<>:"/\\|?*\x00-\x1f]/);
    expect(file(session, result.id!).text).toContain(title);
  });

  it("对话导出返回固定预览入口，没有写章或采用副作用", async () => {
    const { root, drafts } = fixture();
    const model = fakeClient([
      { kind: "ok", message: modelMessage([{ type: "tool_use", id: "export", name: "prepare_text_export", input: { scope: "range", from: 1, to: 3 } }] as Anthropic.ContentBlock[], "tool_use") },
      modelText("导出预览已准备好，第 3 章尚未采用。"),
    ]);
    const session = new ProjectSession(root, undefined, { client: model.client });
    const before = new ProjectStore(root).load();
    const result = await session.converse("导出第1到3章，先让我看本次会包含的版本。");
    const effect = result.effects.find(effect => effect.kind === "export_prepared");
    expect(effect).toMatchObject({ kind: "export_prepared", chapters: 2, exportId: expect.stringMatching(/^export-[a-f0-9]{64}$/) });
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(drafts.workVersion()).toBe(0);
    expect(model.calls).toHaveLength(2);
    const toolResult = model.calls[1]!.messages.flatMap(message => typeof message.content === "string" ? [] : message.content)
      .find(block => block.type === "tool_result" && block.tool_use_id === "export");
    expect(toolResult?.type).toBe("tool_result");
    if (toolResult?.type !== "tool_result" || typeof toolResult.content !== "string") throw new Error("导出工具应返回 JSON 预览");
    const exported = JSON.parse(toolResult.content) as TextExportPreview;
    expect(exported.omitted).toEqual([{ from: 3, to: 3 }]);
    expect(exported.pendingDrafts).toEqual([{ chapter: 3, count: 1 }]);
    expect(toolResult.content).not.toContain(CH1);
  });

  it("对话中的空范围说明可调整原因，不生成下载入口或调用写章", async () => {
    const { root, drafts } = fixture();
    const model = fakeClient([
      { kind: "ok", message: modelMessage([{ type: "tool_use", id: "empty-export", name: "prepare_text_export", input: { scope: "range", from: 7, to: 9 } }] as Anthropic.ContentBlock[], "tool_use") },
      modelText("第7到9章没有已采用正文，可以调整导出范围。"),
    ]);
    const session = new ProjectSession(root, undefined, { client: model.client });
    const before = new ProjectStore(root).load();
    const result = await session.converse("导出第7到9章。");
    expect(result.effects).toEqual([{ kind: "action_failed", tool: "prepare_text_export", message: expect.stringContaining("没有已采用正文") }]);
    expect(existsSync(join(root, "exports"))).toBe(false);
    expect(new ProjectStore(root).load()).toEqual(before);
    expect(drafts.workVersion()).toBe(0);
    expect(model.calls).toHaveLength(2);
  });
});
