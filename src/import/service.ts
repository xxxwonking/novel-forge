/**
 * 导入旧作·第一批：把作者已有的正文入库（差距盘点第 2 项）。
 *
 * **本批只做正文，不反推结构。** 逐章 C5 式反推（事件、伏笔埋设与兑现、人物状态）
 * 与跨章伏笔累积留作下一批 —— 那才是这一项真正的设计难题（上下文装不下整本书，
 * 而"埋设→兑现"的关系必须跨章累积）。
 *
 * 所以导入完成后，伏笔时间线是空的。这是**诚实状态**，不是缺陷：没有声明就没有
 * 事实，系统不假装知道这本书的结构。作者接着走资料页的「让 AI 起草资料」
 * （第 22 节）补人物与设定，就能继续往下写。
 *
 * 覆盖策略是本文件最要紧的部分，三档：
 *   - **逐字相同** → 跳过，算已导入。响应丢失后重试不会变成"冲突"。
 *   - **内容不同、没有结构记录** → 必须作者显式勾选覆盖。`data/` 不入库、
 *     无 git 可恢复（第 22 节的事故），覆盖不能是默认行为。
 *   - **已有结构事件或已采用稿** → 一律拒绝，勾了也不行。那些章的锚点指向
 *     现有正文，换掉正文等于让整条事件流指向不存在的原文；要改走稿件修订。
 */

import { ChapterWriteError } from "../server/chapter-input.js";
import { countWords } from "../text/measure.js";
import type { ProjectSession } from "../server/state.js";
import { splitChapters, type SplitResult } from "./split.js";

type Source = Pick<ProjectSession, "chapterText" | "chapterNumbers" | "events" | "allDrafts" | "putChapters">;

export interface ImportRequest {
  readonly text: string;
  readonly overwrite?: boolean;
}

export interface ImportConflict {
  readonly chapter: number;
  readonly existingWords: number;
  /** 已有正文与本次要导入的逐字相同。 */
  readonly identical: boolean;
  /** 有结构事件或已采用稿：勾了覆盖也不会替换。 */
  readonly locked: boolean;
  readonly reason: string;
}

export interface ImportPreview extends SplitResult {
  readonly conflicts: readonly ImportConflict[];
  readonly totalWords: number;
  /** 不勾覆盖就能导入。 */
  readonly ready: boolean;
  /** 勾上覆盖后能导入。 */
  readonly readyWithOverwrite: boolean;
}

export interface ImportResult {
  /** 新增的章号。 */
  readonly imported: readonly number[];
  /** 覆盖掉已有正文的章号。 */
  readonly replaced: readonly number[];
  /** 已有逐字相同正文、本次未写的章号。 */
  readonly unchanged: readonly number[];
  readonly totalWords: number;
  readonly nextChapter: number;
}

function parseRequest(raw: unknown): ImportRequest {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ChapterWriteError(400, "导入参数必须是对象");
  const input = raw as Record<string, unknown>;
  if (typeof input["text"] !== "string") throw new ChapterWriteError(400, "缺少要导入的正文 text");
  const overwrite = input["overwrite"] ?? false;
  if (typeof overwrite !== "boolean") throw new ChapterWriteError(400, "overwrite 必须是布尔值");
  for (const key of Object.keys(input)) if (key !== "text" && key !== "overwrite") throw new ChapterWriteError(400, `不支持的导入参数 ${key}`);
  return { text: input["text"], overwrite };
}

export class ImportService {
  constructor(private readonly source: Source) {}

  preview(raw: unknown): ImportPreview {
    const { text } = parseRequest(raw);
    const split = splitChapters(text);
    const conflicts = split.chapters.flatMap((chapter) => {
      const existing = this.source.chapterText(chapter.chapter);
      if (existing === undefined) return [];
      const identical = existing === chapter.body;
      const locked = this.locked(chapter.chapter);
      return [{
        chapter: chapter.chapter,
        existingWords: countWords(existing),
        identical,
        locked: locked !== null && !identical,
        reason: identical ? `第 ${chapter.chapter} 章已有逐字相同的正文，本次跳过。`
          : locked !== null ? `第 ${chapter.chapter} 章${locked}，导入不会替换它。需要改这一章的正文，请走稿件修订。`
            : `第 ${chapter.chapter} 章已有 ${countWords(existing)} 字正文，勾选覆盖后才会被替换。`,
      }];
    });
    const usable = split.problems.length === 0 && split.chapters.length > 0;
    return {
      ...split,
      notes: [...split.notes, ...this.holes(split.chapters.map((c) => c.chapter))],
      conflicts,
      totalWords: split.chapters.reduce((sum, chapter) => sum + chapter.words, 0),
      ready: usable && conflicts.every((c) => c.identical),
      readyWithOverwrite: usable && conflicts.every((c) => !c.locked),
    };
  }

  apply(raw: unknown): ImportResult {
    const { overwrite } = parseRequest(raw);
    const preview = this.preview(raw);
    if (preview.problems.length > 0) throw new ChapterWriteError(400, preview.problems.join("；"));
    const blocked = preview.conflicts.filter((c) => c.locked);
    if (blocked.length > 0) throw new ChapterWriteError(409, blocked.map((c) => c.reason).join("；"));
    const replacing = preview.conflicts.filter((c) => !c.identical);
    if (replacing.length > 0 && !overwrite) throw new ChapterWriteError(409, replacing.map((c) => c.reason).join("；"));

    const skip = new Set(preview.conflicts.filter((c) => c.identical).map((c) => c.chapter));
    const replaced = new Set(replacing.map((c) => c.chapter));
    const writes = preview.chapters.filter((chapter) => !skip.has(chapter.chapter))
      .map((chapter) => ({ chapter: chapter.chapter, text: chapter.body }));
    // 一次事务写完：有阻断项时一章都不落，不留半本书。
    if (writes.length > 0) this.source.putChapters(writes);

    const numbers = writes.map((w) => w.chapter);
    return {
      imported: numbers.filter((n) => !replaced.has(n)).sort((a, b) => a - b),
      replaced: numbers.filter((n) => replaced.has(n)).sort((a, b) => a - b),
      unchanged: [...skip].sort((a, b) => a - b),
      totalWords: preview.chapters.filter((c) => !skip.has(c.chapter)).reduce((sum, c) => sum + c.words, 0),
      nextChapter: Math.max(0, ...this.source.chapterNumbers()) + 1,
    };
  }

  /**
   * 导入之后整本书还缺哪几章。
   *
   * `splitChapters` 只看得见这一份文件里的缺号，看不见"文件里只有第 7 章，而书里
   * 现有第 1–3 章"这种更常见的情况 —— 那会留下 4–6 三个空洞，让阅读和导出直接跳号。
   * 不说出来，作者要到导出时才发现。
   */
  private holes(incoming: readonly number[]): readonly string[] {
    if (incoming.length === 0) return [];
    const after = new Set([...this.source.chapterNumbers(), ...incoming]);
    const gaps: number[] = [];
    for (let n = 1; n <= Math.max(...after); n += 1) if (!after.has(n)) gaps.push(n);
    if (gaps.length === 0) return [];
    const listed = gaps.length > 8 ? `${gaps.slice(0, 5).join("、")} 等 ${gaps.length}` : gaps.join("、");
    return [`导入后第 ${listed} 章仍然没有正文，阅读和导出会跳过它们。如果不是分批导入，请确认这是有意的。`];
  }

  /** 这一章为什么不能被替换；可以替换时返回 null。 */
  private locked(chapter: number): string | null {
    const events = this.source.events().some((event) => event.envelope.chapter === chapter
      && (event.envelope.provenance === "committed" || event.envelope.provenance === "authored"));
    if (events) return "已有正式结构记录（事件、伏笔等指向现有正文）";
    return this.source.allDrafts().some((draft) => draft.chapter === chapter && draft.status === "adopted")
      ? "已有采用记录" : null;
  }
}
