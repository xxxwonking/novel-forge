import { useRef, useState } from "react";
import { api, type DraftView } from "../api.js";
import { useFetch } from "../hooks.js";

export function DraftEditor({ draft, onSaved, onClose }: { draft: DraftView; onSaved: (draft: DraftView) => void; onClose: () => void }): React.ReactElement {
  // 固定打开编辑器时的源版本；轮询不能悄悄替换作者尚未提交的内容或版本凭据。
  const [source] = useState(draft);
  const [body, setBody] = useState(draft.body);
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = useRef<{ content: string; id: string } | null>(null);
  const save = async (): Promise<void> => {
    if (busy || !body.trim()) return;
    setBusy(true); setError(null);
    const content = JSON.stringify([body, summary]);
    if (receipt.current?.content !== content) receipt.current = { content, id: crypto.randomUUID() };
    try {
      onSaved(await api.editDraft({ chapter: source.chapter, draftId: source.draftId, revisionToken: source.revisionToken,
        body, summary: summary.trim() || "作者手动编辑正文", requestId: receipt.current.id }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="prep-section draft-editor" aria-label="修改正文">
    <h2>修改正文</h2><p className="muted">保存为新版本，旧正文和检查结果保留。保存后可选择检查或检查并采用。</p>
    <label>正文<textarea aria-label="编辑正文" rows={16} value={body} onChange={e => setBody(e.target.value)} disabled={busy} /></label>
    <label>修改说明<input value={summary} onChange={e => setSummary(e.target.value)} placeholder="这次主要调整了什么（可选）" disabled={busy} /></label>
    {error && <p className="finding" data-level="block" role="alert">{error}</p>}
    <div className="row"><button data-primary="true" disabled={busy || !body.trim()} onClick={() => void save()}>{busy ? "保存中…" : "保存新版本"}</button><button disabled={busy} onClick={onClose}>取消编辑</button></div>
  </section>;
}

export function RevisionComparison({ draft, characters }: { draft: DraftView; characters: readonly { id: string; name: string }[] }): React.ReactElement | null {
  const sourceId = draft.revision?.sourceDraftId;
  const source = useFetch(() => sourceId === undefined ? Promise.resolve(null) : api.chapterDraft(draft.chapter, sourceId), [draft.chapter, sourceId]);
  if (draft.revision === undefined) return null;
  return <section className="revision-note">
    <strong>{draft.revision.summary}</strong><p>基于 <a href={`#/draft/${draft.chapter}/${sourceId}`}>{sourceId}</a> 保存为 {draft.draftId}。{draft.revision.rebased && "本稿已同步最新作品依据，需重新检查。"}</p>
    {source.error && <p className="muted">修改前的结果暂时无法读取：{source.error}</p>}
    {source.data && <details><summary>查看修改前后</summary>
      {source.data.body === draft.body ? <p>正文保持不变；本次调整结构记录。</p> : <div className="revision-comparison"><section><h3>修改前</h3><article>{source.data.body}</article></section><section><h3>修改后</h3><article>{draft.body}</article></section></div>}
      {source.data.body === draft.body && <div className="revision-comparison"><section><h3>修改前的记录</h3><p>{recordSummary(source.data, characters)}</p></section><section><h3>修改后的记录</h3><p>{recordSummary(draft, characters)}</p></section></div>}
    </details>}
  </section>;
}

function recordSummary(draft: DraftView, characters: readonly { id: string; name: string }[]): string {
  const d = draft.declaration;
  if (d === null) return "尚无结构记录。";
  const name = (id: string): string => characters.find(character => character.id === id)?.name ?? id;
  const words: Record<string, string> = { alive: "存活", dead: "死亡", missing: "失踪", pov: "视角人物", major: "主要出场", minor: "次要出场", mentioned: "仅被提及" };
  const state = (value: string | null): string => value === null ? "未记录" : words[value] ?? value;
  return [
    ...d.events.map(e => e.summary), ...d.characterStates.map(e => `${name(e.characterId)}：${state(e.from)} → ${state(e.to)}`),
    ...d.relationsChanged.map(e => `${name(e.from)} → ${name(e.to)}：${e.note}`),
    ...d.foreshadowPlanted.map(e => `新埋「${e.label}」：${e.intent}，预期第 ${e.expectedBy} 章`),
    ...d.foreshadowResolved.map(e => `${e.foreshadowId}：${e.completeness === "full" ? "完整兑现" : "部分兑现"}`),
    ...d.characterPresence.map(e => `${name(e.characterId)}：${state(e.role)}`),
  ].join("\n") || "没有结构记录。";
}
