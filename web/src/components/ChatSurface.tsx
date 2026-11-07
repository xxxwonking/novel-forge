import { useEffect, useRef, useState, type ReactNode } from "react";
import { Maximize2, PanelRightClose } from "lucide-react";
import { Button } from "./ui/button.js";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "./ui/sheet.js";

export type ChatPresentation = "full" | "dock" | "hidden";
const WIDTH_KEY = "novel-forge-chat-width";
const MIN_WIDTH = 360;
const DEFAULT_WIDTH = 420;

function savedWidth(): number {
  try {
    const value = Number(localStorage.getItem(WIDTH_KEY));
    return Number.isFinite(value) && value >= MIN_WIDTH ? Math.min(640, value) : DEFAULT_WIDTH;
  } catch { return DEFAULT_WIDTH; }
}

/** 只改变呈现位置；会话和流式请求由上层 Chat 持有，不随 Sheet 的卸载丢失。 */
export function ChatSurface({ presentation, onClose, onExpand, onVisible, dismissNested, children }: {
  presentation: ChatPresentation;
  onClose: () => void;
  onExpand: () => void;
  onVisible: () => void;
  dismissNested: (() => void) | undefined;
  children: ReactNode;
}): React.ReactElement | null {
  const [viewport, setViewport] = useState(() => window.innerWidth);
  const [preferredWidth, setPreferredWidth] = useState(savedWidth);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const narrow = viewport < 1200;
  const maxWidth = Math.max(MIN_WIDTH, Math.min(640, viewport - 236 - 520));
  const width = Math.min(preferredWidth, maxWidth);
  const visible = useRef(onVisible);
  visible.current = onVisible;
  useEffect(() => {
    const resize = () => setViewport(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);
  useEffect(() => {
    try { localStorage.setItem(WIDTH_KEY, String(preferredWidth)); } catch { /* 隐私模式仍可使用。 */ }
  }, [preferredWidth]);
  useEffect(() => {
    if (presentation === "hidden") return;
    const frame = requestAnimationFrame(() => visible.current());
    return () => cancelAnimationFrame(frame);
  }, [presentation, narrow]);
  const resize = (value: number) => setPreferredWidth(Math.max(MIN_WIDTH, Math.min(maxWidth, value)));
  const tools = <div className="chat-dock-tools">
    <Button size="icon" variant="ghost" aria-label="展开为独立对话" title="展开为独立对话" onClick={onExpand}><Maximize2 aria-hidden="true" /></Button>
    <Button size="icon" variant="ghost" aria-label="收起 AI 助手" title="收起 AI 助手" onClick={onClose}><PanelRightClose aria-hidden="true" /></Button>
  </div>;

  if (presentation === "hidden") return null;
  if (presentation === "full") return <section className="chat-full" aria-label="对话">{children}</section>;
  if (narrow) return <Sheet open onOpenChange={open => { if (!open) (dismissNested ?? onClose)(); }}>
    <SheetContent side="right" className="chat-drawer w-[min(480px,100vw)] sm:max-w-none h-dvh gap-0" showCloseButton={false}
      // 内层刚挂载时 Radix 的层级注册可能尚未完成，Escape 仍须只关闭内层。
      onEscapeKeyDown={event => { if (dismissNested) { event.preventDefault(); dismissNested(); } }}
      onPointerDownOutside={event => { if (dismissNested) event.preventDefault(); }}
      onCloseAutoFocus={event => {
        event.preventDefault();
        // 没有 SheetTrigger，入口在主区；跨断点/跳到正文时也回到当前可见入口。
        document.getElementById("chat-dock-trigger")?.focus();
      }}>
      <header className="chat-dock-bar"><div><SheetTitle>AI 助手</SheetTitle><SheetDescription>讨论、查资料，准备下一章</SheetDescription></div>{tools}</header>
      {children}
    </SheetContent>
  </Sheet>;
  return <aside className="chat-dock" aria-label="AI 助手" style={{ width }}>
    <div className="chat-dock-resize" role="separator" tabIndex={0} aria-label="调整 AI 助手宽度" aria-orientation="vertical"
      aria-valuemin={MIN_WIDTH} aria-valuemax={maxWidth} aria-valuenow={Math.round(width)} aria-valuetext={`${Math.round(width)} 像素`}
      title="拖动调整宽度；方向键微调，Home/End 最窄/最宽"
      onKeyDown={event => {
        const value = event.key === "ArrowLeft" ? width + 24 : event.key === "ArrowRight" ? width - 24 : event.key === "Home" ? MIN_WIDTH : event.key === "End" ? maxWidth : null;
        if (value !== null) { event.preventDefault(); resize(value); }
      }}
      onDoubleClick={() => resize(DEFAULT_WIDTH)}
      onPointerDown={event => {
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault();
        event.currentTarget.focus();
        drag.current = { x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={event => { if (drag.current) resize(drag.current.width + drag.current.x - event.clientX); }}
      onPointerUp={event => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { drag.current = null; }} onLostPointerCapture={() => { drag.current = null; }} />
    <header className="chat-dock-bar"><div><h2>AI 助手</h2><p>讨论、查资料，准备下一章</p></div>{tools}</header>
    {children}
  </aside>;
}
