/**
 * 项目落盘（§12.7 的状态写入时机表）。
 *
 * M3 才需要这一层：M1/M2 的验收都是"跑一次脚本看报告"，而 web 界面打开项目
 * 就得看到上次写到哪 —— 内存事件流满足不了。
 *
 * 布局与格式的两个判断：
 *
 * 1. **事件流用 JSONL**，保留按行查看及逻辑 append-only 的格式。追加保留原有行，
 *    裁决只改变信封。文件替换经同步事务保存，使采用涉及的正文、事件和版本一起恢复。
 * 2. **正文一章一个文件**，纯文本。它是用户资产里最重要的部分，必须在任何
 *    编辑器里能直接打开；塞进 JSON 会让 30 万字变成一行带 \n 转义的字符串。
 *
 * 目录：
 *   <root>/setting.json          作品设定（L1，极少改）
 *   <root>/discipline.json       写作纪律（L1，版本随内容保存）
 *   <root>/settings.json         地点/组织设定库（L3 按需读取）
 *   <root>/profile.json          平台/题材/目标字数
 *   <root>/characters.json       人物卡（设定块；state 块是投影，不存）
 *   <root>/plotlines.json        情节线定义
 *   <root>/beats.json            节拍表（含派生预算）
 *   <root>/alert-states.json     告警的用户侧状态
 *   <root>/review.json           两个 model 审查通道的开关（缺省用 rules.review）
 *   <root>/events.jsonl          结构事件流，append-only
 *   <root>/chapters/ch{n}.txt    正文
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { EventStream, type Clock, systemClock } from "./event-stream.js";
import { readProjectFile, recoverFileTransaction, withFileTransaction, writeProjectFile } from "./transaction.js";
import type { StructuralEvent } from "../types/events.js";
import type { ChapterBeat, WorkProfile } from "../types/beat.js";
import type { CharacterCard } from "../types/character.js";
import type { VolumeCard, WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import { WRITING_DISCIPLINE } from "../context/discipline.js";
import type { AlertState } from "../types/projections.js";
import type { ReviewRules } from "../rules/schema.js";
import type { AlertId, ChapterNo, PlotLineId } from "../types/primitives.js";
import type { ForeshadowWeight } from "../types/events.js";

/** 情节线的静态定义。与 ProjectionInput.plotLineDefs 同形。 */
export interface PlotLineDef {
  readonly id: PlotLineId;
  readonly label: string;
  readonly weight: ForeshadowWeight;
}

/**
 * 一个项目的全部持久状态。
 *
 * 人物卡的 `state` 块**不在这里** —— 它带 Derived 标记、由投影器算出，
 * 存下来就等于给自己造了一份可能与事件流分歧的拷贝
 * （同 store/project.ts 里 plotLineGap 不给缺省值的理由）。
 */
export interface ProjectSnapshot {
  readonly setting: WorkSetting;
  readonly discipline: WritingDiscipline;
  readonly settings: readonly SettingCard[];
  readonly profile: WorkProfile;
  readonly characters: readonly Omit<CharacterCard, "state">[];
  readonly plotLines: readonly PlotLineDef[];
  readonly volumes: readonly VolumeCard[];
  readonly beats: readonly ChapterBeat[];
  readonly alertStates: readonly AlertState[];
  readonly events: readonly StructuralEvent[];
  readonly chapters: ReadonlyMap<ChapterNo, string>;
}

/** 兼容尚未提供写章资料的旧建库/演示调用方；读取总是返回完整快照。 */
type ProjectSaveInput = Omit<ProjectSnapshot, "discipline" | "settings" | "volumes"> &
  Partial<Pick<ProjectSnapshot, "discipline" | "settings" | "volumes">>;

const FILES = {
  setting: "setting.json",
  discipline: "discipline.json",
  settings: "settings.json",
  profile: "profile.json",
  characters: "characters.json",
  plotLines: "plotlines.json",
  volumes: "volumes.json",
  beats: "beats.json",
  alertStates: "alert-states.json",
  review: "review.json",
  events: "events.jsonl",
} as const;

const CHAPTER_DIR = "chapters";
const CHAPTER_FILE = /^ch(\d+)\.txt$/u;

export class ProjectStore {
  constructor(private readonly root: string) {}

  /** 目录是否已经是一个项目。web 层用它判断"新建还是打开"。 */
  exists(): boolean {
    recoverFileTransaction(this.root);
    return existsSync(join(this.root, FILES.setting));
  }

  // ── 读 ────────────────────────────────────────────────────────────────

  load(): ProjectSnapshot {
    recoverFileTransaction(this.root);
    return {
      setting: this.readJson<WorkSetting>(FILES.setting),
      discipline: this.readJsonOr<WritingDiscipline>(FILES.discipline, WRITING_DISCIPLINE),
      settings: this.readJsonOr<readonly SettingCard[]>(FILES.settings, []),
      profile: this.readJson<WorkProfile>(FILES.profile),
      characters: this.readJsonOr<readonly Omit<CharacterCard, "state">[]>(FILES.characters, []),
      plotLines: this.readJsonOr<readonly PlotLineDef[]>(FILES.plotLines, []),
      volumes: this.readJsonOr<readonly VolumeCard[]>(FILES.volumes, []),
      beats: this.readJsonOr<readonly ChapterBeat[]>(FILES.beats, []),
      alertStates: this.readJsonOr<readonly AlertState[]>(FILES.alertStates, []),
      events: this.loadEvents(),
      chapters: this.loadChapters(),
    };
  }

  /**
   * 事件流。**逐行解析，坏行报错而非跳过。**
   *
   * 静默跳过一条坏行意味着投影会少一个事件而没有任何提示 —— 伏笔清单里
   * 凭空少一条比整个项目打不开难查得多。
   */
  loadEvents(): readonly StructuralEvent[] {
    const text = readProjectFile(this.root, FILES.events);
    if (text === undefined) return [];
    const out: StructuralEvent[] = [];
    text.split("\n").forEach((line, i) => {
      if (line.trim() === "") return;
      try {
        out.push(JSON.parse(line) as StructuralEvent);
      } catch (e) {
        throw new Error(`${FILES.events} 第 ${i + 1} 行不是合法 JSON：${(e as Error).message}`);
      }
    });
    return out;
  }

  /** 恢复出一个可继续 append 的事件流（seq 与章内计数都续上）。 */
  loadEventStream(clock: Clock = systemClock): EventStream {
    return EventStream.restore(this.loadEvents(), clock);
  }

  loadChapters(): ReadonlyMap<ChapterNo, string> {
    recoverFileTransaction(this.root);
    const dir = join(this.root, CHAPTER_DIR);
    const out = new Map<ChapterNo, string>();
    if (!existsSync(dir)) return out;
    for (const name of readdirSync(dir)) {
      const m = CHAPTER_FILE.exec(name);
      if (m?.[1] === undefined) continue;
      out.set(Number(m[1]), readFileSync(join(dir, name), "utf8"));
    }
    return out;
  }

  readChapter(chapter: ChapterNo): string | undefined {
    return readProjectFile(this.root, join(CHAPTER_DIR, `ch${chapter}.txt`));
  }

  // ── 写 ────────────────────────────────────────────────────────────────

  /** 建目录并写入全部文件。已存在的项目会被整体覆盖。 */
  save(snapshot: ProjectSaveInput): void {
    withFileTransaction(this.root, () => {
      this.writeJson(FILES.setting, snapshot.setting);
      this.writeDiscipline(snapshot.discipline ?? WRITING_DISCIPLINE);
      this.writeSettings(snapshot.settings ?? []);
      this.writeJson(FILES.profile, snapshot.profile);
      this.writeJson(FILES.characters, snapshot.characters);
      this.writeJson(FILES.plotLines, snapshot.plotLines);
      this.writeJson(FILES.volumes, snapshot.volumes ?? []);
      this.writeJson(FILES.beats, snapshot.beats);
      this.writeJson(FILES.alertStates, snapshot.alertStates);
      this.rewriteEvents(snapshot.events);
      for (const [chapter, text] of snapshot.chapters) this.writeChapter(chapter, text);
    });
  }

  /**
   * 追加事件。原有每一行保持原样，文件通过事务替换，避免失败后留下半行 JSON。
   *
   * ⚠ 裁决（proposed→committed）**不能**用它 —— 那是修改已有行。裁决后要
   * 调 `rewriteEvents`。这两种写法在 append-only 语义下的区别是：追加是
   * 新事实，裁决是给旧事实盖章（信封变、载荷不变，见 event-stream.ts）。
   */
  appendEvents(events: readonly StructuralEvent[]): void {
    if (events.length === 0) return;
    const previous = readProjectFile(this.root, FILES.events) ?? "";
    writeProjectFile(
      this.root, FILES.events,
      previous + (previous && !previous.endsWith("\n") ? "\n" : "") + events.map((e) => JSON.stringify(e)).join("\n") + "\n",
    );
  }

  /** 全量重写事件流。裁决改了信封后用。 */
  rewriteEvents(events: readonly StructuralEvent[]): void {
    writeProjectFile(
      this.root, FILES.events,
      events.map((e) => JSON.stringify(e)).join("\n") + (events.length > 0 ? "\n" : ""),
    );
  }

  writeChapter(chapter: ChapterNo, text: string): void {
    writeProjectFile(this.root, join(CHAPTER_DIR, `ch${chapter}.txt`), text);
  }

  writeBeats(beats: readonly ChapterBeat[]): void {
    this.writeJson(FILES.beats, beats);
  }

  writeAlertStates(states: readonly AlertState[]): void {
    this.writeJson(FILES.alertStates, states);
  }

  writeCharacters(characters: readonly Omit<CharacterCard, "state">[]): void {
    this.writeJson(FILES.characters, characters);
  }

  writeSettings(settings: readonly SettingCard[]): void {
    this.writeJson(FILES.settings, settings);
  }

  /**
   * 模型审查开关。**刻意不进 `ProjectSnapshot`** —— 来源指纹是按快照字段算的
   * （见 `chapterInputFingerprint`），开关一旦进去，作者改个建议性审查的开关
   * 就会把所有未采用草稿判成"作品资料发生变化"。结构上隔开比约定更可靠。
   *
   * 文件不存在时返回 undefined，由调用方回落到 `rules.review` 的全局默认；
   * 只读浏览不写文件。
   */
  loadReview(): ReviewRules | undefined {
    if (!existsSync(join(this.root, FILES.review))) return undefined;
    const value = this.readJson<Partial<ReviewRules>>(FILES.review);
    if (typeof value?.voice !== "boolean" || typeof value.semantics !== "boolean") {
      throw new Error(`${FILES.review} 不是合法的审查开关：voice 与 semantics 必须都是布尔值`);
    }
    return Object.freeze({ voice: value.voice, semantics: value.semantics });
  }

  writeReview(review: ReviewRules): void {
    this.writeJson(FILES.review, review);
  }

  writeDiscipline(discipline: WritingDiscipline): void {
    this.writeJson(FILES.discipline, discipline);
  }

  /** 资料方案仅写资料和规划，不触碰正式故事事件、正文或告警决定。 */
  writePreparation(content: Omit<ProjectSnapshot, "events" | "chapters" | "alertStates">): void {
    withFileTransaction(this.root, () => {
      this.writeJson(FILES.setting, content.setting);
      this.writeJson(FILES.profile, content.profile);
      this.writeDiscipline(content.discipline);
      this.writeCharacters(content.characters);
      this.writeSettings(content.settings);
      this.writeJson(FILES.plotLines, content.plotLines);
      this.writeJson(FILES.volumes, content.volumes);
      this.writeBeats(content.beats);
    });
  }

  // ── 原语 ──────────────────────────────────────────────────────────────

  private readJson<T>(name: string): T {
    try {
      const text = readProjectFile(this.root, name);
      if (text === undefined) throw new Error(`项目文件缺失：${name}`);
      return JSON.parse(text) as T;
    } catch (e) {
      throw new Error(`${name} 不是合法 JSON：${(e as Error).message}`);
    }
  }

  private readJsonOr<T>(name: string, fallback: T): T {
    return existsSync(join(this.root, name)) ? this.readJson<T>(name) : fallback;
  }

  private writeJson(name: string, value: unknown): void {
    // 缩进两格：这些文件用户会手改（§5.8 状态必须能给用户看和改），
    // 单行 JSON 改起来太难。
    writeProjectFile(this.root, name, `${JSON.stringify(value, null, 2)}\n`);
  }
}

/** 告警状态数组 ↔ Map。compute 要 Map，落盘要数组。 */
export function alertStateMap(states: readonly AlertState[]): ReadonlyMap<AlertId, AlertState> {
  return new Map(states.map((s) => [s.id, s]));
}
