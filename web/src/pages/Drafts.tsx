import { useEffect, useRef, useState } from "react";
import { Button, Select, Tag } from "antd";
import { api, type TextAnchor, type ChapterTaskView, type DraftView } from "../api.js";
import { useFetch, useRouteActive } from "../hooks.js";
import { TaskCard, taskRunning } from "../components/TaskPanel.js";
import { DraftEditor, RevisionComparison } from "../components/DraftEditing.js";
import { StructureEditor } from "../components/StructureEditor.js";
import { DraftRewriteEditor } from "../components/DraftRewriteEditor.js";
import { DraftProposals } from "../components/DraftProposals.js";
import { Chip } from "../components/Chip.js";

const states: Record<string, string> = { writing: "正文未完成", pending_check: "待检查", declaring: "结构核对未完成", checking: "检查未完成", failed: "执行未完成", needs_revision: "需要修改", ready: "待采用", adopted: "已采用", stale: "依据已变化，需重新核对", discarded: "已丢弃" };

export function Drafts({ chapter, draftId, refresh, task, reloadTasks }: { chapter: number; draftId: string; refresh: () => void; task: ChapterTaskView | undefined; reloadTasks: () => void }): React.ReactElement {
  const isCurrent = useRouteActive();
  const query = useFetch(() => api.chapterDraft(chapter, draftId), [chapter, draftId]);
  const versions = useFetch(() => api.chapterDrafts(chapter), [chapter, draftId]);
  const preparation = useFetch(() => api.preparation(), [chapter, draftId]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selectedProposals, setSelectedProposals] = useState<number[]>([]);
  const [editor, setEditor] = useState<"body" | "structure" | "rewrite" | "continue" | null>(null);
  const [anchor, setAnchor] = useState<TextAnchor | null>(null);
  const prose = useRef<HTMLElement | null>(null);
  useEffect(() => { query.reload(); versions.reload(); }, [task?.updatedAt, task?.status, task?.draftStatus, query.reload, versions.reload]);
  useEffect(() => { setEditor(null); setError(null); setNotice(null); setAnchor(null); }, [chapter, draftId]);
  useEffect(() => { setSelectedProposals([]); }, [query.data?.revisionToken, chapter, draftId]);
  if (query.data === null) return <div className="empty">{query.error ?? "读取章节结果…"} <Button size="small" onClick={query.reload}>重试</Button></div>;
  const draft = query.data;
  const declaration = draft.declaration;
  const dependency = preparation.data?.proposals.find((p) => p.id === draft.preparationProposalId);
  const names = dependency?.content.characters ?? preparation.data?.confirmed.characters ?? [];
  const name = (id: string): string => names.find((c) => c.id === id)?.name ?? id;
  const reload = (): void => { if (isCurrent()) { query.reload(); versions.reload(); preparation.reload(); } reloadTasks(); refresh(); };
  const goDraft = (n: number, id: string): void => { if (isCurrent()) { window.location.hash = `/draft/${n}/${id}`; setAnchor(null); } };
  const saved = (next: DraftView): void => { if (isCurrent()) { setEditor(null); goDraft(next.chapter, next.draftId); } reload(); };
  const editable = draft.status !== "discarded" && (draft.status !== "adopted" || draft.isCurrentAdopted) && !taskRunning(task);
  const perform = async (action: "adopt" | "continue" | "resume" | "new" | "discard" | "check" | "checkAdopt"): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    let adopted = false;
    try {
      if (action === "check" || action === "checkAdopt") {
        await api.checkDraft({ chapter, draftId, revisionToken: draft.revisionToken, adoptOnSuccess: action === "checkAdopt", ...(action === "checkAdopt" ? { selectedProposals } : {}) });
        if (isCurrent()) setNotice(action === "checkAdopt" ? "已开始检查；通过后采用这一版，有必须处理的问题时保留结果。" : "已开始检查当前版本。");
      }
      if (action === "adopt" || action === "continue") {
        await api.adopt(chapter, draftId, { revisionToken: draft.revisionToken, selectedProposals }); adopted = true; reload();
        if (isCurrent()) setNotice(`已采用第 ${chapter} 章。${action === "continue" ? "正在准备下一章…" : "它已成为后续创作依据。"}`);
      }
      if (action === "discard") { await api.discard(chapter, draftId); if (isCurrent()) setNotice("草稿已丢弃，历史内容仍可查看。"); }
      if (action === "resume" || action === "new" || action === "continue") {
        const next = await api.writeChapter(action === "continue" ? { chapter: chapter + 1 }
          : action === "resume" ? { chapter, draftId }
            : { chapter, newDraft: true, ...(draft.preparationProposalId === null ? {} : { proposalId: draft.preparationProposalId }) });
        goDraft(next.chapter, next.draftId);
      }
    } catch (e) { if (isCurrent()) setError(`${adopted ? `第 ${chapter} 章已采用；下一章尚未完成：` : ""}${(e as Error).message}`); }
    finally { if (isCurrent()) setBusy(false); reload(); }
  };
  const evidence = (a: TextAnchor): React.ReactElement => <Button type="text" size="small" onClick={() => { setAnchor(a); requestAnimationFrame(() => prose.current?.querySelector("mark")?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>查看原文 ↗</Button>;
  const offsets: number[] = [];
  if (anchor !== null && anchor.quote !== "") {
    let offset = draft.body.indexOf(anchor.quote);
    while (offset >= 0) { offsets.push(offset); offset = draft.body.indexOf(anchor.quote, offset + 1); }
  }
  const hit = anchor === null ? -1 : offsets[anchor.occurrence] ?? -1;

  return <>
    <div className="page-head"><h1>第 {chapter} 章 · 章节结果</h1><p>先看这一章发生了什么，再核对原文。待采用内容保留在当前稿中。</p></div>
    {task && <TaskCard task={task} reload={reload} detailed />}
    {draft.automaticResultDraftId && <div className="prep-readiness"><div><strong>这份初稿已保留</strong><p>本次任务已创建自动修订版。请查看新版本的进度与检查结果。</p></div><a className="prep-link" href={`#/draft/${chapter}/${draft.automaticResultDraftId}`}>查看自动修订稿 →</a></div>}
    {draft.revision?.kind === "automatic" && <p className="muted">这是本次任务的第 1 次自动修订，初稿及原检查保留在版本列表中。当前用量包含初稿与本次修订。</p>}
    <div className="draft-toolbar"><Chip color={draft.status === "needs_revision" ? "orange" : draft.status === "ready" ? "cyan" : undefined}>{draft.status === "adopted" ? draft.isCurrentAdopted ? "当前正式版本" : "历史采用版本" : states[draft.status] ?? draft.status}</Chip><span>{draft.words} 字</span><label>版本 <Select aria-label="稿件版本" value={draftId} popupMatchSelectWidth={false} onChange={(value) => goDraft(chapter, value)}
      options={(versions.data ?? [draft]).map((d) => ({ value: d.draftId, label: `${d.draftId} · ${d.isCurrentAdopted ? "当前正式版本" : states[d.status] ?? d.status}` }))} /></label><a href="#/preparation">作品资料</a></div>
    {draft.preparationProposalId !== null && <div className="prep-readiness"><div><strong>依赖方案：{dependency?.summary ?? "正在读取"}</strong><p>{dependency?.status === "confirmed" ? "此方案已确认。" : "这份草稿使用了尚未确认的建议设定。采用章节时会一并确认该方案。"}</p></div><a href={`#/preparation?proposal=${encodeURIComponent(draft.preparationProposalId)}`}>查看依赖</a></div>}
    {(error ?? query.error) && <div className="finding" data-level="block" role="alert">{error ?? query.error}</div>}
    {notice && <p className="prep-notice" role="status">{notice}</p>}
    {draft.review?.adoptionError && <p className="finding" data-level="block" role="alert">检查已完成，但采用未完成：{draft.review.adoptionError}。稿件仍保留，可核对后重试采用。</p>}
    <DraftProposals draft={draft} selected={selectedProposals} onSelected={setSelectedProposals} disabled={busy || !editable || editor !== null || !["ready", "pending_check"].includes(draft.status)} />
    <div className="draft-actions row">
      {draft.status === "pending_check" && <><Button type="primary" disabled={busy || taskRunning(task) || editor !== null} onClick={() => void perform("checkAdopt")}>检查并采用</Button><Button disabled={busy || taskRunning(task) || editor !== null} onClick={() => void perform("check")}>检查</Button></>}
      {draft.status === "ready" && draft.acceptable && <><Button type="primary" disabled={busy} onClick={() => void perform("continue")}>采用并继续下一章</Button><Button disabled={busy} onClick={() => void perform("adopt")}>采用这一版</Button></>}
      {editable && <Button disabled={busy || editor !== null} onClick={() => setEditor("body")}>修改正文</Button>}
      {editable && draft.body.trim() && <Button disabled={busy || editor !== null} onClick={() => setEditor("rewrite")}>按要求改写</Button>}
      {editable && draft.canContinueBody && <Button type="primary" disabled={busy || editor !== null} onClick={() => setEditor("continue")}>保留片段继续完成</Button>}
      {editable && declaration !== null && <Button disabled={busy || editor !== null} onClick={() => setEditor("structure")}>正文保持，纠正记录</Button>}
      {draft.status !== "discarded" && <Button disabled={busy || taskRunning(task)} onClick={() => void perform("new")}>另写一版</Button>}
      {draft.status !== "adopted" && draft.status !== "discarded" && <Button type="text" disabled={busy || taskRunning(task)} onClick={() => void perform("discard")}>丢弃这份草稿</Button>}
      {draft.status === "adopted" && <a href={`#/chapter/${chapter}`}>查看正式正文 →</a>}
    </div>
    {editor === "body" && <DraftEditor key={draftId} draft={draft} onSaved={saved} onClose={() => setEditor(null)} />}
    {editor === "structure" && <StructureEditor key={draftId} draft={draft} characters={names} onSaved={saved} onClose={() => setEditor(null)} />}
    {(editor === "rewrite" || editor === "continue") && <DraftRewriteEditor key={`${draftId}-${editor}`} draft={draft} mode={editor} onSaved={saved} onClose={() => setEditor(null)} />}
    {draft.revision && <RevisionComparison draft={draft} characters={names} />}
    <section className="prep-section"><h2>本章摘要</h2>{declaration === null ? <p className="muted">结构核对尚未完成，已有正文保留在下方。</p> : declaration.events.length === 0 ? <p className="muted">本稿未提取独立剧情事件，可直接阅读正文。</p> : declaration.events.map((event, i) => <div className="draft-change" key={i}><p>{event.summary}</p>{evidence(event.anchor)}</div>)}</section>
    {declaration !== null && <section className="prep-section"><h2>人物、关系与伏笔变化 <Tag>{draft.status === "adopted" ? "本版本的结构记录" : "待采用变化"}</Tag></h2>
      {declaration.characterStates.map((change, i) => <div className="draft-change" key={`state-${i}`} data-important={change.field === "vital" || change.to === "dead"}><div><strong>{name(change.characterId)}</strong><p>{change.field}：{change.from ?? "未记录"} → {change.to}</p></div>{evidence(change.anchor)}</div>)}
      {declaration.relationsChanged.map((change, i) => <div className="draft-change" key={`relation-${i}`}><div><strong>{name(change.from)} → {name(change.to)}</strong><p>{change.note}（{change.fromKind ?? "未记录"} → {change.toKind}）</p></div>{evidence(change.anchor)}</div>)}
      {declaration.foreshadowPlanted.map((f, i) => <div className="draft-change" key={`planted-${i}`}><div><strong>新埋 · {f.label}</strong><p>{f.intent}</p><small>预期第 {f.expectedBy} 章前兑现</small></div>{evidence(f.anchor)}</div>)}
      {declaration.foreshadowResolved.map((f, i) => <div className="draft-change" key={`resolved-${i}`}><p>{f.foreshadowId} · {f.completeness === "full" ? "完整兑现" : "部分兑现，仍有剩余承诺"}</p>{evidence(f.anchor)}</div>)}
      {declaration.characterStates.length + declaration.relationsChanged.length + declaration.foreshadowPlanted.length + declaration.foreshadowResolved.length === 0 && <p className="muted">本稿没有提取额外状态、关系或伏笔变化。</p>}
    </section>}
    <section className="prep-section"><h2>检查结果</h2>{draft.status === "pending_check" && <p className="muted">修改已保存，原检查对本版本已过时；原结果仍可在历史版本查看。请选择检查或检查并采用。</p>}{draft.error !== null && <div className="finding" data-level="block"><strong>执行未完成</strong><p>{draft.error.detail}</p></div>}{draft.findings.length === 0 ? draft.status !== "pending_check" && <p className="muted">{draft.status === "ready" || draft.status === "adopted" ? "本次检查未发现问题。" : "尚无检查结果。"}</p> : draft.findings.map((finding, i) => <div className="finding" key={i} data-level={finding.level}><strong>{finding.level === "block" ? "需要处理" : finding.level === "warn" ? "建议核对" : "说明"}</strong><p>{finding.message}</p></div>)}</section>
    <section className="prep-section"><div className="section-head"><h2>正文</h2>{anchor && <Button type="text" size="small" onClick={() => setAnchor(null)}>取消定位</Button>}</div>{anchor !== null && hit < 0 && <p className="finding" data-level="warn">此处记录的引用已无法在当前正文定位，需要重新核对。</p>}<article className="draft-prose" ref={prose}>{draft.body === "" ? "尚未生成正文。" : hit < 0 || anchor === null ? draft.body : <>{draft.body.slice(0, hit)}<mark>{draft.body.slice(hit, hit + anchor.quote.length)}</mark>{draft.body.slice(hit + anchor.quote.length)}</>}</article></section>
  </>;
}
