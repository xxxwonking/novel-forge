/**
 * 旧稿反推的运行结果（差距第 2 项下半场）。
 *
 * **事实在事件流，这里只有运行结果。** 反推出的声明是 proposed 事件，状态由事件流
 * 自己说清楚（有 proposed 就是待确认、committed 就是已确认）；这个文件记的是事件
 * 流装不下的东西：这一章上一次为什么没通过、模型报了什么警告、什么时候跑的。
 *
 * 落盘布局：`import-inference.json` { chapters: { "3": { outcome, problems, warnings, at } } }
 * 跟 data/ 一起不入 git。读坏了直接报错，不静默当空 —— 空态会让"这一章处理过"
 * 变成"没处理过"，作者会重跑一遍已经看过的章。
 */

import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import type { ChapterNo, IsoTimestamp } from "../types/primitives.js";

const FILE = "import-inference.json";

/**
 * 一章最后一次反推的结果。
 *
 * `done` 之后这一章的状态由事件流接管（proposed 是待确认、committed 是已确认），
 * 所以这里只区分"跑完了"与三种没跑成的收场。`skipped` 是作者看过后的决定，
 * 不是失败 —— 它允许后面的章继续反推。
 */
export type InferenceOutcomeKind = "done" | "problem" | "failed" | "skipped";

export interface InferenceRun {
  readonly outcome: InferenceOutcomeKind;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  readonly at: IsoTimestamp;
}

interface InferenceFile {
  readonly chapters: Readonly<Record<string, InferenceRun>>;
}

export class InferenceStore {
  constructor(private readonly root: string) {}

  load(): ReadonlyMap<ChapterNo, InferenceRun> {
    const text = readProjectFile(this.root, FILE);
    if (text === undefined) return new Map();
    try {
      const raw = JSON.parse(text) as Partial<InferenceFile> | null;
      if (raw === null || typeof raw.chapters !== "object" || raw.chapters === null) throw new Error("chapters 结构无效");
      const entries = Object.entries(raw.chapters).map(([key, value]) => {
        const chapter = Number(key);
        if (!Number.isSafeInteger(chapter) || chapter < 1 || !valid(value)) throw new Error(`第 ${key} 章的记录无效`);
        return [chapter, value] as const;
      });
      return new Map(entries);
    } catch (error) {
      throw new Error(`${FILE} 读取失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  get(chapter: ChapterNo): InferenceRun | undefined {
    return this.load().get(chapter);
  }

  save(chapter: ChapterNo, run: InferenceRun): void {
    const chapters = Object.fromEntries([...this.load().entries()].map(([n, value]) => [String(n), value]));
    chapters[String(chapter)] = run;
    writeProjectFile(this.root, FILE, `${JSON.stringify({ chapters }, null, 2)}\n`);
  }
}

function valid(value: unknown): value is InferenceRun {
  if (typeof value !== "object" || value === null) return false;
  const run = value as Partial<InferenceRun>;
  if (run.outcome !== "done" && run.outcome !== "problem" && run.outcome !== "failed" && run.outcome !== "skipped") return false;
  return Array.isArray(run.problems) && run.problems.every((p) => typeof p === "string")
    && Array.isArray(run.warnings) && run.warnings.every((w) => typeof w === "string")
    && typeof run.at === "string";
}
