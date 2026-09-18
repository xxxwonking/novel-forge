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
      try { return this.describe(id); }
      catch (error) {
        return { id, title: id, premise: "", genre: "", platform: "", currentChapter: 0, chapterCount: 0, pendingDrafts: 0, updatedAt: "", error: error instanceof Error ? error.message : String(error) };
      }
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
    const root = this.projectPath(id);
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
