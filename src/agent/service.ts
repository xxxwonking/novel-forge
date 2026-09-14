/**
 * 对话式主 Agent 的服务（Stage 2·切片 1；谋篇模式分支）。
 *
 * 一次 `send()`：读历史 → 拼消息 → 跑工具循环 → 落 user/agent 两条记录 → 回复。
 *
 * 几个刻意的取舍：
 *   - 历史只回放**文本**，不回放回合内的工具往返 —— 对话续接靠"之前说过什么"，
 *     持久化大段 tool_result 不值得（切片 1）。每回合起一个干净的工具循环。
 *   - 常规模式用 judge（haiku）：意图路由与短回复是判定型任务（§8.2），成本低。
 *     真正的创作（写章）在 write_next_chapter 触发的独立任务里用 creative（opus）。
 *     **谋篇模式也用 creative** —— 「不知道写什么」要的是出点子与推演，判定型模型
 *     给不出；而方案落盘不花模型钱，多出来的成本只在讨论回合。
 *   - effects 不回传给模型（它是 UI 用的副作用记录），只随 agent 回合落盘。
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions, ModelRole } from "../client/claude.js";
import type { ModelClient } from "../client/model.js";
import { MAIN_AGENT_TOOLS, PLANNING_MODE_TOOLS } from "./tools.js";
import { runAgentLoop, type MainAgentToolContext } from "./tool-exec.js";
import { buildMainAgentSystem, type MainAgentContextInfo } from "./system-prompt.js";
import type { ConversationStore } from "./conversation-store.js";
import type { ConversationMode } from "./proposal-types.js";
import type { ConversationReply, ConversationTurn } from "./types.js";

/** 回复 token 上限。API 输出规模常量（与 task/steps 同类），低于流式阈值走非流式。 */
const REPLY_MAX_TOKENS = 2048;
/** 谋篇要一口气写出摘要 + 十几条 items，输出规模比常规对话大一档。 */
const PLANNING_MAX_TOKENS = 8192;
const EMPTY_REPLY = "（我没有可回复的内容，请换个说法或把要做的事说得更具体一点。）";

/** 两种模式的差异集中在这一张表：模型角色、输出上限、工具集、轮数来源。 */
interface ModeProfile {
  readonly role: ModelRole;
  readonly maxTokens: number;
  readonly tools: readonly Anthropic.Tool[];
  readonly maxRounds: (deps: MainAgentServiceDeps) => number;
}

const MODE_PROFILE: Readonly<Record<ConversationMode, ModeProfile>> = {
  normal: { role: "judge", maxTokens: REPLY_MAX_TOKENS, tools: MAIN_AGENT_TOOLS, maxRounds: (d) => d.maxRounds },
  planning: {
    role: "creative",
    maxTokens: PLANNING_MAX_TOKENS,
    tools: PLANNING_MODE_TOOLS,
    maxRounds: (d) => d.maxPlanningRounds,
  },
};

export interface MainAgentServiceDeps {
  readonly client: ModelClient;
  readonly store: ConversationStore;
  readonly ctx: MainAgentToolContext;
  /** 每回合开始时重算的作品状态快照（写章/采用会改变它）。 */
  readonly contextInfo: () => MainAgentContextInfo;
  /** rules.agent.maxConversationRounds。 */
  readonly maxRounds: number;
  /** rules.agent.maxPlanningRounds。谋篇要先读一圈再出方案，轮数放宽。 */
  readonly maxPlanningRounds: number;
  readonly clock?: () => string;
}

export class MainAgentService {
  constructor(private readonly deps: MainAgentServiceDeps) {}

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))();
  }

  async send(userText: string): Promise<ConversationReply> {
    const text = userText.trim();
    if (text === "") throw new Error("消息不能为空");

    const history = this.deps.store.load();
    const mode = history.mode;
    const profile = MODE_PROFILE[mode];
    const messages: Anthropic.MessageParam[] = [
      ...toMessages(history.turns),
      { role: "user", content: text },
    ];
    const callOpts: CallOptions = {
      role: profile.role,
      maxTokens: profile.maxTokens,
      tools: profile.tools,
      system: buildMainAgentSystem(this.deps.contextInfo(), mode),
      messages,
    };

    const loop = await runAgentLoop(this.deps.client, callOpts, this.deps.ctx, profile.maxRounds(this.deps), mode);
    const replyText = loop.text || EMPTY_REPLY;

    const userAt = this.now();
    this.deps.store.appendTurn({ role: "user", text, at: userAt });
    this.deps.store.appendTurn({
      role: "agent",
      text: replyText,
      at: this.now(),
      ...(loop.effects.length === 0 ? {} : { effects: loop.effects }),
    });

    return { text: replyText, effects: loop.effects, toolRounds: loop.toolRounds, mode };
  }
}

/** 历史回合 → 模型消息（只带文本）。相邻同角色不合并 —— 对话天然交替。 */
function toMessages(turns: readonly ConversationTurn[]): Anthropic.MessageParam[] {
  return turns
    .filter((t) => t.text.trim() !== "")
    .map((t) => ({ role: t.role === "user" ? "user" : "assistant", content: t.text }));
}
