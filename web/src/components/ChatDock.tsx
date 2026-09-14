/**
 * 右侧常驻对话栏（参考 OpenFic 写作页的三栏：左导航 / 中内容 / 右助手）。
 *
 * 对话只负责「驱动」：写章、采用、改计划都由主 Agent 在后端受控执行；产物（草稿正文、
 * 新旧对比、筹备资料、方案）在中间区展示 —— 写出草稿或出了方案就自动把中间区切过去，
 * 对话栏本身不塞长文。
 *
 * 不用气泡。两种材质区分说话人：作者的话落在纸块上（--paper），助手的回复是桌面上的墨。
 * 文字统一对齐在一条竖线上，纸块向两侧出血。回复下面的「账目」是这一轮真实发生的事
 * （effects）—— "说了什么"与"做了什么"是两层，分开看。
 *
 * 它挂在 App 级、跨路由不卸载：切去看伏笔时间线再回来，正在进行的一轮不丢；
 * 滚动只发生在栏内的消息列表，不再连带滚动主区。
 *
 * 模式存在后端（它和工具集必须是同一份真相），这里只是显示与切换入口 —— 先落库成功
 * 再改本地状态，失败就停在原模式。
 */

import { useEffect, useRef, useState } from "react";
import { api, type AgentEffect, type ConversationMode, type ConversationTurn, type PrepPayload } from "../api.js";
import { useFetch } from "../hooks.js";
import { chapterTypeLabel, draftStatusLabel, draftStatusTone } from "../labels.js";
import { RichText } from "./RichText.js";

export interface ChatDockProps {
  width: number;
  prep: PrepPayload | null;
  resizing: boolean;
  onResizeStart: (e: React.PointerEvent<HTMLElement>) => void;
  onCollapse: () => void;
  onJump: (chapter: number, quote: string) => void;
  onOpenDraft: (chapter: number, draftId: string) => void;
  onOpenProposal: (id: string) => void;
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
  onOpenProposal,
  onAdopt,
  refresh,
}: ChatDockProps): React.ReactElement {
  const history = useFetch(() => api.conversationHistory(), []);
  const [live, setLive] = useState<ConversationTurn[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [mode, setMode] = useState<ConversationMode>("normal");
  const [switching, setSwitching] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const turns: ConversationTurn[] = [...(history.data?.turns ?? []), ...live];

  // 历史载入后对齐后端的模式。之后以本地状态为准（每次切换都落过库）。
  useEffect(() => {
    if (history.data !== null) setMode(history.data.mode);
  }, [history.data]);

  // 历史首次载入直接跳到底；之后的新消息平滑滚。
  useEffect(() => {
    listRef.current?.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: live.length === 0 && !sending ? "auto" : "smooth",
    });
  }, [turns.length, sending, live.length]);

  // 输入框随内容长高，上限由 CSS 的 max-height 定；清空后缩回一行。
  // scrollHeight 不含边框，而 height 是 border-box —— 差的两像素会让它自己长出滚动条。
  // 占位文案换了、栏拖宽了，折行都会变，一并重算。
  useEffect(() => {
    const el = inputRef.current;
    if (el === null) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  }, [input, mode, width]);

  const switchMode = async (next: ConversationMode): Promise<void> => {
    if (switching || sending) return;
    setSwitching(true);
    try {
      const r = await api.setConversationMode(next);
      setMode(r.mode);
    } catch {
      // 落库失败就停在原模式：前端显示的锁必须与后端实际执行的那把是同一把。
    } finally {
      setSwitching(false);
    }
  };

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
      setMode(reply.mode);
      refresh();
      const written = reply.effects.findLast((e) => e.kind === "chapter_written");
      if (written !== undefined) onOpenDraft(written.chapter, written.draftId);
      const proposed = reply.effects.findLast((e) => e.kind === "proposal_ready");
      if (proposed !== undefined) onOpenProposal(proposed.id);
    } catch (e) {
      setLive((prev) => [...prev, { role: "agent", text: `（出错了：${(e as Error).message}）`, at: new Date().toISOString() }]);
    } finally {
      setSending(false);
    }
  };

  /** 起手句只填进输入框，不直接发 —— 作者改两个字再发，比替他说话诚实。 */
  const pick = (s: Starter): void => {
    if (s.planning === true && mode !== "planning") void switchMode("planning");
    setInput(s.text);
    inputRef.current?.focus();
  };

  const gaps = prep?.gaps.length ?? null;
  const planning = mode === "planning";
  const hasText = input.trim() !== "";
  const handlers: ChipHandlers = { onJump, onOpenDraft, onOpenProposal, onAdopt };

  return (
    <aside className="dock" style={{ width }} data-mode={mode}>
      <div className="dock-resizer" data-active={resizing} onPointerDown={onResizeStart} />

      <div className="dock-head">
        <span className="dock-title">{planning ? "谋篇" : "对话"}</span>
        {gaps !== null && prep !== null && (
          <a href="#/desk" className="tag" data-tone={gaps === 0 ? "done" : "warn"}>
            {gaps === 0 ? `可写第 ${prep.nextChapter} 章` : `还缺 ${gaps} 项`}
          </a>
        )}
        <span style={{ flex: 1 }} />
        <button
          data-quiet="true"
          disabled={switching || sending}
          title={planning ? "回到常规对话，说了就做" : "进谋篇模式：只讨论、不改动，谈拢后出方案"}
          onClick={() => void switchMode(planning ? "normal" : "planning")}
        >
          {planning ? "退出谋篇" : "谋篇"}
        </button>
        <button data-quiet="true" title="收起对话栏" onClick={onCollapse}>
          收起
        </button>
      </div>

      <div ref={listRef} className="dock-list">
        {history.loading && turns.length === 0 ? (
          <div className="dock-empty">载入对话…</div>
        ) : turns.length === 0 ? (
          <div className="dock-empty">
            <p>{planning ? "谋篇模式：只讨论，不改动作品。" : "还没有对话。"}点一句放进输入框，改改再发：</p>
            {starters(planning, gaps).map((s) => (
              <button key={s.text} className="starter" onClick={() => pick(s)}>
                {s.text}
              </button>
            ))}
          </div>
        ) : (
          groupByDay(turns, new Date()).map((g) => (
            <div key={g.key} className="dock-day">
              <div className="dock-date">{g.label}</div>
              {g.turns.map((t, i) => (
                <Message key={i} turn={t} {...handlers} />
              ))}
            </div>
          ))
        )}
        {sending && <div className="msg-wait">在想…</div>}
      </div>

      <div className="composer">
        <textarea
          ref={inputRef}
          value={input}
          placeholder={planning ? "只讨论不改动，想到什么就说…" : "说点什么…"}
          rows={1}
          disabled={sending}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send();
            }
          }}
        />
        {/* 空着时静默、有字才亮：屏幕上不该有一块常驻的黄 */}
        <button
          data-primary={hasText ? "true" : undefined}
          data-quiet={hasText ? undefined : "true"}
          disabled={sending || !hasText}
          title="Enter 发送，Shift+Enter 换行"
          onClick={() => void send()}
        >
          发送
        </button>
      </div>
    </aside>
  );
}

// ── 起手句 ──────────────────────────────────────────────────────────────

interface Starter {
  readonly text: string;
  /** 点它顺带切进谋篇 —— 新手"不知道写什么"的入口。 */
  readonly planning?: true;
}

/** 空态的起手句要能被直接发出去 —— 新手最卡的就是不知道第一句说什么。 */
function starters(planning: boolean, gaps: number | null): readonly Starter[] {
  const fresh = gaps !== null && gaps > 0;
  if (planning) {
    return fresh
      ? [{ text: "我还没想好写什么，脑子里只有一个画面：一个人半夜被敲门声吵醒。" }, { text: "先聊聊主角是谁。" }]
      : [{ text: "我想给主角加一条旧伤的线，但不知道往哪放。" }, { text: "看看还欠着哪些伏笔，帮我想想怎么收。" }];
  }
  return fresh
    ? [{ text: "这本书讲一个落魄捕快查十年前的旧案，真凶是他三叔。" }, { text: "我还没想好写什么，一起想想。", planning: true }]
    : [{ text: "看看现在写到哪了，下一章该做什么。" }, { text: "按计划写下一章。" }];
}

// ── 按天分组 ────────────────────────────────────────────────────────────

interface DayGroup {
  readonly key: string;
  readonly label: string;
  readonly turns: ConversationTurn[];
}

/** 对话跨会话持久，翻旧记录要知道是哪天说的。只在换天时插一条日期线。 */
function groupByDay(turns: readonly ConversationTurn[], now: Date): readonly DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of turns) {
    const d = new Date(t.at);
    const day = Number.isNaN(d.getTime()) ? now : d;
    const key = dayKey(day);
    const last = groups[groups.length - 1];
    if (last === undefined || last.key !== key) groups.push({ key, label: dayLabel(day, now), turns: [t] });
    else last.turns.push(t);
  }
  return groups;
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(d: Date, now: Date): string {
  if (dayKey(d) === dayKey(now)) return "今天";
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(yesterday)) return "昨天";
  const md = `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()} 年 ${md}`;
}

// ── 消息与账目 ──────────────────────────────────────────────────────────

interface ChipHandlers {
  onJump: (chapter: number, quote: string) => void;
  onOpenDraft: (chapter: number, draftId: string) => void;
  onOpenProposal: (id: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
}

function Message({ turn, ...handlers }: { turn: ConversationTurn } & ChipHandlers): React.ReactElement {
  return (
    <div className="msg" data-role={turn.role}>
      {/* 作者说的话原样留着；Agent 的回复是 markdown，要渲染 */}
      <div className="msg-body">{turn.role === "agent" ? <RichText text={turn.text} /> : turn.text}</div>
      {turn.effects !== undefined && turn.effects.length > 0 && (
        <div className="ledger">
          {turn.effects.map((e, i) => (
            <LedgerRow key={i} effect={e} {...handlers} />
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

type Tone = "calm" | "warn" | "alarm" | "done" | undefined;

/**
 * 账目的一行：动词｜对象｜动作。动词淡、对象实；只有"未定 / 要你处理"的状态给动词上色。
 * 查看类按钮一律静默，「采用」是唯一的主按钮 —— 与草稿页同一约定。
 */
function LedgerRow({ effect, onJump, onOpenDraft, onOpenProposal, onAdopt }: { effect: AgentEffect } & ChipHandlers): React.ReactElement {
  const row = (verb: string, object: string, actions?: React.ReactNode, tone?: Tone): React.ReactElement => (
    <div className="ledger-row">
      <span className="ledger-verb" data-tone={tone}>{verb}</span>
      <span className="ledger-obj">{object}</span>
      {/* 行是 display: contents，三个格子必须都在，否则下一行的动词会顶到动作列 */}
      <span className="ledger-act">{actions}</span>
    </div>
  );

  switch (effect.kind) {
    case "chapter_written":
      return row(
        "已写草稿",
        `${effect.draftId} · 第 ${effect.chapter} 章 · ${draftStatusLabel(effect.status)}${effect.revisions > 0 ? ` · 自动修订 ${effect.revisions} 次` : ""}`,
        <>
          <button data-quiet="true" onClick={() => onOpenDraft(effect.chapter, effect.draftId)}>
            {effect.revisions > 0 ? "看改动" : "查看"}
          </button>
          {effect.acceptable && (
            <button data-primary="true" onClick={() => onAdopt(effect.chapter, effect.draftId)}>采用</button>
          )}
        </>,
        draftStatusTone(effect.status),
      );
    case "chapter_adopted":
      return row(
        "已采用",
        `第 ${effect.chapter} 章 ${effect.draftId}${effect.staleMarked.length > 0 ? ` · 后续 ${effect.staleMarked.length} 章需重核` : ""}`,
        <button data-quiet="true" onClick={() => onJump(effect.chapter, "")}>看正文</button>,
        effect.staleMarked.length > 0 ? "warn" : undefined,
      );
    case "plan_updated":
      return row("已改计划", `第 ${effect.chapter} 章${effect.promotedToPayoff ? " · 升级为回收章" : ""}`);
    case "foreshadow_rescheduled":
      return row("已改期", `${effect.foreshadowId} → 第 ${effect.expectedBy} 章`);
    case "foreshadow_abandoned":
      return row("已废弃", effect.foreshadowId);
    case "idea_recorded":
      return row("已记备选", effect.text);
    case "setting_updated":
      return row("已改方向", effect.fields.map((f) => DIRECTION_LABEL[f] ?? f).join("、"));
    case "character_upserted":
      return row(effect.created ? "已建人物" : "已改人物", `${effect.id} ${effect.name}`);
    case "location_upserted":
      return row(effect.created ? "已建场景" : "已改场景", `${effect.id} ${effect.name}`);
    case "plotline_defined":
      return row(effect.created ? "已建情节线" : "已改情节线", `${effect.id} ${effect.label}`);
    case "discipline_updated":
      return row("已改纪律", `${effect.count} 条 · 版本 ${effect.version}`);
    case "chapter_planned":
      return row(
        "已排节拍",
        `第 ${effect.chapter} 章 · ${chapterTypeLabel(effect.chapterType)}${effect.warnings > 0 ? ` · ${effect.warnings} 条提醒` : ""}`,
        undefined,
        effect.warnings > 0 ? "warn" : undefined,
      );
    case "proposal_ready":
      return row(
        "已出方案",
        `${effect.id} · ${effect.scope === "preparation" ? "筹备" : "变更"} · ${effect.items} 条`,
        <button data-quiet="true" onClick={() => onOpenProposal(effect.id)}>查看</button>,
        "calm",
      );
    case "action_failed":
      return row("未完成", `${effect.tool}：${effect.message}`, undefined, "alarm");
  }
}
