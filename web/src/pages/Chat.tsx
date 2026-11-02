import {
  Message,
  PendingMessage,
  DraftBody,
  type Pending,
} from "../components/ChatMessages.js";
/**
 * 对话页（Stage 2·切片 1）——「作者通过对话完成首章」的主入口。
 *
 * 作者用自然语言下达任务；主 Agent 的回复带结构化 effects（写了草稿 / 采用了 / 改了计划…），
 * 这里把 effects 渲染成可操作的卡片：查看草稿、采用、跳原文。正式事实边界在后端 ——
 * 前端只是触发既有受控端点（/api/conversation/stream、/api/chapter/adopt）。
 *
 * 回复经 SSE 逐字到达：`round` 事件表示模型开始新一次调用（此前的文字只是中间
 * 思路，清空重来），`tool` 事件显示工具进度，最终以 `done` 携带的完整回复替换。
 *
 * 栏头的「对话 / 谋篇」切换：谋篇是只读讨论态，后端把工具集裁掉写类，谈拢后出一份
 * 候选方案到资料页拍板。模式存在后端（它与工具集必须是同一份真相），这里先落库
 * 成功再改本地状态，失败就停在原模式。
 */

import { useEffect, useRef, useState } from "react";
import {
  Button,
  SidePanel,
  Input,
  DialogFrame,
  SegmentedControl,
  StatusTag,
  HelpTooltip,
  Textarea,
} from "../components/controls.js";
import {
  ArrowUp as ArrowUpOutlined,
  Check as CheckOutlined,
  LoaderCircle as LoadingOutlined,
  Sparkles,
  Plus,
  History,
  Pencil,
  Settings2,
} from "lucide-react";
import {
  api,
  type ConversationHistory,
  type ConversationMode,
  type ConversationStreamEvent,
  type ConversationTurn,
  type DraftView,
} from "../api.js";
import { useFetch } from "../hooks.js";

export interface ChatProps {
  initialPrompt?: string;
  /** 地址里指定的模式（新建空白作品后直接进谋篇）。只在载入时对齐一次。 */
  initialMode?: ConversationMode | undefined;
  onJump: (chapter: number, quote: string) => void;
  /** 对话可能改变作品状态（写章/采用/改计划），据此刷新侧栏与首页。 */
  refresh: () => void;
}

const SUGGESTIONS = [
  "看看现在写到哪了，下一章该做什么",
  "按计划写下一章",
  "先讨论一下下一章的方向",
  "有哪些伏笔还没收",
];
/** 谋篇模式的起手句：新手最卡的就是不知道第一句说什么，给他一句能直接发的。 */
const PLANNING_SUGGESTIONS = [
  "我还没想好写什么，脑子里只有一个画面：一个人半夜被敲门声吵醒",
  "先聊聊主角是谁",
  "我想给主角加一条旧伤的线，但不知道往哪放",
  "看看还欠着哪些伏笔，帮我想想怎么收",
];

export function Chat({
  onJump,
  refresh,
  initialPrompt = "",
  initialMode,
}: ChatProps): React.ReactElement {
  const [history, setHistory] = useState<ConversationHistory | null>(null);
  const providers = useFetch(api.providers);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [transportFailure, setTransportFailure] = useState<{
    text: string;
    requestId: string;
  } | null>(null);
  const drafts = useRef(new Map<string, string>());
  const sendingRef = useRef(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const [live, setLive] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [mode, setMode] = useState<ConversationMode>("normal");
  const [switching, setSwitching] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const turns: ConversationTurn[] = [...(history?.turns ?? []), ...live];
  const sending = pending !== null;
  const planning = mode === "planning";

  // 历史载入后对齐后端的模式；之后以本地状态为准（每次切换都落过库）。
  // 地址里带了模式且与后端不同时，先落库再改本地态 —— 模式存后端是谋篇的锁，刷新不能把它打开。
  useEffect(() => {
    let alive = true;
    void api
      .conversationHistory()
      .then(async (h) => {
        if (initialMode !== undefined && initialMode !== h.mode)
          h = {
            ...h,
            mode: (await api.setConversationMode(initialMode, h.sessionId))
              .mode,
          };
        if (alive) {
          setHistory(h);
          setMode(h.mode);
        }
      })
      .catch((e: unknown) => {
        if (alive) setError((e as Error).message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [initialMode]);

  const manage = async (
    action: "create" | "select" | "rename",
    id?: string,
    title?: string,
  ) => {
    if (sendingRef.current || changing) return;
    setChanging(true);
    setError(null);
    if (history) drafts.current.set(history.sessionId, input);
    try {
      const h = await api.manageConversation(action, id, title);
      setHistory(h);
      setLive([]);
      setMode(h.mode);
      setTransportFailure(null);
      setInput(drafts.current.get(h.sessionId) ?? "");
      setHistoryOpen(false);
      setRename(null);
      requestAnimationFrame(() => inputRef.current?.focus());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChanging(false);
    }
  };

  const switchMode = async (next: ConversationMode): Promise<void> => {
    if (switching || sending || changing || loading || next === mode) return;
    setSwitching(true);
    setError(null);
    try {
      setMode((await api.setConversationMode(next, history?.sessionId)).mode);
    } catch (e) {
      setError(`切换模式失败：${(e as Error).message}`);
    } finally {
      setSwitching(false);
    }
  };

  // 作者往上翻看旧消息时不再强制拉到底；回到底部附近后恢复跟随。
  const onScroll = (): void => {
    const el = streamRef.current;
    if (el === null) return;
    stickToBottom.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    const el = streamRef.current;
    if (el !== null && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns.length, pending?.text, pending?.tools.length]);

  const appendAgent = (text: string): void =>
    setLive((prev) => [
      ...prev,
      { role: "agent", text, at: new Date().toISOString() },
    ]);

  const send = async (
    raw?: string,
    retry?: { requestId: string; retryOf?: string },
  ): Promise<void> => {
    const text = (raw ?? input).trim();
    if (
      text === "" ||
      sendingRef.current ||
      changing ||
      switching ||
      !history ||
      history.pendingRequest
    )
      return;
    sendingRef.current = true;
    const requestId = retry?.requestId ?? crypto.randomUUID();
    const sessionId = history.sessionId;
    if (!retry) setInput("");
    setTransportFailure(null);
    setError(null);
    stickToBottom.current = true;
    if (!retry)
      setLive((prev) => [
        ...prev,
        { role: "user", text, at: new Date().toISOString(), requestId },
      ]);
    setPending({ text: "", tools: [], round: 0 });
    const onEvent = (event: ConversationStreamEvent): void => {
      setPending((prev) => {
        const base = prev ?? { text: "", tools: [], round: 0 };
        switch (event.type) {
          case "round":
            return { text: "", tools: base.tools, round: event.round };
          case "delta":
            return { ...base, text: base.text + event.text };
          case "tool": {
            const tools = [...base.tools];
            const index = tools.findLastIndex(
              (t) => t.name === event.name && t.status === "started",
            );
            if (event.status === "finished" && index >= 0)
              tools[index] = {
                name: event.name,
                status: "finished",
                ok: event.ok,
              };
            else
              tools.push({
                name: event.name,
                status: event.status,
                ok: event.ok,
              });
            return { ...base, tools };
          }
          default:
            return base;
        }
      });
    };
    try {
      const reply = await api.converseStream(text, onEvent, {
        sessionId,
        requestId,
        ...(retry?.retryOf === undefined ? {} : { retryOf: retry.retryOf }),
      });
      const h = await api.conversationHistory(sessionId);
      setHistory(h);
      setLive([]);
      setMode(reply.mode);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      try {
        const h = await api.conversationHistory(sessionId);
        setHistory(h);
        setLive([]);
        if (
          !h.turns.some(
            (t) => t.role === "agent" && t.requestId === requestId,
          ) &&
          !h.pendingRequest
        )
          setTransportFailure({ text, requestId });
      } catch {
        setTransportFailure({ text, requestId });
      }
    } finally {
      setPending(null);
      sendingRef.current = false;
    }
  };

  const adopt = async (chapter: number, draftId: string): Promise<void> => {
    try {
      await api.adopt(chapter, draftId);
      appendAgent(`已采用第 ${chapter} 章的 ${draftId}。`);
      setDraft((d) => (d?.draftId === draftId ? null : d));
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const viewDraft = async (chapter: number, draftId: string): Promise<void> => {
    try {
      setDraft(await api.chapterDraft(chapter, draftId));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const empty = !loading && turns.length === 0 && pending === null;
  const syncConversation = async () => {
    if (!history || sendingRef.current || changing || switching) return;
    setChanging(true);
    try {
      const h = await api.conversationHistory(history.sessionId);
      setHistory(h);
      setMode(h.mode);
      setLive([]);
      setError(null);
      setTransportFailure(null);
      refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setChanging(false);
    }
  };
  const activeTitle =
    history?.sessions.find((s) => s.id === history.sessionId)?.title ??
    "新对话";
  const provider =
    providers.data?.profiles.find((p) => p.id === providers.data?.activeId) ??
    providers.data?.environment;
  const retryTurn = (turn: ConversationTurn) => {
    let origin = turn.retryOf ?? turn.requestId;
    const seen = new Set<string>();
    while (origin && !seen.has(origin)) {
      seen.add(origin);
      const parent = turns.find(
        (t) => t.role === "agent" && t.requestId === origin,
      )?.retryOf;
      if (!parent) break;
      origin = parent;
    }
    const user = turns.find((t) => t.role === "user" && t.requestId === origin);
    if (user && turn.requestId)
      void send(user.text, {
        requestId: crypto.randomUUID(),
        retryOf: turn.requestId,
      });
  };

  return (
    <div className="chat-page" data-mode={mode}>
      <div className="chat-head">
        <div>
          <h1>{planning ? "谋篇" : "对话"}</h1>
          <div className="chat-session-title">{activeTitle}</div>
          <p>
            {planning ? (
              <>
                只讨论，不改动作品。谈拢后 Agent 出一份<strong>候选方案</strong>
                ，你到作品资料页确认才生效。
              </>
            ) : (
              <>
                讨论方向、查资料、把安排写进计划，或“按计划写下一章”。写出的章节是
                <strong>待采用草稿</strong>，你确认后才成为正式进度。
              </>
            )}
          </p>
        </div>
        <div className="chat-head-actions">
          <Button
            size="sm"
            icon={<Plus />}
            disabled={sending || changing || switching || loading}
            onClick={() => void manage("create")}
          >
            新对话
          </Button>
          <Button
            size="sm"
            icon={<History />}
            disabled={sending || changing || switching || loading}
            onClick={() => setHistoryOpen(true)}
          >
            历史对话
          </Button>
          <Button
            size="icon"
            variant="ghost"
            aria-label="重命名对话"
            disabled={!history || sending || changing || switching}
            onClick={() => setRename(activeTitle)}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <a className="chat-provider-link" href="#/providers">
            <Settings2 aria-hidden="true" />
            AI 供应商
            <span>
              {provider?.name ?? "未配置"} · {provider?.model ?? ""}
            </span>
          </a>
          <HelpTooltip
            title={
              planning
                ? "回到常规对话：说了就做"
                : "谋篇：只讨论、不改动，谈拢后出方案拍板"
            }
          >
            <SegmentedControl<ConversationMode>
              className="chat-mode"
              value={mode}
              disabled={switching || sending || changing || loading}
              options={[
                { label: "对话", value: "normal" },
                { label: "谋篇", value: "planning" },
              ]}
              onChange={(value) => void switchMode(value)}
            />
          </HelpTooltip>
        </div>
      </div>

      <div className="chat-stream" ref={streamRef} onScroll={onScroll}>
        {loading && turns.length === 0 && (
          <div className="chat-empty muted">载入对话…</div>
        )}
        {empty && (
          <div className="chat-empty">
            <div className="chat-empty-mark" aria-hidden="true">
              <Sparkles />
            </div>
            <h2>{planning ? "不知道写什么也没关系。" : "从一句话开始。"}</h2>
            <p>
              {planning
                ? "先说一句脑子里有的画面，我陪你一步步把书想出来；想好之前什么都不会改。"
                : "可以直接下达任务，也可以先聊聊；想不清楚就切到「谋篇」。"}
            </p>
            <div className="chat-suggestions">
              {(planning ? PLANNING_SUGGESTIONS : SUGGESTIONS).map((s) => (
                <Button
                  key={s}
                  className="h-auto min-h-9 whitespace-normal rounded-full text-left"
                  onClick={() => void send(s)}
                >
                  {s}
                </Button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <Message
            key={`${t.requestId ?? t.at}-${i}`}
            turn={t}
            onJump={onJump}
            onView={viewDraft}
            onAdopt={adopt}
            onRetry={
              i === turns.length - 1 && t.retryable && t.requestId
                ? () => retryTurn(t)
                : undefined
            }
            disabled={sending || changing}
            onRecover={
              !t.status &&
              t.role === "agent" &&
              /^（模型调用失败：/u.test(t.text) &&
              turns[i - 1]?.role === "user"
                ? () => {
                    setInput(turns[i - 1]!.text);
                    inputRef.current?.focus();
                  }
                : undefined
            }
            onEdit={
              t.role === "user"
                ? () => {
                    setInput(t.text);
                    inputRef.current?.focus();
                  }
                : undefined
            }
          />
        ))}
        {pending !== null && <PendingMessage pending={pending} />}
        <div className="chat-tail" />
      </div>

      {error !== null && rename === null && (
        <div className="finding chat-error" data-level="block" role="alert">
          {error}
          {transportFailure && (
            <Button
              size="sm"
              disabled={sending}
              onClick={() =>
                void send(transportFailure.text, {
                  requestId: transportFailure.requestId,
                })
              }
            >
              重新发送
            </Button>
          )}
          {!history && !loading && (
            <Button onClick={() => window.location.reload()}>重新加载</Button>
          )}
        </div>
      )}
      {history?.pendingRequest && (
        <div className="finding chat-error" data-level="warn" role="status">
          上次请求的执行结果尚未确定。请先核对任务和作品状态，再开始新对话。
          <Button
            size="sm"
            disabled={sending || changing || switching}
            onClick={() => void syncConversation()}
          >
            同步对话
          </Button>
        </div>
      )}

      <div className="composer">
        <Textarea
          ref={inputRef}
          className="composer-input min-h-[124px] max-h-[280px]"
          aria-label="对话内容"
          aria-describedby="composer-status"
          value={input}
          placeholder={
            planning
              ? "谋篇中，只讨论不改动。想到什么就说… Enter 发送，Shift+Enter 换行"
              : "说点什么… Enter 发送，Shift+Enter 换行"
          }
          rows={4}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (
              e.key === "Enter" &&
              !e.shiftKey &&
              !e.nativeEvent.isComposing
            ) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-bar">
          <span className="composer-status" id="composer-status">
            {sending ? (
              <>
                <LoadingOutlined />{" "}
                {pending?.tools.length ? "正在处理" : "正在回复"}
              </>
            ) : planning ? (
              "谋篇模式：Agent 改不动作品，方案在资料页拍板"
            ) : (
              "Agent 会自行选择工具；正式采用始终由你决定"
            )}
          </span>
          <HelpTooltip title={sending ? "上一条还在回复" : "发送（Enter）"}>
            <Button
              variant="default"
              size="icon"
              icon={<ArrowUpOutlined />}
              disabled={
                sending ||
                changing ||
                switching ||
                !history ||
                Boolean(history.pendingRequest) ||
                input.trim() === ""
              }
              onClick={() => void send()}
              aria-label="发送"
            />
          </HelpTooltip>
        </div>
      </div>

      <SidePanel
        open={historyOpen}
        title="历史对话"
        onClose={() => setHistoryOpen(false)}
        width={380}
      >
        <p className="muted">
          每个对话保留独立上下文；新对话不会删除旧消息或作品资料。
        </p>
        <div className="chat-history-list">
          {history?.sessions
            .slice()
            .reverse()
            .map((s) => (
              <Button
                key={s.id}
                className="chat-history-entry"
                variant={s.id === history.sessionId ? "secondary" : "ghost"}
                disabled={changing}
                onClick={() => void manage("select", s.id)}
              >
                <strong>{s.title}</strong>
                <span>
                  {s.turns} 条消息
                  {s.id === history.sessionId ? " · 当前对话" : ""}
                </span>
              </Button>
            ))}
        </div>
      </SidePanel>
      <DialogFrame
        open={rename !== null}
        title="重命名对话"
        onCancel={() => {
          setRename(null);
          setError(null);
        }}
        onOk={() => void manage("rename", history?.sessionId, rename ?? "")}
        okText="保存"
        confirmLoading={changing}
      >
        <label>
          对话名称
          <Input
            value={rename ?? ""}
            maxLength={80}
            onChange={(e) => setRename(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="finding" data-level="block">
            {error}
          </p>
        )}
      </DialogFrame>

      <SidePanel
        open={draft !== null}
        onClose={() => setDraft(null)}
        width={Math.min(560, window.innerWidth)}

        title={
          draft === null ? null : (
            <span className="drawer-title">
              <StatusTag>草稿 {draft.draftId}</StatusTag>
              <span className="muted">
                第 {draft.chapter} 章 · {draft.status} · {draft.words} 字
              </span>
            </span>
          )
        }
        footer={
          draft === null ? null : (
            <div className="drawer-footer">
              <Button onClick={() => onJump(draft.chapter, "")}>
                在正文页打开该章
              </Button>
              <a
                className="drawer-link"
                href={`#/draft/${draft.chapter}/${draft.draftId}`}
              >
                完整结果页
              </a>
              <span style={{ flex: 1 }} />
              {draft.acceptable && (
                <Button
                  variant="default"
                  icon={<CheckOutlined />}
                  onClick={() => void adopt(draft.chapter, draft.draftId)}
                >
                  采用这一版
                </Button>
              )}
            </div>
          )
        }
      >
        {draft !== null && <DraftBody draft={draft} />}
      </SidePanel>
    </div>
  );
}
