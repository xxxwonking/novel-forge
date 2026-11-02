import { useEffect, useRef, useState } from "react";
import { ArrowUp, Copy, MessageSquareText, X } from "lucide-react";
import { api, type PassageMessage, type PassageSelection, type PassageSource } from "../api.js";
import { Button, Textarea } from "./controls.js";
import type { PassageIntent } from "./SelectableProse.js";
export type PassageRequest = PassageSelection & { intent: PassageIntent; id: number };

export function PassageAssistant({ source, selection, onClear, onBusy }: {
  source: PassageSource; selection: PassageRequest | null; onClear: () => void; onBusy: (busy: boolean) => void;
}) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<(PassageMessage & { warning?: string })[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const generation = useRef(0);
  const sending = useRef(false);
  const results = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    generation.current++;
    setMessages([]); setError(null); setCopied(null);
    setInput(selection?.intent === "polish" ? "请润色所选段落，保留原有事实、视角和叙述风格，直接给出替代文字。" : selection?.intent === "rewrite" ? "请改写所选段落，保留原有事实与视角。我的具体要求是：" : "");
    if (selection) requestAnimationFrame(() => { inputRef.current?.focus({ preventScroll: true }); inputRef.current?.scrollIntoView({ block: "nearest" }); });
  }, [selection?.id]);
  useEffect(() => () => { generation.current++; }, []);
  useEffect(() => { results.current?.scrollTo({ top: results.current.scrollHeight }); }, [messages.length, busy]);
  const send = async () => {
    if (!selection || sending.current || !input.trim()) return;
    const ticket = generation.current, instruction = input.trim();
    sending.current = true; setBusy(true); onBusy(true); setError(null);
    try {
      const reply = await api.assistPassage({ ...source, start: selection.start, quote: selection.quote, instruction,
        history: messages.slice(-4).map(({ role, text }) => ({ role, text: text.slice(0, 6000) })) });
      if (ticket !== generation.current) return;
      setMessages(previous => [...previous, { role: "user", text: instruction }, { role: "assistant", text: reply.text,
        ...(reply.stale ? { warning: "正文已发生变化，请重新选择原文后核对建议。" } : reply.truncated ? { warning: "这条回复被截断，尚未完整生成。" } : {}) }]);
      setInput("");
    } catch (cause) { if (ticket === generation.current) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { sending.current = false; if (ticket === generation.current) { setBusy(false); onBusy(false); } }
  };
  return <section className="passage-assistant" aria-label="段落助手">
    {selection === null ? <div className="passage-empty"><MessageSquareText aria-hidden="true" /><h2>从一段文字开始</h2><p>在正文中选中不满意的句子或段落，再点「问 AI」「润色」或「改写」。</p><p>会附带相邻正文。这里只提供建议，原文由你决定如何修改。</p></div> : <>
      <section className="passage-quote" aria-label="已选原文">
        <div><strong>第 {source.chapter} 章 · {source.draftId ? "草稿选段" : "正文选段"}</strong><Button size="icon" variant="ghost" disabled={busy} aria-label="清除选段" onClick={onClear}><X aria-hidden="true" /></Button></div>
        <blockquote>{selection.quote}</blockquote>
      </section>
      <div className="passage-results" ref={results} aria-live="polite" aria-busy={busy}>
        {messages.length === 0 && <p className="muted">告诉 AI 哪里不满意，或希望保留什么。</p>}
        {messages.map((message, index) => <div className="passage-message" data-role={message.role} key={index}>
          <strong>{message.role === "user" ? "你的要求" : "AI 建议"}</strong><p>{message.text}</p>
          {message.warning && <p className="finding" data-level="warn">{message.warning}</p>}
          {message.role === "assistant" && <Button size="icon" variant="ghost" aria-label="复制段落建议" title={copied === index ? "已复制" : "复制建议"} onClick={async () => {
            try { await navigator.clipboard.writeText(message.text); setCopied(index); } catch { setError("复制失败，请选中建议文字手动复制。"); }
          }}><Copy aria-hidden="true" /></Button>}
        </div>)}
        {busy && <p role="status">正在结合所选段落思考…</p>}
      </div>
      {error && <p className="finding passage-error" data-level="block" role="alert">{error}（原文未修改，可重试。）</p>}
      <div className="passage-composer"><Textarea ref={inputRef} aria-label="段落要求" value={input} maxLength={4000} rows={3} disabled={busy}
        placeholder="例如：减少解释，用动作表现紧张…" onChange={event => setInput(event.target.value)}
        onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        <div><small>{copied !== null ? "建议已复制；原文未修改" : "建议不会直接替换正文"}</small><Button variant="default" size="icon" aria-label="发送段落要求" disabled={busy || !input.trim()} loading={busy} onClick={() => void send()}><ArrowUp aria-hidden="true" /></Button></div>
      </div>
    </>}
  </section>;
}
