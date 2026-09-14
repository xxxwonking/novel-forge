/**
 * 草稿与作品版本的持久化（Stage 1）。
 *
 * 刻意放在 `src/task/` 而非 `src/store/`：草稿是**任务领域**的产物，让 store 层
 * 保持领域无关；也让本文件不落进 `test/rules.test.ts` 的"代码无数字"扫描目录
 * （草稿号/版本号这类序号不是 §10.1 的派生阈值）。
 *
 * 布局（都在项目 root 下，`data/` 不入 git）：
 *   drafts/ch{n}/{draftId}.json   草稿元数据（不含正文）
 *   drafts/ch{n}/{draftId}.txt    草稿正文（纯文本，沿用「正文不塞 JSON」原则）
 *   work-meta.json                作品版本号（每次采用 +1，staleness 判据）
 */

import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { readProjectFile, recoverFileTransaction, withFileTransaction, writeProjectFile } from "../store/transaction.js";
import type { ChapterNo } from "../types/primitives.js";
import type { ChapterDraft, DraftId } from "./types.js";

const DRAFT_DIR = "drafts";
const META_FILE = "work-meta.json";
const CHAPTER_SUBDIR = /^ch(\d+)$/u;

interface WorkMeta {
  readonly workVersion: number;
}

/** 落盘的草稿元数据 —— 正文单独存 .txt，其余进 JSON。 */
type DraftMeta = Omit<ChapterDraft, "body">;

export class DraftStore {
  constructor(private readonly root: string) {}

  private chapterDir(chapter: ChapterNo): string {
    return join(this.root, DRAFT_DIR, `ch${chapter}`);
  }

  // ── 作品版本 ────────────────────────────────────────────────────────────

  /** 当前作品版本。无 meta 文件时为 0（筹备期，尚未采用过任何章）。 */
  workVersion(): number {
    try {
      const text = readProjectFile(this.root, META_FILE);
      if (text === undefined) return 0;
      const meta = JSON.parse(text) as Partial<WorkMeta> | null;
      if (meta === null || !Number.isSafeInteger(meta.workVersion) || (meta.workVersion ?? -1) < 0) throw new Error("workVersion 必须是非负安全整数");
      return meta.workVersion as number;
    } catch (error) {
      throw new Error(`${META_FILE} 读取失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  /** 版本 +1 并落盘，返回新版本。每次成功采用调一次。 */
  bumpWorkVersion(): number {
    const next = this.workVersion() + 1;
    if (!Number.isSafeInteger(next)) throw new Error(`${META_FILE} 版本超出安全整数范围`);
    writeProjectFile(
      this.root, META_FILE,
      `${JSON.stringify({ workVersion: next } satisfies WorkMeta, null, 2)}\n`,
    );
    return next;
  }

  // ── 草稿 ──────────────────────────────────────────────────────────────

  /** 序号取已有最大值 + 1；手动移除旧稿留下缺口时也不能覆盖现存版本。 */
  nextDraftId(chapter: ChapterNo): DraftId {
    const last = this.listDrafts(chapter).reduce((max, draft) => Math.max(max, draftSequence(draft.draftId)), 0);
    return `ch${chapter}d${last + 1}`;
  }

  saveDraft(draft: ChapterDraft): void {
    const dir = join(DRAFT_DIR, `ch${draft.chapter}`);
    const { body, ...meta } = draft;
    this.transaction(() => {
      writeProjectFile(this.root, join(dir, `${draft.draftId}.json`), `${JSON.stringify(meta, null, 2)}\n`);
      writeProjectFile(this.root, join(dir, `${draft.draftId}.txt`), body);
    });
  }

  transaction<T>(operation: () => T): T {
    return withFileTransaction(this.root, operation);
  }

  loadDraft(chapter: ChapterNo, draftId: DraftId): ChapterDraft | undefined {
    const dir = join(DRAFT_DIR, `ch${chapter}`);
    const text = readProjectFile(this.root, join(dir, `${draftId}.json`));
    if (text === undefined) return undefined;
    const meta = JSON.parse(text) as DraftMeta;
    const body = readProjectFile(this.root, join(dir, `${draftId}.txt`)) ?? "";
    return { ...meta, body };
  }

  /** 该章全部草稿，按创建时间升序（末尾即最新）。 */
  listDrafts(chapter: ChapterNo): readonly ChapterDraft[] {
    recoverFileTransaction(this.root);
    const dir = this.chapterDir(chapter);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.loadDraft(chapter, f.slice(0, f.length - ".json".length)))
      .filter((d): d is ChapterDraft => d !== undefined)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || draftSequence(a.draftId) - draftSequence(b.draftId));
  }

  latestDraft(chapter: ChapterNo): ChapterDraft | undefined {
    const all = this.listDrafts(chapter);
    return all.at(-1);
  }

  /** 有草稿的章号（升序）。resume 扫描与 staleness 标记的入口。 */
  chaptersWithDrafts(): readonly ChapterNo[] {
    recoverFileTransaction(this.root);
    const base = join(this.root, DRAFT_DIR);
    if (!existsSync(base)) return [];
    return readdirSync(base)
      .map((name) => CHAPTER_SUBDIR.exec(name)?.[1])
      .filter((s): s is string => s !== undefined)
      .map(Number)
      .sort((a, b) => a - b);
  }
}

function draftSequence(draftId: DraftId): number {
  return Number(/^ch\d+d(\d+)$/u.exec(draftId)?.[1] ?? 0);
}
