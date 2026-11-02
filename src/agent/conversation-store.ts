/**
 * 对话历史与备选想法的持久化（Stage 2·切片 1）。
 *
 * 放在 `src/agent/` 而非 `src/store/`：对话是**主 Agent 领域**的产物，与小说事件流
 * （正式事实的唯一真源）分开 —— 对话里说了什么不等于作品里发生了什么。落盘布局：
 *   conversation.json 保留旧turns，并增加sessions、activeId；ideas全作品共享。
 *
 * 整份原子更新，让可见回合、模型历史和 ideas 保持对应。完整模型历史会随对话增长，
 * 会话独立保留上下文，目前没有自动压缩或跨进程锁。
 */

import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { randomUUID } from "node:crypto";
import type { IsoTimestamp } from "../types/primitives.js";
import type {
  AlternativeIdea,
  ConversationMode,
  ConversationModelHistory,
  ConversationState,
  ConversationTurn,
} from "./types.js";

const FILE = "conversation.json";
const EMPTY: ConversationState = { turns: [], ideas: [], mode: "normal" };
interface StoredSession extends ConversationState {
  readonly id: string;
  readonly title?: string;
}
interface Document extends ConversationState {
  readonly activeId?: string;
  readonly sessions?: readonly StoredSession[];
  readonly title?: string;
}

export class ConversationStore {
  constructor(
    private readonly root: string,
    private readonly selected?: string,
    private readonly queue = { tail: Promise.resolve() },
  ) {}

  sessionId(): string {
    return this.selected ?? this.readDocument().activeId ?? "legacy";
  }
  forSession(id = this.sessionId()): ConversationStore {
    if (
      id !== "legacy" &&
      !this.readDocument().sessions?.some((s) => s.id === id)
    )
      throw new Error("对话不存在，请重新选择");
    return new ConversationStore(this.root, id, this.queue);
  }
  listSessions(): {
    id: string;
    title: string;
    turns: number;
    updatedAt: string | null;
  }[] {
    const doc = this.readDocument();
    return [{ ...doc, id: "legacy" }, ...(doc.sessions ?? [])].map((s) => ({
      id: s.id,
      title:
        s.title ??
        s.turns.find((t) => t.role === "user")?.text.slice(0, 36) ??
        "新对话",
      turns: s.turns.length,
      updatedAt: s.turns.at(-1)?.at ?? null,
    }));
  }
  createSession(title?: string): string {
    if (title !== undefined && (!title.trim() || title.length > 80))
      throw new Error("对话名称需要1–80个字符");
    const doc = this.readDocument(),
      id = randomUUID();
    this.writeDocument({
      ...doc,
      activeId: id,
      sessions: [
        ...(doc.sessions ?? []),
        {
          ...EMPTY,
          id,
          ...(title === undefined ? {} : { title: title.trim() }),
        },
      ],
    });
    return id;
  }
  selectSession(id: string): void {
    this.forSession(id);
    this.writeDocument({ ...this.readDocument(), activeId: id });
  }
  renameSession(id: string, title: string): void {
    if (!title.trim() || title.length > 80)
      throw new Error("对话名称需要1–80个字符");
    this.forSession(id);
    const doc = this.readDocument();
    this.writeDocument(
      id === "legacy"
        ? { ...doc, title: title.trim() }
        : {
            ...doc,
            sessions: doc.sessions!.map((s) =>
              s.id === id ? { ...s, title: title.trim() } : s,
            ),
          },
    );
  }
  beginRequest(id: string, text: string): void {
    this.save({
      ...this.load(),
      pendingRequest: { id, text, at: new Date().toISOString() },
    });
  }

  /** 仅缺失文件返回空态；坏的可见历史必须报错，不能被下一次保存静默覆盖。 */
  load(): ConversationState {
    const doc = this.readDocument(),
      id = this.selected ?? doc.activeId ?? "legacy";
    if (id === "legacy") return doc;
    const state = doc.sessions?.find((s) => s.id === id);
    if (!state) throw new Error("对话不存在，请重新选择");
    return { ...state, ideas: doc.ideas };
  }

  private readDocument(): Document {
    try {
      const text = readProjectFile(this.root, FILE);
      if (text === undefined) return EMPTY;
      const raw = JSON.parse(text) as Partial<Document> | null;
      if (
        raw === null ||
        !Array.isArray(raw.turns) ||
        !raw.turns.every(validTurn) ||
        !Array.isArray(raw.ideas) ||
        !raw.ideas.every(validIdea)
      )
        throw new Error("turns / ideas 结构无效");
      if (new Set(raw.ideas.map((idea) => idea.id)).size !== raw.ideas.length)
        throw new Error("备选想法 ID 重复");
      const modelHistory = readModelHistory(raw.modelHistory);
      if (!validPending(raw.pendingRequest))
        throw new Error("请求收据结构无效");
      if (
        raw.sessions !== undefined &&
        (!Array.isArray(raw.sessions) ||
          raw.sessions.some(
            (s) =>
              !record(s) ||
              typeof s.id !== "string" ||
              !/^[a-zA-Z0-9_-]{1,80}$/u.test(s.id) ||
              s.id === "legacy" ||
              !Array.isArray(s.turns) ||
              !s.turns.every(validTurn) ||
              !Array.isArray(s.ideas) ||
              !s.ideas.every(validIdea) ||
              !validPending(s.pendingRequest) ||
              (s.mode !== "normal" && s.mode !== "planning"),
          ) ||
          new Set(raw.sessions.map((s) => s.id)).size !== raw.sessions.length)
      )
        throw new Error("会话列表结构无效");
      if (
        raw.activeId !== undefined &&
        raw.activeId !== "legacy" &&
        !raw.sessions?.some((s) => s.id === raw.activeId)
      )
        throw new Error("当前会话不存在");
      const { modelHistory: _invalid, ...safe } = raw;
      return {
        ...safe,
        ...(raw.sessions === undefined
          ? {}
          : {
              sessions: raw.sessions.map((s) => {
                const { modelHistory: _bad, ...rest } = s;
                const history = readModelHistory(s.modelHistory);
                return {
                  ...rest,
                  ...(history === undefined ? {} : { modelHistory: history }),
                };
              }),
            }),
        turns: raw.turns,
        ideas: raw.ideas,
        // 旧文件没有 mode：默认常规模式，锁是要显式打开的。
        mode: raw.mode === "planning" ? "planning" : "normal",
        ...(modelHistory === undefined ? {} : { modelHistory }),
      };
    } catch (error) {
      throw new Error(
        `${FILE} 读取失败：${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  }

  private save(state: ConversationState): void {
    const doc = this.readDocument(),
      id = this.selected ?? doc.activeId ?? "legacy";
    const { pendingRequest: _old, modelHistory: _oldHistory, ...legacy } = doc;
    this.writeDocument(
      id === "legacy"
        ? { ...legacy, ...state }
        : {
            ...doc,
            ideas: state.ideas,
            sessions: doc.sessions!.map((s) => {
              const {
                pendingRequest: _pending,
                modelHistory: _history,
                ...rest
              } = s;
              return s.id === id ? { ...rest, ...state } : s;
            }),
          },
    );
  }
  private writeDocument(state: Document): void {
    writeProjectFile(this.root, FILE, `${JSON.stringify(state, null, 2)}\n`);
  }

  /** 一个 ProjectSession 内串行处理对话，防止模型历史与可见回合交错。不是跨进程锁。 */
  runTurn<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.tail.then(work);
    this.queue.tail = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  /** 一次保存完整回合，重新读取以保留本轮工具刚记录的 ideas。 */
  appendExchange(
    user: ConversationTurn,
    agent: ConversationTurn,
    model?: Omit<ConversationModelHistory, "turnCount">,
    retry = false,
  ): void {
    const state = this.load();
    const turns = [...state.turns, ...(retry ? [] : [user]), agent];
    const {
      pendingRequest: _pending,
      modelHistory: _oldHistory,
      ...rest
    } = state;
    this.save({
      ...rest,
      turns,
      ideas: state.ideas,
      mode: state.mode,
      ...(model === undefined
        ? {}
        : { modelHistory: { ...model, turnCount: turns.length } }),
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
    const maxSeq = state.ideas.reduce(
      (m, i) => Math.max(m, ideaSequence(i.id)),
      0,
    );
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
    if (state.pendingRequest)
      throw new Error("对话仍在处理或执行结果尚未确定，暂不能切换模式");
    if (state.mode !== mode) this.save({ ...state, mode });
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validPending(value: unknown): boolean {
  return (
    value === undefined ||
    (record(value) &&
      typeof value.id === "string" &&
      /^[a-zA-Z0-9_-]{1,80}$/u.test(value.id) &&
      typeof value.text === "string" &&
      typeof value.at === "string")
  );
}

function validTurn(value: unknown): value is ConversationTurn {
  return (
    record(value) &&
    (value.role === "user" || value.role === "agent") &&
    typeof value.text === "string" &&
    typeof value.at === "string" &&
    [value.requestId, value.retryOf].every(
      (id) =>
        id === undefined ||
        (typeof id === "string" && /^[a-zA-Z0-9_-]{1,80}$/u.test(id)),
    ) &&
    (value.status === undefined ||
      value.status === "failed" ||
      value.status === "incomplete") &&
    (value.retryable === undefined || typeof value.retryable === "boolean") &&
    (value.effects === undefined ||
      (Array.isArray(value.effects) &&
        value.effects.every(
          (effect: unknown) =>
            record(effect) && typeof effect.kind === "string",
        )))
  );
}

function validIdea(value: unknown): value is AlternativeIdea {
  return (
    record(value) &&
    typeof value.id === "string" &&
    value.id !== "" &&
    typeof value.text === "string" &&
    typeof value.at === "string"
  );
}

function readModelHistory(
  value: unknown,
): ConversationModelHistory | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const history = value as Partial<ConversationModelHistory>;
  if (
    typeof history.target !== "string" ||
    history.target === "" ||
    typeof history.turnCount !== "number" ||
    !Number.isSafeInteger(history.turnCount) ||
    history.turnCount < 0 ||
    !Array.isArray(history.messages)
  )
    return undefined;
  if (history.turnCount > 0 && history.messages.length === 0) return undefined;
  if (
    !history.messages.every((m: unknown) => {
      if (typeof m !== "object" || m === null) return false;
      const message = m as Record<string, unknown>;
      return (
        (message.role === "user" || message.role === "assistant") &&
        (typeof message.content === "string" || Array.isArray(message.content))
      );
    })
  )
    return undefined;
  return history as ConversationModelHistory;
}

function ideaSequence(id: string): number {
  return Number(/^idea(\d+)$/u.exec(id)?.[1] ?? 0);
}
