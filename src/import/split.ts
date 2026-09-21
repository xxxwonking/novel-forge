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

// ── 多文件 ──────────────────────────────────────────────────────────────

export interface ImportFile {
  readonly name: string;
  readonly text: string;
}

export interface JoinResult {
  /** 拼好的整本，交给 `splitChapters`。 */
  readonly text: string;
  /** 实际采用的文件顺序，供预览核对。 */
  readonly order: readonly string[];
  readonly notes: readonly string[];
  /** 没被当成正文的文件（大纲、角色档案、目录…），由调用方收进作品资料。 */
  readonly materials: readonly ImportFile[];
}

/** 文件名里写的章号：`12-灰痕.txt`、`第十二章.txt`、`012.txt` 都认；认不出返回 null。 */
function fileChapterKey(name: string): number | null {
  // 选整个文件夹时带目录前缀（`失踪档案/12-灰痕.txt`）；章号只认文件名那一段。
  const base = name.split(/[\\/]/u).at(-1)!.replace(/\.[^.]+$/u, "").trim();
  for (const { pattern } of MARKERS) {
    const match = pattern.exec(base);
    if (match !== null) return parseChapterNumber(match[1] ?? "");
  }
  const leading = /^[\s　]*(\d{1,6})(?![^\s\-_.．、—－()（）])/u.exec(base);
  return leading === null ? null : Number(leading[1]);
}

/** 一份文件里第一条标记行的下标；没有则 -1。用的是整本已选定的那一种标记。 */
function firstMarkerLine(lines: readonly string[], pattern: RegExp): number {
  return lines.findIndex((line) => line.length <= MAX_HEADING && pattern.test(line));
}

/**
 * 这份文件是一份**目录**吗？
 *
 * 真机撞上的：`目录及简介.txt` 里是一百行 `第001章 标题`，长得和一本书一模一样 ——
 * 拼进去就变成「每一章都重号、每一章都没有正文」，把整次导入卡死。
 *
 * 判据是**有多条标记却一条正文都没有**。只有一条标记又没正文的不算目录，那是
 * 切坏了的章节文件，仍要按问题报出来让作者看见。
 */
function looksLikeContents(lines: readonly string[], pattern: RegExp): boolean {
  let markers = 0;
  let bodied = false;
  for (const line of lines) {
    if (line.length <= MAX_HEADING && pattern.test(line)) { markers += 1; continue; }
    if (markers > 0 && line.trim() !== "") bodied = true;
  }
  return markers >= 2 && !bodied;
}

/**
 * 每章一个文件时把它们拼成一本。
 *
 * 顺序按文件名里的章号排（字典序会把 10、100 排到 2 前面）；认不出章号的排到最后，
 * 同组内按数字感知的自然序。章号最终仍取自正文里的标记 —— 这里的排序只决定预览
 * 里的先后与「不是递增顺序」那条提示，不决定哪一章落到哪。
 *
 * 两类内容不能并进去：**整个文件都没有标记行**（大纲、人物档案、简介），以及某个
 * 文件**标记行之前**的文字（文件自带的标题行）。两者若直接拼接都会悄悄粘到前一章
 * 的末尾 —— 那是几万字之后才会被发现的错。所以都单独说明、不导入。
 */
export function joinChapterFiles(files: readonly ImportFile[]): JoinResult {
  const collator = new Intl.Collator("zh", { numeric: true });
  const ordered = files.map((file) => ({ ...file, key: fileChapterKey(file.name) }))
    .sort((a, b) => (a.key ?? Number.POSITIVE_INFINITY) - (b.key ?? Number.POSITIVE_INFINITY) || collator.compare(a.name, b.name));
  const normalized = ordered.map((file) => ({ name: file.name, lines: normalize(file.text).split("\n") }));
  const marker = MARKERS.find(({ pattern }) => normalized.some((file) => firstMarkerLine(file.lines, pattern) >= 0));
  // 一个标记都没有：原样拼上交给 splitChapters，由它报那条标准的「没有识别到章节标记」。
  // 这时没有哪份文件能算正文，全部交给调用方当资料收下。
  if (marker === undefined) return { text: normalized.map((file) => file.lines.join("\n")).join("\n\n"), order: ordered.map((file) => file.name), notes: [], materials: files };

  const skipped: string[] = [];
  const contents: string[] = [];
  const materials: ImportFile[] = [];
  const prefaced: { readonly name: string; readonly words: number }[] = [];
  const parts: string[] = [];
  for (const file of normalized) {
    const at = firstMarkerLine(file.lines, marker.pattern);
    if (at < 0) { skipped.push(file.name); materials.push({ name: file.name, text: file.lines.join("\n") }); continue; }
    if (looksLikeContents(file.lines, marker.pattern)) { contents.push(file.name); materials.push({ name: file.name, text: file.lines.join("\n") }); continue; }
    const before = trimBody(file.lines.slice(0, at));
    if (before !== "") prefaced.push({ name: file.name, words: countWords(before) });
    parts.push(file.lines.slice(at).join("\n"));
  }

  const notes: string[] = [];
  if (skipped.length > 0) notes.push(`${skipped.length} 个文件里没有章节标记，本次不导入：${skipped.join("、")}。大纲、人物档案这类资料请到「作品资料」里录入。`);
  if (contents.length > 0) notes.push(`${contents.join("、")} 看起来是目录（有章节标题但没有正文），本次不导入。`);
  if (prefaced.length > 0) {
    const named = prefaced.slice(0, 3).map((f) => `${f.name}（${f.words} 字）`).join("、");
    notes.push(`${prefaced.length} 个文件在标记行之前有未编号内容，本次不导入：${named}${prefaced.length > 3 ? " 等" : ""}。需要它的话请并进该章正文。`);
  }
  return { text: parts.join("\n\n"), order: ordered.map((file) => file.name), notes, materials };
}
