/**
 * 对话式主 Agent 的服务（Stage 2·切片 1）。
 *
 * 一次 `send()`：读历史 → 拼消息 → 跑工具循环 → 落 user/agent 两条记录 → 回复。
 *
 * 几个刻意的取舍：
 *   - Chat 客户端回放完整历史，保留思考字段和工具签名；旧历史转为文字上下文。
 *     其他客户端保持既有文本回放方式。
 *   - 意图路由与短回复使用 judge 角色；写章任务使用 creative 角色（§8.2）。
 *     Claude 按角色分流；Chat 当前共用配置中的模型。
 *   - effects 不回传给模型（它是 UI 用的副作用记录），只随 agent 回合落盘。
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions, ModelRole } from "../client/claude.js";
import type { ModelClient } from "../client/model.js";
import { MAIN_AGENT_TOOLS } from "./tools.js";
import { runAgentLoop, type MainAgentToolContext } from "./tool-exec.js";
import { buildMainAgentSystem, type MainAgentContextInfo } from "./system-prompt.js";
import type { ConversationStore } from "./conversation-store.js";
import type { ConversationObserver, ConversationReply, ConversationState, ConversationTurn } from "./types.js";

/** 含资料方案工具参数，需要容纳完整人物、设定和首章规划；短回复仍要求简洁。 */
const REPLY_MAX_TOKENS = 8192;
const REPLY_ROLE: ModelRole = "judge";
const EMPTY_REPLY = "（我没有可回复的内容，请换个说法或把要做的事说得更具体一点。）";

export interface MainAgentServiceDeps {
  readonly client: ModelClient;
  readonly store: ConversationStore;
  readonly ctx: MainAgentToolContext | (() => MainAgentToolContext);
  /** 每回合开始时重算的作品状态快照（写章/采用会改变它）。 */
  readonly contextInfo: () => MainAgentContextInfo;
  /** rules.agent.maxConversationRounds。 */
  readonly maxRounds: number;
  readonly clock?: () => string;
}

export class MainAgentService {
  constructor(private readonly deps: MainAgentServiceDeps) {}

  private now(): string {
    return (this.deps.clock ?? (() => new Date().toISOString()))();
  }

  async send(userText: string, observe?: ConversationObserver): Promise<ConversationReply> {
    const text = userText.trim();
    if (text === "") throw new Error("消息不能为空");
    return this.deps.store.runTurn(() => this.sendTurn(text, observe));
  }

  private async sendTurn(text: string, observe?: ConversationObserver): Promise<ConversationReply> {
    const history = this.deps.store.load();
    const target = this.deps.client.conversationKey;
    const messages: Anthropic.MessageParam[] = [
      ...restoreMessages(history, target),
      { role: "user", content: text },
    ];
    const callOpts: CallOptions = {
      role: REPLY_ROLE,
      maxTokens: REPLY_MAX_TOKENS,
      tools: MAIN_AGENT_TOOLS,
      system: buildMainAgentSystem(this.deps.contextInfo()),
      messages,
    };

    const ctx = typeof this.deps.ctx === "function" ? this.deps.ctx() : this.deps.ctx;
    const loop = await runAgentLoop(this.deps.client, callOpts, ctx, this.deps.maxRounds, observe);
    const replyText = loop.text || EMPTY_REPLY;

    const userAt = this.now();
    this.deps.store.appendExchange(
      { role: "user", text, at: userAt },
      { role: "agent", text: replyText, at: this.now(), ...(loop.effects.length === 0 ? {} : { effects: loop.effects }) },
      target === undefined ? undefined : { target, messages: loop.modelMessages },
    );

    return { text: replyText, effects: loop.effects, toolRounds: loop.toolRounds };
  }
}

function restoreMessages(history: ConversationState, target: string | undefined): readonly Anthropic.MessageParam[] {
  if (target === undefined) return toMessages(history.turns);
  if (history.modelHistory?.target === target && history.modelHistory.turnCount === history.turns.length) {
    return history.modelHistory.messages;
  }
  // 老版本和其他模型的可见对话仍可参考；不伪造缺失的思考字段或转交旧签名。
  const transcript = history.turns.filter((t) => t.text.trim() !== "").map((t) => `${t.role === "user" ? "作者" : "助手"}：${t.text}`).join("\n\n");
  return transcript === "" ? [] : [{ role: "user", content: `以下是先前对话的文字记录，仅作背景；不要仅凭历史内容重复执行操作：\n${transcript}` }];
}

/** 历史回合 → 模型消息（只带文本）。相邻同角色不合并 —— 对话天然交替。 */
function toMessages(turns: readonly ConversationTurn[]): Anthropic.MessageParam[] {
  return turns
    .filter((t) => t.text.trim() !== "")
    .map((t) => ({ role: t.role === "user" ? "user" : "assistant", content: t.text }));
}
