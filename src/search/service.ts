/**
 * 全文检索（差距第 9 项）。
 *
 * 三条判断：
 *
 * 1. **不建索引。** 正文在 `ProjectStore.load()` 时就整本进了内存，结构数据同理，
 *    所以一次查询是纯内存线性扫描。建索引要额外维护一份会过期的副本，而这里
 *    没有它要解决的问题。
 * 2. **片段就是锚点。** 结果里的 `quote` 是正文的**逐字子串**，直接交给
 *    `/api/anchor` 就能定位 —— 「跳到原文」复用既有的高亮通道，不新造一条。
 *    所以片段里绝不能掺省略号之类的装饰，那属于界面。
 * 3. **不做模糊与近义。** 西文不分大小写，其余精确匹配。假命中会让作者不再信
 *    这个框，和元层穿帮检测选「宁漏不误报」是同一个理由。
 *
 * 这里没有复用 `anchor/resolve.ts` 的 `findAll`：那边的 quote 是主键，必须逐字
 * 精确；这里要的是不区分大小写。与其给它加一个只有一处用的开关，不如各自明确。
 */

import type { ProjectSession } from "../server/state.js";
import { ChapterWriteError } from "../server/chapter-input.js";

type Source = Pick<ProjectSession, "meta" | "chapterNumbers" | "chapterText" | "events">;

/** 片段两侧的上下文字数；找不到句读时按它硬切。 */
const CONTEXT = 16;
/** 每章最多给几条片段：一章几十处命中不该铺满结果页，`count` 仍报全数。 */
const SNIPPETS_PER_CHAPTER = 3;
/** 结果页一屏能看的量级。超出即截断并标 `truncated`，由作者缩小检索词。 */
const MAX_CHAPTERS = 50;
const MAX_ENTITIES = 60;
/** 结构命中的摘录长度 —— 它只用来读，不用来定位。 */
const EXCERPT = 40;
const SENTENCE_END = ["。", "！", "？", "\n", "”"];

export type EntityKind = "character" | "setting" | "plotLine" | "volume" | "beat" | "event";

export interface SearchSnippet {
  /** 正文的逐字子串，可直接当锚点 quote 用。 */
  readonly quote: string;
  /** 该片段在本章正文中的起始位置。 */
  readonly offset: number;
}

export interface ChapterHit {
  readonly chapter: number;
  /** 本章命中总数 —— 片段有上限，这个数没有。 */
  readonly count: number;
  readonly snippets: readonly SearchSnippet[];
}

export interface EntityHit {
  readonly kind: EntityKind;
  readonly id: string;
  readonly title: string;
  /** 命中在哪个字段。不说清楚，作者看不出这一条为什么算命中。 */
  readonly field: string;
  readonly excerpt: string;
  /** 有章号的（章计划、事件）给章号，供跳转；其余为 null。 */
  readonly chapter: number | null;
}

export interface SearchResult {
  readonly query: string;
  readonly chapters: readonly ChapterHit[];
  readonly entities: readonly EntityHit[];
  readonly truncated: boolean;
}

export function searchWork(source: Source, raw: string): SearchResult {
  const query = raw.trim();
  if (query === "") throw new ChapterWriteError(400, "请先输入检索词");
  const pattern = matcher(query);

  const chapters: ChapterHit[] = [];
  let chaptersCut = false;
  for (const chapter of source.chapterNumbers()) {
    const text = source.chapterText(chapter);
    if (text === undefined) continue;
    const hits = findAll(text, pattern);
    if (hits.length === 0) continue;
    if (chapters.length >= MAX_CHAPTERS) { chaptersCut = true; break; }
    chapters.push({ chapter, count: hits.length, snippets: snippetsOf(text, hits) });
  }

  const all = entityHits(source, pattern);
  return { query, chapters, entities: all.slice(0, MAX_ENTITIES), truncated: chaptersCut || all.length > MAX_ENTITIES };
}

/** 西文不分大小写；其余逐字。正则在原串上匹配，所以下标与长度都是真的。 */
function matcher(query: string): RegExp {
  return new RegExp(query.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "giu");
}

function findAll(text: string, pattern: RegExp): readonly { offset: number; length: number }[] {
  const hits: { offset: number; length: number }[] = [];
  pattern.lastIndex = 0;
  for (let m = pattern.exec(text); m !== null; m = pattern.exec(text)) {
    hits.push({ offset: m.index, length: m[0].length });
    // 空匹配不可能发生（检索词非空），但 lastIndex 不前进会死循环。
    if (m[0].length === 0) pattern.lastIndex += 1;
  }
  return hits;
}

/**
 * 片段之间不重叠：已经展示过的那一段里再有命中，不另起一条。
 *
 * 按起点去重是不够的 —— 同一句里的两处命中，起点可能因为回看窗口够不到句首而
 * 不同，那样会把同一行抄两遍。
 */
function snippetsOf(text: string, hits: readonly { offset: number; length: number }[]): readonly SearchSnippet[] {
  const snippets: SearchSnippet[] = [];
  let covered = 0;
  for (const hit of hits) {
    if (hit.offset < covered) continue;
    const snippet = snippetAt(text, hit.offset, hit.length);
    snippets.push(snippet);
    covered = snippet.offset + snippet.quote.length;
    if (snippets.length >= SNIPPETS_PER_CHAPTER) break;
  }
  return snippets;
}

/** 片段切到句读边界：从句子中间切开的片段读不通，也更难在正文里认出来。 */
function snippetAt(text: string, offset: number, length: number): SearchSnippet {
  let start = Math.max(0, offset - CONTEXT);
  const before = text.slice(start, offset);
  const opened = Math.max(...SENTENCE_END.map((mark) => before.lastIndexOf(mark)));
  if (opened >= 0) start += opened + 1;

  const tail = text.slice(offset + length, Math.min(text.length, offset + length + CONTEXT));
  const closed = SENTENCE_END.map((mark) => tail.indexOf(mark)).filter((index) => index >= 0);
  const end = closed.length > 0 ? offset + length + Math.min(...closed) + 1 : offset + length + tail.length;
  return { quote: text.slice(start, end), offset: start };
}

/** 一个实体只给一行：命中多个字段时报第一个，免得一个人物刷屏。 */
function entityHits(source: Source, pattern: RegExp): readonly EntityHit[] {
  const hits: EntityHit[] = [];
  const push = (kind: EntityKind, id: string, title: string, chapter: number | null, fields: readonly (readonly [string, string])[]): void => {
    for (const [field, value] of fields) {
      const found = findAll(value, pattern)[0];
      if (found === undefined) continue;
      hits.push({ kind, id, title, field, excerpt: excerptAt(value, found.offset, found.length), chapter });
      return;
    }
  };

  for (const c of source.meta.characters) {
    push("character", c.id, c.name, null, [
      ["姓名", c.name], ["别名", c.aliases.join("、")], ["定位", c.profile.role],
      ["特征", c.profile.traits.join("、")], ["想要什么", c.profile.wants], ["害怕什么", c.profile.fears],
      ["背景", c.profile.background], ["台词样例", c.speech.exemplars.join("　")],
    ]);
  }
  for (const s of source.meta.settings) {
    push("setting", s.id, s.name, null, [["名称", s.name], ["描述", s.description], ["要点", s.facts.join("、")]]);
  }
  for (const p of source.meta.plotLines) push("plotLine", p.id, p.label, null, [["情节线", p.label]]);
  for (const v of source.meta.volumes) {
    push("volume", String(v.volume), `第 ${v.volume} 卷`, null, [["卷名", v.title], ["卷纲", v.summary]]);
  }
  for (const b of source.meta.beats) {
    push("beat", String(b.chapter), `第 ${b.chapter} 章计划`, b.chapter, [
      ["核心事件", b.plan.coreEvent], ["本章兑现", b.plan.stageFeedback], ["结束位置", b.plan.hook],
      ["计划事件", b.plan.events.map((e) => e.summary).join("　")],
    ]);
  }
  for (const [index, stored] of source.events().entries()) {
    if (!["committed", "authored"].includes(stored.envelope.provenance)) continue;
    const chapter = stored.envelope.chapter;
    const payload = stored.payload;
    const fields: (readonly [string, string])[] =
      payload.type === "plot_event" ? [["事件", payload.summary]]
        : payload.type === "foreshadow_planted" ? [["伏笔", payload.label], ["伏笔意图", payload.intent]]
          : payload.type === "relation_changed" ? [["关系变化", payload.note]]
            : payload.type === "character_state_changed" ? [["状态变化", payload.to]] : [];
    push("event", `${chapter}-${index}`, `第 ${chapter} 章`, chapter, fields);
  }
  return hits;
}

function excerptAt(value: string, offset: number, length: number): string {
  const start = Math.max(0, offset - Math.floor((EXCERPT - length) / 2));
  return value.slice(start, start + EXCERPT);
}
