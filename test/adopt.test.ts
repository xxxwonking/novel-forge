/**
 * 按版本采用的测试。提交侧用真实 EventStream，草稿用真实 DraftStore（临时目录）。
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { adoptDraft, type AdoptDeps } from "../src/task/adopt.js";
import { DraftStore } from "../src/task/draft-store.js";
import { EventStream, commitDeclaration } from "../src/store/event-stream.js";
import type { C5Declaration } from "../src/types/events.js";
import type { ChapterDraft, DraftId } from "../src/task/types.js";

const CLOCK = () => "2026-09-10T00:00:00.000Z";

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

function readyDraft(
  chapter: number,
  draftId: DraftId,
  body: string,
  declaration: C5Declaration,
  baseVersion: number,
): ChapterDraft {
  return {
    chapter,
    draftId,
    status: "ready",
    body,
    declaration,
    findings: [],
    acceptable: true,
    proposals: [],
    revisions: [],
    session: null,
    baseVersion,
    baseAdoptedThrough: chapter - 1,
    error: null,
    createdAt: CLOCK(),
    updatedAt: CLOCK(),
  };
}

let root: string;
let store: DraftStore;
let stream: EventStream;
let bodies: Map<number, string>;
let deps: AdoptDeps;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nf-adopt-"));
  store = new DraftStore(root);
  stream = new EventStream(CLOCK);
  bodies = new Map();
  deps = {
    draftStore: store,
    clock: CLOCK,
    commitDeclaration: (chapter, declaration) => {
      const superseded = stream.supersedeChapter(chapter);
      commitDeclaration(stream, chapter, declaration);
      stream.decideChapter(chapter, "committed");
      return superseded;
    },
    putChapter: (chapter, body) => bodies.set(chapter, body),
  };
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function committedSummaries(chapter: number): string[] {
  return stream
    .effective()
    .filter((e) => e.envelope.chapter === chapter && e.payload.type === "plot_event")
    .map((e) => (e.payload as { summary: string }).summary);
}

describe("adoptDraft：按版本采用", () => {
  it("同章多稿，采用 B 只生效 B", () => {
    store.saveDraft(readyDraft(53, "ch53d1", "正文A", decl("A"), 0));
    store.saveDraft(readyDraft(53, "ch53d2", "正文B", decl("B"), 0));

    const r = adoptDraft(deps, 53, "ch53d2");

    expect(r.changed).toBe(true);
    expect(r.superseded).toBe(0);
    expect(committedSummaries(53)).toEqual(["B"]); // A 从未入流
    expect(bodies.get(53)).toBe("正文B");
    expect(store.loadDraft(53, "ch53d2")?.status).toBe("adopted");
    expect(store.loadDraft(53, "ch53d1")?.status).toBe("ready"); // A 不受影响
    expect(store.workVersion()).toBe(1);
  });

  it("幂等：重复采用同一稿不重复写入", () => {
    store.saveDraft(readyDraft(53, "ch53d1", "正文A", decl("A"), 0));
    adoptDraft(deps, 53, "ch53d1");
    const again = adoptDraft(deps, 53, "ch53d1");

    expect(again.changed).toBe(false);
    expect(committedSummaries(53)).toEqual(["A"]); // 仍只有一条
    expect(store.workVersion()).toBe(1); // 未再 +1
  });

  it("未就绪的草稿不能采用", () => {
    const d = readyDraft(53, "ch53d1", "x", decl("x"), 0);
    store.saveDraft({ ...d, status: "needs_revision", acceptable: false });
    expect(() => adoptDraft(deps, 53, "ch53d1")).toThrow(/未就绪/u);
  });

  it("修订已采用章：supersede 旧事件，新稿取代旧事实", () => {
    store.saveDraft(readyDraft(53, "ch53d1", "正文B", decl("B"), 0));
    adoptDraft(deps, 53, "ch53d1");
    expect(committedSummaries(53)).toEqual(["B"]);

    // 新修订稿（基于当前版本）
    store.saveDraft(readyDraft(53, "ch53d2", "正文C", decl("C"), store.workVersion()));
    const r = adoptDraft(deps, 53, "ch53d2");

    expect(r.superseded).toBe(1); // 旧 B 事件被作废
    expect(committedSummaries(53)).toEqual(["C"]); // 只剩 C
    expect(bodies.get(53)).toBe("正文C");
    expect(store.workVersion()).toBe(2);
  });

  it("采用某章后，依赖它的后续章草稿标记 stale", () => {
    store.saveDraft(readyDraft(53, "ch53d1", "正文53", decl("e53"), 0));
    store.saveDraft(readyDraft(54, "ch54d1", "正文54", decl("e54"), 0)); // 基于旧版本

    const r = adoptDraft(deps, 53, "ch53d1");

    expect(r.staleMarked).toContain(54);
    expect(store.loadDraft(54, "ch54d1")?.status).toBe("stale");
    expect(store.loadDraft(53, "ch53d1")?.status).toBe("adopted");
  });
});
