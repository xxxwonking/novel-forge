/** 作品目录与会话缓存。选择作品只属于请求，不存在可被别的页面切换的全局当前作品。 */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { ProjectStore } from "../store/persist.js";
import { DraftStore } from "../task/draft-store.js";
import { WRITING_DISCIPLINE } from "../context/discipline.js";
import { ProjectSession } from "../server/state.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import type { ChapterWriterOptions } from "../server/chapter-writer.js";
import type { Genre, Platform } from "../types/beat.js";
import type { WorkSetting } from "../types/work.js";

/** 已删除作品的归档条目。`archive` 是 `.trash/` 下的目录名，也是作者能在磁盘上找到它的凭据。 */
export interface RemovedWork extends WorkSummary {
  readonly archive: string;
  readonly deletedAt: string;
}

export interface WorkSummary {
  readonly id: string;
  readonly title: string;
  readonly premise: string;
  readonly genre: string;
  readonly platform: string;
  readonly currentChapter: number;
  readonly chapterCount: number;
  readonly pendingDrafts: number;
  readonly updatedAt: string;
  readonly error: string | null;
}

interface WorkspaceOptions extends ChapterWriterOptions {
  readonly projectRoot?: string;
}

interface NewWorkInput {
  readonly title: string;
  readonly idea: string;
  readonly genre: Genre;
  readonly platform: Platform;
  readonly targetWords: number;
  readonly requestId: string;
}

const GENRES: readonly Genre[] = ["xuanhuan", "xianxia", "urban", "scifi", "mystery", "rulehorror"];
const PLATFORMS: readonly Platform[] = ["fanqie", "feilu", "qidian", "unpublished"];
/** 回收站。点号开头，因此天然不满足 `validId`，不会被当成作品列出或打开。 */
const TRASH_DIR = ".trash";
/** 归档目录名：定长时间戳 + 原 ID，解析无歧义（ID 自身可含 `-` 与 `.`）。 */
const ARCHIVE_NAME = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z-(.+)$/u;
const validId = (id: string): boolean => /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,127}$/u.test(id) && !/[. ]$/u.test(id);

export class Workspace {
  readonly root: string;
  readonly defaultProjectId: string | null;
  private readonly openedRoot: string | undefined;
  private readonly sessions = new Map<string, ProjectSession>();

  constructor(root: string, private readonly options: WorkspaceOptions = {}) {
    this.root = resolve(root);
    this.openedRoot = options.projectRoot === undefined ? undefined : resolve(options.projectRoot);
    this.defaultProjectId = this.openedRoot === undefined ? null
      : dirname(this.openedRoot) === this.root && validId(basename(this.openedRoot)) ? basename(this.openedRoot) : "opened-project";
  }

  list(): readonly WorkSummary[] {
    const ids = new Set<string>();
    if (this.defaultProjectId !== null) ids.add(this.defaultProjectId);
    if (existsSync(this.root)) {
      for (const entry of readdirSync(this.root, { withFileTypes: true })) {
        if (entry.isDirectory() && !entry.isSymbolicLink() && validId(entry.name) && existsSync(join(this.root, entry.name, "setting.json"))) ids.add(entry.name);
      }
    }
    return [...ids].map((id) => {
      try { return summarize(this.projectPath(id), id); }
      catch (error) { return failedSummary(id, error); }
    }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
  }

  project(id: string | undefined): ProjectSession {
    const selected = id ?? this.defaultProjectId;
    if (selected === null) throw new ChapterWriteError(409, "请先从作品列表选择或创建一本作品");
    const root = this.projectPath(selected);
    // Windows 的大小写及短文件名可能指向同一目录，必须共用状态和活动任务锁。
    const canonicalRoot = realpathSync.native(root);
    let session = this.sessions.get(canonicalRoot);
    if (session === undefined) {
      session = new ProjectSession(canonicalRoot, undefined, this.options);
      this.sessions.set(canonicalRoot, session);
    }
    return session;
  }

  create(raw: unknown): WorkSummary {
    const input = parseNewWork(raw);
    const { requestId, ...details } = input;
    const id = `work-${requestId}`;
    const target = resolve(this.root, id);
    const fingerprint = createHash("sha256").update(JSON.stringify(details)).digest("hex");
    if (existsSync(target)) {
      const metaFile = join(this.projectPath(id), "workspace.json");
      if (!existsSync(metaFile) || (JSON.parse(readFileSync(metaFile, "utf8")) as { fingerprint?: string }).fingerprint !== fingerprint) {
        throw new ChapterWriteError(409, "该创建请求已用于另一份作品内容，请刷新后重试");
      }
      return this.describe(id);
    }

    mkdirSync(this.root, { recursive: true });
    // 资料全部写好才公开目录；失败时只清理本次新建的临时目录。
    const staging = mkdtempSync(join(this.root, ".creating-"));
    try {
      const setting: WorkSetting = {
        title: input.title, genre: input.genre, platform: input.platform, premise: input.idea,
        centralConflict: "", pov: "third_limited", tense: "past", protagonistTraits: [],
        protagonistForbidden: [], specialAbility: "", abilityLimits: [], worldRules: [],
        openingSituation: "", styleKeywords: [], romanceLine: "", taboos: [],
      };
      new ProjectStore(staging).save({
        setting, discipline: WRITING_DISCIPLINE, settings: [],
        profile: { genre: input.genre, platform: input.platform, targetWords: input.targetWords },
        characters: [], plotLines: [], beats: [], alertStates: [], events: [], chapters: new Map(),
      });
      writeFileSync(join(staging, "workspace.json"), `${JSON.stringify({ createdAt: new Date().toISOString(), fingerprint }, null, 2)}\n`, "utf8");
      renameSync(staging, target);
    } finally {
      if (existsSync(staging)) rmSync(staging, { recursive: true, force: true });
    }
    return this.describe(id);
  }

  /**
   * 删除 = 把作品目录整体移进 `.trash/`，内容一字不改。
   *
   * 不做真删除有两个理由：作品是作者攒了几十万字的资产，误删不可逆；归档目录本身
   * 就是一本完整的作品，拷出去即可用，恢复只是把它改名移回来（沿用 §35
   * `revision/rebuild` 的「改名留档」口径）。
   */
  remove(raw: unknown): RemovedWork {
    const id = parseRef(raw).id;
    if (id === undefined) throw new ChapterWriteError(400, "缺少作品 ID");
    const root = this.projectPath(id);
    if (id === this.defaultProjectId && this.openedRoot !== undefined) {
      throw new ChapterWriteError(400, "这本作品是启动时用 --project 打开的，不在工作区的管理范围内，请直接在文件系统中处理");
    }
    const canonicalRoot = realpathSync.native(root);
    const session = this.sessions.get(canonicalRoot);
    if (session !== undefined) {
      if (session.chapterTasks().some((task) => task.status === "running")) throw new ChapterWriteError(409, "这本作品有章节任务正在执行，请先暂停或等它结束再删除");
      if (session.run.view().status === "running") throw new ChapterWriteError(409, "这本作品正在连写，请先停下再删除");
    }

    const summary = summarize(root, id);
    const deletedAt = new Date();
    const archive = `${stamp(deletedAt)}-${id}`;
    const trash = join(this.root, TRASH_DIR);
    mkdirSync(trash, { recursive: true });
    const target = join(trash, archive);
    if (existsSync(target)) throw new ChapterWriteError(409, "同名归档已存在，请稍后重试");
    renameSync(root, target);
    // 会话缓存按目录键，留着它会让后续请求继续写到已经改名的旧路径。
    this.sessions.delete(canonicalRoot);
    return { ...summary, archive, deletedAt: deletedAt.toISOString() };
  }

  /** 回收站，按删除时间倒序。 */
  listRemoved(): readonly RemovedWork[] {
    const trash = join(this.root, TRASH_DIR);
    if (!existsSync(trash)) return [];
    return readdirSync(trash, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => this.readArchive(entry.name))
      .filter((work): work is RemovedWork => work !== null)
      .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt) || a.id.localeCompare(b.id));
  }

  /** 把归档移回原 ID。`archive` 指定具体哪一份，省略时取该 ID 最近删除的一份。 */
  restore(raw: unknown): WorkSummary {
    const { id, archive } = parseRef(raw);
    const entry = archive === undefined ? this.listRemoved().find((work) => work.id === id) ?? null : this.readArchive(archive);
    if (entry === null || (id !== undefined && entry.id !== id)) throw new ChapterWriteError(404, "回收站里没有这本作品");

    const target = resolve(this.root, entry.id);
    if (existsSync(target)) throw new ChapterWriteError(409, `已经有一本作品占用了原来的位置（${entry.id}），请先处理它再恢复`);
    renameSync(join(this.root, TRASH_DIR, entry.archive), target);
    return this.describe(entry.id);
  }

  private readArchive(archive: string): RemovedWork | null {
    const parsed = ARCHIVE_NAME.exec(archive);
    const id = parsed?.[8];
    if (parsed === null || id === undefined || !validId(id)) return null;
    const root = join(this.root, TRASH_DIR, archive);
    if (!existsSync(join(root, "setting.json"))) return null;
    const deletedAt = `${parsed[1]}-${parsed[2]}-${parsed[3]}T${parsed[4]}:${parsed[5]}:${parsed[6]}.${parsed[7]}Z`;
    return { ...summarize(root, id), archive, deletedAt };
  }

  private projectPath(id: string): string {
    if (!validId(id)) throw new ChapterWriteError(400, "作品 ID 无效");
    if (id === this.defaultProjectId && this.openedRoot !== undefined) return this.openedRoot;
    const target = resolve(this.root, id);
    if (!existsSync(target) || !lstatSync(target).isDirectory()) throw new ChapterWriteError(404, "找不到这本作品");
    const rel = relative(realpathSync(this.root), realpathSync(target));
    if (rel.startsWith("..") || isAbsolute(rel) || lstatSync(target).isSymbolicLink()) throw new ChapterWriteError(400, "作品目录不能指向工作区外部");
    if (!new ProjectStore(target).exists()) throw new ChapterWriteError(404, "此目录不是作品");
    return target;
  }

  private describe(id: string): WorkSummary {
    return describeWork(this.projectPath(id), id);
  }
}

function describeWork(root: string, id: string): WorkSummary {
  const snapshot = new ProjectStore(root).load();
  const drafts = new DraftStore(root);
  const allDrafts = drafts.chaptersWithDrafts().flatMap((n) => drafts.listDrafts(n));
  const dates = [statSync(join(root, "setting.json")).mtime.toISOString(),
    ...snapshot.beats.map((b) => b.updatedAt), ...allDrafts.map((d) => d.updatedAt),
    ...[...snapshot.chapters.keys()].map((n) => statSync(join(root, "chapters", `ch${n}.txt`)).mtime.toISOString())];
  return {
    id, title: snapshot.setting.title, premise: snapshot.setting.premise,
    genre: snapshot.profile.genre, platform: snapshot.profile.platform,
    currentChapter: Math.max(0, ...snapshot.chapters.keys()), chapterCount: snapshot.chapters.size,
    pendingDrafts: allDrafts.filter((d) => d.status !== "adopted" && d.status !== "discarded").length,
    updatedAt: dates.sort().at(-1) ?? "", error: null,
  };
}

/** 读不出来的作品仍要列出来并说明原因，否则作者看不到它、也就无从修复。 */
function summarize(root: string, id: string): WorkSummary {
  try { return describeWork(root, id); }
  catch (error) { return failedSummary(id, error); }
}

function failedSummary(id: string, error: unknown): WorkSummary {
  return { id, title: id, premise: "", genre: "", platform: "", currentChapter: 0, chapterCount: 0, pendingDrafts: 0, updatedAt: "", error: error instanceof Error ? error.message : String(error) };
}

/** `20260919T102804123Z`：定长且人能读，作者在磁盘上一眼看得出哪份是哪天删的。 */
function stamp(at: Date): string {
  return at.toISOString().replace(/[-:]/gu, "").replace(".", "");
}

function parseRef(raw: unknown): { readonly id: string | undefined; readonly archive: string | undefined } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ChapterWriteError(400, "参数必须是对象");
  const input = raw as Record<string, unknown>;
  const text = (key: string, message: string): string | undefined => {
    const value = input[key];
    if (value === undefined || (typeof value === "string" && value !== "")) return value as string | undefined;
    throw new ChapterWriteError(400, message);
  };
  return { id: text("id", "作品 ID 无效"), archive: text("archive", "归档名无效") };
}

function parseNewWork(raw: unknown): NewWorkInput {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new ChapterWriteError(400, "新建作品参数必须是对象");
  const input = raw as Record<string, unknown>;
  const text = (key: string, fallback: string, max: number): string => {
    const value = input[key] ?? fallback;
    if (typeof value !== "string" || value.length > max) throw new ChapterWriteError(400, `${key} 格式或长度不正确`);
    return value.trim();
  };
  const title = text("title", "未命名作品", 100) || "未命名作品";
  // 想法可以为空：还没想好写什么的作者建了作品先进谋篇模式，由对话把书想出来。
  const idea = text("idea", "", 10000);
  const genre = input["genre"] ?? "xuanhuan";
  const platform = input["platform"] ?? "unpublished";
  if (!GENRES.includes(genre as Genre)) throw new ChapterWriteError(400, "不支持的题材");
  if (!PLATFORMS.includes(platform as Platform)) throw new ChapterWriteError(400, "不支持的平台");
  const targetWords = input["targetWords"] ?? 300000;
  if (typeof targetWords !== "number" || !Number.isSafeInteger(targetWords) || targetWords < 1 || targetWords > 10000000) throw new ChapterWriteError(400, "目标字数必须是 1 到 1000 万之间的整数");
  const requestId = input["requestId"] ?? randomUUID();
  if (typeof requestId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(requestId)) throw new ChapterWriteError(400, "创建请求编号无效");
  return { title, idea, genre: genre as Genre, platform: platform as Platform, targetWords, requestId: requestId.toLowerCase() };
}
