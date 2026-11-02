import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { createPortal } from "react-dom";
import { MessageSquare, Pencil, WandSparkles } from "lucide-react";
import { Button } from "./ui/button.js";
import type { PassageSelection } from "../api.js";
export type PassageIntent = "ask" | "polish" | "rewrite";

/** 每段保留原文偏移，跨段、重复句子与高亮都按确切DOM位置定位。 */
export function SelectableProse({ text, className, hit, markRef, onSelect, disabled = false, articleRef, children }: {
  text: string; className: string; hit?: { offset: number; length: number } | null;
  markRef?: Ref<HTMLElement>; onSelect: (selection: PassageSelection, intent: PassageIntent) => void;
  disabled?: boolean; children?: ReactNode; articleRef?: { current: HTMLElement | null };
}) {
  const root = useRef<HTMLElement | null>(null);
  const [selection, setSelection] = useState<(PassageSelection & { left: number; top: number }) | null>(null);
  useEffect(() => {
    const read = () => {
      const selected = window.getSelection();
      if (disabled || !selected || selected.isCollapsed || selected.rangeCount !== 1 || !root.current) { setSelection(null); return; }
      const range = selected.getRangeAt(0);
      const point = (node: Node, offset: number): number | null => {
        const p = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("p[data-source-start]");
        if (!p || !root.current?.contains(p)) return null;
        const before = document.createRange(); before.selectNodeContents(p); before.setEnd(node, offset);
        return Number(p.dataset.sourceStart) + before.toString().length;
      };
      const start = point(range.startContainer, range.startOffset), end = point(range.endContainer, range.endOffset);
      if (start === null || end === null || end <= start || !text.slice(start, end).trim()) { setSelection(null); return; }
      const rect = range.getBoundingClientRect();
      setSelection({ start, quote: text.slice(start, end), left: Math.max(8, Math.min(window.innerWidth - 282, rect.left)), top: Math.max(8, Math.min(window.innerHeight - 52, rect.top - 50)) });
    };
    document.addEventListener("selectionchange", read);
    document.addEventListener("scroll", read, true);
    return () => { document.removeEventListener("selectionchange", read); document.removeEventListener("scroll", read, true); };
  }, [text, disabled]);
  const choose = (intent: PassageIntent) => {
    if (!selection || selection.quote.length > 12000) return;
    onSelect({ start: selection.start, quote: selection.quote }, intent);
    window.getSelection()?.removeAllRanges(); setSelection(null);
  };
  return <>
    <article ref={node => { root.current = node; if (articleRef) articleRef.current = node; }} className={className}>
      {[...text.matchAll(/[^\r\n]+/gu)].filter(match => match[0].trim()).map(match => {
        const start = match.index, content = match[0];
        const from = Math.max(start, hit?.offset ?? -1), to = Math.min(start + content.length, (hit?.offset ?? -1) + (hit?.length ?? 0));
        return <p key={start} data-source-start={start}>{hit && from < to ? <>
          <span>{text.slice(start, from)}</span><mark ref={markRef}>{text.slice(from, to)}</mark><span>{text.slice(to, start + content.length)}</span>
        </> : <span>{content}</span>}</p>;
      })}
      {children}
    </article>
    {selection && createPortal(<div className="passage-selection-tools" role="toolbar" aria-label="所选段落操作" style={{ left: selection.left, top: selection.top }} onPointerDown={event => event.preventDefault()}>
      {selection.quote.length > 12000 ? <span role="status">选段过长，请缩小到12000字以内</span> : <>
        <Button variant="ghost" size="sm" aria-label="询问所选段落" onClick={() => choose("ask")}><MessageSquare aria-hidden="true" />问 AI</Button>
        <Button variant="ghost" size="sm" aria-label="润色所选段落" onClick={() => choose("polish")}><WandSparkles aria-hidden="true" />润色</Button>
        <Button variant="ghost" size="sm" aria-label="改写所选段落" onClick={() => choose("rewrite")}><Pencil aria-hidden="true" />改写</Button>
      </>}
    </div>, document.body)}
  </>;
}
