import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions, CallResult } from "../src/client/claude.js";
import { handle } from "../src/server/api.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { loadRules } from "../src/rules/load.js";
import { declaration, fakeClient, modelMessage, modelText, PROSE, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function seed(results: readonly CallResult[] = []) {
  const root = mkdtempSync(join(tmpdir(), "nf-consistency-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const model = fakeClient(results);
  return { root, model, drafts: new DraftStore(root), session: new ProjectSession(root, loadRules(), { client: model.client }) };
}

function tools(...calls: readonly { id: string; name: string; input: unknown }[]): CallResult {
  return {
    kind: "ok",
    message: modelMessage(calls.map((call) => ({
      ...call, type: "tool_use", caller: { type: "direct" },
    })) as Anthropic.ContentBlock[], "tool_use"),
  };
}

function toolResult(call: CallOptions | undefined, id: string): string {
  for (const message of call?.messages ?? []) {
    if (!Array.isArray(message.content)) continue;
    for (const block of message.content) {
      if (block.type === "tool_result" && block.tool_use_id === id && typeof block.content === "string") return block.content;
    }
  }
  throw new Error(`模型未收到工具结果 ${id}`);
}

function get(session: ProjectSession, path: string, query = "") {
  return handle(session, { method: "GET", path, query: new URLSearchParams(query), body: null });
}

describe("同一轮对话中的正式资料一致性", () => {
  it.each(["正文", "人物状态", "未收伏笔"])("采用后立即查询%s，读取刚采用的版本", async (part) => {
    const { model, session, drafts } = seed([
      tools({ id: "adopt", name: "adopt_chapter", input: { draftId: "ch3d1" } }),
      tools(
        { id: "body", name: "get_chapter_text", input: { chapter: 3 } },
        { id: "character", name: "get_character", input: { name: "C01" } },
        { id: "foreshadows", name: "list_open_foreshadows", input: { weight: "all" } },
      ),
      modelText("核对完成。"),
    ]);
    const body = `${PROSE}李长风的毒伤已经痊愈。`;
    drafts.saveDraft(savedDraft({
      body,
      declaration: {
        ...declaration(),
        characterStates: [{ type: "character_state_changed", characterId: "C01", field: "condition", from: "毒伤尚未痊愈", to: "毒伤已经痊愈", anchor: { chapter: 3, quote: "毒伤已经痊愈", offsetHint: 0, occurrence: 0 } }],
        foreshadowResolved: [{ type: "foreshadow_resolved", foreshadowId: "F01", completeness: "full", anchor: { chapter: 3, quote: "钥匙的齿缝与锁眼严丝合缝", offsetHint: 0, occurrence: 0 } }],
      },
    }));
    await session.converse("采用 ch3d1，然后核对第三章正文、主角状态和剩余伏笔。");
    expect(session.currentChapter).toBe(3);
    if (part === "正文") expect(toolResult(model.calls[2], "body")).toBe(body);
    if (part === "人物状态") expect(JSON.parse(toolResult(model.calls[2], "character")).state.condition).toBe("毒伤已经痊愈");
    if (part === "未收伏笔") {
      const ids = (JSON.parse(toolResult(model.calls[2], "foreshadows")) as { id: string }[]).map((f) => f.id);
      expect(ids).not.toContain("F01");
      expect(ids).toContain("F02");
    }
  });

  it("同一批工具先改期再读取，查询反映新计划", async () => {
    const { model, session } = seed([
      tools(
        { id: "reschedule", name: "plan_reschedule_foreshadow", input: { foreshadowId: "F01", expectedBy: 12 } },
        { id: "read", name: "list_open_foreshadows", input: { weight: "all" } },
      ),
      modelText("已改期。"),
    ]);
    await session.converse("把 F01 改到第十二章，列出更新后的安排。");
    const items = JSON.parse(toolResult(model.calls[1], "read")) as { id: string; expectedBy: number }[];
    expect(items.find((f) => f.id === "F01")?.expectedBy).toBe(12);
  });
});

describe("正式正文的体检边界", () => {
  const health = (session: ProjectSession) => get(session, "/api/health", "n=2").body as { chapterGate: { density: number } };

  it.each([
    ["proposed", "C5_declaration"],
    ["authored", "P4_outline"],
    ["committed", "P4_outline"],
    ["rejected", "C5_declaration"],
  ] as const)("%s / %s 不改变正式正文的事件密度", (provenance, origin) => {
    const { session, root } = seed();
    const before = health(session).chapterGate.density;
    expect(before).toBeGreaterThan(0);
    const store = new ProjectStore(root);
    const stream = store.loadEventStream();
    const event = stream.append({ chapter: 2, provenance: provenance === "authored" ? "authored" : "proposed", origin, payload: {
      type: "plot_event", kind: "info", summary: "尚未发生的候选情节", weight: 3,
      plotLine: "P01", participants: ["C01"], anchor: { chapter: 2, quote: "旧图", offsetHint: 0, occurrence: 0 },
    } });
    if (provenance === "committed" || provenance === "rejected") stream.decide(event.envelope.id, provenance);
    store.rewriteEvents(stream.all());
    expect(health(new ProjectSession(root)).chapterGate.density).toBe(before);
  });

  it("作者确认的正文事件仍参与体检", () => {
    const { session } = seed();
    const before = health(session).chapterGate.density;
    session.appendEvents([{ chapter: 2, provenance: "authored", origin: "user_edit", payload: {
      type: "plot_event", kind: "info", summary: "主角确认密库位置", weight: 1,
      plotLine: "P01", participants: ["C01"], anchor: { chapter: 2, quote: "密库位置", offsetHint: 0, occurrence: 0 },
    } }]);
    expect(health(session).chapterGate.density).toBeGreaterThan(before);
  });
});

describe("用户可见字数", () => {
  const body = "你好，hello world!\n";

  it("章节列表计汉字与西文词，排除标点和空白", () => {
    const { session } = seed();
    session.putChapter(2, body);
    const rows = get(session, "/api/chapters").body as { chapter: number; words: number }[];
    expect(rows.find((r) => r.chapter === 2)?.words).toBe(4);
  });

  it("对话中的草稿字数使用相同口径", async () => {
    const { session, drafts, model } = seed([
      tools({ id: "drafts", name: "list_chapter_drafts", input: { chapter: 3 } }),
      modelText("草稿已列出。"),
    ]);
    drafts.saveDraft(savedDraft({ body }));
    await session.converse("第三章草稿多少字？");
    expect(JSON.parse(toolResult(model.calls[1], "drafts"))[0].words).toBe(4);
  });

  it("草稿详情返回可供 Web 直接展示的统一字数", () => {
    const { session, drafts } = seed();
    drafts.saveDraft(savedDraft({ body }));
    const view = get(session, "/api/chapter/draft", "n=3&id=ch3d1").body as { words: number };
    expect(view.words).toBe(4);
  });
});
