/**
 * DraftStore 落盘往返、作品版本与草稿序号。用临时目录。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Anthropic from "@anthropic-ai/sdk";
import { DraftStore } from "../src/task/draft-store.js";
import type { ChapterDraft, DraftId, DraftSession } from "../src/task/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function newStore(): DraftStore {
  const root = mkdtempSync(join(tmpdir(), "nf-draftstore-"));
  roots.push(root);
  return new DraftStore(root);
}

function fakeSession(): DraftSession {
  const c4Response = {
    id: "m",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: "正文", citations: [] }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
  return {
    system: [{ type: "text", text: "L1" }],
    tools: [],
    messages: [{ role: "user", content: "写第 7 章" }],
    c4Response,
  };
}

function draft(chapter: number, draftId: DraftId, over: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    chapter,
    draftId,
    status: "declaring",
    body: `正文-${draftId}`,
    declaration: null,
    findings: [],
    acceptable: false,
    proposals: [{ kind: "foreshadow", label: "钥匙", intent: "后收", weight: "sub", expectedBy: 20 }],
    session: fakeSession(),
    baseVersion: 0,
    baseAdoptedThrough: chapter - 1,
    error: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
    ...over,
  };
}

describe("DraftStore", () => {
  it("saveDraft → loadDraft 保真（含正文、会话、提议）", () => {
    const store = newStore();
    const d = draft(7, "ch7d1");
    store.saveDraft(d);
    const back = store.loadDraft(7, "ch7d1");
    expect(back).toEqual(d);
    expect(back?.body).toBe("正文-ch7d1");
    expect(back?.session?.c4Response.content[0]).toMatchObject({ type: "text" });
  });

  it("loadDraft 不存在 → undefined", () => {
    expect(newStore().loadDraft(1, "nope")).toBeUndefined();
  });

  it("nextDraftId 按已有序号递增", () => {
    const store = newStore();
    expect(store.nextDraftId(7)).toBe("ch7d1");
    store.saveDraft(draft(7, "ch7d1"));
    expect(store.nextDraftId(7)).toBe("ch7d2");
  });

  it("草稿编号有缺口时继续最大序号，不能覆盖已有稿", () => {
    const store = newStore();
    store.saveDraft(draft(7, "ch7d1"));
    store.saveDraft(draft(7, "ch7d3"));
    expect(store.nextDraftId(7)).toBe("ch7d4");
    expect(store.loadDraft(7, "ch7d3")?.body).toBe("正文-ch7d3");
  });

  it("创建时间相同时按数字版本排序，d10 晚于 d9", () => {
    const store = newStore();
    store.saveDraft(draft(7, "ch7d9"));
    store.saveDraft(draft(7, "ch7d10"));
    expect(store.latestDraft(7)?.draftId).toBe("ch7d10");
  });

  it("listDrafts 按 createdAt 升序，末尾即最新", () => {
    const store = newStore();
    store.saveDraft(draft(7, "ch7d1", { createdAt: "2026-09-10T00:00:00.000Z" }));
    store.saveDraft(draft(7, "ch7d2", { createdAt: "2026-09-10T01:00:00.000Z" }));
    const list = store.listDrafts(7);
    expect(list.map((d) => d.draftId)).toEqual(["ch7d1", "ch7d2"]);
    expect(store.latestDraft(7)?.draftId).toBe("ch7d2");
  });

  it("workVersion 从 0 起，bump 递增", () => {
    const store = newStore();
    expect(store.workVersion()).toBe(0);
    expect(store.bumpWorkVersion()).toBe(1);
    expect(store.bumpWorkVersion()).toBe(2);
    expect(store.workVersion()).toBe(2);
  });

  it("chaptersWithDrafts 返回有草稿的章号（升序）", () => {
    const store = newStore();
    store.saveDraft(draft(9, "ch9d1"));
    store.saveDraft(draft(7, "ch7d1"));
    expect(store.chaptersWithDrafts()).toEqual([7, 9]);
  });
});
