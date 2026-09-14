import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { ConversationStore } from "../src/agent/conversation-store.js";
import { declaration, NOW, PROSE, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function seed() {
  const root = mkdtempSync(join(tmpdir(), "nf-persistence-"));
  roots.push(root);
  const store = new ProjectStore(root);
  store.save(writingSnapshot());
  const drafts = new DraftStore(root);
  drafts.saveDraft(savedDraft({ declaration: { ...declaration(), events: [{
    type: "plot_event", kind: "action", summary: "打开密库", weight: 2, plotLine: "P01", participants: ["C01"],
    anchor: { chapter: 3, quote: "打开了宗门密库", offsetHint: 0, occurrence: 0 },
  }] } }));
  return { root, store, drafts, session: new ProjectSession(root) };
}

describe("采用保存失败的一致性", () => {
  it("正文保存失败时不改变正式事件、内存进度或版本；排障后可重试同一稿", () => {
    const { root, store, drafts, session } = seed();
    const events = structuredClone(session.events());
    const obstacle = join(root, "chapters", "ch3.txt");
    mkdirSync(obstacle);
    writeFileSync(join(obstacle, "obstacle"), "keep", "utf8");
    expect(() => session.adopt(3, "ch3d1")).toThrow();
    expect(session.events()).toEqual(events);
    expect(store.loadEvents()).toEqual(events);
    expect(session.currentChapter).toBe(2);
    expect(drafts.workVersion()).toBe(0);
    expect(drafts.loadDraft(3, "ch3d1")?.status).toBe("ready");
    rmSync(obstacle, { recursive: true });
    expect(session.adopt(3, "ch3d1").changed).toBe(true);
    expect(new ProjectSession(root).chapterText(3)).toBe(PROSE);
    expect(drafts.workVersion()).toBe(1);
    expect(session.adopt(3, "ch3d1").changed).toBe(false);
  });

  it("版本文件不可写时不会提前公布新正文与声明", () => {
    const { root, store, drafts, session } = seed();
    const events = structuredClone(session.events());
    mkdirSync(join(root, "work-meta.json"));
    expect(() => session.adopt(3, "ch3d1")).toThrow();
    expect(session.events()).toEqual(events);
    expect(store.loadEvents()).toEqual(events);
    expect(session.currentChapter).toBe(2);
    expect(existsSync(join(root, "chapters", "ch3.txt"))).toBe(false);
    expect(drafts.loadDraft(3, "ch3d1")?.status).toBe("ready");
  });

  it("草稿正文写入失败时保留旧元数据，避免新声明配旧正文", () => {
    const { root, drafts } = seed();
    const dir = join(root, "drafts", "ch3");
    const meta = readFileSync(join(dir, "ch3d1.json"), "utf8");
    rmSync(join(dir, "ch3d1.txt"));
    mkdirSync(join(dir, "ch3d1.txt"));
    expect(() => drafts.saveDraft(savedDraft({ status: "failed", body: "修改后的正文" }))).toThrow();
    expect(readFileSync(join(dir, "ch3d1.json"), "utf8")).toBe(meta);
  });
});

describe("不把坏数据当成空数据覆盖", () => {
  it.each(["{broken", '{"workVersion":-1}', '{"workVersion":1.5}', '{"workVersion":"2"}', "{}"])("损坏的作品版本 %s 阻止后续采用", (bad) => {
    const { root, drafts, session } = seed();
    const path = join(root, "work-meta.json");
    writeFileSync(path, bad, "utf8");
    expect(() => drafts.workVersion()).toThrow(/work-meta/u);
    expect(() => session.adopt(3, "ch3d1")).toThrow();
    expect(readFileSync(path, "utf8")).toBe(bad);
    expect(session.currentChapter).toBe(2);
  });

  it.each(["{broken", '{"turns":"broken","ideas":[]}', '{"turns":[null],"ideas":[]}', '{"turns":[],"ideas":[{}]}'])("损坏对话 %s 不会被新操作静默清空", (bad) => {
    const { root } = seed();
    const path = join(root, "conversation.json");
    writeFileSync(path, bad, "utf8");
    const conversation = new ConversationStore(root);
    expect(() => conversation.recordIdea("新的备选", NOW)).toThrow(/conversation/u);
    expect(readFileSync(path, "utf8")).toBe(bad);
  });
});
