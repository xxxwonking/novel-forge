import { useState } from "react";
import { selectedProjectId } from "../api.js";

export interface DraftBuffer { body: string; summary: string; revisionToken: string; receipt: { content: string; id: string } | null }

/** 浏览器缓冲不是版本稿；只在作者明确恢复后放进编辑器。 */
export function useDraftBuffer(chapter: number, draftId: string) {
  const [key] = useState(() => `novel-forge:editor:${selectedProjectId() ?? "default"}:${chapter}:${draftId}`);
  const [initial] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return { buffer: null, status: "" };
      const data = JSON.parse(raw) as DraftBuffer;
      if (!data || typeof data.body !== "string" || typeof data.summary !== "string" || !/^[a-f0-9]{64}$/.test(data.revisionToken) ||
        (data.receipt !== null && (!data.receipt || typeof data.receipt.content !== "string" || typeof data.receipt.id !== "string"))) throw new Error("invalid buffer");
      return { buffer: data, status: "发现此稿未保存的编辑" };
    } catch { return { buffer: null, status: "无法读取编辑缓冲；请留意手动保存" }; }
  });
  const [recovery, setRecovery] = useState(initial.buffer);
  const [status, setStatus] = useState(initial.status);
  const write = (buffer: DraftBuffer) => {
    try { localStorage.setItem(key, JSON.stringify(buffer)); setStatus("编辑缓冲已保存在此浏览器"); }
    catch { setStatus("浏览器未能保存缓冲，请及时保存新版本或复制正文"); }
  };
  const clear = () => {
    try { localStorage.removeItem(key); setStatus(""); setRecovery(null); }
    catch { setStatus("缓冲未能清除；下次恢复前请核对稿件版本"); }
  };
  return { recovery, status, write, clear, recovered: () => { setRecovery(null); setStatus("编辑缓冲已保存在此浏览器"); } };
}
