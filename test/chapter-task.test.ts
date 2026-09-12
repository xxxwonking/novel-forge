/**
 * 章节任务服务 + LangGraph 图的测试。用假客户端与临时目录，不打真实 API。
 *
 * 重点：
 *   ① C5 失败仍保留 C4 正文；resume 从声明步起、不重跑 C4（capability-map §3.1）。
 *   ② 工具循环在图内生效：propose_* 提议进草稿。
 *   ③ 顺利路径产出 ready 草稿并落盘。
 */

import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { ChapterTaskService, type ToolReadSource } from "../src/task/service.js";
import { DraftStore } from "../src/task/draft-store.js";
import { adoptDraft } from "../src/task/adopt.js";
import { EventStream, commitDeclaration } from "../src/store/event-stream.js";
import { ClaudeClient, type CallOptions, type CallResult } from "../src/client/claude.js";
import type { ChapterRunInput } from "../src/chapter/pipeline.js";
import { loadRules } from "../src/rules/load.js";
import { buildL2Snapshot } from "../src/context/build-l2.js";
import { selectL3 } from "../src/context/select-l3.js";
import { WRITING_DISCIPLINE } from "../src/context/discipline.js";
import type { ForeshadowId } from "../src/types/primitives.js";
import {
  beat,
  chapterSynopses,
  characters,
  foreshadows,
  plotLines,
  previousChapterText,
  settings,
  volumeSummaries,
  workProfile,
  workSetting,
} from "./fixtures.js";

const PROSE = [
  "血刀客推开破庙的门，刀还在鞘里。",
  "李长风把断剑横过来。账本从三叔的袖口滑出来，第三行写着他的名字。",
  "断剑崩成两截。",
].join("\n");

const C5_JSON = JSON.stringify({
  events: [
    { kind: "action", summary: "血刀客围住破庙，李长风接下第九式", weight: 3, plot_line: "P01", participants: ["C01", "C02"], quote: "血刀客推开破庙的门" },
    { kind: "info", summary: "账本第三行出现三叔的名字", weight: 2, plot_line: "P02", participants: ["C01"], quote: "第三行写着他的名字" },
  ],
  foreshadow_planted: [],
  foreshadow_resolved: [
    { foreshadow_id: "F03", completeness: "full", quote: "第三行写着他的名字" },
    { foreshadow_id: "F07", completeness: "full", quote: "断剑崩成两截" },
    { foreshadow_id: "F11", completeness: "partial", quote: "断剑崩成两截" },
  ],
  relations_changed: [],
  character_states: [{ character_id: "C01", field: "condition", from: "养伤中", to: "断剑折断", quote: "断剑崩成两截" }],
  character_presence: [{ character_id: "C01", role: "pov" }, { character_id: "C02", role: "major" }],
});

function textMessage(text: string): Anthropic.Message {
  return {
    id: "m", type: "message", role: "assistant", model: "claude-opus-5",
    content: [{ type: "text", text, citations: [] }],
    stop_reason: "end_turn", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function toolUseMessage(uses: readonly { id: string; name: string; input: unknown }[]): Anthropic.Message {
  return {
    id: "mt", type: "message", role: "assistant", model: "claude-opus-5",
    content: uses.map((u) => ({ type: "tool_use", id: u.id, name: u.name, input: u.input })),
    stop_reason: "tool_use", stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

function fakeClient(results: readonly CallResult[]): { client: ClaudeClient; calls: CallOptions[] } {
  const calls: CallOptions[] = [];
  let i = 0;
  const client = {
    official: true,
    call: vi.fn(async (opts: CallOptions): Promise<CallResult> => {
      calls.push(opts);
      const r = results[i];
      i += 1;
      if (r === undefined) throw new Error("假客户端调用次数超出预设");
      return r;
    }),
  } as unknown as ClaudeClient;
  return { client, calls };
}

const READ: ToolReadSource = {
  loadCharacter: () => "李长风：断剑门弟子。",
  loadSetting: () => null,
  loadChapter: () => null,
  listOpenForeshadows: () => "未收伏笔：生锈的钥匙。",
};

let fsCounter = 30;
function runInput(): ChapterRunInput {
  return {
    chapter: 53,
    assembleInput: {
      l1: { setting: workSetting, discipline: WRITING_DISCIPLINE },
      l2: buildL2Snapshot({ currentChapter: 52, characters, chapterSynopses, volumeSummaries: [...volumeSummaries], foreshadows, plotLines, pendingAppend: [] }),
      l3: selectL3({ beat, characters: characters.filter((c) => beat.plan.characters.includes(c.id)), settings: settings.filter((s) => beat.plan.locations.includes(s.id)), volumeBoundary: null, plantedExcerpts: [] }),
      volatile: { previous: { chapter: 52, headSummary: null, tailText: previousChapterText }, beat, resolves: [], avoid: [], task: "写第 53 章。" },
    },
    parseContextBase: {
      chapter: 53,
      knownCharacters: new Set(["C01", "C02", "C03"]),
      knownForeshadows: new Set(["F03", "F07", "F11"]),
      knownPlotLines: new Set(["P01", "P02", "P03"]),
      allocateForeshadowId: () => `F${String(++fsCounter)}` as ForeshadowId,
    },
    promisedResolutions: [
      { foreshadowId: "F03", completeness: "full" },
      { foreshadowId: "F07", completeness: "full" },
      { foreshadowId: "F11", completeness: "partial" },
    ],
  };
}

let root: string;
let store: DraftStore;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "nf-task-"));
  store = new DraftStore(root);
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function service(client: ClaudeClient, maxRevisions = 1): ChapterTaskService {
  return new ChapterTaskService({ client, draftStore: store, readSource: READ, maxToolRounds: 6, maxRevisions });
}

describe("ChapterTaskService.run：顺利路径", () => {
  it("write→declare→check 产出 ready 草稿并落盘", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
    ]);
    const draft = await service(client).run(runInput());

    expect(draft.status).toBe("ready");
    expect(draft.acceptable).toBe(true);
    expect(draft.body).toBe(PROSE);
    expect(draft.declaration).not.toBeNull();
    expect(draft.declaration?.events).toHaveLength(2);
    // 已落盘、可重新读出
    expect(store.loadDraft(53, draft.draftId)?.status).toBe("ready");
    expect(store.listDrafts(53)).toHaveLength(1);
  });

  it("工具循环在图内生效：propose_foreshadow 进草稿", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: toolUseMessage([{ id: "t1", name: "propose_foreshadow", input: { label: "血刀令", intent: "后揭伪造", weight: "sub", expected_by: 60 } }]) },
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
    ]);
    const draft = await service(client).run(runInput());

    expect(draft.status).toBe("ready");
    expect(draft.proposals).toHaveLength(1);
    expect(draft.proposals[0]).toMatchObject({ kind: "foreshadow", label: "血刀令" });
  });
});

describe("ChapterTaskService：C5 失败与恢复（gap ①）", () => {
  it("C5 失败保留正文与会话，草稿标 failed", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "error", error: { type: "status", status: 500, message: "boom", retryable: true } },
    ]);
    const draft = await service(client).run(runInput());

    expect(draft.status).toBe("failed");
    expect(draft.body).toBe(PROSE); // 正文没丢
    expect(draft.declaration).toBeNull();
    expect(draft.session).not.toBeNull(); // C4 会话已存，可恢复
    expect(draft.error?.step).toBe("C5");
  });

  it("resume 从声明步起，不重跑 C4", async () => {
    const failing = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "error", error: { type: "status", status: 500, message: "boom", retryable: true } },
    ]);
    const first = await service(failing.client).run(runInput());
    expect(first.status).toBe("failed");
    expect(failing.calls).toHaveLength(2);

    // resume 用新客户端，只需 C5 一次；write 节点应跳过。
    const resuming = fakeClient([{ kind: "ok", message: textMessage(C5_JSON) }]);
    const resumed = await service(resuming.client).resume(runInput(), first.draftId);

    expect(resumed.status).toBe("ready");
    expect(resumed.body).toBe(PROSE);
    expect(resumed.declaration).not.toBeNull();
    expect(resuming.calls).toHaveLength(1); // 只跑了 C5，没有重跑 C4
    expect(store.listDrafts(53)).toHaveLength(1); // 同一草稿，未新增
  });

  it("C4 被拒：无正文、无会话、标 failed", async () => {
    const { client } = fakeClient([
      { kind: "refusal", message: textMessage(""), category: "violence", explanation: null, userMessage: "这段暴力描写无法生成" },
    ]);
    const draft = await service(client).run(runInput());

    expect(draft.status).toBe("failed");
    expect(draft.body).toBe("");
    expect(draft.session).toBeNull();
    expect(draft.error?.detail).toContain("无法生成");
  });
});

describe("自动修订（rules.task.maxAutoRevisions）", () => {
  /** 带闸门的输入：PROSE 只有三行，字数远低于预算下限 ⇒ C7 必给 route_patch(block)。 */
  function gated(): ChapterRunInput {
    return { ...runInput(), gate: { profile: workProfile, rules: loadRules() } };
  }

  it("检查未过 → 改一次 → 重新声明重新检查，旧正文进 revisions", async () => {
    const revised = `${PROSE}\n他把账本翻到最后一页，缺口的毛边还新。`;
    const { client, calls } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
      { kind: "ok", message: textMessage(revised) },
      { kind: "ok", message: textMessage(C5_JSON) },
    ]);
    const draft = await service(client).run(gated());

    expect(calls).toHaveLength(4); // C4 → C5 → C7 → C5
    expect(draft.body).toBe(revised);
    expect(draft.revisions).toHaveLength(1);
    expect(draft.revisions[0]?.body).toBe(PROSE);
    expect(draft.revisions[0]?.findings.some((f) => f.level === "block")).toBe(true);
    expect(draft.revisions[0]?.reason).toContain("补写");
    // 声明与检查是重算的，不是沿用修订前那份。
    expect(draft.declaration).not.toBeNull();
    expect(store.loadDraft(53, draft.draftId)?.revisions[0]?.body).toBe(PROSE);
  });

  it("修订轮的请求带着 C7 问题清单，并续在 C4 会话之后", async () => {
    const { client, calls } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
      { kind: "ok", message: textMessage(`${PROSE}\n补了一句。`) },
      { kind: "ok", message: textMessage(C5_JSON) },
    ]);
    await service(client).run(gated());

    const revisionCall = calls[2];
    const last = JSON.stringify(revisionCall?.messages.at(-1));
    expect(last).toContain("问题清单");
    expect(last).toContain("按优先级补写");
    // 字数不足时给净增硬指标（数字来自 route_patch 的 measured/threshold）。
    expect(last).toContain("只增不减");
    expect(last).toMatch(/新增合计不少于 \d+ 字/u);
    // 续接点是 C4 之后：倒数第二条是那次产出正文的 assistant 回合。
    expect(JSON.stringify(revisionCall?.messages.at(-2))).toContain("断剑崩成两截");
  });

  it("额度用尽不再改：maxRevisions=0 时停在 needs_revision", async () => {
    const { client, calls } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
    ]);
    const draft = await service(client, 0).run(gated());

    expect(calls).toHaveLength(2);
    expect(draft.status).toBe("needs_revision");
    expect(draft.revisions).toEqual([]);
  });

  it("修订调用失败不作废原稿：仍是 needs_revision，正文与 C5 声明都在", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
      { kind: "error", error: { type: "status", status: 500, message: "boom", retryable: true } },
    ]);
    const draft = await service(client).run(gated());

    expect(draft.status).toBe("needs_revision");
    expect(draft.body).toBe(PROSE);
    expect(draft.declaration).not.toBeNull();
    expect(draft.revisions).toEqual([]);
    expect(draft.error?.step).toBe("C7");
  });

  it("resume 不重置修订额度：已改过一次的草稿恢复后不再自动改", async () => {
    const revised = `${PROSE}\n他把账本翻到最后一页。`;
    const first = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
      { kind: "ok", message: textMessage(revised) },
      { kind: "error", error: { type: "status", status: 500, message: "boom", retryable: true } },
    ]);
    const failed = await service(first.client).run(gated());
    expect(failed.status).toBe("failed"); // 修订后的 C5 挂了
    expect(failed.revisions).toHaveLength(1);

    const again = fakeClient([{ kind: "ok", message: textMessage(C5_JSON) }]);
    const resumed = await service(again.client).resume(gated(), failed.draftId);

    expect(again.calls).toHaveLength(1); // 只补跑 C5，没有第二次修订
    expect(resumed.status).toBe("needs_revision");
    expect(resumed.revisions).toHaveLength(1);
  });
});

describe("全链路：run → adopt", () => {
  it("service.run 产出的 ready 草稿可被 adoptDraft 采用（同一 DraftStore）", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: textMessage(PROSE) },
      { kind: "ok", message: textMessage(C5_JSON) },
    ]);
    const draft = await service(client).run(runInput());
    expect(draft.status).toBe("ready");

    const stream = new EventStream(() => "2026-09-10T00:00:00.000Z");
    const bodies = new Map<number, string>();
    const r = adoptDraft(
      {
        draftStore: store,
        commitDeclaration: (ch, decl) => {
          const superseded = stream.supersedeChapter(ch);
          commitDeclaration(stream, ch, decl);
          stream.decideChapter(ch, "committed");
          return superseded;
        },
        putChapter: (ch, b) => bodies.set(ch, b),
      },
      53,
      draft.draftId,
    );

    expect(r.changed).toBe(true);
    expect(store.loadDraft(53, draft.draftId)?.status).toBe("adopted");
    expect(bodies.get(53)).toBe(PROSE);
    expect(stream.effective().filter((e) => e.envelope.chapter === 53).length).toBeGreaterThan(0);
  });
});
