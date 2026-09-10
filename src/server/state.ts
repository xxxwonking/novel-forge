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

import { EventStream, commitDeclaration } from "../store/event-stream.js";
import { ProjectStore, alertStateMap, type PlotLineDef, type ProjectSnapshot } from "../store/persist.js";
import { DraftStore } from "../task/draft-store.js";
import { adoptDraft } from "../task/adopt.js";
import type { AdoptResult, ChapterDraft, DraftId } from "../task/types.js";
import { project, type Projections } from "../store/project.js";
import { computeAlerts, type AlertCandidate } from "../alerts/compute.js";
import { selectAlerts, type AlertSelection } from "../alerts/select.js";
import { buildViewModel, type ViewModel } from "../view/models.js";
import { loadRules } from "../rules/load.js";
import type { Rules } from "../rules/schema.js";
import type { AlertState } from "../types/projections.js";
import type { ChapterBeat, WorkProfile } from "../types/beat.js";
import type { WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import type { CharacterCard } from "../types/character.js";
import type { AlertId, ChapterNo } from "../types/primitives.js";
import type { C5Declaration } from "../types/events.js";
import { ChapterWriter, type ChapterWriteOptions, type ChapterWriterOptions } from "./chapter-writer.js";
import { ChapterWriteError } from "./chapter-input.js";

export interface SessionDerived {
  readonly projections: Projections;
  readonly candidates: readonly AlertCandidate[];
  readonly selection: AlertSelection;
  readonly views: ViewModel;
}

export class ProjectSession {
  private readonly store: ProjectStore;
  private readonly drafts: DraftStore;
  private readonly writer: ChapterWriter;
  private stream: EventStream;
  private setting: WorkSetting;
  private discipline: WritingDiscipline;
  private settings: readonly SettingCard[];
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
    writing: ChapterWriterOptions = {},
  ) {
    this.store = new ProjectStore(root);
    this.drafts = new DraftStore(root);
    const snap = this.store.load();
    this.setting = snap.setting;
    this.discipline = snap.discipline;
    this.settings = snap.settings;
    this.profile = snap.profile;
    this.characters = snap.characters;
    this.plotLines = snap.plotLines;
    this.beats = snap.beats;
    this.alertStates = new Map(snap.alertStates.map((s) => [s.id, s]));
    this.chapters = new Map(snap.chapters);
    this.stream = EventStream.restore(snap.events);
    this.writer = new ChapterWriter(this, this.drafts, writing);
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
    readonly discipline: WritingDiscipline;
    readonly settings: readonly SettingCard[];
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
      discipline: this.discipline,
      settings: this.settings,
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

  putSettings(settings: readonly SettingCard[]): void {
    this.store.writeSettings(settings);
    this.settings = settings;
    this.invalidate();
  }

  putDiscipline(discipline: WritingDiscipline): void {
    this.store.writeDiscipline(discipline);
    this.discipline = discipline;
    this.invalidate();
  }

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

  /**
   * 采用一份草稿声明为该章正式事实（Stage 1 按版本采用的提交侧）。
   *
   * 先作废该章旧的 C5 committed 事件（修订已采用章时 >0），再把新声明展开为
   * proposed 并逐条提交，最后全量重写事件流并失效缓存。返回被作废数。
   *
   * 只裁决本次新建的事件 ID；旧流程或异步诊断留在流里的候选仍然待确认，
   * 不能随本次采用一起生效。
   */
  commitDraftDeclaration(chapter: ChapterNo, declaration: C5Declaration): number {
    const superseded = this.stream.supersedeChapter(chapter);
    const added = commitDeclaration(this.stream, chapter, declaration);
    for (const event of added) this.stream.decide(event.envelope.id, "committed");
    this.store.rewriteEvents(this.stream.all());
    this.invalidate();
    return superseded;
  }

  // ── 草稿（Stage 1 章节任务）────────────────────────────────────────────

  writeChapter(options: ChapterWriteOptions): Promise<ChapterDraft> {
    return this.writer.write(options);
  }

  listDrafts(chapter: ChapterNo): readonly ChapterDraft[] {
    return this.drafts.listDrafts(chapter);
  }

  allDrafts(): readonly ChapterDraft[] {
    return this.drafts.chaptersWithDrafts().flatMap((chapter) => this.drafts.listDrafts(chapter));
  }

  getDraft(chapter: ChapterNo, draftId: DraftId): ChapterDraft | undefined {
    return this.drafts.loadDraft(chapter, draftId);
  }

  discardDraft(chapter: ChapterNo, draftId: DraftId): boolean {
    this.writer.assertNotRunning(chapter, draftId);
    const d = this.drafts.loadDraft(chapter, draftId);
    if (d === undefined) return false;
    if (d.status === "adopted") throw new ChapterWriteError(409, "已采用版本不能丢弃；需要修改时请另建草稿");
    this.drafts.saveDraft({ ...d, status: "discarded", updatedAt: new Date().toISOString() });
    return true;
  }

  /** 采用一份草稿：提交声明为正式事实 + 落正文 + 版本 +1 + 标记后续章草稿需重核。 */
  adopt(chapter: ChapterNo, draftId: DraftId): AdoptResult {
    const draft = this.drafts.loadDraft(chapter, draftId);
    if (draft !== undefined) this.writer.assertFresh(draft);
    return adoptDraft(
      {
        draftStore: this.drafts,
        commitDeclaration: (ch, decl) => this.commitDraftDeclaration(ch, decl),
        putChapter: (ch, body) => this.putChapter(ch, body),
      },
      chapter,
      draftId,
    );
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
