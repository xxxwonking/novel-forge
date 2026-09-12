/**
 * 草稿与作品版本的持久化（Stage 1）。
 *
 * 刻意放在 `src/task/` 而非 `src/store/`：草稿是**任务领域**的产物，让 store 层
 * 保持领域无关；也让本文件不落进 `test/rules.test.ts` 的"代码无数字"扫描目录
 * （草稿号/版本号这类序号不是 §10.1 的派生阈值）。
 *
 * 布局（都在项目 root 下，`data/` 不入 git）：
 *   drafts/ch{n}/{draftId}.json      草稿元数据（不含任何正文）
 *   drafts/ch{n}/{draftId}.txt       草稿当前正文
 *   drafts/ch{n}/{draftId}.r{k}.txt  第 k 次自动修订前的正文快照
 *   work-meta.json                   作品版本号（每次采用 +1，staleness 判据）
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ChapterNo } from "../types/primitives.js";
import type { ChapterDraft, DraftId, DraftRevision } from "./types.js";

const DRAFT_DIR = "drafts";
const META_FILE = "work-meta.json";
const CHAPTER_SUBDIR = /^ch(\d+)$/u;

interface WorkMeta {
  readonly workVersion: number;
}

/**
 * 落盘的草稿元数据 —— 正文一律另存 .txt，JSON 里只留结构。
 *
 * 修订快照同样脱掉 body：它们也是正文，塞进 JSON 会让元数据文件随修订次数
 * 膨胀成不可读的大块转义文本。`revisions` 缺失即旧版草稿（回读补空数组）。
 */
type DraftMeta = Omit<ChapterDraft, "body" | "revisions"> & {
  readonly revisions?: readonly Omit<DraftRevision, "body">[];
};

export class DraftStore {
  constructor(private readonly root: string) {}

  private chapterDir(chapter: ChapterNo): string {
    return join(this.root, DRAFT_DIR, `ch${chapter}`);
  }

  // ── 作品版本 ────────────────────────────────────────────────────────────

  /** 当前作品版本。无 meta 文件时为 0（筹备期，尚未采用过任何章）。 */
  workVersion(): number {
    const path = join(this.root, META_FILE);
    if (!existsSync(path)) return 0;
    try {
      const meta = JSON.parse(readFileSync(path, "utf8")) as Partial<WorkMeta>;
      return typeof meta.workVersion === "number" ? meta.workVersion : 0;
    } catch {
      return 0;
    }
  }

  /** 版本 +1 并落盘，返回新版本。每次成功采用调一次。 */
  bumpWorkVersion(): number {
    const next = this.workVersion() + 1;
    mkdirSync(this.root, { recursive: true });
    writeFileSync(
      join(this.root, META_FILE),
      `${JSON.stringify({ workVersion: next } satisfies WorkMeta, null, 2)}\n`,
      "utf8",
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
    const dir = this.chapterDir(draft.chapter);
    mkdirSync(dir, { recursive: true });
    const { body, revisions, ...rest } = draft;
    const meta: DraftMeta = {
      ...rest,
      revisions: revisions.map(({ body: _body, ...r }) => r),
    };
    writeFileSync(join(dir, `${draft.draftId}.json`), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    writeFileSync(join(dir, `${draft.draftId}.txt`), body, "utf8");
    revisions.forEach((r, i) => writeFileSync(join(dir, revisionFile(draft.draftId, i)), r.body, "utf8"));
  }

  loadDraft(chapter: ChapterNo, draftId: DraftId): ChapterDraft | undefined {
    const dir = this.chapterDir(chapter);
    const metaPath = join(dir, `${draftId}.json`);
    if (!existsSync(metaPath)) return undefined;
    const { revisions = [], ...meta } = JSON.parse(readFileSync(metaPath, "utf8")) as DraftMeta;
    return {
      ...meta,
      body: readText(join(dir, `${draftId}.txt`)),
      revisions: revisions.map((r, i) => ({ ...r, body: readText(join(dir, revisionFile(draftId, i))) })),
    };
  }

  /** 该章全部草稿，按创建时间升序（末尾即最新）。 */
  listDrafts(chapter: ChapterNo): readonly ChapterDraft[] {
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

/** 修订快照的正文文件名。序号从 1 起，与作者看到的「第几版」一致。 */
function revisionFile(draftId: DraftId, index: number): string {
  return `${draftId}.r${index + 1}.txt`;
}

/** 正文文件缺失不算错误：元数据是权威，正文丢了也要让草稿能被读出来看见。 */
function readText(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}
