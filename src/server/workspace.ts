/**
 * 工作区：一个根目录下的多个作品 + 一个「活动作品」指针（Stage 2·切片 2）。
 *
 * 为什么是「活动指针」而不是每个请求带 work id：现服务是单用户、绑 127.0.0.1、
 * 服务端已经缓存 ProjectSession 的模型（state.ts）。活动指针让既有全部端点零改动
 * ——只在最外层把 session 从「构造期钉死的一个」换成「workspace.active()」。
 * 代价是同一 server 同时只有一个活动作品，对本地单用户工具可接受。
 *
 * 回兼：serve 传入的目录若自身就是一个作品（含 setting.json，如 data/demo），
 * 走单作品模式（活动=该目录），`npm run serve -- data/demo` 与既有测试作品照旧。
 */

import { existsSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { ProjectStore, type ProjectSnapshot } from "../store/persist.js";
import { ProjectSession } from "./state.js";
import type { ChapterWriterOptions } from "./chapter-writer.js";
import { WRITING_DISCIPLINE } from "../context/discipline.js";
import type { Genre, Platform, WorkProfile } from "../types/beat.js";
import type { WorkSetting } from "../types/work.js";

export interface WorkSeed {
  readonly title: string;
  readonly genre: Genre;
  readonly platform: Platform;
  readonly targetWords?: number;
}

/** 合法题材/平台。字面量数组，加错值编译期即报（typo 挡在编译期）。 */
const GENRES: readonly Genre[] = ["xuanhuan", "xianxia", "urban", "scifi", "mystery", "rulehorror"];
const PLATFORMS: readonly Platform[] = ["fanqie", "feilu", "qidian", "unpublished"];

export function isGenre(v: unknown): v is Genre {
  return typeof v === "string" && (GENRES as readonly string[]).includes(v);
}
export function isPlatform(v: unknown): v is Platform {
  return typeof v === "string" && (PLATFORMS as readonly string[]).includes(v);
}

export interface WorkSummary {
  readonly id: string;
  readonly title: string;
  readonly genre: Genre;
  readonly platform: Platform;
  readonly currentChapter: number;
  readonly chapterCount: number;
}

/** 全书目标字数的默认值。仅进度显示用，不参与任何阈值派生（§10.3）。 */
const DEFAULT_TARGET_WORDS = 1_000_000;

/**
 * 最小合法作品快照：能被 ProjectSession 打开，其余靠对话逐步补全（切片 2）。
 *
 * premise/centralConflict 等留空是刻意的 —— 它们由筹备对话填，不在这里编造内容。
 * discipline 用平台默认（§13.3 平台资产），genre/platform 在 setting 与 profile
 * 两处保持一致（预算派生只看 profile，展示看 setting）。
 */
export function scaffoldSnapshot(seed: WorkSeed): ProjectSnapshot {
  const setting: WorkSetting = {
    title: seed.title,
    genre: seed.genre,
    platform: seed.platform,
    premise: "",
    centralConflict: "",
    pov: "third_limited",
    tense: "past",
    protagonistTraits: [],
    protagonistForbidden: [],
    specialAbility: "",
    abilityLimits: [],
    worldRules: [],
    openingSituation: "",
    styleKeywords: [],
    romanceLine: "",
    taboos: [],
  };
  const profile: WorkProfile = {
    platform: seed.platform,
    genre: seed.genre,
    targetWords: seed.targetWords ?? DEFAULT_TARGET_WORDS,
  };
  return {
    setting,
    discipline: WRITING_DISCIPLINE,
    settings: [],
    profile,
    characters: [],
    plotLines: [],
    beats: [],
    alertStates: [],
    events: [],
    chapters: new Map(),
  };
}

/** 作品标题 → 目录 slug。保留中英数字（\p{L} 含中日韩），其余折成 -。 */
function slugify(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/gu, "") || "work"
  );
}

export class Workspace {
  private readonly sessions = new Map<string, ProjectSession>();
  private activeId: string | null = null;
  /** root 自身即一个作品时为 true —— 不支持新建，id 恒为目录名。 */
  private readonly singleWork: boolean;

  constructor(
    private readonly root: string,
    private readonly writing: ChapterWriterOptions = {},
  ) {
    this.singleWork = new ProjectStore(root).exists();
    if (this.singleWork) {
      this.activeId = basename(resolve(root));
    } else {
      // 恰好一个作品时自动激活，省掉一次选择；多于一个则等用户选。
      const works = this.scan();
      if (works.length === 1) this.activeId = works[0] ?? null;
    }
  }

  /** 作品 id → 作品目录。单作品模式下恒为 root。 */
  private dirOf(id: string): string {
    return this.singleWork ? this.root : join(this.root, id);
  }

  /** 扫描当前有哪些作品（含 setting.json 的直接子目录）。每次实时读盘，不缓存。 */
  private scan(): readonly string[] {
    if (this.singleWork) return [basename(resolve(this.root))];
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root).filter((name) => {
      const p = join(this.root, name);
      return statSync(p).isDirectory() && new ProjectStore(p).exists();
    });
  }

  list(): { readonly works: readonly WorkSummary[]; readonly activeId: string | null } {
    const works = this.scan().map<WorkSummary>((id) => {
      const snap = new ProjectStore(this.dirOf(id)).load();
      const nums = [...snap.chapters.keys()];
      return {
        id,
        title: snap.setting.title,
        genre: snap.profile.genre,
        platform: snap.profile.platform,
        currentChapter: nums.length === 0 ? 0 : Math.max(...nums),
        chapterCount: snap.chapters.size,
      };
    });
    return { works, activeId: this.activeId };
  }

  /** 新建作品并落最小快照；新建即设为活动作品。返回作品 id。 */
  create(seed: WorkSeed): string {
    if (this.singleWork) {
      throw new Error("单作品模式不支持新建；用一个工作区目录（不含 setting.json）启动服务");
    }
    if (seed.title.trim() === "") throw new Error("作品标题不能为空");
    const id = this.uniqueId(slugify(seed.title));
    new ProjectStore(this.dirOf(id)).save(scaffoldSnapshot(seed));
    this.activeId = id;
    return id;
  }

  private uniqueId(base: string): string {
    const existing = new Set(this.scan());
    if (!existing.has(base)) return base;
    for (let i = 2; ; i += 1) {
      const candidate = `${base}-${i}`;
      if (!existing.has(candidate)) return candidate;
    }
  }

  select(id: string): void {
    if (!this.scan().includes(id)) throw new Error(`作品不存在：${id}`);
    this.activeId = id;
  }

  activeWorkId(): string | null {
    return this.activeId;
  }

  active(): ProjectSession | null {
    return this.activeId === null ? null : this.session(this.activeId);
  }

  /** 懒建并缓存某作品的会话（透传写章配置，供对话中写章复用同一模型客户端）。 */
  session(id: string): ProjectSession {
    let s = this.sessions.get(id);
    if (s === undefined) {
      s = new ProjectSession(this.dirOf(id), undefined, this.writing);
      this.sessions.set(id, s);
    }
    return s;
  }
}
