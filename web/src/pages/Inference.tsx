/**
 * 逐章反推结构（差距第 2 项下半场的界面）。
 *
 * 界面要替作者回答三个问题：**哪些章还没反推**、**这一章反推出了什么**、
 * **确认了会变成什么**。所以主体是一张按章的进度表，而不是一次性的批处理按钮。
 *
 * 两处刻意的取舍：
 *
 * 1. **连续反推由浏览器逐章驱动**，不在服务端起一个长任务。每章一次请求、
 *    立刻落盘，所以关掉页面只是停下来，已经反推的章不会丢；接着点继续即可。
 *    服务端因此不必为这件事再养一套任务状态。
 * 2. **确认是逐章的**，与「逐章采用」同构。「确认全部」只是替作者按顺序点完，
 *    仍然一章一次请求 —— 先收后埋的顺序问题由服务端挡，不靠界面自觉。
 */

import { Fragment, useRef, useState } from "react";
import { InferenceCorrection } from "../components/InferenceCorrection.js";
import { Button, CheckField, DialogFrame, HelpTooltip } from "../components/controls.js";
import { api, type InferenceChapter, type InferenceDeclaration, type InferenceView } from "../api.js";
import { useFetch, useRouteActive } from "../hooks.js";
import { Chip } from "../components/Chip.js";

const STATES: Record<InferenceChapter["state"], { label: string; color?: string; hint: string }> = {
  written: { label: "已有记录", hint: "这一章是在平台里写的，结构记录已经是正式事实。" },
  confirmed: { label: "已确认", color: "cyan", hint: "已进入伏笔时间线与各视图。" },
  pending: { label: "待你确认", color: "gold", hint: "模型的判断，确认后才成为事实。" },
  problem: { label: "需要处理", color: "orange", hint: "记录本身有问题，处理后重跑。" },
  failed: { label: "没跑成", color: "orange", hint: "这一轮没拿到可用结果，可以重跑。" },
  skipped: { label: "已跳过", hint: "你决定不为这一章留结构记录。" },
  none: { label: "未反推", hint: "还没有结构记录。" },
};

export function Inference({ refresh }: { refresh: () => void }): React.ReactElement {
  const isCurrent = useRouteActive();
  const data = useFetch(() => api.inferenceView(), []);
  const preparation = useFetch(() => api.preparation(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [reviewing, setReviewing] = useState<InferenceChapter | null>(null);
  const [correcting, setCorrecting] = useState<number | null>(null);
  const [excludedRecords, setExcludedRecords] = useState<{ section: keyof InferenceDeclaration; index: number }[]>([]);
  const stop = useRef(false);
  const reviewReturn = useRef<HTMLElement | null>(null);

  if (data.data === null) return <div className="empty">{data.error ?? "读取反推进度…"} <Button size="sm" onClick={data.reload}>重试</Button></div>;
  const view = data.data;
  // 记录里是人物 ID，作者读的是名字；资料还没读回来时退回显示 ID。
  const name = (id: string): string => preparation.data?.confirmed.characters.find((c) => c.id === id)?.name ?? id;

  const done = (message: string): void => {
    if (isCurrent()) { setNotice(message); data.reload(); }
    refresh();
  };

  /** 逐章反推直到没有下一章、出现问题或作者叫停。 */
  const run = async (continuous: boolean): Promise<void> => {
    if (busy !== null) return;
    stop.current = false;
    setError(null); setNotice(null); setBusy("infer");
    let current: InferenceView = view;
    let count = 0;
    try {
      while (current.nextChapter !== null) {
        const chapter = current.nextChapter;
        const result = await api.inferChapter(chapter);
        count += 1;
        if (isCurrent()) setNotice(`第 ${chapter} 章：${STATES[result.state].label}${result.state === "pending" ? `，${summarize(result)}` : ""}`);
        if (result.state !== "pending" || !continuous || stop.current) break;
        current = await api.inferenceView();
      }
      if (count > 0 && isCurrent()) setNotice((previous) => `${previous ?? ""}${stop.current ? "（已停下）" : ""}`);
    } catch (cause) {
      if (isCurrent()) setError((cause as Error).message);
    } finally {
      setBusy(null);
      if (isCurrent()) data.reload();
      refresh();
    }
  };

  const act = async (chapter: number, action: "confirm" | "reject" | "again"): Promise<void> => {
    if (busy !== null) return;
    setError(null); setNotice(null); setBusy(`${action}${chapter}`);
    try {
      if (action === "confirm") { const r = await api.confirmInference(chapter); done(`第 ${chapter} 章已确认，${r.committed} 条记录进入正式事实。`); }
      else if (action === "reject") { await api.rejectInference(chapter); done(`第 ${chapter} 章已跳过，不留结构记录。`); }
      else { const r = await api.inferChapter(chapter); done(`第 ${chapter} 章重跑完成：${STATES[r.state].label}。`); }
    } catch (cause) { if (isCurrent()) setError((cause as Error).message); }
    finally { setBusy(null); }
  };

  /** 按顺序确认全部待确认章。中间失败就停在那一章，不跳过去接着确认。 */
  const confirmAll = async (): Promise<void> => {
    if (busy !== null) return;
    setError(null); setBusy("confirmAll");
    try {
      let committed = 0;
      for (const chapter of view.pending) committed += (await api.confirmInference(chapter)).committed;
      done(`已确认 ${view.pending.length} 章，共 ${committed} 条记录进入正式事实。`);
    } catch (cause) { if (isCurrent()) setError((cause as Error).message); }
    finally { setBusy(null); if (isCurrent()) data.reload(); }
  };

  const running = busy === "infer";
  const confirmValid = async (): Promise<void> => {
    if (busy !== null || !reviewing?.review) return;
    setBusy("review"); setError(null);
    try {
      const result = await api.confirmValidInference(reviewing.chapter, reviewing.review.token, excludedRecords);
      // 确认后按钮会消失；先选定仍存在的章节容器，避免迟到刷新再次丢焦点。
      reviewReturn.current = reviewReturn.current?.closest("article") ?? null;
      done(`第 ${reviewing.chapter} 章已按你的复核保留 ${result.committed} 条有效记录，排除原因已留档。`);
      setReviewing(null);
    } catch (cause) { if (isCurrent()) setError((cause as Error).message); }
    finally { setBusy(null); }
  };
  return <>
    {correcting !== null && <InferenceCorrection chapter={correcting} characters={preparation.data?.confirmed.characters ?? []} onClose={() => setCorrecting(null)} onChanged={() => { data.reload(); refresh(); }} />}
    <div className="page-head"><h1>从正文反推结构</h1><p>读你已经写好的旧稿，逐章补出事件、伏笔与人物变化。反推出来的是模型的判断，确认之后才成为作品事实。</p></div>

    {view.blocked !== null && <div className="finding" data-level="block" role="alert">{view.blocked}<div><a href="#/preparation">去资料页 →</a></div></div>}
    {(error ?? data.error) !== null && <div className="finding" data-level="block" role="alert">{error ?? data.error}</div>}
    {notice !== null && <p className="prep-notice" role="status">{notice}</p>}

    <div className="prep-readiness">
      <div>
        <strong>{view.nextChapter === null ? (view.pending.length > 0 ? `${view.pending.length} 章等你确认` : "所有章节都处理过了") : `下一章是第 ${view.nextChapter} 章`}</strong>
        <p>{view.nextChapter === null && view.pending.length === 0 ? "新写的章节会在写作时自己声明结构，不需要反推。" : "必须按章号顺序反推：后面章节要兑现的伏笔编号，是前面章节分配出来的。"}</p>
      </div>
      {/* 按钮位置固定：一轮跑完后「确认」不能顶到「反推」原来的位置上 —— 顺手再点一下就把模型判断变成了事实。 */}
      <div className="row">
        {running
          ? <Button danger onClick={() => { stop.current = true; }}>停下</Button>
          : <Button variant="default" disabled={view.blocked !== null || busy !== null || view.nextChapter === null} onClick={() => void run(true)}>连续反推</Button>}
        <Button disabled={view.blocked !== null || busy !== null || view.nextChapter === null} onClick={() => void run(false)}>{view.nextChapter === null ? "只反推一章" : `只反推第 ${view.nextChapter} 章`}</Button>
        <Button loading={busy === "confirmAll"} disabled={busy !== null || view.pending.length === 0} onClick={() => void confirmAll()}>{view.pending.length === 0 ? "确认全部" : `确认全部 ${view.pending.length} 章`}</Button>
      </div>
    </div>

    {view.chapters.length === 0
      ? <p className="muted">还没有正文。先在资料页用「导入已有正文」把旧稿放进来。</p>
      : <section className="prep-section">
        <div className="section-head"><h2>按章进度 <small>{view.chapters.length} 章</small></h2></div>
        {view.chapters.map((chapter) => {
          const state = STATES[chapter.state];
          const expanded = open === chapter.chapter;
          return <article className="prep-beat" key={chapter.chapter} data-state={chapter.state} tabIndex={-1}>
            <div className="row">
              <h3>第 {chapter.chapter} 章</h3>
              {(chapter.state === "confirmed" || chapter.state === "written") && <><Button size="sm" aria-label={`纠正第 ${chapter.chapter} 章结构`} disabled={busy !== null} onClick={() => setCorrecting(chapter.chapter)}>正文保持，纠正记录</Button>{chapter.eventCount === 0 && <span className="muted">未提取独立剧情事件，请核对覆盖</span>}</>}
              <HelpTooltip title={state.hint}><Chip color={state.color}>{state.label}</Chip></HelpTooltip>
              <span className="muted">{chapter.words} 字</span>
              <span className="push-right row">
                <a href={`#/chapter/${chapter.chapter}`}>读正文</a>
                {chapter.declaration !== null && <Button size="sm" variant="ghost" onClick={() => setOpen(expanded ? null : chapter.chapter)}>{expanded ? "收起" : "看这一章反推出什么"}</Button>}
                {chapter.state === "pending" && <Button size="sm" variant="default" loading={busy === `confirm${chapter.chapter}`} disabled={busy !== null} onClick={() => void act(chapter.chapter, "confirm")}>确认</Button>}
                {chapter.review && <Button size="sm" disabled={busy !== null} onClick={event => { reviewReturn.current = event.currentTarget; setExcludedRecords([]); setReviewing(chapter); }}>复核有效记录</Button>}
                {(chapter.state === "pending" || chapter.state === "problem" || chapter.state === "failed") && <>
                  <Button size="sm" loading={busy === `again${chapter.chapter}`} disabled={busy !== null} onClick={() => void act(chapter.chapter, "again")}>重跑</Button>
                  <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void act(chapter.chapter, "reject")}>跳过</Button>
                </>}
              </span>
            </div>
            {chapter.problems.map((problem, index) => <p className="finding" data-level="block" key={index}>{problem}</p>)}
            {chapter.warnings.map((warning, index) => <p className="finding" data-level="warn" key={index}>{warning}</p>)}
            {expanded && chapter.declaration !== null && <Declaration chapter={chapter} name={name} />}
          </article>;
        })}
      </section>}
    {reviewing?.review && <DialogFrame open className="inference-review-dialog" returnFocusRef={reviewReturn} title={`复核第 ${reviewing.chapter} 章的有效记录`} onCancel={() => { if (busy === null) setReviewing(null); }} confirmLoading={busy === "review"} okText="确认保留，排除问题项" onOk={() => void confirmValid()}>
      <p>以下重复埋设项将被排除，原文保持不变。请逐项核对后，再决定是否保留其余记录；仍有疑问的条目可取消勾选，排除原因会留档；这里不会替你合并语义相近的伏笔。</p>
      <h3>将排除的问题</h3><ul>{reviewing.problems.map((problem, i) => <li key={i}>{problem}</li>)}</ul>
      <h3>将保留的记录</h3><Declaration chapter={{ ...reviewing, declaration: reviewing.review.declaration }} name={name} excludedRecords={excludedRecords} onToggle={(section, index, keep) => setExcludedRecords(old => keep ? old.filter(item => item.section !== section || item.index !== index) : [...old, { section, index }])} />
      {error && <p role="alert" className="finding" data-level="block">{error}</p>}
    </DialogFrame>}
  </>;
}

/** 一章反推出的记录。与草稿结果页同一种读法：一句话摘要 + 原文引文。 */
function Declaration({ chapter, name, excludedRecords = [], onToggle }: { chapter: InferenceChapter; name: (id: string) => string; excludedRecords?: readonly { section: keyof InferenceDeclaration; index: number }[]; onToggle?: (section: keyof InferenceDeclaration, index: number, keep: boolean) => void }): React.ReactElement {
  const d = chapter.declaration;
  if (d === null) return <p className="muted">没有待确认的记录。</p>;
  const quote = (text: string): React.ReactElement => <blockquote>「{text}」</blockquote>;
  const labels: Record<keyof InferenceDeclaration, string> = { events: "事件", foreshadowPlanted: "埋设伏笔", foreshadowResolved: "兑现记录", relationsChanged: "关系变化", characterStates: "人物状态", characterPresence: "人物出场" };
  const presenceRoles: Record<string, string> = { pov: "视角人物", major: "主要出场", minor: "次要出场", mentioned: "仅被提及" };
  const row = (section: keyof InferenceDeclaration, index: number, content: React.ReactNode): React.ReactElement => {
    if (onToggle === undefined) return <Fragment key={`${section}-${index}`}>{content}</Fragment>;
    const excluded = excludedRecords.some(item => item.section === section && item.index === index);
    return <div key={`${section}-${index}`} className="inference-review-choice" data-excluded={excluded || undefined}>
      <CheckField aria-label={`保留${labels[section]}第 ${index + 1} 项`} checked={!excluded} onChange={keep => onToggle(section, index, keep)}>保留此项</CheckField>{content}
    </div>;
  };
  return <div className="prep-facts">
    {d.events.map((event, index) => row("events", index, <div className="draft-change"><div><strong>{event.summary}</strong><p className="muted">{event.participants.map(name).join("、") || "无点名人物"}</p></div>{quote(event.anchor.quote)}</div>))}
    {d.foreshadowPlanted.map((f, index) => row("foreshadowPlanted", index, <div className="draft-change"><div><strong>埋下 · {f.label}（{f.foreshadowId}）</strong><p>{f.intent}</p><small>预期第 {f.expectedBy} 章前兑现</small></div>{quote(f.anchor.quote)}</div>))}
    {d.foreshadowResolved.map((f, index) => row("foreshadowResolved", index, <div className="draft-change"><div><strong>兑现 · {f.foreshadowId}</strong><p>{f.completeness === "full" ? "完整兑现" : "部分兑现，仍有剩余承诺"}</p></div>{quote(f.anchor.quote)}</div>))}
    {d.relationsChanged.map((r, index) => row("relationsChanged", index, <div className="draft-change"><div><strong>{name(r.from)} → {name(r.to)}</strong><p>{r.note}（{r.fromKind ?? "未记录"} → {r.toKind}）</p></div>{quote(r.anchor.quote)}</div>))}
    {d.characterStates.map((state, index) => row("characterStates", index, <div className="draft-change"><div><strong>{name(state.characterId)}</strong><p>{state.field}：{state.from ?? "未记录"} → {state.to}</p></div>{quote(state.anchor.quote)}</div>))}
    {onToggle && d.characterPresence.map((presence, index) => row("characterPresence", index, <div className="draft-change"><strong>{name(presence.characterId)}</strong><span>{presenceRoles[presence.role] ?? presence.role}</span></div>))}
    {summarize(chapter) === "" && <p className="muted">这一章只记了出场，没有独立事件或伏笔。</p>}
  </div>;
}

/** 一句话说清这一章反推出了多少东西，用在回执里。 */
function summarize(chapter: InferenceChapter): string {
  const d = chapter.declaration;
  if (d === null) return "";
  const parts = [
    d.events.length > 0 ? `${d.events.length} 个事件` : "",
    d.foreshadowPlanted.length > 0 ? `埋下 ${d.foreshadowPlanted.length} 条伏笔` : "",
    d.foreshadowResolved.length > 0 ? `兑现 ${d.foreshadowResolved.length} 条伏笔` : "",
    d.relationsChanged.length > 0 ? `${d.relationsChanged.length} 处关系变化` : "",
    d.characterStates.length > 0 ? `${d.characterStates.length} 处状态变化` : "",
  ].filter(Boolean);
  return parts.join("、");
}
