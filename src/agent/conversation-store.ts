/**
 * 对话历史与备选想法的持久化（Stage 2·切片 1）。
 *
 * 放在 `src/agent/` 而非 `src/store/`：对话是**主 Agent 领域**的产物，与小说事件流
 * （正式事实的唯一真源）分开 —— 对话里说了什么不等于作品里发生了什么。落盘布局：
 *   conversation.json   { turns, ideas, modelHistory? }，随 data/ 一起不入 git
 *
 * 整份原子更新，让可见回合、模型历史和 ideas 保持对应。完整模型历史会随对话增长，
 * 当前没有自动压缩或分段归档。
 */

import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import type { IsoTimestamp } from "../types/primitives.js";
import type { AlternativeIdea, ConversationMode, ConversationModelHistory, ConversationState, ConversationTurn } from "./types.js";

const FILE = "conversation.json";
const EMPTY: ConversationState = { turns: [], ideas: [], mode: "normal" };

export class ConversationStore {
  private turnQueue: Promise<void> = Promise.resolve();
  constructor(private readonly root: string) {}

  /** 仅缺失文件返回空态；坏的可见历史必须报错，不能被下一次保存静默覆盖。 */
  load(): ConversationState {
    try {
      const text = readProjectFile(this.root, FILE);
      if (text === undefined) return EMPTY;
      const raw = JSON.parse(text) as Partial<ConversationState> | null;
      if (raw === null || !Array.isArray(raw.turns) || !raw.turns.every(validTurn) || !Array.isArray(raw.ideas) || !raw.ideas.every(validIdea)) throw new Error("turns / ideas 结构无效");
      if (new Set(raw.ideas.map((idea) => idea.id)).size !== raw.ideas.length) throw new Error("备选想法 ID 重复");
      const modelHistory = readModelHistory(raw.modelHistory);
      return {
        turns: raw.turns,
        ideas: raw.ideas,
        // 旧文件没有 mode：默认常规模式，锁是要显式打开的。
        mode: raw.mode === "planning" ? "planning" : "normal",
        ...(modelHistory === undefined ? {} : { modelHistory }),
      };
    } catch (error) {
      throw new Error(`${FILE} 读取失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  private save(state: ConversationState): void {
    writeProjectFile(this.root, FILE, `${JSON.stringify(state, null, 2)}\n`);
  }

  /** 一个 ProjectSession 内串行处理对话，防止模型历史与可见回合交错。不是跨进程锁。 */
  runTurn<T>(work: () => Promise<T>): Promise<T> {
    const next = this.turnQueue.then(work);
    this.turnQueue = next.then(() => {}, () => {});
    return next;
  }

  /** 一次保存完整回合，重新读取以保留本轮工具刚记录的 ideas。 */
  appendExchange(user: ConversationTurn, agent: ConversationTurn, model?: Omit<ConversationModelHistory, "turnCount">): void {
    const state = this.load();
    const turns = [...state.turns, user, agent];
    this.save({
      turns,
      ideas: state.ideas,
      mode: state.mode,
      ...(model === undefined ? {} : { modelHistory: { ...model, turnCount: turns.length } }),
    });
  }

  /** 追加一条对话记录（user 或 agent）。 */
  appendTurn(turn: ConversationTurn): void {
    const state = this.load();
    this.save({ ...state, turns: [...state.turns, turn] });
  }

  /** 记一条备选想法，返回创建的条目。id 取已有最大序号 +1，缺口不覆盖旧条目。 */
  recordIdea(text: string, at: IsoTimestamp): AlternativeIdea {
    const state = this.load();
    const maxSeq = state.ideas.reduce((m, i) => Math.max(m, ideaSequence(i.id)), 0);
    const idea: AlternativeIdea = { id: `idea${maxSeq + 1}`, text, at };
    this.save({ ...state, ideas: [...state.ideas, idea] });
    return idea;
  }

  listIdeas(): readonly AlternativeIdea[] {
    return this.load().ideas;
  }

  mode(): ConversationMode {
    return this.load().mode;
  }

  setMode(mode: ConversationMode): void {
    const state = this.load();
    if (state.mode !== mode) this.save({ ...state, mode });
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validTurn(value: unknown): value is ConversationTurn {
  return record(value) && (value.role === "user" || value.role === "agent") && typeof value.text === "string" && typeof value.at === "string" &&
    (value.effects === undefined || (Array.isArray(value.effects) && value.effects.every((effect: unknown) => record(effect) && typeof effect.kind === "string")));
}

function validIdea(value: unknown): value is AlternativeIdea {
  return record(value) && typeof value.id === "string" && value.id !== "" && typeof value.text === "string" && typeof value.at === "string";
}

function readModelHistory(value: unknown): ConversationModelHistory | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const history = value as Partial<ConversationModelHistory>;
  if (typeof history.target !== "string" || history.target === "" || typeof history.turnCount !== "number" || !Number.isSafeInteger(history.turnCount) || history.turnCount < 0 || !Array.isArray(history.messages)) return undefined;
  if (history.turnCount > 0 && history.messages.length === 0) return undefined;
  if (!history.messages.every((m: unknown) => {
    if (typeof m !== "object" || m === null) return false;
    const message = m as Record<string, unknown>;
    return (message.role === "user" || message.role === "assistant") && (typeof message.content === "string" || Array.isArray(message.content));
  })) return undefined;
  return history as ConversationModelHistory;
}

function ideaSequence(id: string): number {
  return Number(/^idea(\d+)$/u.exec(id)?.[1] ?? 0);
}
