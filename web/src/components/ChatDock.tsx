/**
 * 右侧常驻对话栏（参考 OpenFic 写作页的三栏：左导航 / 中内容 / 右助手）。
 *
 * 对话只负责「驱动」：写章、采用、改计划都由主 Agent 在后端受控执行，这里把回复里的
 * effects 渲染成可点 chip。产物（草稿正文、新旧对比、筹备资料）在中间区展示 ——
 * 写出草稿时自动把中间区切到那份草稿，对话栏本身不塞长文。
 *
 * 它挂在 App 级、跨路由不卸载：切去看伏笔时间线再回来，正在进行的一轮不丢；
 * 滚动只发生在栏内的消息列表，不再连带滚动主区。
 */

import { useEffect, useRef, useState } from "react";
import { api, type AgentEffect, type ConversationTurn, type PrepPayload } from "../api.js";
import { useFetch } from "../hooks.js";
import { chapterTypeLabel } from "../labels.js";
import { RichText } from "./RichText.js";

export interface ChatDockProps {
  width: number;
  prep: PrepPayload | null;
  resizing: boolean;
  onResizeStart: (e: React.PointerEvent<HTMLElement>) => void;
  onCollapse: () => void;
  onJump: (chapter: number, quote: string) => void;
  onOpenDraft: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
  /** 对话可能改变作品状态（写章/采用/改计划/筹备），据此刷新侧栏、首页与筹备摘要。 */
  refresh: () => void;
}

export function ChatDock({
  width,
  prep,
  resizing,
  onResizeStart,
  onCollapse,
  onJump,
  onOpenDraft,
  onAdopt,
  refresh,
}: ChatDockProps): React.ReactElement {
  const history = useFetch(() => api.conversationHistory(), []);
  const [live, setLive] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const turns: ConversationTurn[] = [...(history.data?.turns ?? []), ...live];

  // 历史首次载入直接跳到底；之后的新消息平滑滚。
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: live.length === 0 && !sending ? "auto" : "smooth",
    });
  }, [turns.length, sending, live.length]);

  const send = async (): Promise<void> => {
    const text = input.trim();
    if (text === "" || sending) return;
    setInput("");
    setSending(true);
    const at = new Date().toISOString();
    setLive((prev) => [...prev, { role: "user", text, at }]);
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
      const written = reply.effects.findLast((e) => e.kind === "chapter_written");
      if (written !== undefined) onOpenDraft(written.chapter, written.draftId);
    } catch (e) {
      setLive((prev) => [...prev, { role: "agent", text: `（出错了：${(e as Error).message}）`, at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  };

  const gaps = prep?.gaps.length ?? null;

  return (
    <aside className="dock" style={{ width }}>
      <div className="dock-resizer" data-active={resizing} onPointerDown={onResizeStart} />

      <div className="dock-head">
        <span className="dock-title">对话</span>
        {gaps !== null && prep !== null && (
          <a href="#/desk" className="tag" data-tone={gaps === 0 ? "done" : "warn"}>
            {gaps === 0 ? `可写第 ${prep.nextChapter} 章` : `还缺 ${gaps} 项`}
          </a>
        )}
        <span style={{ flex: 1 }} />
        <button data-quiet="true" title="收起对话栏" onClick={onCollapse}>
          收起
        </button>
      </div>

      <div ref={listRef} className="dock-list">
        {history.loading && turns.length === 0 ? (
          <div className="empty">载入对话…</div>
        ) : turns.length === 0 ? (
          <div className="empty">
            {gaps === null || gaps === 0
              ? "还没有对话。试试：“看看现在写到哪了，下一章该做什么。”"
              : "还没有对话。试试：“这本书讲一个落魄捕快查十年前的旧案，真凶是他三叔。”"}
          </div>
        ) : (
          turns.map((t, i) => (
            <Message key={i} turn={t} onJump={onJump} onOpenDraft={onOpenDraft} onAdopt={onAdopt} />
          ))
        )}
        {sending && (
          <div className="msg" data-role="agent">
            <div className="msg-body muted">思考中…</div>
          </div>
        )}
      </div>

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
    </aside>
  );
}

interface ChipHandlers {
  onJump: (chapter: number, quote: string) => void;
  onOpenDraft: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
}

function Message({ turn, ...handlers }: { turn: ConversationTurn } & ChipHandlers): React.ReactElement {
  return (
    <div className="msg" data-role={turn.role}>
      {/* 作者说的话原样留着；Agent 的回复是 markdown，要渲染 */}
      <div className="msg-body">{turn.role === "agent" ? <RichText text={turn.text} /> : turn.text}</div>
      {turn.effects !== undefined && turn.effects.length > 0 && (
        <div className="msg-effects">
          {turn.effects.map((e, i) => (
            <EffectChip key={i} effect={e} {...handlers} />
          ))}
        </div>
      )}
    </div>
  );
}

/** 作品方向字段名 → 中文。与后端 DIRECTION_LABELS 对应（跨 tsconfig 不能 import）。 */
const DIRECTION_LABEL: Record<string, string> = {
  premise: "前提",
  centralConflict: "核心冲突",
  pov: "视角",
  tense: "时态",
  protagonistTraits: "主角性格",
  protagonistForbidden: "主角禁忌",
  specialAbility: "金手指",
  abilityLimits: "能力限制",
  worldRules: "世界观",
  openingSituation: "开局情境",
  styleKeywords: "风格关键词",
  romanceLine: "感情线",
  taboos: "禁忌",
};

function EffectChip({ effect, onJump, onOpenDraft, onAdopt }: { effect: AgentEffect } & ChipHandlers): React.ReactElement {
  switch (effect.kind) {
    case "chapter_written":
      return (
        <div className="effect">
          <span className="tag">草稿 {effect.draftId}</span>
          <span className="muted">
            第 {effect.chapter} 章 · {effect.status}
            {effect.revisions > 0 ? ` · 自动修订 ${effect.revisions} 次` : ""}
          </span>
          <button data-quiet="true" onClick={() => onOpenDraft(effect.chapter, effect.draftId)}>
            {effect.revisions > 0 ? "查看草稿与改动" : "查看草稿"}
          </button>
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
    case "setting_updated":
      return <div className="effect"><span className="tag" data-tone="done">作品方向已更新</span><span className="muted">{effect.fields.map((f) => DIRECTION_LABEL[f] ?? f).join("、")}</span></div>;
    case "character_upserted":
      return (
        <div className="effect">
          <span className="tag" data-tone="done">{effect.created ? "已建人物" : "已改人物"}</span>
          <span className="muted">{effect.id} {effect.name}</span>
        </div>
      );
    case "location_upserted":
      return (
        <div className="effect">
          <span className="tag" data-tone="done">{effect.created ? "已建场景" : "已改场景"}</span>
          <span className="muted">{effect.id} {effect.name}</span>
        </div>
      );
    case "plotline_defined":
      return (
        <div className="effect">
          <span className="tag" data-tone="done">{effect.created ? "已定情节线" : "已改情节线"}</span>
          <span className="muted">{effect.id} {effect.label}</span>
        </div>
      );
    case "discipline_updated":
      return <div className="effect"><span className="tag" data-tone="done">写作纪律已更新</span><span className="muted">{effect.count} 条 · 版本 {effect.version}</span></div>;
    case "chapter_planned":
      return (
        <div className="effect">
          <span className="tag" data-tone="done">第 {effect.chapter} 章节拍已排</span>
          <span className="muted">{chapterTypeLabel(effect.chapterType)}{effect.warnings > 0 ? ` · ${effect.warnings} 条提醒` : ""}</span>
        </div>
      );
    case "action_failed":
      return <div className="effect"><span className="tag" data-tone="alarm">未完成</span><span className="muted">{effect.tool}：{effect.message}</span></div>;
  }
}
