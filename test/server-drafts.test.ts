/**
 * 章节草稿端点（Stage 1）：采用 / 幂等 / 丢弃 / 列表。只测 handle()，不起端口。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { handle, type ApiRequest, type ApiResponse } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { workProfile, workSetting } from "./fixtures.js";
import type { C5Declaration } from "../src/types/events.js";
import type { ChapterDraft, DraftId } from "../src/task/types.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function decl(summary: string): C5Declaration {
  return {
    events: [
      {
        type: "plot_event",
        kind: "action",
        summary,
        weight: 2,
        plotLine: "P01",
        participants: ["C01"],
        anchor: { chapter: 53, quote: summary, offsetHint: 0, occurrence: 0 },
      },
    ],
    foreshadowPlanted: [],
    foreshadowResolved: [],
    relationsChanged: [],
    characterStates: [],
    characterPresence: [],
  };
}

function ready(draftId: DraftId, body: string, summary: string): ChapterDraft {
  return {
    chapter: 53,
    draftId,
    status: "ready",
    body,
    declaration: decl(summary),
    findings: [],
    acceptable: true,
    proposals: [],
    session: null,
    baseVersion: 0,
    baseAdoptedThrough: 52,
    error: null,
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
}

function seed(): { session: ProjectSession; drafts: DraftStore } {
  const root = mkdtempSync(join(tmpdir(), "nf-server-drafts-"));
  roots.push(root);
  new ProjectStore(root).save({
    setting: workSetting,
    profile: workProfile,
    characters: [],
    plotLines: [],
    beats: [],
    alertStates: [],
    events: [],
    chapters: new Map(),
  });
  const drafts = new DraftStore(root);
  drafts.saveDraft(ready("ch53d1", "正文A", "A"));
  drafts.saveDraft(ready("ch53d2", "正文B", "B"));
  return { session: new ProjectSession(root), drafts };
}

function get(session: ProjectSession, path: string, params: Record<string, string> = {}): ApiResponse {
  const req: ApiRequest = { method: "GET", path, query: new URLSearchParams(params), body: null };
  return handle(session, req);
}
function post(session: ProjectSession, path: string, body: unknown): ApiResponse {
  const req: ApiRequest = { method: "POST", path, query: new URLSearchParams(), body };
  return handle(session, req);
}

describe("章节草稿端点", () => {
  it("GET /api/chapter/drafts 列出草稿，不含内部会话", () => {
    const { session } = seed();
    const res = get(session, "/api/chapter/drafts", { n: "53" });
    expect(res.status).toBe(200);
    const list = res.body as ChapterDraft[];
    expect(list).toHaveLength(2);
    expect(list.every((d) => !("session" in d))).toBe(true);
  });

  it("POST /api/chapter/adopt 采用指定版本，正文与首页刷新", () => {
    const { session } = seed();
    const res = post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d2" });
    expect(res.status).toBe(200);
    const body = res.body as { result: { changed: boolean; draftId: string }; alerts: unknown };
    expect(body.result.changed).toBe(true);
    expect(body.result.draftId).toBe("ch53d2");
    expect(body.alerts).toBeDefined();

    // 采用后正文可读，草稿状态更新
    const chap = get(session, "/api/chapter", { n: "53" });
    expect(chap.status).toBe(200);
    expect((chap.body as { text: string }).text).toBe("正文B");
    const d2 = get(session, "/api/chapter/draft", { n: "53", id: "ch53d2" });
    expect((d2.body as ChapterDraft).status).toBe("adopted");
  });

  it("重复采用同一版本幂等（changed:false）", () => {
    const { session } = seed();
    post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d1" });
    const again = post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d1" });
    expect((again.body as { result: { changed: boolean } }).result.changed).toBe(false);
  });

  it("采用只提交选中稿的声明，不顺带确认事件流中的旧候选", () => {
    const { session } = seed();
    session.appendEvents([{ chapter: 53, origin: "async_candidate", provenance: "proposed", payload: { type: "plot_event", kind: "info", summary: "未选择的旧候选", weight: 1, plotLine: "P01", participants: ["C01"], anchor: { chapter: 53, quote: "旧候选", offsetHint: 0, occurrence: 0 } } }]);
    const res = post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d1" });
    expect(res.status).toBe(200);
    expect(session.events()[0]?.envelope.provenance).toBe("proposed");
    expect(session.events().filter((e) => e.envelope.provenance === "committed").map((e) => e.payload.type === "plot_event" ? e.payload.summary : e.payload.type)).toEqual(["A"]);
  });

  it("采用未就绪草稿 → 400", () => {
    const { session, drafts } = seed();
    drafts.saveDraft({ ...ready("ch53d3", "x", "x"), status: "needs_revision", acceptable: false });
    const res = post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d3" });
    expect(res.status).toBe(400);
  });

  it.each(["stale", "discarded", "failed", "writing", "declaring", "checking"] as const)("%s 草稿即使保留旧 acceptable 也不能采用", (status) => {
    const { session, drafts } = seed();
    drafts.saveDraft({ ...ready("ch53d3", "过期的正文", "旧声明"), status });
    const res = post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d3" });
    expect(res.status).toBe(400);
    expect(session.chapterText(53)).toBeUndefined();
    expect(session.events()).toHaveLength(0);
  });

  it("POST /api/chapter/discard 丢弃草稿", () => {
    const { session } = seed();
    const res = post(session, "/api/chapter/discard", { chapter: 53, draftId: "ch53d1" });
    expect(res.status).toBe(200);
    const d = get(session, "/api/chapter/draft", { n: "53", id: "ch53d1" });
    expect((d.body as ChapterDraft).status).toBe("discarded");
  });

  it("不能把已采用版本改成已丢弃，正式正文保持可追溯", () => {
    const { session } = seed();
    post(session, "/api/chapter/adopt", { chapter: 53, draftId: "ch53d1" });
    const discarded = post(session, "/api/chapter/discard", { chapter: 53, draftId: "ch53d1" });
    expect(discarded.status).toBe(409);
    expect(session.getDraft(53, "ch53d1")?.status).toBe("adopted");
    expect(session.chapterText(53)).toBe("正文A");
  });

  it("缺参数 → 400", () => {
    const { session } = seed();
    expect(post(session, "/api/chapter/adopt", { chapter: 53 }).status).toBe(400);
    expect(get(session, "/api/chapter/drafts").status).toBe(400);
  });
});
