import type { TextAnchor } from "./alert-types.js";

export type SourcePosition = Pick<TextAnchor, "offsetHint" | "occurrence">;
export type JumpToSource = (chapter: number, quote: string, position?: SourcePosition) => void;

/** 所有原文入口共享定位参数；不把重复引文重置到第一处。 */
export function chapterRoute(chapter: number, quote = "", position?: SourcePosition): string {
  if (quote === "") return `/chapter/${chapter}`;
  const query = new URLSearchParams({ quote });
  if (position) {
    query.set("offsetHint", String(position.offsetHint));
    query.set("occurrence", String(position.occurrence));
  }
  return `/chapter/${chapter}?${query}`;
}

export function anchorFromQuery(chapter: number, query: URLSearchParams): TextAnchor | null {
  const quote = query.get("quote");
  if (!quote) return null;
  const number = (field: string): number => {
    const raw = query.get(field);
    const value = raw !== null && /^\d+$/u.test(raw) ? Number(raw) : 0;
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
  };
  return { chapter, quote, offsetHint: number("offsetHint"), occurrence: number("occurrence") };
}
