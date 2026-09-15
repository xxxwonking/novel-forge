import { useEffect, useRef, useState } from "react";
import { api, type ExportSelection, type TextExportPreview } from "../api.js";

const chapterRange = (from: number, to: number) => from === to ? `第 ${from} 章` : `第 ${from}–${to} 章`;

export function Export({ exportId }: { exportId: string | null }): React.ReactElement {
  const [scope, setScope] = useState<"all" | "range">("all");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("1");
  const [preview, setPreview] = useState<TextExportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(exportId !== null);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  const operation = useRef(0);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    operation.current++;
    setBusy(false);
    let current = true;
    if (exportId === null) { setLoading(false); return; }
    setLoading(true); setError(null);
    void api.getExport(exportId).then(result => {
      if (!current) return;
      setPreview(result); setScope(result.selection.scope);
      if (result.selection.scope === "range") { setFrom(String(result.selection.from)); setTo(String(result.selection.to)); }
    }).catch(cause => { if (current) setError(cause instanceof Error ? cause.message : String(cause)); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [exportId]);

  function beginOperation(): () => boolean {
    const version = ++operation.current;
    const route = window.location.hash;
    return () => alive.current && operation.current === version && window.location.hash === route;
  }

  async function prepare(): Promise<void> {
    if (busy || loading) return;
    const start = Number(from), end = Number(to);
    if (scope === "range" && (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start)) {
      setError("请输入有效范围，结束章号应大于或等于起始章号。"); return;
    }
    const selection: ExportSelection = scope === "all" ? { scope } : { scope, from: start, to: end };
    const isCurrent = beginOperation();
    setBusy(true); setError(null);
    try {
      const result = await api.exportPreview(selection);
      if (!isCurrent()) return;
      setPreview(result);
      window.location.hash = result.id === null ? "/export" : `/export?id=${encodeURIComponent(result.id)}`;
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrent()) setBusy(false); }
  }

  async function download(): Promise<void> {
    if (busy || loading || preview?.id === null || preview === null) return;
    const isCurrent = beginOperation();
    setBusy(true); setError(null);
    try {
      const result = await api.downloadExport(preview.id);
      if (!isCurrent()) return;
      const url = URL.createObjectURL(new Blob([result.text], { type: "text/plain;charset=utf-8" }));
      const link = document.createElement("a"); link.href = url; link.download = result.filename;
      document.body.appendChild(link); link.click(); link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) { if (isCurrent()) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (isCurrent()) setBusy(false); }
  }
  const changed = preview !== null && (preview.selection.scope !== scope || (scope === "range" && preview.selection.scope === "range" && (Number(from) !== preview.selection.from || Number(to) !== preview.selection.to)));

  return <div className="export-page">
    <div className="page-head"><h1>导出正文</h1><p>选择已采用章节，核对版本后下载 TXT。候选稿保留在作品中。</p></div>
    <form className="export-form" onSubmit={event => { event.preventDefault(); void prepare(); }}>
      <fieldset disabled={busy || loading}>
        <legend>导出范围</legend>
        <div className="row"><label><input type="radio" name="export-scope" checked={scope === "all"} onChange={() => setScope("all")} />全部已采用章节</label>
          <label><input type="radio" name="export-scope" checked={scope === "range"} onChange={() => setScope("range")} />连续章号范围</label></div>
        {scope === "range" && <div className="export-range">
          <label>起始章号<input aria-label="起始章号" type="number" min="1" step="1" value={from} onChange={event => setFrom(event.target.value)} required /></label>
          <label>结束章号<input aria-label="结束章号" type="number" min="1" step="1" value={to} onChange={event => setTo(event.target.value)} required /></label>
        </div>}
        <button type="submit">{busy ? "处理中…" : preview === null ? "预览导出" : "按当前内容重新预览"}</button>
      </fieldset>
    </form>
    {error !== null && <p className="finding" data-level="block" role="alert">{error}</p>}
    {loading && <p role="status">正在读取这次固定的导出预览…</p>}
    {changed && <p className="finding" data-level="warn">范围已修改。请重新预览；下方清单和下载仍对应上一次预览。</p>}
    {preview !== null && <section className="export-preview" aria-label="本次导出预览" data-export-id={preview.id ?? "empty"}>
      <h2>本次导出预览</h2>
      <p>{preview.title} · {preview.selection.scope === "all" ? "全部已采用章节" : chapterRange(preview.selection.from, preview.selection.to)}</p>
      <p>{preview.message}</p>
      {preview.chapters.length > 0 && <>
        <p className="muted">共 {preview.chapters.length} 章 · {preview.totalWords.toLocaleString("zh-CN")} 字 · 固定于 {new Date(preview.createdAt).toLocaleString("zh-CN")}</p>
        <table><thead><tr><th>章节</th><th>正式版本</th><th className="num">字数</th></tr></thead><tbody>
          {preview.chapters.map(chapter => <tr key={chapter.chapter} data-version={chapter.version}><td>第 {chapter.chapter} 章</td><td>{chapter.draftId === null ? <span title={chapter.version}>历史正文 · {chapter.sha256.slice(0, 10)}</span> : <span title={chapter.draftId}>第 {chapter.draftId.split("d").at(-1)} 稿 <small>（{chapter.draftId}）</small></span>}</td><td className="num">{chapter.words.toLocaleString("zh-CN")}</td></tr>)}
        </tbody></table>
      </>}
      {preview.omitted.length > 0 && <div className="export-notice"><h3>未包含的章节</h3><ul>{preview.omitted.map(range => <li key={range.from}>{chapterRange(range.from, range.to)}：尚无已采用正文。</li>)}</ul></div>}
      {preview.pendingDrafts.length > 0 && <div className="export-notice"><h3>未采用稿提示</h3><ul>{preview.pendingDrafts.map(item => <li key={item.chapter}>第 {item.chapter} 章有 {item.count} 份未采用稿，未纳入本次文件。</li>)}</ul></div>}
      <div className="row"><button type="button" disabled={preview.id === null || busy || loading} onClick={() => void download()}>下载此预览 TXT</button><span className="muted">UTF-8 · 可用记事本打开</span></div>
      {preview.filename !== null && <p className="muted export-filename">{preview.filename}</p>}
    </section>}
  </div>;
}
