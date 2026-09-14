import { useEffect, useRef, useState } from "react";
import type { AlertAction } from "../api.js";

export type EditablePlanningAction = Extract<AlertAction, { kind: "reschedule" | "abandon" }>;
export function PlanningActionDialog({ title, action, currentChapter, onApply, onClose }: {
  title: string; action: EditablePlanningAction; currentChapter: number;
  onApply: (action: EditablePlanningAction, reason?: string) => Promise<void>; onClose: () => void;
}): React.ReactElement {
  const dialog = useRef<HTMLDialogElement>(null);
  const [chapter, setChapter] = useState(String(action.kind === "reschedule" ? Math.max(currentChapter + 1, action.expectedBy + 1) : currentChapter + 1));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const node = dialog.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog className="planning-dialog" ref={dialog} aria-labelledby="planning-dialog-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <form onSubmit={event => {
      event.preventDefault();
      if (busy) return;
      const expectedBy = Number(chapter);
      if (action.kind === "reschedule" && (!Number.isSafeInteger(expectedBy) || expectedBy <= currentChapter)) { setError("请输入未来的正整数章号。"); return; }
      setBusy(true); setError(null);
      void onApply(action.kind === "reschedule" ? { ...action, expectedBy } : action, reason)
        .then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
    }}>
      <h2 id="planning-dialog-title">{action.kind === "reschedule" ? "调整预期兑现期限" : "放弃这条伏笔"}</h2>
      <p>{title}</p>
      <fieldset disabled={busy}>
        {action.kind === "reschedule" ? <>
          <label htmlFor="planning-chapter">新的预期章号</label><input id="planning-chapter" type="number" min={currentChapter + 1} step="1" value={chapter} onChange={event => setChapter(event.target.value)} required autoFocus />
          <p className="muted">原期限是第 {action.expectedBy} 章。这里只调整预期期限，已有具体章节安排会保留，伏笔仍未兑现。</p>
        </> : <>
          <label htmlFor="planning-reason">放弃原因（可选）</label><textarea id="planning-reason" value={reason} onChange={event => setReason(event.target.value)} rows={3} autoFocus />
          <p className="muted">保留原文和历史，移除未来章节的相关回收安排，并重算这些章节的预算。放弃会单独记录。</p>
        </>}
        {error !== null && <p className="finding" data-level="block" role="alert">{error}</p>}
        <div className="row"><button type="submit">{busy ? "保存中…" : action.kind === "reschedule" ? "保存新期限" : "确认放弃"}</button><button type="button" data-quiet onClick={onClose}>取消</button></div>
      </fieldset>
    </form>
  </dialog>;
}
