import { useState } from "react";
import { Alert, Button, Input, InputNumber, Modal } from "antd";
import type { AlertAction } from "../api.js";

export type EditablePlanningAction = Extract<AlertAction, { kind: "reschedule" | "abandon" }>;

export function PlanningActionDialog({ title, action, currentChapter, completed = false, onApply, onClose }: {
  title: string; action: EditablePlanningAction; currentChapter: number;
  /** 作品已完结时期限可以改到已写的章（§57）；下限由服务端同一条规则兜底。 */
  completed?: boolean;
  onApply: (action: EditablePlanningAction, reason?: string) => Promise<void>; onClose: () => void;
}): React.ReactElement {
  const reschedule = action.kind === "reschedule";
  const minChapter = completed ? 1 : currentChapter + 1;
  const [chapter, setChapter] = useState<number | null>(reschedule ? (completed ? action.expectedBy : Math.max(currentChapter + 1, action.expectedBy + 1)) : currentChapter + 1);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    if (busy) return;
    const expectedBy = Number(chapter);
    if (reschedule && (!Number.isSafeInteger(expectedBy) || expectedBy < minChapter)) { setError(completed ? "请输入正整数章号。" : "请输入未来的正整数章号。"); return; }
    setBusy(true); setError(null);
    void onApply(reschedule ? { ...action, expectedBy } : action, reason)
      .then(onClose).catch(cause => setError(cause instanceof Error ? cause.message : String(cause))).finally(() => setBusy(false));
  };

  return (
    <Modal
      open
      className="planning-dialog"
      title={reschedule ? "调整预期兑现期限" : "放弃这条伏笔"}
      onCancel={() => { if (!busy) onClose(); }}
      maskClosable={!busy}
      afterOpenChange={(open) => { if (open) document.querySelector<HTMLElement>(".planning-dialog .ant-input-number-input, .planning-dialog textarea")?.focus(); }}
      footer={[
        <Button key="cancel" disabled={busy} onClick={onClose}>取消</Button>,
        <Button key="ok" type="primary" loading={busy} onClick={submit}>{reschedule ? "保存新期限" : "确认放弃"}</Button>,
      ]}
    >
      <p className="planning-target">{title}</p>
      {reschedule ? (
        <>
          <label htmlFor="planning-chapter">新的预期章号</label>
          <InputNumber id="planning-chapter" min={minChapter} step={1} value={chapter} onChange={setChapter} disabled={busy} style={{ width: "100%" }} />
          <p className="muted">原期限是第 {action.expectedBy} 章。这里只调整预期期限，已有具体章节安排会保留，伏笔仍未兑现。{completed ? "这本书已标记为完结，可以改到已经写好的章，如实记下它兑现在哪。" : ""}</p>
        </>
      ) : (
        <>
          <label htmlFor="planning-reason">放弃原因（可选）</label>
          <Input.TextArea id="planning-reason" value={reason} onChange={event => setReason(event.target.value)} rows={3} disabled={busy} />
          <p className="muted">保留原文和历史，移除未来章节的相关回收安排，并重算这些章节的预算。放弃会单独记录。</p>
        </>
      )}
      {error !== null && <Alert type="error" showIcon message={error} role="alert" style={{ marginTop: 12 }} />}
    </Modal>
  );
}
