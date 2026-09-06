/**
 * 章循环的测试。用假客户端 —— 不打真实 API。
 *
 * 重点验证三件事：
 *   ① C5 是同会话第二轮（消息里带着 C4 的完整响应）
 *   ② 拒绝不被当成报错，带出可展示文案
 *   ③ 产出的事件全部是 proposed，投影不受影响
 */

import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { runChapter, type ChapterRunInput } from "../src/chapter/pipeline.js";
import { ClaudeClient, type CallOptions, type CallResult } from "../src/client/claude.js";
import { EventStream } from "../src/store/event-stream.js";
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
  workSetting,
} from "./fixtures.js";

const chapterProse = [
  "血刀客推开破庙的门，刀还在鞘里。",
  "李长风把断剑横过来。账本从三叔的袖口滑出来，第三行写着他的名字。",
  "断剑崩成两截。",
].join("\n");

function fakeMessage(text: string, usage?: Partial<Anthropic.Usage>): Anthropic.Message {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text, citations: [] }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 5_500,
      output_tokens: 900,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 12_700,
      ...usage,
    },
  } as unknown as Anthropic.Message;
}

const c5Json = JSON.stringify({
  events: [
    {
      kind: "action",
      summary: "血刀客围住破庙，李长风接下第九式",
      weight: 3,
      plot_line: "P01",
      participants: ["C01", "C02"],
      quote: "血刀客推开破庙的门",
    },
    {
      kind: "info",
      summary: "账本第三行出现三叔的名字",
      weight: 2,
      plot_line: "P02",
      participants: ["C01"],
      quote: "第三行写着他的名字",
    },
  ],
  foreshadow_planted: [],
  foreshadow_resolved: [
    { foreshadow_id: "F03", completeness: "full", quote: "第三行写着他的名字" },
    { foreshadow_id: "F07", completeness: "full", quote: "断剑崩成两截" },
    { foreshadow_id: "F11", completeness: "partial", quote: "断剑崩成两截" },
  ],
  relations_changed: [],
  character_states: [
    { character_id: "C01", field: "condition", from: "养伤中", to: "断剑折断", quote: "断剑崩成两截" },
  ],
  character_presence: [
    { character_id: "C01", role: "pov" },
    { character_id: "C02", role: "major" },
  ],
});

/** 假客户端：按调用顺序返回预设结果，并记录每次的入参。 */
function fakeClient(results: readonly CallResult[], official = true): {
  client: ClaudeClient;
  calls: CallOptions[];
} {
  const calls: CallOptions[] = [];
  let i = 0;
  const client = {
    official,
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

let fsCounter = 30;
function runInput(): ChapterRunInput {
  return {
    chapter: 53,
    assembleInput: {
      l1: { setting: workSetting, discipline: WRITING_DISCIPLINE },
      l2: buildL2Snapshot({
        currentChapter: 52,
        characters,
        chapterSynopses,
        volumeSummaries: [...volumeSummaries],
        foreshadows,
        plotLines,
        pendingAppend: [],
      }),
      l3: selectL3({
        beat,
        characters: characters.filter((c) => beat.plan.characters.includes(c.id)),
        settings: settings.filter((s) => beat.plan.locations.includes(s.id)),
        volumeBoundary: null,
        plantedExcerpts: [],
      }),
      volatile: {
        previous: { chapter: 52, headSummary: null, tailText: previousChapterText },
        beat,
        resolves: [
          {
            id: "F03" as ForeshadowId,
            label: "生锈的钥匙",
            intent: foreshadows[0]!.intent,
            weight: "main",
            completeness: "full",
          },
        ],
        avoid: [],
        task: "写出第 53 章。",
      },
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

describe("runChapter：正常路径", () => {
  it("跑通 C4 → C5，产出正文与结构声明", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    const stream = new EventStream();
    const r = await runChapter(client, stream, runInput());

    expect(r.kind).toBe("ok");
    if (r.kind !== "ok") return;
    expect(r.chapterText).toBe(chapterProse);
    expect(r.parse.declaration.events).toHaveLength(2);
    expect(r.parse.declaration.foreshadowResolved).toHaveLength(3);
  });

  it("C5 是同会话第二轮：消息里带着 C4 的完整响应内容", async () => {
    const c4msg = fakeMessage(chapterProse);
    const { client, calls } = fakeClient([
      { kind: "ok", message: c4msg },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    await runChapter(client, new EventStream(), runInput());

    expect(calls).toHaveLength(2);
    const c5Call = calls[1]!;
    // 第二轮的消息 = 第一轮消息 + assistant 完整 content + C5 指令
    expect(c5Call.messages).toHaveLength(calls[0]!.messages.length + 2);
    const assistantTurn = c5Call.messages[c5Call.messages.length - 2];
    expect(assistantTurn?.role).toBe("assistant");
    // 追加的是整个 content 数组，不是抽出来的字符串
    expect(assistantTurn?.content).toBe(c4msg.content);
  });

  it("C5 复用同一份 system 与 tools，保证缓存命中", async () => {
    const { client, calls } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    await runChapter(client, new EventStream(), runInput());
    expect(calls[1]!.system).toBe(calls[0]!.system);
    expect(calls[1]!.tools).toBe(calls[0]!.tools);
  });

  it("C4 用 xhigh + thinking，C5 用 medium + 结构化输出", async () => {
    const { client, calls } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    await runChapter(client, new EventStream(), runInput());
    expect(calls[0]!.effort).toBe("xhigh");
    expect(calls[0]!.thinking).toBe(true);
    expect(calls[1]!.effort).toBe("medium");
    expect(calls[1]!.outputSchema).toBeDefined();
  });

  it("两步的缓存度量都被记录", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    if (r.kind !== "ok") return;
    expect(r.metrics.map((m) => m.step)).toEqual(["C4", "C5"]);
    expect(r.metrics.every((m) => m.trustworthy)).toBe(true);
  });

  it("非官方端点时度量标为不可信", async () => {
    const { client } = fakeClient(
      [
        { kind: "ok", message: fakeMessage(chapterProse) },
        { kind: "ok", message: fakeMessage(c5Json) },
      ],
      false,
    );
    const r = await runChapter(client, new EventStream(), runInput());
    if (r.kind !== "ok") return;
    expect(r.metrics.every((m) => m.trustworthy)).toBe(false);
  });

  it("产出的事件全是 proposed，投影不受影响", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    const stream = new EventStream();
    const r = await runChapter(client, stream, runInput());
    if (r.kind !== "ok") return;
    expect(r.proposed.length).toBeGreaterThan(0);
    expect(r.proposed.every((e) => e.envelope.provenance === "proposed")).toBe(true);
    expect(stream.effective()).toHaveLength(0);

    stream.decideChapter(53, "committed");
    expect(stream.effective()).toHaveLength(r.proposed.length);
  });

  it("节拍表承诺的三条收束都声明了，无 block", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(c5Json) },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    if (r.kind !== "ok") return;
    expect(r.findings.filter((f) => f.level === "block")).toHaveLength(0);
  });

  it("漏收承诺的伏笔时产出 block", async () => {
    const missing = JSON.parse(c5Json) as Record<string, unknown>;
    missing["foreshadow_resolved"] = [];
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(JSON.stringify(missing)) },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    if (r.kind !== "ok") return;
    const blocks = r.findings.filter((f) => f.level === "block");
    expect(blocks).toHaveLength(3);
    expect(blocks[0]?.rule).toBe("resolution_missing");
  });
});

describe("runChapter：异常路径", () => {
  it("C4 被拒时返回可展示文案，不当成报错", async () => {
    const refused = fakeMessage("");
    const { client } = fakeClient([
      {
        kind: "refusal",
        message: refused,
        category: "violence",
        explanation: null,
        userMessage: "这段涉及的暴力描写超出了模型的生成范围。试试把冲突写得更间接。",
      },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    expect(r.kind).toBe("refused");
    if (r.kind !== "refused") return;
    expect(r.userMessage).toContain("更间接");
    // 拒绝也是 HTTP 200，度量照记
    expect(r.metrics).toHaveLength(1);
  });

  it("C4 返回空正文时判失败，不进 C5", async () => {
    const { client, calls } = fakeClient([{ kind: "ok", message: fakeMessage("   ") }]);
    const r = await runChapter(client, new EventStream(), runInput());
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.step).toBe("C4");
    expect(calls).toHaveLength(1);
  });

  it("C5 输出非 JSON 时判失败但保留度量", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage("这不是 JSON") },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.step).toBe("C5");
    expect(r.metrics).toHaveLength(2);
  });

  it("C5 输出被 markdown 围栏包裹时仍能解析", async () => {
    const { client } = fakeClient([
      { kind: "ok", message: fakeMessage(chapterProse) },
      { kind: "ok", message: fakeMessage(`\`\`\`json\n${c5Json}\n\`\`\``) },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    expect(r.kind).toBe("ok");
  });

  it("网络错误时返回失败并带具体信息", async () => {
    const { client } = fakeClient([
      {
        kind: "error",
        error: { type: "connection", status: null, message: "socket hang up", retryable: true },
      },
    ]);
    const r = await runChapter(client, new EventStream(), runInput());
    expect(r.kind).toBe("failed");
    if (r.kind !== "failed") return;
    expect(r.detail).toBe("socket hang up");
    // 错误不产生 usage，度量为空
    expect(r.metrics).toHaveLength(0);
  });
});
