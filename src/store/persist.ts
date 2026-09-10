/**
 * 项目落盘（§12.7 的状态写入时机表）。
 *
 * M3 才需要这一层：M1/M2 的验收都是"跑一次脚本看报告"，而 web 界面打开项目
 * 就得看到上次写到哪 —— 内存事件流满足不了。
 *
 * 布局与格式的两个判断：
 *
 * 1. **事件流用 JSONL append-only**，不是一个 JSON 数组。事件流的核心不变量
 *    就是 append-only（event-stream.ts），JSONL 让"追加一条"是真的追加一行，
 *    不需要读出整个数组、改、写回 —— 后者在写入中途崩溃会丢掉整份历史。
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
 *   <root>/events.jsonl          结构事件流，append-only
 *   <root>/chapters/ch{n}.txt    正文
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { EventStream, type Clock, systemClock } from "./event-stream.js";
import type { StructuralEvent } from "../types/events.js";
import type { ChapterBeat, WorkProfile } from "../types/beat.js";
import type { CharacterCard } from "../types/character.js";
import type { WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import { WRITING_DISCIPLINE } from "../context/discipline.js";
import type { AlertState } from "../types/projections.js";
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
  readonly beats: readonly ChapterBeat[];
  readonly alertStates: readonly AlertState[];
  readonly events: readonly StructuralEvent[];
  readonly chapters: ReadonlyMap<ChapterNo, string>;
}

/** 兼容尚未提供写章资料的旧建库/演示调用方；读取总是返回完整快照。 */
type ProjectSaveInput = Omit<ProjectSnapshot, "discipline" | "settings"> &
  Partial<Pick<ProjectSnapshot, "discipline" | "settings">>;

const FILES = {
  setting: "setting.json",
  discipline: "discipline.json",
  settings: "settings.json",
  profile: "profile.json",
  characters: "characters.json",
  plotLines: "plotlines.json",
  beats: "beats.json",
  alertStates: "alert-states.json",
  events: "events.jsonl",
} as const;

const CHAPTER_DIR = "chapters";
const CHAPTER_FILE = /^ch(\d+)\.txt$/u;

export class ProjectStore {
  constructor(private readonly root: string) {}

  /** 目录是否已经是一个项目。web 层用它判断"新建还是打开"。 */
  exists(): boolean {
    return existsSync(join(this.root, FILES.setting));
  }

  // ── 读 ────────────────────────────────────────────────────────────────

  load(): ProjectSnapshot {
    return {
      setting: this.readJson<WorkSetting>(FILES.setting),
      discipline: this.readJsonOr<WritingDiscipline>(FILES.discipline, WRITING_DISCIPLINE),
      settings: this.readJsonOr<readonly SettingCard[]>(FILES.settings, []),
      profile: this.readJson<WorkProfile>(FILES.profile),
      characters: this.readJsonOr<readonly Omit<CharacterCard, "state">[]>(FILES.characters, []),
      plotLines: this.readJsonOr<readonly PlotLineDef[]>(FILES.plotLines, []),
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
    const path = join(this.root, FILES.events);
    if (!existsSync(path)) return [];
    const text = readFileSync(path, "utf8");
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
    const path = join(this.root, CHAPTER_DIR, `ch${chapter}.txt`);
    return existsSync(path) ? readFileSync(path, "utf8") : undefined;
  }

  // ── 写 ────────────────────────────────────────────────────────────────

  /** 建目录并写入全部文件。已存在的项目会被整体覆盖。 */
  save(snapshot: ProjectSaveInput): void {
    mkdirSync(join(this.root, CHAPTER_DIR), { recursive: true });
    this.writeJson(FILES.setting, snapshot.setting);
    this.writeDiscipline(snapshot.discipline ?? WRITING_DISCIPLINE);
    this.writeSettings(snapshot.settings ?? []);
    this.writeJson(FILES.profile, snapshot.profile);
    this.writeJson(FILES.characters, snapshot.characters);
    this.writeJson(FILES.plotLines, snapshot.plotLines);
    this.writeJson(FILES.beats, snapshot.beats);
    this.writeJson(FILES.alertStates, snapshot.alertStates);
    writeFileSync(
      join(this.root, FILES.events),
      snapshot.events.map((e) => JSON.stringify(e)).join("\n") + (snapshot.events.length > 0 ? "\n" : ""),
      "utf8",
    );
    for (const [chapter, text] of snapshot.chapters) this.writeChapter(chapter, text);
  }

  /**
   * 追加事件。C8 提交走这条路，不重写整个文件。
   *
   * ⚠ 裁决（proposed→committed）**不能**用它 —— 那是修改已有行。裁决后要
   * 调 `rewriteEvents`。这两种写法在 append-only 语义下的区别是：追加是
   * 新事实，裁决是给旧事实盖章（信封变、载荷不变，见 event-stream.ts）。
   */
  appendEvents(events: readonly StructuralEvent[]): void {
    if (events.length === 0) return;
    mkdirSync(this.root, { recursive: true });
    appendFileSync(
      join(this.root, FILES.events),
      events.map((e) => JSON.stringify(e)).join("\n") + "\n",
      "utf8",
    );
  }

  /** 全量重写事件流。裁决改了信封后用。 */
  rewriteEvents(events: readonly StructuralEvent[]): void {
    mkdirSync(this.root, { recursive: true });
    writeFileSync(
      join(this.root, FILES.events),
      events.map((e) => JSON.stringify(e)).join("\n") + (events.length > 0 ? "\n" : ""),
      "utf8",
    );
  }

  writeChapter(chapter: ChapterNo, text: string): void {
    mkdirSync(join(this.root, CHAPTER_DIR), { recursive: true });
    writeFileSync(join(this.root, CHAPTER_DIR, `ch${chapter}.txt`), text, "utf8");
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

  writeDiscipline(discipline: WritingDiscipline): void {
    this.writeJson(FILES.discipline, discipline);
  }

  // ── 原语 ──────────────────────────────────────────────────────────────

  private readJson<T>(name: string): T {
    const path = join(this.root, name);
    if (!existsSync(path)) throw new Error(`项目文件缺失：${path}`);
    try {
      return JSON.parse(readFileSync(path, "utf8")) as T;
    } catch (e) {
      throw new Error(`${name} 不是合法 JSON：${(e as Error).message}`);
    }
  }

  private readJsonOr<T>(name: string, fallback: T): T {
    return existsSync(join(this.root, name)) ? this.readJson<T>(name) : fallback;
  }

  private writeJson(name: string, value: unknown): void {
    mkdirSync(this.root, { recursive: true });
    // 缩进两格：这些文件用户会手改（§5.8 状态必须能给用户看和改），
    // 单行 JSON 改起来太难。
    writeFileSync(join(this.root, name), `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }
}

/** 告警状态数组 ↔ Map。compute 要 Map，落盘要数组。 */
export function alertStateMap(states: readonly AlertState[]): ReadonlyMap<AlertId, AlertState> {
  return new Map(states.map((s) => [s.id, s]));
}
