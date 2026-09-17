/**
 * 旧稿的章节切分（导入旧作·第一批）。
 *
 * 纯函数、无 I/O —— 与 `gate/*-channel.ts` 同一套纪律：能在单测里逐条钉住的判断
 * 不放进服务层。
 *
 * 两条贯穿全文件的原则：
 *
 * 1. **章号取自标记本身，绝不按出现顺序重编。** 作者的第 37 章就是第 37 章。
 *    悄悄重编会让"接着第 38 章写"变成写错地方，而这种错要到几万字之后才看得出来。
 *    缺号、乱序一律如实报告，由作者决定。
 * 2. **不擅自丢内容。** 切不出来就报问题，不猜；小节标记、空行原样留在正文里。
 *    唯一不进正文的是章节标记行本身 —— 它是目录信息，不是作者写的句子。
 */

import { countWords } from "../text/measure.js";

export interface ImportChapter {
  readonly chapter: number;
  /** 标记行里跟在章号后面的文字，可能为空。 */
  readonly title: string;
  /** 原始标记行，供作者在预览里核对切分位置。 */
  readonly heading: string;
  readonly body: string;
  readonly words: number;
}

export interface SplitResult {
  /** 实际采用的标记层级；没切出章节时为 null。 */
  readonly marker: string | null;
  readonly chapters: readonly ImportChapter[];
  /** 第一个标记之前的内容（楔子／序章／版权页）。本次不导入。 */
  readonly preface: { readonly words: number; readonly excerpt: string } | null;
  /** 必须由作者处理才能导入。 */
  readonly problems: readonly string[];
  /** 提示但不阻断。 */
  readonly notes: readonly string[];
}

/**
 * 支持的标记层级，**按优先级排列**。
 *
 * 只用命中的第一种：一本用「第N章」分章、章内又用「第N节」分节的书，
 * 如果两种都认就会被切成一堆残片。优先级而不是"全都认"是这里的关键。
 *
 * `(?![^\s:：.．、\-－—])` 是把标记行与正文段落分开的那一条：章号后面必须是
 * 行尾、空白或分隔标点。没有它，一段以「第三章的事他一直记得……」开头的**正文**
 * 会被当成标记行，把一章从中间劈开 —— 而作者要到几万字之后才发现。
 * 顺带也挡住「第一章节」这类词。
 */
const NUMBER = "[0-9０-９〇零一二三四五六七八九十百千两]{1,8}";
const TAIL = "(?![^\\s:：.．、\\-－—])\\s*(?:[:：.．、\\-－—]\\s*)?(.*)$";
const MARKERS: readonly { readonly name: string; readonly pattern: RegExp }[] = [
  { name: "章", pattern: new RegExp(`^[ \t　]*第\\s*(${NUMBER})\\s*章${TAIL}`, "u") },
  { name: "回", pattern: new RegExp(`^[ \t　]*第\\s*(${NUMBER})\\s*回${TAIL}`, "u") },
  { name: "节", pattern: new RegExp(`^[ \t　]*第\\s*(${NUMBER})\\s*节${TAIL}`, "u") },
  { name: "Chapter", pattern: /^[ \t]*chapter\s+([0-9]{1,6})(?![^\s:.\-])\s*(?:[:.\-]\s*)?(.*)$/iu },
];

/**
 * 标记行的长度上限 —— 分隔符规则之外的兜底。
 *
 * 「第三章 的事他一直记得……」这类带了空格的正文段落绕得过分隔符规则，
 * 但真实章节标题不会有这么长。
 */
const MAX_HEADING = 50;

const CHAPTER_MIN = 1;
const CHAPTER_MAX = 99_999;

const DIGITS: Readonly<Record<string, number>> = {
  "〇": 0, "零": 0, "一": 1, "二": 2, "两": 2, "三": 3, "四": 4,
  "五": 5, "六": 6, "七": 7, "八": 8, "九": 9,
};
const UNITS: Readonly<Record<string, number>> = { "十": 10, "百": 100, "千": 1000 };

/** 阿拉伯数字（含全角）与中文数字。解析不出来返回 null，由调用方报问题而不是猜。 */
export function parseChapterNumber(raw: string): number | null {
  const ascii = raw.replace(/[０-９]/gu, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (/^\d+$/u.test(ascii)) {
    const value = Number(ascii);
    return Number.isSafeInteger(value) ? value : null;
  }
  let total = 0;
  let pending = 0;
  for (const char of raw) {
    if (Object.hasOwn(DIGITS, char)) { pending = DIGITS[char]!; continue; }
    if (!Object.hasOwn(UNITS, char)) return null;
    const unit = UNITS[char]!;
    // 「十五」开头的十没有前导数字，按一算；「二十」的十有。
    total += (pending === 0 && unit === 10 ? 1 : pending) * unit;
    pending = 0;
  }
  return total + pending;
}

function normalize(text: string): string {
  return text.replace(/^﻿/u, "").replace(/\r\n?/gu, "\n");
}

/** 去掉首尾空行，保留段落之间的空行与缩进。 */
function trimBody(lines: readonly string[]): string {
  const body = lines.join("\n");
  return body.replace(/^(?:[ \t　]*\n)+/u, "").replace(/\s+$/u, "");
}

function missingRanges(numbers: readonly number[]): readonly number[] {
  const present = new Set(numbers);
  const gaps: number[] = [];
  for (let n = Math.min(...numbers); n <= Math.max(...numbers); n += 1) if (!present.has(n)) gaps.push(n);
  return gaps;
}

export function splitChapters(input: string): SplitResult {
  const text = normalize(input);
  const empty: SplitResult = { marker: null, chapters: [], preface: null, problems: [], notes: [] };
  if (text.trim() === "") return { ...empty, problems: ["这份内容是空的，没有可导入的正文。"] };

  const lines = text.split("\n");
  const marker = MARKERS.find(({ pattern }) => lines.some((line) => line.length <= MAX_HEADING && pattern.test(line)));
  if (marker === undefined) {
    return { ...empty, problems: ["没有识别到章节标记。请确认每章标题独占一行，支持「第一章」「第1章」「第一回」「Chapter 1」这几种写法。"] };
  }

  const problems: string[] = [];
  const notes: string[] = [];
  const chapters: ImportChapter[] = [];
  const seen = new Map<number, string>();
  let pending: { readonly chapter: number; readonly title: string; readonly heading: string; readonly lines: string[] } | null = null;
  const prefaceLines: string[] = [];

  const close = (): void => {
    if (pending === null) return;
    const body = trimBody(pending.lines);
    if (body === "") problems.push(`第 ${pending.chapter} 章（${pending.heading.trim()}）标记下没有正文，请核对切分位置。`);
    else chapters.push({ chapter: pending.chapter, title: pending.title, heading: pending.heading.trim(), body, words: countWords(body) });
    pending = null;
  };

  for (const line of lines) {
    const match = line.length <= MAX_HEADING ? marker.pattern.exec(line) : null;
    if (match === null) {
      if (pending === null) prefaceLines.push(line);
      else pending.lines.push(line);
      continue;
    }
    const chapter = parseChapterNumber(match[1] ?? "");
    if (chapter === null || chapter < CHAPTER_MIN || chapter > CHAPTER_MAX) {
      problems.push(`无法识别章号的标记行：「${line.trim()}」。章号需要在 ${CHAPTER_MIN}–${CHAPTER_MAX} 之间。`);
      if (pending === null) prefaceLines.push(line); else pending.lines.push(line);
      continue;
    }
    close();
    const previous = seen.get(chapter);
    if (previous !== undefined) problems.push(`第 ${chapter} 章出现了两次（「${previous}」与「${line.trim()}」），请先确定保留哪一份。`);
    seen.set(chapter, line.trim());
    pending = { chapter, title: (match[2] ?? "").trim(), heading: line, lines: [] };
  }
  close();

  const preface = trimBody(prefaceLines);
  if (preface !== "") {
    notes.push(`开头有 ${countWords(preface)} 字未编号内容（可能是楔子、序章或版权页），本次不导入。需要它的话，请把它单独作为一章粘贴进来。`);
  }

  const numbers = chapters.map((c) => c.chapter);
  if (numbers.length > 0) {
    const gaps = missingRanges(numbers);
    if (gaps.length > 0) {
      notes.push(gaps.length > 8
        ? `第 ${Math.min(...numbers)}–${Math.max(...numbers)} 章之间缺 ${gaps.length} 章（如第 ${gaps.slice(0, 5).join("、")} 章）。如果不是分批导入，请检查切分是否正确。`
        : `缺少第 ${gaps.join("、")} 章。如果不是分批导入，请检查切分是否正确。`);
    }
    if (numbers.some((n, i) => i > 0 && n < numbers[i - 1]!)) notes.push("文件里的章号不是递增顺序，导入仍按标记上的章号落位。");
  } else if (problems.length === 0) {
    problems.push("识别到章节标记，但没有切出任何带正文的章节。");
  }

  return {
    marker: marker.name,
    chapters,
    preface: preface === "" ? null : { words: countWords(preface), excerpt: preface.slice(0, 80) },
    problems,
    notes,
  };
}
