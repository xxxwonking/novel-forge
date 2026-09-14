import { useRef, useState } from "react";
import { api, type DraftView } from "../api.js";

export function DraftRewriteEditor({ draft, mode, onSaved, onClose }: { draft: DraftView; mode: "rewrite" | "continue"; onSaved: (draft: DraftView) => void; onClose: () => void }): React.ReactElement {
  const [source] = useState(draft);
  const [scopeKind, setScopeKind] = useState("selection");
  const [quote, setQuote] = useState("");
  const [occurrence, setOccurrence] = useState<number | null>(null);
  const [instruction, setInstruction] = useState(mode === "continue" ? "保留已有片段，继续完成本章的目标和结尾。" : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = useRef<{ content: string; id: string } | null>(null);
  const positions: number[] = [];
  if (quote.trim()) for (let offset = source.body.indexOf(quote); offset >= 0; offset = source.body.indexOf(quote, offset + 1)) positions.push(offset);
  const chosen = positions.length === 1 ? 0 : occurrence;
  const valid = mode === "continue" || scopeKind === "chapter" || (positions.length > 0 && chosen !== null && positions[chosen] !== undefined);
  const selectText = (event: React.SyntheticEvent<HTMLTextAreaElement>): void => {
    const { selectionStart, selectionEnd } = event.currentTarget;
    if (selectionEnd <= selectionStart) return;
    const selected = source.body.slice(selectionStart, selectionEnd);
    let count = 0;
    for (let offset = source.body.indexOf(selected); offset >= 0 && offset < selectionStart; offset = source.body.indexOf(selected, offset + 1)) count++;
    setQuote(selected); setOccurrence(count);
  };
  const save = async (): Promise<void> => {
    if (busy || !valid || !instruction.trim()) return;
    setBusy(true); setError(null);
    const payload = { chapter: source.chapter, draftId: source.draftId, revisionToken: source.revisionToken, mode,
      instruction: instruction.trim(), scope: mode === "continue" || scopeKind === "chapter" ? null : { quote, occurrence: chosen! } };
    const content = JSON.stringify(payload);
    if (receipt.current?.content !== content) receipt.current = { content, id: crypto.randomUUID() };
    try { onSaved(await api.reviseDraft({ ...payload, requestId: receipt.current.id })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="prep-section draft-editor" aria-label={mode === "continue" ? "保留片段继续完成" : "按要求改写正文"}>
    <h2>{mode === "continue" ? "保留片段，继续完成" : "按要求改写正文"}</h2>
    <p className="muted">{mode === "continue" ? "已有片段原样保留，从末尾继续。完成后核对结构并检查，交付待采用的新版本。" : "选择原文范围并说明要求。范围外的正文原样保留；需要扩大范围时先展示建议。"}</p>
    {mode === "rewrite" ? <>
      <label>修改范围<select value={scopeKind} disabled={busy} onChange={event => setScopeKind(event.target.value)}><option value="selection">指定段落</option><option value="chapter">本章全文</option></select></label>
      {scopeKind === "selection" ? <>
        <label>在原文中选中要改写的内容<textarea aria-label="选择改写原文" readOnly rows={10} value={source.body} onSelect={selectText} disabled={busy} /></label>
        <label>已选原文（也可粘贴）<textarea aria-label="已选原文" rows={3} value={quote} onChange={event => { setQuote(event.target.value); setOccurrence(null); }} disabled={busy} /></label>
        {positions.length > 1 && <label>原文出现多次，请选择位置<select value={chosen ?? ""} onChange={event => setOccurrence(event.target.value === "" ? null : Number(event.target.value))} disabled={busy}><option value="">请选择</option>{positions.map((offset, n) => <option key={offset} value={n}>第 {n + 1} 处 · {source.body.slice(Math.max(0, offset - 12), offset + Math.min(quote.length, 24))}</option>)}</select></label>}
        {quote && positions.length === 0 && <p className="finding" data-level="warn">所填文字不在源稿中，请重新选择原文。</p>}
      </> : <p className="muted">本次允许修改本章全文。其他章节保持原样，新版本仍需检查和采用。</p>}
    </> : <details><summary>查看保留片段的结尾</summary><pre className="rewrite-excerpt">{source.body.slice(-1200)}</pre></details>}
    <label>{mode === "continue" ? "续写要求" : "改写要求"}<textarea aria-label={mode === "continue" ? "续写要求" : "改写要求"} rows={3} value={instruction} onChange={event => setInstruction(event.target.value)} placeholder="例如：先加一轮试探再答应，保留结尾的决定" disabled={busy} /></label>
    {error && <p className="finding" data-level="block" role="alert">{error}</p>}
    <div className="row"><button data-primary="true" disabled={busy || !valid || !instruction.trim()} onClick={() => void save()}>{busy ? "保存任务中…" : mode === "continue" ? "开始续写" : "开始改写"}</button><button disabled={busy} onClick={onClose}>取消</button></div>
  </section>;
}
