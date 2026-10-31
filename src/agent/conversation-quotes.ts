import { createHash } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import { quoteCatalog } from "../chapter/quote-catalog.js";
import type { ChapterExcerpt } from "../task/tool-exec.js";

type ReadChapter = (chapter: number, excerpt: ChapterExcerpt) => string | null;
type ReadRequest = { kind: "chapter"; chapter: number; excerpt: ChapterExcerpt } | { kind: "draft"; draftId: string };
interface Source { chapter: number; excerpt: ChapterExcerpt; digest: string; text: string; entries: readonly { text: string }[] }
const DIVIDER = "\n\n【对话原文引用目录】\n";
const HIDDEN = "（引文无法在当前原文中核验，已隐藏；请重新读取对应章节或草稿。）";
const REF = /^\[\[quote:(\d+):(full|head|tail):([a-f0-9]{16}):(\d+)\]\]$/u;
const ANY_REF = String.raw`\[\[quote\b[^\r\n]*?(?:\]\]|(?=\r?\n|$))`;
const CLAIM = String.raw`(?:原文(?:引句|出处)?|引文|原句|原话|逐字引用|摘录)[\t ]*(?:(?:是|为|写道|写的是)[\t ]*)?[:：]?[\t ]*(?=[“"'「『])`;
const PROSE_TOKEN = new RegExp(`${ANY_REF}|${CLAIM}[^\r\n]*`, "gu");
// 接受普通/缩进/列表中的 Markdown 引文；不把概括或假设误认成已验证原文。
const BLOCK = /(?:^[\t ]*(?:(?:[-*+]|\d+[.)])[\t ]+)?>[^\n]*(?:\n|$))+/gmu;
const PREFIX = /^[\t ]*(?:(?:[-*+]|\d+[.)])[\t ]+)?>[\t ]?/u;
const UNSAFE = /(?:^[\t ]*(?:(?:[-*+]|\d+[.)])[\t ]+)?>|\[\[|原文|引文|原句|原话|逐字引用|摘录)/mu;
const digestOf = (text: string) => createHash("sha256").update(text).digest("hex").slice(0, 16);
const keyOf = (chapter: number, excerpt: ChapterExcerpt, digest: string) => `${chapter}:${excerpt}:${digest}`;

export const CONVERSATION_QUOTE_INSTRUCTIONS = `## 原文与概括
- get_chapter_text 返回原文和引用目录。引用原文时只输出目录里的完整 [[quote:...]] 编号，由程序复制原句并标注章号；不要抄写、换代词、改标点或拼接两处文字。
- Markdown 的 > 引文格式只用于逐字原文，必须与当前已读取的正文连续对应；无效或过期的引用会被隐藏。引用旧对话中的原文前先重新读取对应章节。
- get_chapter_draft 返回的草稿正文可以逐字引用，但必须注明是草稿，不能当成已采用事实；检查摘要与状态字段不是正文。
- 你的概括、推测、假设与新写示例使用普通文字并明确说明性质，不要冒充原文，也不要使用 > 引文格式。未核对的历史引用不能当作已确认事实。`;

/** 每个工具循环独立持有出处；历史只恢复执行成功的读工具，不信任助手自报编号。 */
export class ConversationQuotes {
  private readonly sources = new Map<string, Source>();
  private readonly drafts = new Set<string>();

  constructor(private readonly read: ReadChapter, history: readonly Anthropic.MessageParam[] = [], private readonly readDraft?: (id: string) => string) {
    const reads = new Map<string, ReadRequest>();
    for (const message of history) {
      if (!Array.isArray(message.content)) continue;
      for (const b of message.content) {
        if (message.role === "assistant" && b.type === "tool_use") {
          reads.delete(b.id);
          const input = b.input as Record<string, unknown>;
          if (b.name === "get_chapter_text" && input && typeof input.chapter === "number" && Number.isSafeInteger(input.chapter) && input.chapter > 0) {
            reads.set(b.id, { kind: "chapter", chapter: input.chapter, excerpt: input.excerpt === "head" || input.excerpt === "tail" ? input.excerpt : "full" });
          } else if (b.name === "get_chapter_draft" && typeof input?.draftId === "string") {
            reads.set(b.id, { kind: "draft", draftId: input.draftId });
          }
        } else if (message.role === "user" && b.type === "tool_result") {
          const source = reads.get(b.tool_use_id);
          reads.delete(b.tool_use_id);
          if (!source || b.is_error || typeof b.content !== "string") continue;
          if (source.kind === "draft") { this.draft(source.draftId, b.content); continue; }
          const end = b.content.lastIndexOf(DIVIDER);
          this.remember(source.chapter, source.excerpt, end < 0 ? b.content : b.content.slice(0, end));
        }
      }
    }
  }

  /** 草稿正文与正式正文分开；JSON 的状态、检查摘要等不能冒充正文。 */
  draft(id: string, payload: string): string {
    if (draftBody(payload, id) !== null) this.drafts.add(id);
    return payload;
  }

  private remember(chapter: number, excerpt: ChapterExcerpt, text: string): Source {
    const source = { chapter, excerpt, digest: digestOf(text), text, entries: quoteCatalog(text).entries };
    this.sources.set(keyOf(chapter, excerpt, source.digest), source);
    return source;
  }

  source(chapter: number, excerpt: ChapterExcerpt, text: string): string {
    const source = this.remember(chapter, excerpt, text);
    return text + DIVIDER + "引用时仅选下面的完整编号，程序回填原文；不要自行重写引句。\n" + source.entries.map((entry, i) =>
      `[[quote:${keyOf(chapter, excerpt, source.digest)}:${i + 1}]] ${JSON.stringify(entry.text)}`).join("\n");
  }

  render(text: string): string {
    const current = new Map<string, string | null>();
    const load = (source: Source): string | null => {
      const key = `${source.chapter}:${source.excerpt}`;
      if (!current.has(key)) {
        try { current.set(key, this.read(source.chapter, source.excerpt)); }
        catch { current.set(key, null); }
      }
      return current.get(key) ?? null;
    };
    const resolve = (ref: string): { chapter: number; text: string } | null => {
      const match = REF.exec(ref);
      if (!match) return null;
      const chapter = Number(match[1]), excerpt = match[2] as ChapterExcerpt, digest = match[3]!;
      const source = this.sources.get(keyOf(chapter, excerpt, digest));
      if (!source) return null;
      const body = load(source), entry = source.entries[Number(match[4]) - 1];
      if (body === null || digestOf(body) !== digest || !entry || !body.includes(entry.text)) return null;
      return { chapter, text: entry.text };
    };
    const currentDrafts = new Map<string, string | null>();
    const literal = (content: string): { text: string; label: string } | null => {
      // 兼容旧式逐字引用。只移除包裹引用的成对符号；不改正文内部字节。
      const candidates = [content];
      for (const [open, close] of [["“", "”"], ["‘", "’"], ['"', '"'], ["「", "」"], ["『", "』"]]) {
        if (content.startsWith(open!) && content.endsWith(close!)) candidates.push(content.slice(open!.length, -close!.length));
      }
      for (const candidate of candidates) {
        if (candidate.trim() === "") continue;
        for (const source of this.sources.values()) {
          if (load(source)?.includes(candidate)) return { text: candidate, label: `第 ${source.chapter} 章原文` };
        }
        for (const id of this.drafts) {
          if (!currentDrafts.has(id)) {
            try { currentDrafts.set(id, this.readDraft ? draftBody(this.readDraft(id), id) : null); }
            catch { currentDrafts.set(id, null); }
          }
          if (currentDrafts.get(id)?.includes(candidate)) return { text: candidate, label: `草稿 ${id} 原文，尚未采用` };
        }
      }
      return null;
    };
    const prose = (raw: string) => raw.replace(PROSE_TOKEN, token => {
      if (token.startsWith("[[quote")) {
        const quote = resolve(token);
        return quote ? `“${quote.text}”（第 ${quote.chapter} 章原文）` : HIDDEN;
      }
      // 显式“原文：…”声明整行核验，不能只匹配其中一小段就放行剩余改写。
      const prefix = new RegExp(CLAIM, "u").exec(token)![0];
      const found = literal(token.slice(prefix.length));
      return found === null ? prefix + HIDDEN : `${token}（${found.label}）`;
    });
    const block = (raw: string): string => {
      const content = raw.split("\n").map(line => line.replace(PREFIX, "")).join("\n").trim();
      const lines = content.split(/\r?\n/u).map(x => x.trim()).filter(Boolean);
      const resolved = lines.map(resolve);
      if (lines.length > 0 && resolved.every(q => q !== null)) {
        return resolved.map(q => `> ${q!.text}\n（第 ${q!.chapter} 章原文）`).join("\n\n");
      }
      const found = literal(content);
      return found === null ? HIDDEN : found.text.split("\n").map(line => `> ${line}`).join("\n") + `\n（${found.label}）`;
    };
    // 原文回填后不再解析其中的标记：书里的保留字符也是普通数据。
    let end = 0, result = "";
    for (const match of text.matchAll(BLOCK)) {
      result += prose(text.slice(end, match.index)) + block(match[0]) + (match[0].endsWith("\n") ? "\n" : "");
      end = match.index + match[0].length;
    }
    return result + prose(text.slice(end));
  }
}

function draftBody(payload: string, id: string): string | null {
  try {
    const value = JSON.parse(payload) as { draftId?: unknown; body?: unknown } | null;
    return value !== null && value.draftId === id && typeof value.body === "string" ? value.body : null;
  } catch { return null; }
}

/** 普通文本照常增量输出；潜在引用从开头起缓冲，完整校验后才可见。 */
export class ConversationQuoteStream {
  private raw = "";
  private emitted = "";
  private buffered = false;
  constructor(private readonly quotes: ConversationQuotes, private readonly emit: (text: string) => void, private readonly reset?: () => void) {}

  push(delta: string): void {
    this.raw += delta;
    if (this.buffered) return;
    // 只扫描新内容及少量跨 chunk 前缀，普通长回复不反复扫描全部已输出文本。
    const from = Math.max(0, this.emitted.length - 8);
    const match = this.raw.slice(from).search(UNSAFE);
    const unsafe = match < 0 ? -1 : from + match;
    if (unsafe >= 0) this.buffered = true;
    let tail = this.raw.length;
    while (tail > this.emitted.length && /\s/u.test(this.raw[tail - 1]!)) tail--;
    let end = Math.min(unsafe < 0 ? this.raw.length : unsafe, tail);
    if (this.raw.endsWith("[")) end = Math.min(end, this.raw.length - 1);
    if (end > this.emitted.length) {
      this.emit(this.raw.slice(this.emitted.length, end));
      this.emitted = this.raw.slice(0, end);
    }
  }

  finish(final: string): string {
    const rendered = this.quotes.render(final);
    if (!rendered.startsWith(this.emitted)) {
      this.reset?.();
      this.emit(rendered);
    } else if (rendered.length > this.emitted.length) this.emit(rendered.slice(this.emitted.length));
    return rendered;
  }
}
