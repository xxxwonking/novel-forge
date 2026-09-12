/**
 * 对话页（Stage 2·切片 1）——「作者通过对话完成首章」的主入口。
 *
 * 作者用自然语言下达任务；主 Agent 的回复带结构化 effects（写了草稿 / 采用了 / 改了计划…），
 * 这里把 effects 渲染成可点 chip：查看草稿、采用、跳原文。正式事实边界在后端 ——
 * 前端只是触发既有受控端点（/api/conversation、/api/chapter/adopt）。
 */

import { useEffect, useRef, useState } from "react";
import {
  api,
  type AgentEffect,
  type ConversationTurn,
  type DiffParagraph,
  type DraftDiffPayload,
  type DraftView,
  type PrepPayload,
} from "../api.js";
import { useFetch } from "../hooks.js";

export interface ChatProps {
  onJump: (chapter: number, quote: string) => void;
  /** 对话可能改变作品状态（写章/采用/改计划/筹备），据此刷新侧栏与首页。 */
  refresh: () => void;
}

export function Chat({ onJump, refresh }: ChatProps): React.ReactElement {
  const history = useFetch(() => api.conversationHistory(), []);
  const [live, setLive] = useState<ConversationTurn[]>([]);
  const [prepNonce, setPrepNonce] = useState(0);
  const prep = useFetch(() => api.prep(), [prepNonce]);
  const [input, setInput] = useState("");
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
      setPrepNonce((n) => n + 1);
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
      setPrepNonce((n) => n + 1);
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
          用自然语言把这本书定下来：方向、人物、地点、情节线、首章安排，都在这里说。
          说清一件事我就落成资料；还在犹豫时只讨论，不写。
          写出的章节是<strong>待采用草稿</strong> —— 你确认采用后才成为正式进度。
        </p>
      </div>

      {prep.data !== null && <PrepPanel prep={prep.data} />}

      <div className="chat">
        {history.loading && turns.length === 0 ? (
          <div className="empty">载入对话…</div>
        ) : turns.length === 0 ? (
          <div className="empty">
            {prep.data === null || prep.data.gaps.length === 0
              ? "还没有对话。试试：“看看现在写到哪了，下一章该做什么。”"
              : "还没有对话。试试：“这本书讲一个落魄捕快查十年前的旧案，真凶是他三叔。”"}
          </div>
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

/**
 * 筹备面板：只读。写入一律经对话（正式事实边界在后端），所以这里没有任何可编辑控件 ——
 * 缺项列在最前，让作者知道下一句该说什么。
 */
function PrepPanel({ prep }: { prep: PrepPayload }): React.ReactElement {
  const { setting, characters, locations, plotLines, gaps } = prep;
  const list = (items: readonly string[]): React.ReactNode =>
    items.length === 0 ? <span className="muted">未定</span> : items.join("、");

  return (
    <div className="prep">
      <div className="row">
        <span className="tag" data-tone={gaps.length === 0 ? "done" : "warn"}>
          {gaps.length === 0 ? "筹备已齐" : `还缺 ${gaps.length} 项`}
        </span>
        {gaps.length === 0 ? (
          <span className="muted">可以写第 {prep.nextChapter} 章了。</span>
        ) : (
          <span className="muted">{gaps.join("、")} —— 在下面说清即可，我会落成资料。</span>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted">目标 {Math.round(prep.targetWords / 10000)} 万字 · 纪律 {prep.discipline.version}（{prep.discipline.rules.length} 条）</span>
      </div>

      <dl>
        <dt>前提</dt>
        <dd>{setting.premise === "" ? <span className="muted">未定</span> : setting.premise}</dd>
        <dt>核心冲突</dt>
        <dd>{setting.centralConflict === "" ? <span className="muted">未定</span> : setting.centralConflict}</dd>
        <dt>视角</dt>
        <dd className="muted">{POV_LABEL[setting.pov] ?? setting.pov} · {setting.tense === "past" ? "过去时" : "现在时"}</dd>
        <dt>人物 {characters.length}</dt>
        <dd>
          {characters.length === 0 ? (
            <span className="muted">未建</span>
          ) : (
            characters.map((c) => (
              <span key={c.id} style={{ marginRight: 10 }}>
                <span className="tag">{c.id}</span> {c.name}
                <span className="muted">（{TIER_LABEL[c.tier] ?? c.tier}{c.role === "" ? "" : `·${c.role}`}）</span>
              </span>
            ))
          )}
        </dd>
        <dt>地点/组织 {locations.length}</dt>
        <dd>
          {locations.length === 0 ? (
            <span className="muted">未建</span>
          ) : (
            locations.map((s) => (
              <span key={s.id} style={{ marginRight: 10 }}>
                <span className="tag">{s.id}</span> {s.name}
              </span>
            ))
          )}
        </dd>
        <dt>情节线 {plotLines.length}</dt>
        <dd>
          {plotLines.length === 0 ? (
            <span className="muted">未定</span>
          ) : (
            plotLines.map((p) => (
              <span key={p.id} style={{ marginRight: 10 }}>
                <span className="tag" data-w={p.weight}>{p.id}</span> {p.label}
              </span>
            ))
          )}
        </dd>
        <dt>世界观</dt>
        <dd>{list(setting.worldRules)}</dd>
        <dt>禁忌</dt>
        <dd>{list(setting.taboos)}</dd>
      </dl>
    </div>
  );
}

const POV_LABEL: Record<string, string> = {
  first: "第一人称",
  third_limited: "第三人称限知",
  third_omniscient: "第三人称全知",
};

const TIER_LABEL: Record<string, string> = {
  protagonist: "主角",
  major: "主要",
  minor: "次要",
  extra: "龙套",
};

const CHAPTER_TYPE_LABEL: Record<string, string> = {
  transition: "过渡章",
  setup: "布局章",
  event: "事件章",
  payoff: "回收章",
  climax: "高潮章",
};

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
    case "chapter_written":
      return (
        <div className="effect">
          <span className="tag">草稿 {effect.draftId}</span>
          <span className="muted">
            第 {effect.chapter} 章 · {effect.status}
            {effect.revisions > 0 ? ` · 自动修订 ${effect.revisions} 次` : ""}
          </span>
          <button data-quiet="true" onClick={() => onView(effect.chapter, effect.draftId)}>
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
          <span className="muted">{CHAPTER_TYPE_LABEL[effect.chapterType] ?? effect.chapterType}{effect.warnings > 0 ? ` · ${effect.warnings} 条提醒` : ""}</span>
        </div>
      );
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
  const [diff, setDiff] = useState<DraftDiffPayload | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const revised = draft.revisions.length;

  // 面板挂在消息流之后、sticky 的输入框之上：不滚过去的话它的头部会被输入框盖住。
  useEffect(() => {
    setDiff(null);
    setDiffError(null);
    panelRef.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [draft.draftId]);

  const toggleDiff = async (): Promise<void> => {
    if (diff !== null) {
      setDiff(null);
      return;
    }
    try {
      setDiff(await api.chapterDiff(draft.chapter, draft.draftId));
      setDiffError(null);
    } catch (e) {
      setDiffError((e as Error).message);
    }
  };

  return (
    <div ref={panelRef} className="chart" style={{ padding: "14px 16px", marginTop: 12, scrollMarginTop: 12 }}>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="tag">草稿 {draft.draftId}</span>
        <span className="muted">
          第 {draft.chapter} 章 · {draft.status} · {draft.body.length} 字
          {revised > 0 ? ` · 自动修订 ${revised} 次` : ""}
        </span>
        <span style={{ flex: 1 }} />
        {revised > 0 && (
          <button data-quiet="true" onClick={() => void toggleDiff()}>
            {diff === null ? "对比上一版" : "看当前正文"}
          </button>
        )}
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
      {diffError !== null && <div className="finding" data-level="block" style={{ marginBottom: 8 }}>{diffError}</div>}
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
      {diff !== null ? (
        <DiffView diff={diff} />
      ) : (
        <div className="prose" style={{ maxHeight: 360, overflow: "auto", maxWidth: "100%" }}>
          {draft.body.split(/\n+/u).map((p, i) => (p.trim() === "" ? null : <p key={i}>{p}</p>))}
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button data-quiet="true" onClick={() => onJump(draft.chapter, "")}>在正文页打开该章</button>
      </div>
    </div>
  );
}

/** 连续未改动的段落超过这个数就折叠，只留首尾各一段做上下文。 */
const FOLD_THRESHOLD = 3;

type DiffBlock = { kind: "para"; index: number } | { kind: "fold"; from: number; to: number };

function foldUnchanged(paragraphs: readonly DiffParagraph[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < paragraphs.length) {
    if (paragraphs[i]?.op !== "equal") {
      blocks.push({ kind: "para", index: i });
      i += 1;
      continue;
    }
    let j = i;
    while (j < paragraphs.length && paragraphs[j]?.op === "equal") j += 1;
    if (j - i > FOLD_THRESHOLD) {
      blocks.push({ kind: "para", index: i }, { kind: "fold", from: i + 1, to: j - 1 }, { kind: "para", index: j - 1 });
    } else {
      for (let k = i; k < j; k++) blocks.push({ kind: "para", index: k });
    }
    i = j;
  }
  return blocks;
}

/**
 * 新旧对比：段落级去留 + 改写段内的字级高亮。红绿是刻意的破例（见 styles.css 开头）：
 * 删除=红底、新增=绿底是通用的增删语义，与行情涨跌无关。
 */
function DiffView({ diff }: { diff: DraftDiffPayload }): React.ReactElement {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const blocks = foldUnchanged(diff.paragraphs);

  const para = (index: number): React.ReactNode => {
    const p = diff.paragraphs[index];
    if (p === undefined) return null;
    return (
      <p key={index} data-op={p.op}>
        {p.op === "replace"
          ? p.spans.map((s, i) => (s.op === "equal" ? s.text : <span key={i} data-op={s.op}>{s.text}</span>))
          : p.spans.map((s) => s.text).join("")}
      </p>
    );
  };

  return (
    <div className="diff">
      <div className="row diff-head">
        <span className="tag" data-tone="warn">第 {diff.revision}/{diff.total} 次修订</span>
        <span className="muted">{diff.reason} · {diff.beforeWords} → {diff.afterWords} 字</span>
        <span className="diff-stat" data-op="insert">+{diff.inserted}</span>
        <span className="diff-stat" data-op="delete">−{diff.deleted}</span>
        <span className="muted">改动 {diff.changed} 段</span>
      </div>
      <div className="prose diff-body" style={{ maxHeight: 420, overflow: "auto", maxWidth: "100%" }}>
        {blocks.map((b) =>
          b.kind === "para" ? (
            para(b.index)
          ) : opened.has(b.from) ? (
            Array.from({ length: b.to - b.from }, (_, k) => para(b.from + k))
          ) : (
            <button
              key={`fold-${b.from}`}
              className="diff-fold"
              onClick={() => setOpened((prev) => new Set(prev).add(b.from))}
            >
              … {b.to - b.from} 段未改动，点开查看
            </button>
          ),
        )}
      </div>
    </div>
  );
}
