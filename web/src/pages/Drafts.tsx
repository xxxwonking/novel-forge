import { useRef, useState } from "react";
import { api, type TextAnchor } from "../api.js";
import { useFetch } from "../hooks.js";

const states: Record<string, string> = { writing: "正文未完成", declaring: "结构核对未完成", checking: "检查未完成", failed: "执行未完成", needs_revision: "需要修改", ready: "待采用", adopted: "已采用", stale: "依据已变化，需重新核对", discarded: "已丢弃" };

export function Drafts({ chapter, draftId, refresh }: { chapter: number; draftId: string; refresh: () => void }): React.ReactElement {
  const query = useFetch(() => api.chapterDraft(chapter, draftId), [chapter, draftId]);
  const versions = useFetch(() => api.chapterDrafts(chapter), [chapter, draftId]);
  const preparation = useFetch(() => api.preparation(), [chapter, draftId]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [anchor, setAnchor] = useState<TextAnchor | null>(null);
  const prose = useRef<HTMLElement | null>(null);
  if (query.data === null) return <div className="empty">{query.error ?? "读取章节结果…"}<button onClick={query.reload}>重试</button></div>;
  const draft = query.data;
  const declaration = draft.declaration;
  const dependency = preparation.data?.proposals.find((p) => p.id === draft.preparationProposalId);
  const names = dependency?.content.characters ?? preparation.data?.confirmed.characters ?? [];
  const name = (id: string): string => names.find((c) => c.id === id)?.name ?? id;
  const reload = (): void => { query.reload(); versions.reload(); preparation.reload(); refresh(); };
  const goDraft = (n: number, id: string): void => { window.location.hash = `/draft/${n}/${id}`; setAnchor(null); };
  const perform = async (action: "adopt" | "continue" | "resume" | "new" | "discard"): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    let adopted = false;
    try {
      if (action === "adopt" || action === "continue") {
        await api.adopt(chapter, draftId); adopted = true; reload();
        setNotice(`已采用第 ${chapter} 章。${action === "continue" ? "正在准备下一章…" : "它已成为后续创作依据。"}`);
      }
      if (action === "discard") { await api.discard(chapter, draftId); setNotice("草稿已丢弃，历史内容仍可查看。"); }
      if (action === "resume" || action === "new" || action === "continue") {
        const next = await api.writeChapter(action === "continue" ? { chapter: chapter + 1 }
          : action === "resume" ? { chapter, draftId }
            : { chapter, newDraft: true, ...(draft.preparationProposalId === null ? {} : { proposalId: draft.preparationProposalId }) });
        goDraft(next.chapter, next.draftId);
      }
    } catch (e) { setError(`${adopted ? `第 ${chapter} 章已采用；下一章尚未完成：` : ""}${(e as Error).message}`); }
    finally { setBusy(false); reload(); }
  };
  const evidence = (a: TextAnchor): React.ReactElement => <button data-quiet="true" onClick={() => { setAnchor(a); requestAnimationFrame(() => prose.current?.querySelector("mark")?.scrollIntoView({ behavior: "smooth", block: "center" })); }}>查看原文 ↗</button>;
  const offsets: number[] = [];
  if (anchor !== null && anchor.quote !== "") {
    let offset = draft.body.indexOf(anchor.quote);
    while (offset >= 0) { offsets.push(offset); offset = draft.body.indexOf(anchor.quote, offset + 1); }
  }
  const hit = anchor === null ? -1 : offsets[anchor.occurrence] ?? -1;

  return <>
    <div className="page-head"><h1>第 {chapter} 章 · 章节结果</h1><p>先看这一章发生了什么，再核对原文。待采用内容保留在当前稿中。</p></div>
    <div className="draft-toolbar"><span className="tag" data-tone={draft.status === "needs_revision" ? "warn" : "calm"}>{states[draft.status] ?? draft.status}</span><span>{draft.words} 字</span><label>版本 <select aria-label="稿件版本" value={draftId} onChange={(e) => goDraft(chapter, e.target.value)}>{(versions.data ?? [draft]).map((d) => <option key={d.draftId} value={d.draftId}>{d.draftId} · {states[d.status] ?? d.status}</option>)}</select></label><a href="#/preparation">作品资料</a></div>
    {draft.preparationProposalId !== null && <div className="prep-readiness"><div><strong>依赖方案：{dependency?.summary ?? "正在读取"}</strong><p>{dependency?.status === "confirmed" ? "此方案已确认。" : "这份草稿使用了尚未确认的建议设定。采用章节时会一并确认该方案。"}</p></div><a href={`#/preparation?proposal=${encodeURIComponent(draft.preparationProposalId)}`}>查看依赖</a></div>}
    {(error ?? query.error) && <div className="finding" data-level="block" role="alert">{error ?? query.error}</div>}
    {notice && <p className="prep-notice" role="status">{notice}</p>}
    <div className="draft-actions row">
      {draft.status === "ready" && draft.acceptable && <><button data-primary="true" disabled={busy} onClick={() => void perform("continue")}>采用并继续下一章</button><button disabled={busy} onClick={() => void perform("adopt")}>采用这一版</button></>}
      {["failed", "writing", "declaring", "checking"].includes(draft.status) && <button disabled={busy} onClick={() => void perform("resume")}>继续未完成步骤</button>}
      {draft.status !== "discarded" && <button disabled={busy} onClick={() => void perform("new")}>另写一版</button>}
      {draft.status !== "adopted" && draft.status !== "discarded" && <button data-quiet="true" disabled={busy} onClick={() => void perform("discard")}>丢弃这份草稿</button>}
      {draft.status === "adopted" && <a href={`#/chapter/${chapter}`}>查看正式正文 →</a>}
    </div>
    <section className="prep-section"><h2>本章摘要</h2>{declaration === null ? <p className="muted">结构核对尚未完成，已有正文保留在下方。</p> : declaration.events.length === 0 ? <p className="muted">本稿未提取独立剧情事件，可直接阅读正文。</p> : declaration.events.map((event, i) => <div className="draft-change" key={i}><p>{event.summary}</p>{evidence(event.anchor)}</div>)}</section>
    {declaration !== null && <section className="prep-section"><h2>人物、关系与伏笔变化 <span className="tag">{draft.status === "adopted" ? "本版本的结构记录" : "待采用变化"}</span></h2>
      {declaration.characterStates.map((change, i) => <div className="draft-change" key={`state-${i}`} data-important={change.field === "vital" || change.to === "dead"}><div><strong>{name(change.characterId)}</strong><p>{change.field}：{change.from ?? "未记录"} → {change.to}</p></div>{evidence(change.anchor)}</div>)}
      {declaration.relationsChanged.map((change, i) => <div className="draft-change" key={`relation-${i}`}><div><strong>{name(change.from)} → {name(change.to)}</strong><p>{change.note}（{change.fromKind ?? "未记录"} → {change.toKind}）</p></div>{evidence(change.anchor)}</div>)}
      {declaration.foreshadowPlanted.map((f, i) => <div className="draft-change" key={`planted-${i}`}><div><strong>新埋 · {f.label}</strong><p>{f.intent}</p><small>预期第 {f.expectedBy} 章前兑现</small></div>{evidence(f.anchor)}</div>)}
      {declaration.foreshadowResolved.map((f, i) => <div className="draft-change" key={`resolved-${i}`}><p>{f.foreshadowId} · {f.completeness === "full" ? "完整兑现" : "部分兑现，仍有剩余承诺"}</p>{evidence(f.anchor)}</div>)}
      {declaration.characterStates.length + declaration.relationsChanged.length + declaration.foreshadowPlanted.length + declaration.foreshadowResolved.length === 0 && <p className="muted">本稿没有提取额外状态、关系或伏笔变化。</p>}
    </section>}
    <section className="prep-section"><h2>检查结果</h2>{draft.error !== null && <div className="finding" data-level="block"><strong>执行未完成</strong><p>{draft.error.detail}</p></div>}{draft.findings.length === 0 ? <p className="muted">{draft.status === "ready" || draft.status === "adopted" ? "本次检查未发现问题。" : "尚无检查结果。"}</p> : draft.findings.map((finding, i) => <div className="finding" key={i} data-level={finding.level}><strong>{finding.level === "block" ? "需要处理" : finding.level === "warn" ? "建议核对" : "说明"}</strong><p>{finding.message}</p></div>)}</section>
    {draft.proposals.length > 0 && <section className="prep-section"><h2>写作中补充的建议</h2><p className="muted">这些建议尚未作为正式资料，需单独整理确认。</p>{draft.proposals.map((p, i) => <p key={i}>{p.name ?? p.label}：{p.value ?? p.intent} {p.reason}</p>)}</section>}
    <section className="prep-section"><div className="section-head"><h2>正文</h2>{anchor && <button data-quiet="true" onClick={() => setAnchor(null)}>取消定位</button>}</div>{anchor !== null && hit < 0 && <p className="finding" data-level="warn">此处记录的引用已无法在当前正文定位，需要重新核对。</p>}<article className="draft-prose" ref={prose}>{draft.body === "" ? "尚未生成正文。" : hit < 0 || anchor === null ? draft.body : <>{draft.body.slice(0, hit)}<mark>{draft.body.slice(hit, hit + anchor.quote.length)}</mark>{draft.body.slice(hit + anchor.quote.length)}</>}</article></section>
  </>;
}
