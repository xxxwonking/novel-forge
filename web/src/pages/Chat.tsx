/**
 * 对话页（Stage 2·切片 1）——「作者通过对话完成首章」的主入口。
 *
 * 作者用自然语言下达任务；主 Agent 的回复带结构化 effects（写了草稿 / 采用了 / 改了计划…），
 * 这里把 effects 渲染成可点 chip：查看草稿、采用、跳原文。正式事实边界在后端 ——
 * 前端只是触发既有受控端点（/api/conversation、/api/chapter/adopt）。
 */

import { useEffect, useRef, useState } from "react";
import { api, type AgentEffect, type ConversationTurn, type DraftView } from "../api.js";
import { useFetch } from "../hooks.js";

export interface ChatProps {
  initialPrompt?: string;
  onJump: (chapter: number, quote: string) => void;
  /** 对话可能改变作品状态（写章/采用/改计划），据此刷新侧栏与首页。 */
  refresh: () => void;
}

export function Chat({ onJump, refresh, initialPrompt = "" }: ChatProps): React.ReactElement {
  const history = useFetch(() => api.conversationHistory(), []);
  const [live, setLive] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState(initialPrompt);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftView | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const turns: ConversationTurn[] = [...(history.data?.turns ?? []), ...live];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [turns.length, sending]);

  const appendAgent = (text: string): void =>
    setLive((prev) => [...prev, { role: "agent", text, at: new Date().toISOString() }]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (text === "" || sending) return;
    setInput("");
    setError(null);
    setSending(true);
    setLive((prev) => [...prev, { role: "user", text, at: new Date().toISOString() }]);
    try {
      const reply = await api.converse(text);
      setLive((prev) => [
        ...prev,
        {
          role: "agent",
          text: reply.text,
          at: new Date().toISOString(),
          ...(reply.effects.length === 0 ? {} : { effects: reply.effects }),
        },
      ]);
      refresh();
    } catch (e) {
      setError((e as Error).message);
      appendAgent(`（出错了：${(e as Error).message}）`);
    } finally {
      setSending(false);
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

  return (
    <>
      <div className="page-head">
        <h1>对话</h1>
        <p>
          用自然语言下达任务：讨论方向、查资料、把安排写进下一章计划，或“按计划写下一章”。
          写出的章节是<strong>待采用草稿</strong> —— 你确认采用后才成为正式进度。
        </p>
      </div>

      <div className="chat">
        {history.loading && turns.length === 0 ? (
          <div className="empty">载入对话…</div>
        ) : turns.length === 0 ? (
          <div className="empty">还没有对话。试试：“看看现在写到哪了，下一章该做什么。”</div>
        ) : (
          turns.map((t, i) => (
            <Message key={i} turn={t} onJump={onJump} onView={viewDraft} onAdopt={adopt} />
          ))
        )}
        {sending && <div className="msg" data-role="agent"><div className="msg-body muted">思考中…</div></div>}
        <div ref={bottomRef} />
      </div>

      {draft !== null && <DraftPanel draft={draft} onClose={() => setDraft(null)} onAdopt={adopt} onJump={onJump} />}

      {error !== null && <div className="finding" data-level="block" style={{ marginTop: 12 }}>{error}</div>}

      <div className="composer">
        <textarea
          value={input}
          placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
          rows={2}
          disabled={sending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button data-primary="true" disabled={sending || input.trim() === ""} onClick={() => void send()}>
          发送
        </button>
      </div>
    </>
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
  return (
    <div className="msg" data-role={turn.role}>
      <div className="msg-body">{turn.text}</div>
      {turn.effects !== undefined && turn.effects.length > 0 && (
        <div className="msg-effects">
          {turn.effects.map((e, i) => (
            <EffectChip key={i} effect={e} onJump={onJump} onView={onView} onAdopt={onAdopt} />
          ))}
        </div>
      )}
    </div>
  );
}

function EffectChip({
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
      return <div className="effect"><span className="tag">{effect.kind === "chapter_started" ? "章节任务" : "任务状态已更新"}</span><a href={`#/draft/${effect.chapter}/${effect.draftId}`}>第 {effect.chapter} 章 · 查看任务与结果</a></div>;
    case "preparation_proposed":
    case "preparation_confirmed":
      return <div className="effect"><span className="tag">{effect.kind === "preparation_confirmed" ? "资料已确认" : "待确认方案"}</span><span>{effect.summary}</span><a href={`#/preparation?proposal=${encodeURIComponent(effect.proposalId)}`}>查看方案</a></div>;
    case "chapter_written":
    case "chapter_revised":
      return (
        <div className="effect">
          <span className="tag">草稿 {effect.draftId}</span>
          <span className="muted">第 {effect.chapter} 章 · {effect.status}</span>
          <button data-quiet="true" onClick={() => onView(effect.chapter, effect.draftId)}>查看草稿</button>
          <a href={`#/draft/${effect.chapter}/${effect.draftId}`}>完整结果</a>
          {effect.acceptable && (
            <button data-primary="true" onClick={() => onAdopt(effect.chapter, effect.draftId)}>采用</button>
          )}
        </div>
      );
    case "chapter_adopted":
      return (
        <div className="effect">
          <span className="tag" data-tone="done">已采用 第 {effect.chapter} 章</span>
          <button data-quiet="true" onClick={() => onJump(effect.chapter, "")}>查看正文</button>
          {effect.staleMarked.length > 0 && <span className="muted">后续 {effect.staleMarked.length} 章需重核</span>}
        </div>
      );
    case "plan_updated":
      return (
        <div className="effect">
          <span className="tag" data-tone="warn">第 {effect.chapter} 章计划已更新</span>
          {effect.promotedToPayoff && <span className="muted">已升级为回收章</span>}
        </div>
      );
    case "foreshadow_rescheduled":
      return <div className="effect"><span className="tag">{effect.foreshadowId} 改期 → 第 {effect.expectedBy} 章</span></div>;
    case "foreshadow_abandoned":
      return <div className="effect"><span className="tag" data-tone="done">{effect.foreshadowId} 已废弃</span></div>;
    case "idea_recorded":
      return <div className="effect"><span className="tag">已记为备选</span><span className="muted">{effect.text}</span></div>;
    case "action_failed":
      return <div className="effect"><span className="tag" data-tone="alarm">未完成</span><span className="muted">{effect.tool}：{effect.message}</span></div>;
  }
}

function DraftPanel({
  draft,
  onClose,
  onAdopt,
  onJump,
}: {
  draft: DraftView;
  onClose: () => void;
  onAdopt: (chapter: number, draftId: string) => void;
  onJump: (chapter: number, quote: string) => void;
}): React.ReactElement {
  return (
    <div className="chart" style={{ padding: "14px 16px", marginTop: 12 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="tag">草稿 {draft.draftId}</span>
        <span className="muted">第 {draft.chapter} 章 · {draft.status} · {draft.words} 字</span>
        <span style={{ flex: 1 }} />
        {draft.acceptable && (
          <button data-primary="true" onClick={() => onAdopt(draft.chapter, draft.draftId)}>采用这一版</button>
        )}
        <button data-quiet="true" onClick={onClose}>关闭</button>
      </div>
      {draft.error !== null && (
        <div className="finding" data-level="block" style={{ marginBottom: 8 }}>
          <div className="finding-rule">{draft.error.step}</div>
          <div className="finding-msg">{draft.error.detail}</div>
        </div>
      )}
      {draft.findings.length > 0 && (
        <div className="findings" style={{ marginBottom: 10 }}>
          {draft.findings.map((f, i) => (
            <div key={i} className="finding" data-level={f.level}>
              <div className="finding-rule">{f.rule} · {f.level}</div>
              <div className="finding-msg">{f.message}</div>
            </div>
          ))}
        </div>
      )}
      <div className="prose" style={{ maxHeight: 360, overflow: "auto", maxWidth: "100%" }}>
        {draft.body.split(/\n+/u).map((p, i) => (p.trim() === "" ? null : <p key={i}>{p}</p>))}
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <button data-quiet="true" onClick={() => onJump(draft.chapter, "")}>在正文页打开该章</button>
      </div>
    </div>
  );
}
