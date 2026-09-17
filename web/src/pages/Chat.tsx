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
import { Button, Drawer, Input, Segmented, Tag, Tooltip } from "antd";
import { ArrowUpOutlined, CheckOutlined, CloseOutlined, LoadingOutlined } from "@ant-design/icons";
import { api, type AgentEffect, type ConversationMode, type ConversationStreamEvent, type ConversationTurn, type DraftView } from "../api.js";
import { useFetch } from "../hooks.js";

export interface ChatProps {
  initialPrompt?: string;
  /** 地址里指定的模式（新建空白作品后直接进谋篇）。只在载入时对齐一次。 */
  initialMode?: ConversationMode | undefined;
  onJump: (chapter: number, quote: string) => void;
  /** 对话可能改变作品状态（写章/采用/改计划），据此刷新侧栏与首页。 */
  refresh: () => void;
}

interface ToolTrace { name: string; status: "started" | "finished"; ok: boolean }
interface Pending { text: string; tools: ToolTrace[]; round: number }

const TOOL_LABELS: Readonly<Record<string, string>> = {
  get_overview: "查看作品概览", get_next_plan: "读取下一章计划", get_chapter_text: "读取章节正文", get_character: "查看人物资料",
  list_open_foreshadows: "查看未收伏笔", list_chapter_drafts: "查看草稿列表", get_chapter_draft: "读取草稿", get_preparation: "读取作品资料",
  get_story_progress: "查看故事进度", list_chapter_tasks: "查看任务", propose_preparation: "拟定资料方案", confirm_preparation: "确认资料方案",
  record_author_details: "记录作者设定", write_next_chapter: "提交写章任务", revise_chapter_draft: "提交修订任务", correct_draft_structure: "纠正结构记录",
  check_chapter_draft: "检查草稿", control_chapter_task: "控制任务", adopt_chapter: "采用章节", plan_add_to_chapter: "写入章节计划",
  plan_reschedule_foreshadow: "改期伏笔", plan_abandon_foreshadow: "放弃伏笔", record_alternative_idea: "记为备选", prepare_text_export: "准备导出",
};

const SUGGESTIONS = ["看看现在写到哪了，下一章该做什么", "按计划写下一章", "先讨论一下下一章的方向", "有哪些伏笔还没收"];
/** 谋篇模式的起手句：新手最卡的就是不知道第一句说什么，给他一句能直接发的。 */
const PLANNING_SUGGESTIONS = ["我还没想好写什么，脑子里只有一个画面：一个人半夜被敲门声吵醒", "先聊聊主角是谁", "我想给主角加一条旧伤的线，但不知道往哪放", "看看还欠着哪些伏笔，帮我想想怎么收"];

export function Chat({ onJump, refresh, initialPrompt = "", initialMode }: ChatProps): React.ReactElement {
  const history = useFetch(() => api.conversationHistory(), []);
  const [live, setLive] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const [mode, setMode] = useState<ConversationMode>("normal");
  const [switching, setSwitching] = useState(false);
  const streamRef = useRef<HTMLDivElement | null>(null);
  const stickToBottom = useRef(true);

  const turns: ConversationTurn[] = [...(history.data?.turns ?? []), ...live];
  const sending = pending !== null;
  const planning = mode === "planning";

  // 历史载入后对齐后端的模式；之后以本地状态为准（每次切换都落过库）。
  // 地址里带了模式且与后端不同时，先落库再改本地态 —— 模式存后端是谋篇的锁，刷新不能把它打开。
  useEffect(() => {
    if (history.data === null) return;
    if (initialMode !== undefined && initialMode !== history.data.mode) {
      void api.setConversationMode(initialMode).then((r) => setMode(r.mode)).catch((e: unknown) => setError(`切换模式失败：${(e as Error).message}`));
      return;
    }
    setMode(history.data.mode);
  }, [history.data, initialMode]);

  const switchMode = async (next: ConversationMode): Promise<void> => {
    if (switching || sending || next === mode) return;
    setSwitching(true);
    setError(null);
    try {
      setMode((await api.setConversationMode(next)).mode);
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
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };
  useEffect(() => {
    const el = streamRef.current;
    if (el !== null && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [turns.length, pending?.text, pending?.tools.length]);

  const appendAgent = (text: string): void =>
    setLive((prev) => [...prev, { role: "agent", text, at: new Date().toISOString() }]);

  const send = async (raw?: string): Promise<void> => {
    const text = (raw ?? input).trim();
    if (text === "" || sending) return;
    setInput("");
    setError(null);
    stickToBottom.current = true;
    setLive((prev) => [...prev, { role: "user", text, at: new Date().toISOString() }]);
    setPending({ text: "", tools: [], round: 0 });
    const onEvent = (event: ConversationStreamEvent): void => {
      setPending((prev) => {
        const base = prev ?? { text: "", tools: [], round: 0 };
        switch (event.type) {
          case "round": return { text: "", tools: base.tools, round: event.round };
          case "delta": return { ...base, text: base.text + event.text };
          case "tool": {
            const tools = [...base.tools];
            const index = tools.findLastIndex((t) => t.name === event.name && t.status === "started");
            if (event.status === "finished" && index >= 0) tools[index] = { name: event.name, status: "finished", ok: event.ok };
            else tools.push({ name: event.name, status: event.status, ok: event.ok });
            return { ...base, tools };
          }
          default: return base;
        }
      });
    };
    try {
      const reply = await api.converseStream(text, onEvent);
      setLive((prev) => [
        ...prev,
        { role: "agent", text: reply.text, at: new Date().toISOString(), ...(reply.effects.length === 0 ? {} : { effects: reply.effects }) },
      ]);
      setMode(reply.mode);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      appendAgent(`（出错了：${(e as Error).message}）`);
    } finally {
      setPending(null);
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

  const empty = !history.loading && turns.length === 0 && pending === null;

  return (
    <div className="chat-page" data-mode={mode}>
      <div className="chat-head">
        <div>
          <h1>{planning ? "谋篇" : "对话"}</h1>
          <p>{planning
            ? <>只讨论，不改动作品。谈拢后 Agent 出一份<strong>候选方案</strong>，你到作品资料页确认才生效。</>
            : <>讨论方向、查资料、把安排写进计划，或“按计划写下一章”。写出的章节是<strong>待采用草稿</strong>，你确认后才成为正式进度。</>}</p>
        </div>
        <Tooltip title={planning ? "回到常规对话：说了就做" : "谋篇：只讨论、不改动，谈拢后出方案拍板"}>
          <Segmented<ConversationMode>
            className="chat-mode"
            value={mode}
            disabled={switching || sending}
            options={[{ label: "对话", value: "normal" }, { label: "谋篇", value: "planning" }]}
            onChange={(value) => void switchMode(value)}
          />
        </Tooltip>
      </div>

      <div className="chat-stream" ref={streamRef} onScroll={onScroll}>
        {history.loading && turns.length === 0 && <div className="chat-empty muted">载入对话…</div>}
        {empty && (
          <div className="chat-empty">
            <div className="chat-empty-mark" aria-hidden="true">✦</div>
            <h2>{planning ? "不知道写什么也没关系。" : "从一句话开始。"}</h2>
            <p>{planning ? "先说一句脑子里有的画面，我陪你一步步把书想出来；想好之前什么都不会改。" : "可以直接下达任务，也可以先聊聊；想不清楚就切到「谋篇」。"}</p>
            <div className="chat-suggestions">
              {(planning ? PLANNING_SUGGESTIONS : SUGGESTIONS).map((s) => <Button key={s} shape="round" onClick={() => void send(s)}>{s}</Button>)}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <Message key={i} turn={t} onJump={onJump} onView={viewDraft} onAdopt={adopt} />
        ))}
        {pending !== null && <PendingMessage pending={pending} />}
        <div className="chat-tail" />
      </div>

      {error !== null && <div className="finding chat-error" data-level="block">{error}</div>}

      <div className="composer">
        <Input.TextArea
          className="composer-input"
          value={input}
          placeholder={planning ? "谋篇中，只讨论不改动。想到什么就说… Enter 发送，Shift+Enter 换行" : "说点什么… Enter 发送，Shift+Enter 换行"}
          autoSize={{ minRows: 1, maxRows: 8 }}
          variant="borderless"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <div className="composer-bar">
          <span className="composer-status">{sending ? <><LoadingOutlined /> {pending?.tools.length ? "正在处理" : "正在回复"}</> : planning ? "谋篇模式：Agent 改不动作品，方案在资料页拍板" : "Agent 会自行选择工具；正式采用始终由你决定"}</span>
          <Tooltip title={sending ? "上一条还在回复" : "发送（Enter）"}>
            <Button type="primary" shape="circle" icon={<ArrowUpOutlined />} disabled={sending || input.trim() === ""} onClick={() => void send()} aria-label="发送" />
          </Tooltip>
        </div>
      </div>

      <Drawer
        open={draft !== null}
        onClose={() => setDraft(null)}
        width={Math.min(560, window.innerWidth)}
        closeIcon={<CloseOutlined />}
        title={draft === null ? null : <span className="drawer-title"><Tag>草稿 {draft.draftId}</Tag><span className="muted">第 {draft.chapter} 章 · {draft.status} · {draft.words} 字</span></span>}
        footer={draft === null ? null : (
          <div className="drawer-footer">
            <Button onClick={() => onJump(draft.chapter, "")}>在正文页打开该章</Button>
            <a className="drawer-link" href={`#/draft/${draft.chapter}/${draft.draftId}`}>完整结果页</a>
            <span style={{ flex: 1 }} />
            {draft.acceptable && <Button type="primary" icon={<CheckOutlined />} onClick={() => void adopt(draft.chapter, draft.draftId)}>采用这一版</Button>}
          </div>
        )}
      >
        {draft !== null && <DraftBody draft={draft} />}
      </Drawer>
    </div>
  );
}

function Message({
  turn,
  onJump,
  onView,
  onAdopt,
}: {
  turn: ConversationTurn;
  onJump: (chapter: number, quote: string) => void;
  onView: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
}): React.ReactElement {
  const time = new Date(turn.at);
  return (
    <div className="msg" data-role={turn.role}>
      <Avatar role={turn.role} />
      <div className="msg-main">
        <div className="msg-meta"><span>{turn.role === "user" ? "你" : "Agent"}</span><time dateTime={turn.at}>{Number.isNaN(time.getTime()) ? "" : time.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</time></div>
        <div className="msg-body">{turn.text}</div>
        {turn.effects !== undefined && turn.effects.length > 0 && (
          <div className="msg-effects">
            {turn.effects.map((e, i) => (
              <EffectCard key={i} effect={e} onJump={onJump} onView={onView} onAdopt={onAdopt} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingMessage({ pending }: { pending: Pending }): React.ReactElement {
  return (
    <div className="msg" data-role="agent" data-pending="true">
      <Avatar role="agent" />
      <div className="msg-main">
        <div className="msg-meta"><span>Agent</span><span className="muted">{pending.round > 1 ? `第 ${pending.round} 轮` : ""}</span></div>
        {pending.tools.length > 0 && (
          <div className="tool-trail" aria-live="polite">
            {pending.tools.map((t, i) => (
              <span key={i} className="tool-step" data-status={t.status} data-ok={t.ok}>
                {t.status === "started" ? <LoadingOutlined /> : t.ok ? <CheckOutlined /> : <CloseOutlined />}
                {TOOL_LABELS[t.name] ?? t.name}
              </span>
            ))}
          </div>
        )}
        <div className="msg-body" aria-live="polite">
          {pending.text === "" && pending.tools.length === 0 ? <span className="thinking-dots" aria-label="思考中"><i /><i /><i /></span> : pending.text}
          {pending.text !== "" && <span className="caret" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "agent" }): React.ReactElement {
  return role === "agent"
    ? <div className="avatar" data-role="agent" aria-hidden="true"><svg viewBox="0 0 24 24" width="16" height="16" fill="none"><path d="M4 20l4-1 10-10-3-3L5 16l-1 4Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"/><path d="M13 8l3 3" stroke="currentColor" strokeWidth="1.6"/></svg></div>
    : <div className="avatar" data-role="user" aria-hidden="true">你</div>;
}

function EffectCard({
  effect,
  onJump,
  onView,
  onAdopt,
}: {
  effect: AgentEffect;
  onJump: (chapter: number, quote: string) => void;
  onView: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
}): React.ReactElement {
  switch (effect.kind) {
    case "chapter_started":
    case "task_updated":
      return <div className="effect"><Tag color="gold">{effect.kind === "chapter_started" ? "章节任务" : "任务状态已更新"}</Tag><a href={`#/draft/${effect.chapter}/${effect.draftId}`}>第 {effect.chapter} 章 · 查看任务与结果</a></div>;
    case "preparation_proposed":
    case "preparation_confirmed":
      return <div className="effect"><Tag color={effect.kind === "preparation_confirmed" ? "cyan" : "gold"}>{effect.kind === "preparation_confirmed" ? "资料已确认" : "待确认方案"}</Tag><span>{effect.summary}</span><a href={`#/preparation?proposal=${encodeURIComponent(effect.proposalId)}`}>查看方案</a></div>;
    case "chapter_written":
    case "chapter_revised":
      return (
        <div className="effect">
          <Tag>草稿 {effect.draftId}</Tag>
          <span className="muted">第 {effect.chapter} 章 · {effect.status}</span>
          <Button size="small" onClick={() => onView(effect.chapter, effect.draftId)}>查看草稿</Button>
          <a href={`#/draft/${effect.chapter}/${effect.draftId}`}>完整结果</a>
          {effect.acceptable && (
            <Button size="small" type="primary" onClick={() => onAdopt(effect.chapter, effect.draftId)}>采用</Button>
          )}
        </div>
      );
    case "chapter_adopted":
      return (
        <div className="effect">
          <Tag color="cyan">已采用 第 {effect.chapter} 章</Tag>
          <Button size="small" onClick={() => onJump(effect.chapter, "")}>查看正文</Button>
          {effect.staleMarked.length > 0 && <span className="muted">后续 {effect.staleMarked.length} 章需重核</span>}
        </div>
      );
    case "plan_updated":
      return (
        <div className="effect">
          <Tag color="orange">第 {effect.chapter} 章计划已更新</Tag>
          {effect.promotedToPayoff && <span className="muted">已升级为回收章</span>}
        </div>
      );
    case "foreshadow_rescheduled":
      return <div className="effect"><Tag>{effect.foreshadowId} 改期 → 第 {effect.expectedBy} 章</Tag></div>;
    case "foreshadow_abandoned":
      return <div className="effect"><Tag>{effect.foreshadowId} 已废弃</Tag></div>;
    case "export_prepared":
      return <div className="effect"><Tag color="gold">已固定 {effect.chapters} 章正式版本</Tag><a href={`#/export?id=${encodeURIComponent(effect.exportId)}`}>查看导出预览并下载</a></div>;
    case "idea_recorded":
      return <div className="effect"><Tag>已记为备选</Tag><span className="muted">{effect.text}</span></div>;
    case "action_failed":
      return <div className="effect"><Tag color="volcano">未完成</Tag><span className="muted">{effect.tool}：{effect.message}</span></div>;
  }
}

function DraftBody({ draft }: { draft: DraftView }): React.ReactElement {
  return (
    <>
      {draft.error !== null && (
        <div className="finding" data-level="block" style={{ marginBottom: 12 }}>
          <div className="finding-rule">{draft.error.step}</div>
          <div className="finding-msg">{draft.error.detail}</div>
        </div>
      )}
      {draft.findings.length > 0 && (
        <div className="findings" style={{ marginBottom: 16 }}>
          {draft.findings.map((f, i) => (
            <div key={i} className="finding" data-level={f.level}>
              <div className="finding-rule">{f.rule} · {f.level}</div>
              <div className="finding-msg">{f.message}</div>
            </div>
          ))}
        </div>
      )}
      <div className="prose drawer-prose">
        {draft.body.split(/\n+/u).map((p, i) => (p.trim() === "" ? null : <p key={i}>{p}</p>))}
      </div>
    </>
  );
}
