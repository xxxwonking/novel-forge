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

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { IsoTimestamp } from "../types/primitives.js";
import type { AlternativeIdea, ConversationModelHistory, ConversationState, ConversationTurn } from "./types.js";

const FILE = "conversation.json";
const EMPTY: ConversationState = { turns: [], ideas: [] };

export class ConversationStore {
  private turnQueue: Promise<void> = Promise.resolve();
  constructor(private readonly root: string) {}

  private path(): string {
    return join(this.root, FILE);
  }

  /** 读整份对话状态。文件不存在或损坏时返回空态（新作品或首次对话）。 */
  load(): ConversationState {
    const p = this.path();
    if (!existsSync(p)) return EMPTY;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<ConversationState>;
      const modelHistory = readModelHistory(raw.modelHistory);
      return {
        turns: Array.isArray(raw.turns) ? raw.turns : [],
        ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
        ...(modelHistory === undefined ? {} : { modelHistory }),
      };
    } catch {
      return EMPTY;
    }
  }

  private save(state: ConversationState): void {
    mkdirSync(this.root, { recursive: true });
    const temporary = join(this.root, `${FILE}.${randomUUID()}.tmp`);
    try {
      writeFileSync(temporary, `${JSON.stringify(state, null, 2)}\n`, "utf8");
      renameSync(temporary, this.path());
    } finally {
      rmSync(temporary, { force: true });
    }
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
