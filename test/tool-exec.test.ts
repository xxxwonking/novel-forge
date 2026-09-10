/**
 * 工具执行与工具循环的测试。用假客户端，不打真实 API。
 */

import { describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import {
  executeToolUse,
  runToolLoop,
  type ToolContext,
  type ToolLoopResult,
} from "../src/task/tool-exec.js";
import { textOf } from "../src/chapter/pipeline.js";
import { ClaudeClient, type CallOptions, type CallResult } from "../src/client/claude.js";
import type { DraftProposal } from "../src/task/types.js";

function toolUseMessage(
  uses: readonly { id: string; name: string; input: unknown }[],
): Anthropic.Message {
  return {
    id: "msg_tool",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: uses.map((u) => ({ type: "tool_use", id: u.id, name: u.name, input: u.input })),
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  } as unknown as Anthropic.Message;
}

function textMessage(text: string): Anthropic.Message {
  return {
    id: "msg_text",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text, citations: [] }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
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

function makeCtx(overrides: Partial<ToolContext> = {}): {
  ctx: ToolContext;
  proposals: DraftProposal[];
} {
  const proposals: DraftProposal[] = [];
  const ctx: ToolContext = {
    loadCharacter: (name) => (name === "李长风" ? "李长风：断剑门弟子，惯用左手。" : null),
    loadSetting: (name) => (name === "青州城" ? "三州交界的商埠，城内不许动武。" : null),
    loadChapter: (n, excerpt) => (n === 1 ? `第一章正文(${excerpt})` : null),
    listOpenForeshadows: (w) => `未收伏笔(${w})：生锈的钥匙。`,
    onPropose: (p) => proposals.push(p),
    ...overrides,
  };
  return { ctx, proposals };
}

function toolUseBlock(name: string, input: unknown, id = "tu_1"): Anthropic.ToolUseBlock {
  return { type: "tool_use", id, name, input } as unknown as Anthropic.ToolUseBlock;
}

describe("executeToolUse", () => {
  it("读工具命中：回传内容，非 is_error", () => {
    const { ctx } = makeCtx();
    const r = executeToolUse(toolUseBlock("load_character", { name: "李长风" }), ctx);
    expect(r.tool_use_id).toBe("tu_1");
    expect(r.is_error).toBeUndefined();
    expect(r.content).toContain("断剑门弟子");
  });

  it("读工具未命中：is_error 且带可读原因", () => {
    const { ctx } = makeCtx();
    const r = executeToolUse(toolUseBlock("load_character", { name: "查无此人" }), ctx);
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("未找到人物");
  });

  it("load_chapter 缺章号 → is_error", () => {
    const { ctx } = makeCtx();
    const r = executeToolUse(toolUseBlock("load_chapter", {}), ctx);
    expect(r.is_error).toBe(true);
  });

  it("提议工具：记录进 sink 并给回执", () => {
    const { ctx, proposals } = makeCtx();
    const r = executeToolUse(
      toolUseBlock("propose_foreshadow", {
        label: "血刀令",
        intent: "第十章揭示是伪造",
        weight: "sub",
        expected_by: 10,
      }),
      ctx,
    );
    expect(r.is_error).toBeUndefined();
    expect(proposals).toHaveLength(1);
    expect(proposals[0]).toMatchObject({ kind: "foreshadow", label: "血刀令", weight: "sub", expectedBy: 10 });
  });

  it("提议工具非法 weight → is_error，不记录", () => {
    const { ctx, proposals } = makeCtx();
    const r = executeToolUse(
      toolUseBlock("propose_foreshadow", { label: "x", intent: "y", weight: "巨", expected_by: 9 }),
      ctx,
    );
    expect(r.is_error).toBe(true);
    expect(proposals).toHaveLength(0);
  });

  it("未知工具 → is_error", () => {
    const { ctx } = makeCtx();
    const r = executeToolUse(toolUseBlock("rm_rf", {}), ctx);
    expect(r.is_error).toBe(true);
    expect(r.content).toContain("未知工具");
  });
});

describe("runToolLoop", () => {
  const callOpts: CallOptions = {
    role: "creative",
    maxTokens: 1000,
    messages: [{ role: "user", content: "写第一章" }],
  };

  it("先调工具再出正文：执行工具、appendTurn、返回最终正文", async () => {
    const { client, calls } = fakeClient([
      { kind: "ok", message: toolUseMessage([{ id: "tu_1", name: "load_character", input: { name: "李长风" } }]) },
      { kind: "ok", message: textMessage("正文：李长风提剑上前。") },
    ]);
    const { ctx } = makeCtx();

    const r: ToolLoopResult = await runToolLoop(client, callOpts, ctx, 6);

    expect(r.result.kind).toBe("ok");
    expect(r.hitCap).toBe(false);
    expect(r.toolRounds).toBe(1);
    if (r.result.kind === "ok") expect(textOf(r.result.message)).toContain("李长风提剑上前");
    expect(calls).toHaveLength(2);
    // 第二次调用的消息里带上了第一轮的 assistant 响应 + tool_result（单条 user）。
    const second = calls[1]!.messages;
    expect(second.at(-1)).toMatchObject({ role: "user" });
    const lastContent = second.at(-1)!.content as Anthropic.ToolResultBlockParam[];
    expect(lastContent[0]).toMatchObject({ type: "tool_result", tool_use_id: "tu_1" });
  });

  it("达到轮数上限即停并置 hitCap", async () => {
    const stuck = { kind: "ok", message: toolUseMessage([{ id: "t", name: "load_setting", input: { name: "青州城" } }]) } as const;
    const { client, calls } = fakeClient([stuck, stuck, stuck, stuck]);
    const { ctx } = makeCtx();

    const r = await runToolLoop(client, callOpts, ctx, 1);

    expect(r.hitCap).toBe(true);
    expect(r.toolRounds).toBe(1);
    expect(calls).toHaveLength(2); // 第 1 次得到 tool_use → 执行；第 2 次仍 tool_use 但已达上限
  });

  it("透传拒绝：不进循环", async () => {
    const { client, calls } = fakeClient([
      { kind: "refusal", message: textMessage(""), category: "violence", explanation: null, userMessage: "无法生成" },
    ]);
    const { ctx } = makeCtx();

    const r = await runToolLoop(client, callOpts, ctx, 6);

    expect(r.result.kind).toBe("refusal");
    expect(r.toolRounds).toBe(0);
    expect(calls).toHaveLength(1);
  });
});
