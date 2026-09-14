/**
 * 对话历史与备选想法的持久化（Stage 2·切片 1）。
 *
 * 放在 `src/agent/` 而非 `src/store/`：对话是**主 Agent 领域**的产物，与小说事件流
 * （正式事实的唯一真源）分开 —— 对话里说了什么不等于作品里发生了什么。落盘布局：
 *   conversation.json   { turns, ideas }，随 data/ 一起不入 git
 *
 * 整份重写而非追加：一次对话的体量远小于事件流，且要与 ideas 一起原子更新；
 * append-only 的复杂度在这里不值得。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IsoTimestamp } from "../types/primitives.js";
import type { ConversationMode } from "./proposal-types.js";
import type { AlternativeIdea, ConversationState, ConversationTurn } from "./types.js";

const FILE = "conversation.json";
const EMPTY: ConversationState = { turns: [], ideas: [], mode: "normal" };

export class ConversationStore {
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
      return {
        turns: Array.isArray(raw.turns) ? raw.turns : [],
        ideas: Array.isArray(raw.ideas) ? raw.ideas : [],
        // 旧文件没有 mode 字段：默认常规模式，锁是要显式打开的。
        mode: raw.mode === "planning" ? "planning" : "normal",
      };
    } catch {
      return EMPTY;
    }
  }

  private save(state: ConversationState): void {
    mkdirSync(this.root, { recursive: true });
    writeFileSync(this.path(), `${JSON.stringify(state, null, 2)}\n`, "utf8");
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

function ideaSequence(id: string): number {
  return Number(/^idea(\d+)$/u.exec(id)?.[1] ?? 0);
}
