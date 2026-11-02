import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import {
  executeMainTool,
  runAgentLoop,
  type MainAgentToolContext,
} from "../src/agent/tool-exec.js";
import {
  buildMainAgentSystem,
  planningScopeOf,
} from "../src/agent/system-prompt.js";
import {
  fakeClient,
  modelMessage,
  modelText,
  writingSnapshot,
  NO_MODEL_REVIEW,
} from "./writing-fixtures.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function fixture(client?: ReturnType<typeof fakeClient>["client"]) {
  const root = mkdtempSync(join(tmpdir(), "nf-agent-recovery-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return new ProjectSession(root, NO_MODEL_REVIEW, client ? { client } : {});
}
const tool = (name: string, input: unknown): Anthropic.ToolUseBlock =>
  ({ type: "tool_use", id: "t1", name, input }) as Anthropic.ToolUseBlock;
it("已完结标记进入主提示和读工具，不把下一章缺计划或开放伏笔当成未完结", async () => {
  const { client, calls } = fakeClient([
    {
      kind: "ok",
      message: modelMessage([tool("get_preparation", {})], "tool_use"),
    },
    modelText("已完结"),
  ]);
  const session = fixture(client);
  session.setWorkCompleted(true);
  await session.converse("这本书完结了吗");
  expect(calls[0]?.system?.[0]?.text).toContain("已完结");
  const result = calls[1]!.messages
    .flatMap((m) => (typeof m.content === "string" ? [] : m.content))
    .find((b) => b.type === "tool_result");
  expect(
    result?.type === "tool_result" && JSON.parse(String(result.content)),
  ).toMatchObject({
    completed: true,
    availableResolutions: expect.arrayContaining([
      expect.objectContaining({ id: "F02", weight: "sub" }),
    ]),
  });
  const info = {
    title: "完本",
    genre: "mystery",
    platform: "unpublished",
    currentChapter: 2,
    nextChapter: 3,
    nextPlanReady: false,
    pendingDrafts: 0,
    completed: true,
    readinessMissing: ["第3章计划"],
  };
  expect(planningScopeOf(info)).toBe("revision");
  expect(buildMainAgentSystem(info)[0]?.text).toContain("开放伏笔不能推翻");
});
it("空删除对象只在Agent边界作为无操作省略，实际删除与域校验保留", async () => {
  const propose = vi.fn(async (input: unknown) => ({
    message: JSON.stringify(input),
  }));
  const ctx = {
    proposePreparation: propose,
  } as unknown as MainAgentToolContext;
  await executeMainTool(
    tool("propose_preparation", {
      summary: "候选",
      changes: { settings: [], removals: {} },
    }),
    ctx,
  );
  expect(propose.mock.calls[0]?.[0]).toMatchObject({
    changes: { settings: [] },
  });
  expect((propose.mock.calls[0]?.[0] as any).changes).not.toHaveProperty(
    "removals",
  );
  await executeMainTool(
    tool("propose_preparation", {
      changes: { removals: { settings: ["S01"] } },
    }),
    ctx,
  );
  expect((propose.mock.calls[1]?.[0] as any).changes.removals.settings).toEqual(
    ["S01"],
  );
});
it("候选一次反馈缺地点与伏笔实际权重，正确的同方案依赖可保存且不确认", () => {
  const session = fixture(),
    base = writingSnapshot().beats.find((b) => b.chapter === 3)!;
  const input = {
    summary: "下一章候选",
    baseFingerprint: session.preparation.fingerprint(),
    changes: {
      beats: [
        {
          chapter: 3,
          volume: 1,
          plan: {
            ...base.plan,
            locations: ["S_Missing"],
            resolves: [
              { foreshadowId: "F02", weight: "main", completeness: "full" },
            ],
          },
        },
      ],
    },
  };
  let error = "";
  try {
    session.preparation.propose(input);
  } catch (e) {
    error = (e as Error).message;
  }
  expect(error).toContain("S_Missing");
  expect(error).toContain("F02");
  expect(error).toContain("sub");
  const corrected = structuredClone(input);
  corrected.changes.beats[0]!.plan.resolves[0]!.weight = "sub";
  const proposal = session.preparation.propose({
    ...corrected,
    changes: {
      ...corrected.changes,
      settings: [
        {
          id: "S_Missing",
          name: "后井",
          kind: "location",
          description: "候选地点",
          facts: [],
        },
      ],
    },
  });
  expect(proposal.status).toBe("proposed");
  expect(session.meta.settings.some((s) => s.id === "S_Missing")).toBe(false);
});
it("同一参数反复失败不重复执行，停止摘要保留具体原因而非责怪作者含糊", async () => {
  const propose = vi.fn(async () => ({
    message: "F02是sub支线，请按sub提交",
    effect: {
      kind: "action_failed" as const,
      tool: "propose_preparation",
      message: "F02是sub支线，请按sub提交",
    },
  }));
  let calls = 0;
  const client = {
    official: false,
    call: async () => {
      calls++;
      return {
        kind: "ok" as const,
        message: modelMessage(
          [tool("propose_preparation", { changes: { beats: [] } })],
          "tool_use",
        ),
      };
    },
  };
  const ctx = {
    proposePreparation: propose,
    getChapterText: () => null,
    getChapterDraft: () => "",
  } as unknown as MainAgentToolContext;
  const result = await runAgentLoop(
    client,
    {
      role: "judge",
      maxTokens: 100,
      messages: [{ role: "user", content: "继续推进" }],
    },
    ctx,
    8,
  );
  expect(propose).toHaveBeenCalledTimes(1);
  expect(calls).toBe(2);
  expect(result.text).toContain("F02");
  expect(result.text).toContain("sub");
  expect(result.text).not.toContain("说得更具体");
});
it("达到既有轮数上限时保留成功与失败记录，不再额外请求模型总结", async () => {
  const { client, calls } = fakeClient([
    {
      kind: "ok",
      message: modelMessage(
        [tool("propose_preparation", { summary: "建议" })],
        "tool_use",
      ),
    },
    {
      kind: "ok",
      message: modelMessage([tool("get_overview", {})], "tool_use"),
    },
  ]);
  const ctx = {
    proposePreparation: async () => ({
      message: "已保存",
      effect: {
        kind: "preparation_proposed" as const,
        proposalId: "p1",
        summary: "第3章候选",
      },
    }),
    getChapterText: () => null,
    getChapterDraft: () => "",
  } as unknown as MainAgentToolContext;
  const result = await runAgentLoop(
    client,
    { role: "judge", maxTokens: 100, messages: [] },
    ctx,
    1,
  );
  expect(result.hitCap).toBe(true);
  expect(result.text).toContain("第3章候选");
  expect(result.text).toContain("候选");
  expect(calls).toHaveLength(2);
});
