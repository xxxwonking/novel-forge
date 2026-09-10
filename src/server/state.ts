/**
 * 服务端的项目会话：把 store / 投影 / 告警 / 视图串成一个可查询的对象。
 *
 * 存在的理由是投影与告警都是**全量重算**（store/project.ts 的判断），而 web
 * 的一次页面加载会连着问四张视图 + 首页告警 + 体检报告。每个端点各自重放
 * 一遍事件流是纯浪费，所以在这里算一次、缓存到下一次写入。
 *
 * 缓存的失效策略是**任何写操作直接丢弃整份缓存**，不做细粒度失效 ——
 * "改了节拍表只有告警要重算、视图不用"这类判断一旦出错就是视图与事件流
 * 不一致，而那正是全量重放要避免的问题。重算一次是毫秒级的。
 */

import { EventStream } from "../store/event-stream.js";
import { ProjectStore, alertStateMap, type PlotLineDef, type ProjectSnapshot } from "../store/persist.js";
import { project, type Projections } from "../store/project.js";
import { computeAlerts, type AlertCandidate } from "../alerts/compute.js";
import { selectAlerts, type AlertSelection } from "../alerts/select.js";
import { buildViewModel, type ViewModel } from "../view/models.js";
import { loadRules } from "../rules/load.js";
import type { Rules } from "../rules/schema.js";
import type { AlertState } from "../types/projections.js";
import type { ChapterBeat, WorkProfile } from "../types/beat.js";
import type { WorkSetting } from "../types/work.js";
import type { CharacterCard } from "../types/character.js";
import type { AlertId, ChapterNo } from "../types/primitives.js";

export interface SessionDerived {
  readonly projections: Projections;
  readonly candidates: readonly AlertCandidate[];
  readonly selection: AlertSelection;
  readonly views: ViewModel;
}

export class ProjectSession {
  private readonly store: ProjectStore;
  private stream: EventStream;
  private setting: WorkSetting;
  private profile: WorkProfile;
  private characters: readonly Omit<CharacterCard, "state">[];
  private plotLines: readonly PlotLineDef[];
  private beats: readonly ChapterBeat[];
  private alertStates: Map<AlertId, AlertState>;
  private chapters: Map<ChapterNo, string>;
  private cache: SessionDerived | null = null;

  constructor(
    root: string,
    readonly rules: Rules = loadRules(),
  ) {
    this.store = new ProjectStore(root);
    const snap = this.store.load();
    this.setting = snap.setting;
    this.profile = snap.profile;
    this.characters = snap.characters;
    this.plotLines = snap.plotLines;
    this.beats = snap.beats;
    this.alertStates = new Map(snap.alertStates.map((s) => [s.id, s]));
    this.chapters = new Map(snap.chapters);
    this.stream = EventStream.restore(snap.events);
  }

  // ── 读 ────────────────────────────────────────────────────────────────

  /**
   * 当前章 = 已有正文的最大章号。
   *
   * 不用节拍表的最大章号：节拍表可以提前排出好几章（§12.2 卷循环一次排 8-12 章），
   * 而"逾期多少章"这类判断的参照必须是**写到哪**，不是排到哪。
   */
  get currentChapter(): ChapterNo {
    return this.chapters.size === 0 ? 0 : Math.max(...this.chapters.keys());
  }

  get nextChapter(): ChapterNo {
    return this.currentChapter + 1;
  }

  /** 下一章的节拍表。告警的可执行性 gate 靠它（§12.6.6）。 */
  get nextBeat(): ChapterBeat | undefined {
    return this.beats.find((b) => b.chapter === this.nextChapter);
  }

  get derived(): SessionDerived {
    this.cache ??= this.recompute();
    return this.cache;
  }

  get meta(): {
    readonly setting: WorkSetting;
    readonly profile: WorkProfile;
    readonly currentChapter: ChapterNo;
    readonly nextChapter: ChapterNo;
    readonly chapterCount: number;
    readonly beats: readonly ChapterBeat[];
    readonly characters: readonly Omit<CharacterCard, "state">[];
    readonly plotLines: readonly PlotLineDef[];
  } {
    return {
      setting: this.setting,
      profile: this.profile,
      currentChapter: this.currentChapter,
      nextChapter: this.nextChapter,
      chapterCount: this.chapters.size,
      beats: this.beats,
      characters: this.characters,
      plotLines: this.plotLines,
    };
  }

  chapterText(chapter: ChapterNo): string | undefined {
    return this.chapters.get(chapter);
  }

  chapterNumbers(): readonly ChapterNo[] {
    return [...this.chapters.keys()].sort((x, y) => x - y);
  }

  beatFor(chapter: ChapterNo): ChapterBeat | undefined {
    return this.beats.find((b) => b.chapter === chapter);
  }

  events(): ReturnType<EventStream["all"]> {
    return this.stream.all();
  }

  alertState(id: AlertId): AlertState | undefined {
    return this.alertStates.get(id);
  }

  // ── 写 ────────────────────────────────────────────────────────────────

  putBeat(beat: ChapterBeat): void {
    const rest = this.beats.filter((b) => b.chapter !== beat.chapter);
    this.beats = [...rest, beat].sort((x, y) => x.chapter - y.chapter);
    this.store.writeBeats(this.beats);
    this.invalidate();
  }

  putAlertState(state: AlertState): void {
    this.alertStates.set(state.id, state);
    this.store.writeAlertStates([...this.alertStates.values()]);
    this.invalidate();
  }

  /** 追加事件（废弃伏笔、确认退场、改期都走这里）。 */
  appendEvents(inputs: readonly Parameters<EventStream["append"]>[0][]): void {
    const written = inputs.map((i) => this.stream.append(i));
    this.store.appendEvents(written);
    this.invalidate();
  }

  putChapter(chapter: ChapterNo, text: string): void {
    this.chapters.set(chapter, text);
    this.store.writeChapter(chapter, text);
    this.invalidate();
  }

  /** 写入本轮算出的告警状态（lastDecay / migratedTo 的推进）。 */
  syncAlertStates(): void {
    let changed = false;
    for (const c of this.derived.candidates) {
      const prev = this.alertStates.get(c.nextState.id);
      if (prev === undefined || prev.lastDecay !== c.nextState.lastDecay || prev.migratedTo !== c.nextState.migratedTo) {
        this.alertStates.set(c.nextState.id, c.nextState);
        changed = true;
      }
    }
    if (changed) this.store.writeAlertStates([...this.alertStates.values()]);
  }

  private invalidate(): void {
    this.cache = null;
  }

  private recompute(): SessionDerived {
    const currentChapter = this.currentChapter;
    const projections = project({
      events: this.stream.effective(),
      currentChapter,
      characterProfiles: this.characters.map((c) => ({
        id: c.id,
        name: c.name,
        tier: c.tier,
        introducedAt: c.introducedAt,
      })),
      plotLineDefs: this.plotLines,
      plotLineGap: this.rules.crossChapter.plotLineGap,
    });

    const candidates = computeAlerts(
      {
        currentChapter,
        nextChapter: this.nextChapter,
        foreshadows: projections.foreshadows,
        plotLines: projections.plotLines,
        arcs: projections.arcs,
        states: alertStateMap([...this.alertStates.values()]),
        now: new Date().toISOString(),
      },
      this.rules,
    );

    return {
      projections,
      candidates,
      selection: selectAlerts(
        { candidates, nextPlan: this.nextBeat?.plan ?? null },
        this.rules.alerts,
      ),
      views: buildViewModel(
        {
          currentChapter,
          foreshadows: projections.foreshadows,
          plotLines: projections.plotLines,
          arcs: projections.arcs,
          relations: projections.relations,
          text: (c) => this.chapters.get(c),
        },
        this.rules.anchor,
      ),
    };
  }
}

export type { ProjectSnapshot };
