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
import type { AdoptResult, ChapterDraft, DraftId, DraftAdoptOptions } from "../task/types.js";
import { project, type Projections } from "../store/project.js";
import { computeAlerts, type AlertCandidate } from "../alerts/compute.js";
import { selectAlerts, type AlertSelection } from "../alerts/select.js";
import { buildViewModel, type ViewModel } from "../view/models.js";
import { loadRules } from "../rules/load.js";
import type { ReviewRules, Rules } from "../rules/schema.js";
import type { AlertAction, AlertState } from "../types/projections.js";
import type { ChapterBeat, WorkProfile } from "../types/beat.js";
import type { VolumeCard, WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import type { CharacterCard } from "../types/character.js";
import type { AlertId, ChapterNo, CharacterId, ForeshadowId, PlotLineId } from "../types/primitives.js";
import type { C5Declaration, ForeshadowWeight } from "../types/events.js";
import { ChapterWriter, type ChapterWriteOptions, type ChapterWriterOptions } from "./chapter-writer.js";
import { ChapterWriteError, buildChapterReadSource, buildChapterRunInput, type ChapterSource } from "./chapter-input.js";
import { ConversationStore } from "../agent/conversation-store.js";
import { MainAgentService } from "../agent/service.js";
import { runAgentLoop, type AgentActionOutcome, type MainAgentToolContext, type PlanAddInput } from "../agent/tool-exec.js";
import { buildMainAgentSystem, type MainAgentContextInfo } from "../agent/system-prompt.js";
import type { AlternativeIdea, ConversationMode, ConversationObserver, ConversationReply, ConversationTurn } from "../agent/types.js";
import { createModelClient } from "../client/create.js";
import { metered } from "../credits/meter.js";
import { MaterialStore, type MaterialFile } from "../import/materials.js";
import { NOT_IN_PROSE, type RelationClaim } from "../types/relations.js";
import type { ImportFile } from "../import/split.js";
import { characterSource } from "../preparation/sources.js";
import { appendCreditEntry, readCreditEntries, summarize } from "../credits/ledger.js";
import type { ModelClient } from "../client/model.js";
import { countWords } from "../text/measure.js";
import { withFileTransaction } from "../store/transaction.js";
import { PreparationService, preparationContent } from "../preparation/service.js";
import type { CharacterInput, PreparationContent, PreparationInput } from "../preparation/types.js";
import { parsePreparationInput } from "../preparation/schema.js";
import { PREPARATION_DRAFT_TOOLS } from "../agent/tools.js";
import { DraftRevisions, validateDraftReference, type DraftEditOptions, type DraftCheckOptions, type DraftCorrectionOptions } from "./draft-revisions.js";
import { toDraftView } from "./draft-view.js";
import type { DraftRewriteOptions } from "./draft-rewrite.js";
import { automaticRevisionLimit } from "../task/automatic-revision.js";
import { prepareDraftProposals, previewDraftProposals, selectedProposalIndices } from "../task/proposals.js";
import { draftRevisionToken, stableFingerprint } from "../task/revision.js";
import { checkChapter } from "../task/steps.js";
import { crossCheckC5, checkPromisedResolutions } from "../chapter/c5-crosscheck.js";
import { PlanningService } from "../planning/service.js";
import { buildStoryProgress } from "../alerts/progress.js";
import { TextExportService } from "../export/service.js";
import { ImportService } from "../import/service.js";
import { InferenceService } from "../import/inference.js";
import { ContinuousRunService, adoptionToken } from "../run/service.js";
import { ReviseService } from "../revise/service.js";

export interface SessionDerived {
  readonly projections: Projections;
  readonly candidates: readonly AlertCandidate[];
  readonly selection: AlertSelection;
  readonly views: ViewModel;
}

/** 起草一次要容纳完整人物档案与首章规划；短回复仍要求简洁。 */
const PREPARATION_DRAFT_MAX_TOKENS = 8192;

export interface PreparationDraftOptions {
  /** 作者的一句话补充要求，可空 —— 空了就只按作品想法推断。 */
  readonly brief?: string;
  /** characters 只起草人物；full 连地点、情节线与下一章计划一起；chapters 只排后面 count 章的章计划。 */
  readonly focus: "characters" | "full" | "chapters";
  readonly count?: number;
  /** true 落成候选方案；false 只把草稿交回来（表单试填），不写任何文件。 */
  readonly apply: boolean;
}

export interface PreparationDraftResult {
  /** 起草回合的说明文字：补了什么、哪里还需要作者拿主意。 */
  readonly reply: string;
  /** apply: true 时的候选方案编号。 */
  readonly proposalId?: string;
  readonly summary?: string;
  /** apply: false 时的草稿人物，供表单填入。 */
  readonly characters: readonly CharacterInput[];
}

export class ProjectSession {
  readonly preparation: PreparationService;
  readonly planning: PlanningService;
  readonly exports: TextExportService;
  readonly imports: ImportService;
  readonly inference: InferenceService;
  readonly run: ContinuousRunService;
  readonly revise: ReviseService;
  private readonly store: ProjectStore;
  private readonly drafts: DraftStore;
  private readonly writer: ChapterWriter;
  private readonly revisions: DraftRevisions;
  private stream: EventStream;
  private setting: WorkSetting;
  private discipline: WritingDiscipline;
  private settings: readonly SettingCard[];
  private profile: WorkProfile;
  private characters: readonly Omit<CharacterCard, "state">[];
  private plotLines: readonly PlotLineDef[];
  private volumes: readonly VolumeCard[];
  private beats: readonly ChapterBeat[];
  private alertStates: Map<AlertId, AlertState>;
  private chapters: Map<ChapterNo, string>;
  private cache: SessionDerived | null = null;
  /** 处理进度与 derived 同源同失效点，但没有理由每问一次就重算一遍（它遍历全部事件与节拍表）。 */
  private progress: ReturnType<typeof buildStoryProgress> | null = null;
  private readonly conversation: ConversationStore;
  private modelClient: ModelClient | undefined;

  constructor(
    private readonly root: string,
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
    this.volumes = snap.volumes;
    this.beats = snap.beats;
    this.alertStates = new Map(snap.alertStates.map((s) => [s.id, s]));
    this.chapters = new Map(snap.chapters);
    this.stream = EventStream.restore(snap.events);
    // 注入的客户端在这里就包上计量，再交给写章器 —— 它拿到的必须已经是计量过的那一个。
    const injected = writing.client === undefined ? undefined : this.meter(writing.client);
    this.writer = new ChapterWriter(this, this.drafts, injected === undefined ? writing : { ...writing, client: injected });
    this.revisions = new DraftRevisions(this, this.drafts, this.writer);
    this.conversation = new ConversationStore(root);
    this.modelClient = injected;
    this.preparation = new PreparationService(root, {
      snapshot: () => this.snapshot(), apply: (content) => this.applyPreparation(content),
      transaction: (operation) => this.transact(operation), rules: this.rules,
      checkChapter: (chapter) => { buildChapterRunInput(this, chapter); },
      commitRelations: (relations) => this.appendRelations(relations),
    });
    this.planning = new PlanningService(this, operation => this.transact(operation));
    this.exports = new TextExportService(root, this);
    this.imports = new ImportService(root, this);
    this.inference = new InferenceService(root, {
      source: this, client: () => this.getModelClient(), transaction: (operation) => this.transact(operation),
    });
    this.revise = new ReviseService(root, {
      source: this, client: () => this.getModelClient(), transaction: (operation) => this.transact(operation),
    });
    this.run = new ContinuousRunService(root, {
      nextChapter: () => this.nextChapter,
      maxBatchChapters: this.rules.task.maxBatchChapters,
      // 改早章留下的硬矛盾没处理完就不开连写：接下来每一章都会建立在错的基准上。
      assertCanStart: () => { this.revise.assertNoConflicts(); this.writer.prepareModelTask(); },
      writeChapter: (chapter, requestId) => this.writer.write({ chapter, requestId }),
      adopt: (chapter, draft) => { this.adopt(chapter, draft.draftId, { revisionToken: adoptionToken(draft) }); },
    });
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
    readonly volumes: readonly VolumeCard[];
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
      volumes: this.volumes,
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

  storyProgress(): ReturnType<typeof buildStoryProgress> { return (this.progress ??= buildStoryProgress(this)); }

  // ── 写 ────────────────────────────────────────────────────────────────

  private snapshot(): ProjectSnapshot {
    return { setting: this.setting, discipline: this.discipline, settings: this.settings, profile: this.profile,
      characters: this.characters, plotLines: this.plotLines, volumes: this.volumes, beats: this.beats,
      events: this.stream.all(), chapters: this.chapters, alertStates: [...this.alertStates.values()] };
  }

  private applyPreparation(content: PreparationContent): void {
    this.store.writePreparation(content);
    Object.assign(this, content);
    this.invalidate();
  }

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
    const beats = [...rest, beat].sort((x, y) => x.chapter - y.chapter);
    this.store.writeBeats(beats);
    this.beats = beats;
    this.invalidate();
  }

  putAlertState(state: AlertState): void {
    const states = new Map(this.alertStates).set(state.id, state);
    this.store.writeAlertStates([...states.values()]);
    this.alertStates = states;
    this.invalidate();
  }

  /** 追加事件（废弃伏笔、确认退场、改期都走这里）。 */
  appendEvents(inputs: readonly Parameters<EventStream["append"]>[0][]): void {
    const stream = EventStream.restore(this.stream.all());
    const written = inputs.map((i) => stream.append(i));
    this.store.appendEvents(written);
    this.stream = stream;
    this.invalidate();
  }

  /**
   * 追加一批**声明的关系**并立即定为正式。
   *
   * 走 proposed → committed 两步而不是直接写 committed：与别处一致，信封里留下
   * 「这条是这么来的」（`origin: material_import`），而 `authored` 是「作者手填、
   * 模型不得覆盖」——比这重得多，不能借它。
   *
   * 这类关系**没有正文出处**：它们来自作者提供的资料（角色档案里的关系表），
   * 所以锚点缺席、章号记 0、图上画虚线。等正文真写到那里，反推或 C5 会补上
   * 有出处的那条，虚线随之变实线。
   */
  appendRelations(relations: readonly RelationClaim[]): void {
    if (relations.length === 0) return;
    const stream = EventStream.restore(this.stream.all());
    const ids = relations.map((r) => stream.append({
      chapter: NOT_IN_PROSE, origin: "material_import", provenance: "proposed",
      payload: { type: "relation_changed", from: r.from, to: r.to, fromKind: r.fromKind ?? null, toKind: r.toKind, note: r.note },
    }).envelope.id);
    // 只落最终态：proposed 那一版从未写盘，账目干净。
    const decided = stream.decideIds(ids, "committed");
    this.store.appendEvents(decided);
    this.stream = stream;
    this.invalidate();
  }

  putChapter(chapter: ChapterNo, text: string): void {
    this.store.writeChapter(chapter, text);
    this.chapters = new Map(this.chapters).set(chapter, text);
    this.invalidate();
  }

  /**
   * 一次事务写入多章正文（导入旧作）。
   *
   * 逐章调 `putChapter` 也能写成，但那样中途失败会留下半本书 —— 导入一次动几十章，
   * 部分落盘比整批失败难收拾得多。
   */
  putChapters(entries: readonly { readonly chapter: ChapterNo; readonly text: string }[]): void {
    this.transact(() => { for (const entry of entries) this.putChapter(entry.chapter, entry.text); });
  }

  /**
   * 旧稿反推的一轮结果落库：先作废该章上一轮的待确认声明，再落这一轮（可为空）。
   *
   * 重跑必须清场 —— 两轮待确认记录并存时，作者在界面上看到的是哪一轮的判断
   * 就说不清了。返回作废的条数。
   */
  replaceInference(chapter: ChapterNo, declaration: C5Declaration | null): number {
    return this.transact(() => {
      const stream = EventStream.restore(this.stream.all());
      const stale = stream.all().filter((e) => e.envelope.chapter === chapter
        && e.envelope.origin === "import_inference" && e.envelope.provenance === "proposed");
      for (const event of stale) stream.decide(event.envelope.id, "rejected", "旧稿反推重跑，上一轮记录作废");
      if (declaration !== null) commitDeclaration(stream, chapter, declaration, "import_inference");
      this.store.rewriteEvents(stream.all());
      this.stream = stream;
      this.invalidate();
      return stale.length;
    });
  }

  /** 裁决一章的旧稿反推声明（作者确认或丢弃）。返回实际改变的条数。 */
  decideInference(chapter: ChapterNo, decision: "committed" | "rejected"): number {
    return this.transact(() => {
      const stream = EventStream.restore(this.stream.all());
      const pending = stream.all().filter((e) => e.envelope.chapter === chapter
        && e.envelope.origin === "import_inference" && e.envelope.provenance === "proposed");
      for (const event of pending) stream.decide(event.envelope.id, decision);
      this.store.rewriteEvents(stream.all());
      this.stream = stream;
      this.invalidate();
      return pending.length;
    });
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
    const stream = EventStream.restore(this.stream.all());
    const superseded = stream.supersedeChapter(chapter);
    const added = commitDeclaration(stream, chapter, declaration);
    for (const event of added) stream.decide(event.envelope.id, "committed");
    this.store.rewriteEvents(stream.all());
    this.stream = stream;
    this.invalidate();
    return superseded;
  }

  // ── 草稿（Stage 1 章节任务）────────────────────────────────────────────

  writeChapter(options: ChapterWriteOptions): Promise<ChapterDraft> {
    return this.writer.write(options);
  }

  startChapter(options: ChapterWriteOptions): ChapterDraft { return this.writer.start(options); }

  editDraft(options: DraftEditOptions): ChapterDraft { return this.revisions.edit(options); }

  correctDraft(options: DraftCorrectionOptions): ChapterDraft { return this.revisions.correct(options); }

  reviseDraft(options: DraftRewriteOptions): ChapterDraft { return this.revisions.rewrite(options); }

  checkDraft(options: DraftCheckOptions): ChapterDraft { return this.writer.check(options); }

  /** 新数据按采用事务记录的版本读取；旧数据仅在正文能唯一对应采用稿时识别。 */
  currentAdoptedDraftId(chapter: ChapterNo): DraftId | undefined {
    const recorded = this.drafts.currentAdoptedDraftId(chapter);
    const body = this.chapterText(chapter);
    if (recorded !== undefined) {
      const draft = this.drafts.loadDraft(chapter, recorded);
      if (draft?.status !== "adopted" || draft.body !== body) throw new ChapterWriteError(409, `第 ${chapter} 章正式正文与版本记录不一致，请先核对保存文件`);
      return recorded;
    }
    const candidates = body === undefined ? [] : this.listDrafts(chapter).filter(draft => draft.status === "adopted" && draft.body === body);
    return candidates.length === 1 ? candidates[0]!.draftId : undefined;
  }

  chapterTasks(): ReturnType<ChapterWriter["tasks"]> { return this.writer.tasks(); }

  controlChapter(chapter: ChapterNo, draftId: DraftId, action: "pause" | "end"): ReturnType<ChapterWriter["control"]> {
    return this.writer.control(chapter, draftId, action);
  }

  chapterSource(proposalId?: string): ChapterSource {
    if (proposalId === undefined) return this;
    const snapshot = this.snapshot();
    const content = this.preparation.preview(proposalId);
    const numbers = [...snapshot.chapters.keys()].sort((a, b) => a - b);
    const currentChapter = Math.max(0, ...numbers);
    return {
      rules: this.rules, reviewSettings: this.reviewSettings,
      meta: { ...content, currentChapter, nextChapter: currentChapter + 1, chapterCount: numbers.length },
      events: () => snapshot.events, chapterNumbers: () => numbers,
      chapterText: (n) => snapshot.chapters.get(n), beatFor: (n) => content.beats.find((b) => b.chapter === n),
      allDrafts: () => this.allDrafts(),
    };
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

  draftProposalOptions(draft: ChapterDraft): ReturnType<typeof previewDraftProposals> {
    try { return previewDraftProposals(draft, this.chapterSource(draft.status === "adopted" ? undefined : draft.writeContext?.proposalId)); }
    catch (error) {
      if (!(error instanceof ChapterWriteError)) throw error;
      return previewDraftProposals(draft, this).map(option => ({ ...option, available: false, problem: error.message }));
    }
  }

  discardDraft(chapter: ChapterNo, draftId: DraftId): boolean {
    this.writer.assertNotRunning(chapter, draftId);
    const d = this.drafts.loadDraft(chapter, draftId);
    if (d === undefined) return false;
    if (d.status === "adopted") throw new ChapterWriteError(409, "已采用版本不能丢弃；需要修改时请另建草稿");
    // 重复丢弃不能把 discardedFrom 覆盖成 discarded，否则这份稿再也回不去原状态。
    if (d.status === "discarded") return true;
    this.drafts.saveDraft({ ...d, status: "discarded", discardedFrom: d.status, updatedAt: new Date().toISOString() });
    return true;
  }

  /**
   * 撤销丢弃：回到丢弃前的状态。
   *
   * 恢复不等于可采用 —— 丢弃期间作品可能已经往前走了，所以最后仍要过一遍新鲜度，
   * 依据变过的稿落 stale，与「另写一版」「采用」用的是同一条判据。
   */
  restoreDraft(chapter: ChapterNo, draftId: DraftId): ChapterDraft | undefined {
    this.writer.assertNotRunning(chapter, draftId);
    const d = this.drafts.loadDraft(chapter, draftId);
    if (d === undefined) return undefined;
    if (d.status !== "discarded") throw new ChapterWriteError(409, "这份草稿没有被丢弃，不需要恢复");
    const { discardedFrom, ...rest } = d;
    const restored: ChapterDraft = { ...rest, status: discardedFrom ?? "pending_check", updatedAt: new Date().toISOString() };
    this.drafts.saveDraft(restored);
    return this.writer.markStaleIfChanged(restored) ?? restored;
  }

  /** 采用一份草稿：提交声明为正式事实 + 落正文 + 版本 +1 + 标记后续章草稿需重核。 */
  adopt(chapter: ChapterNo, draftId: DraftId, options: DraftAdoptOptions = {}): AdoptResult {
    // 连不带建议的旧调用也必须先校验路径；不能让外部 draftId 进入存储路径。
    validateDraftReference({ chapter, draftId, revisionToken: options.revisionToken ?? "0".repeat(64) });
    const draft = this.drafts.loadDraft(chapter, draftId);
    if (draft === undefined) throw new ChapterWriteError(404, "草稿不存在");
    const selected = selectedProposalIndices(options.selectedProposals, draft.proposals.length);
    if (options.selectedProposals !== undefined && options.revisionToken === undefined) throw new ChapterWriteError(400, "选择建议时必须同时提供 revisionToken");
    if (draft.status === "adopted") {
      if (options.selectedProposals !== undefined && stableFingerprint(selected) !== stableFingerprint(draft.proposalAdoption?.selected ?? [])) throw new ChapterWriteError(409, "该稿已采用，不能改变原次采用的建议选择；请提出新的修改");
    } else {
      this.writer.assertNotRunning(chapter, draftId);
      if (options.revisionToken !== undefined && options.revisionToken !== draftRevisionToken(draft)) throw new ChapterWriteError(409, "稿件已变化，请重新查看建议与当前版本再采用");
      this.writer.assertFresh(draft);
    }
    return this.transact(() => {
      if (draft.status !== "adopted") {
        if (draft.status !== "ready" || !draft.acceptable || draft.declaration === null) throw new ChapterWriteError(400, "草稿未就绪，不能采用");
        const now = new Date().toISOString();
        const prepared = prepareDraftProposals(draft, this.chapterSource(draft.writeContext?.proposalId), selected, now);
        if (draft.writeContext?.proposalId !== undefined) this.preparation.confirm(draft.writeContext.proposalId);
        let findings = draft.findings;
        if (selected.length > 0) {
          if (selected.some(index => draft.proposals[index]?.kind === "character_update")) this.applyPreparation({ ...preparationContent(this.snapshot()), characters: prepared.characters });
          const input = buildChapterRunInput(this, chapter);
          const checked = checkChapter(input, draft.body, draft.declaration, [
            ...crossCheckC5({ declaration: draft.declaration, chapterText: draft.body }),
            ...checkPromisedResolutions(draft.declaration, input.promisedResolutions, input.patchWords),
          ]);
          if (!checked.acceptable) throw new ChapterWriteError(409, `选定资料后仍有必须处理项，本次采用未完成：${checked.findings.filter(f => f.level === "block").map(f => f.message).join("；")}`);
          findings = checked.findings;
          this.appendEvents(prepared.planned);
        }
        if (draft.proposals.length > 0) this.drafts.saveDraft({ ...draft, findings,
          proposalAdoption: { sourceToken: draftRevisionToken(draft), selected, options: prepared.options, at: now },
        });
      }
      // 改的是更早的章：先留下这一章原本的结构记录，采用后拿它比出差异。
      // 必须在 commitDraftDeclaration 作废旧事件之前取，之后就读不到了。
      const downstream = chapter < this.currentChapter;
      const before = downstream ? this.revise.adoptedDeclaration(chapter) : null;
      const proseChanged = downstream && this.chapterText(chapter) !== draft.body;
      const result = adoptDraft(
      {
        draftStore: this.drafts,
        commitDeclaration: (ch, decl) => this.commitDraftDeclaration(ch, decl),
        putChapter: (ch, body) => this.putChapter(ch, body),
      },
      chapter,
      draftId,
      );
      if (downstream && result.changed) this.revise.record(chapter, before, draft.declaration, proseChanged);
      return result;
    });
  }

  /** 文件失败时也恢复内存；各写入口只替换状态引用，不原地修改旧对象。 */
  private transact<T>(operation: () => T): T {
    const before = { setting: this.setting, discipline: this.discipline, settings: this.settings,
      profile: this.profile, characters: this.characters, plotLines: this.plotLines, volumes: this.volumes, beats: this.beats,
      alertStates: this.alertStates, chapters: this.chapters, stream: this.stream };
    try {
      return withFileTransaction(this.root, operation);
    } catch (error) {
      Object.assign(this, before);
      throw error;
    } finally {
      this.invalidate();
    }
  }

  // ── 对话式主 Agent（Stage 2·切片 1）────────────────────────────────────

  /**
   * 一轮对话：主 Agent 理解意图、自主选工具，产出回复与本回合的 effects。
   * 需要模型客户端（未配置抛 503）—— 只读浏览不经过这里，不受影响。
   */
  async converse(text: string, observe?: ConversationObserver): Promise<ConversationReply> {
    const client = this.getModelClient();
    const service = new MainAgentService({
      client,
      store: this.conversation,
      // 排队的回合在真正开始时取资料，包含前一回合已采用的正文和状态。
      ctx: () => this.buildAgentContext(text.trim()),
      contextInfo: () => this.agentContextInfo(),
      maxRounds: this.rules.agent.maxConversationRounds,
      maxPlanningRounds: this.rules.agent.maxPlanningRounds,
    });
    return service.send(text, observe);
  }

  conversationMode(): ConversationMode {
    return this.conversation.mode();
  }

  /** 模式是对话的属性，存在会话文件里 —— 它决定这一轮能不能写入，必须与工具集是同一份真相。 */
  setConversationMode(mode: ConversationMode): ConversationMode {
    this.conversation.setMode(mode);
    return mode;
  }

  /**
   * 资料页的「让 AI 起草」：跑一次**没有人坐在旁边**的起草回合。
   *
   * 三处刻意的取舍：
   *   - **不落对话历史。** 按钮不是作者打的字；写进 turns 会让对话里出现一条作者
   *     从未说过的 user 发言，那是伪造。起草只落候选方案（真实产品产物）。
   *   - **受限工具集**（`PREPARATION_DRAFT_TOOLS`）。起草过程无人盯着，不能让它
   *     顺手确认方案或写章 —— 用工具集从能力上杜绝，而不是靠提示词祈祷。
   *   - **复用主 Agent 的提示与工具循环**，所以 schema 不合规时校验错误会作为
   *     tool_result 回喂，模型自己改到过；这次的输出还会被 prepare 的业务校验兜住。
   *
   * `apply: false` 是「试填」：只把草稿交回来给表单，不落任何文件。它靠包装
   * `proposePreparation` 捕获输入实现 —— 校验照常发生（错误仍回喂），只是不保存。
   */
  async draftPreparation(options: PreparationDraftOptions, observe?: ConversationObserver): Promise<PreparationDraftResult> {
    const client = this.getModelClient();
    const chapters = options.focus === "chapters" ? this.batchRange(options.count) : null;
    const sources = options.focus === "characters" ? this.characterSources() : null;
    const focus = options.focus === "characters"
      ? `这次**只**起草人物档案（changes.characters）。地点、情节线、章节计划一律不要动。把这本书里**已经出现过的人物**尽量都建出来，一人一张卡，并按出场权重分档：protagonist（主角）、major（主要）、minor（次要）、extra（龙套）；身份与定位写进 profile.role，关系与来历写进 profile.background。${sources !== null && sources.from.length > 0 ? "人物以作者提供的资料文件为准，正文抽样只用来核对谁真的出过场。资料里如果写了人物之间的关系（搭档、亲属、师徒、仇敌…），一并填进 changes.relations —— 每条一个方向，双向关系填两条，note 用一句话说清是什么关系；**只填资料里写明的，不要自己推测**。" : ""}`
      : chapters !== null
        ? `这次**只**排章计划（changes.beats）：为第 ${chapters.from} 章到第 ${chapters.to} 章各起草一份，章号连续、volume 沿用最近一章的卷号（没有就填 1）。人物、地点、情节线一律不动，只能引用已确认的 ID。每章必须有具体的核心事件、阶段反馈与章末钩子，不要写「继续铺垫」「更大的风暴」这类空话；要收的伏笔只能是当前 open 的编号，埋设与兑现要跨章衔接，不要把所有兑现堆在最后一章。`
        : "起草这份作品现在还缺的资料：人物档案、必要的地点/组织、情节线，以及下一章的章计划。已经确认的内容不要重复提交。";
    const brief = (options.brief ?? "").trim();
    // 提示词仍然写明边界，与受限工具集互补：工具集管"做不到"，提示词管"该怎么用"。
    const ask = [
      "（这条请求来自资料页的「让 AI 起草」按钮，不是作者在对话里打的字，请直接执行，不要反问。）",
      "先 get_preparation 读取作者已指定的想法与现有正式资料，再据此推断并补齐：",
      focus,
      ...(sources === null || sources.text === "" ? [] : ["以下是这本书已有的材料：", sources.text]),
      ...(sources === null || sources.sampled.length === 0 ? [] : [`注意：正文只抽样了上面那 ${sources.sampled.length} 章的开头，全书共 ${this.chapterNumbers().length} 章。没有抽到的章里的人物如果资料文件提到了，也照样建卡；不要声称你读过全书。`]),
      ...(chapters !== null ? [] : ["人物 profile 与 speech 必须是完整的：定位、外貌、性格标签、想要什么、害怕什么、背景，以及说话方式（语域、情绪表达、句长区间、句式偏好、至少一条正例台词）。作者的设定常常只有一句想法 —— 人物具体是什么样由你判断，不要回过头去问作者。"]),
      "用 propose_preparation 保存为一份方案供作者审阅。不要确认方案，不要写章，不要采用任何稿件。",
      ...(brief === "" ? [] : [`作者这次的补充要求：${brief}`]),
      chapters !== null ? "最后用一段话说明每章推进了什么、哪几章收了哪些伏笔，以及哪里还需要作者拿主意。"
        : "最后用一段话说明你补了哪些人物、各自的关键设定，以及哪里还需要作者拿主意。",
    ].join("\n");

    let captured: PreparationInput | null = null;
    const base = this.buildAgentContext(ask);
    const ctx: MainAgentToolContext = options.apply ? base : {
      ...base,
      proposePreparation: async (input: unknown): Promise<AgentActionOutcome> => {
        try {
          // 试填只校验形状（schema），不跑需要正式资料配合的业务校验 —— 那些等作者
          // 在表单里定稿后保存时再跑，否则一个还没埋设的伏笔引用会让整个试填报废。
          captured = parsePreparationInput(input);
          return { message: "（草稿已收下，尚未保存为方案。内容已完整时不要再重复提交。）" };
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return { message, effect: { kind: "action_failed", tool: "propose_preparation", message } };
        }
      },
    };

    const loop = await runAgentLoop(client, {
      role: "judge",
      maxTokens: PREPARATION_DRAFT_MAX_TOKENS,
      tools: PREPARATION_DRAFT_TOOLS,
      system: buildMainAgentSystem(this.agentContextInfo()),
      messages: [{ role: "user", content: ask }],
    }, ctx, this.rules.agent.maxConversationRounds, observe);

    const reply = loop.text.trim();
    if (!options.apply) {
      if (captured === null) throw new ChapterWriteError(502, `起草没有产出可用的资料${reply === "" ? "" : `：${reply}`}`);
      return { reply, characters: (captured as PreparationInput).changes.characters ?? [] };
    }
    const proposed = loop.effects.find((effect) => effect.kind === "preparation_proposed");
    if (proposed === undefined || proposed.kind !== "preparation_proposed") {
      throw new ChapterWriteError(502, `起草没有保存出方案${reply === "" ? "" : `：${reply}`}`);
    }
    return { reply, proposalId: proposed.proposalId, summary: proposed.summary, characters: [] };
  }

  /**
   * 本作品实际生效的模型审查开关：作品自己的设置优先，没设过就用 `rules.review`。
   *
   * 每次从磁盘读：它不参与来源指纹，也就不该进入会话缓存 —— 另一个页面改了开关，
   * 下一章检查就该按新值走，不必重开会话。
   */
  get reviewSettings(): ReviewRules {
    return this.store.loadReview() ?? this.rules.review;
  }

  setReviewSettings(review: ReviewRules): ReviewRules {
    if (typeof review?.voice !== "boolean" || typeof review.semantics !== "boolean") {
      throw new ChapterWriteError(400, "voice 与 semantics 必须都是布尔值");
    }
    const value = { voice: review.voice, semantics: review.semantics };
    this.store.writeReview(value);
    return value;
  }

  conversationTurns(): readonly ConversationTurn[] {
    return this.conversation.load().turns;
  }

  listIdeas(): readonly AlternativeIdea[] {
    return this.conversation.listIdeas();
  }

  /**
   * 懒创建/复用模型客户端。与 ChapterWriter 各自懒创建（客户端是无状态配置载体，
   * 不共享实例无碍）；测试注入 writing.client 时两者拿到同一实例。
   * 不在构造期创建 —— 只读作品（如演示数据）没有配模型，构造期创建会 503 掉整个会话。
   */
  /**
   * 排章的范围：从最后一章已确认计划之后开始，排 count 章。
   * 不从下一章开始 —— 已排好的计划不该被"排后面几章"覆盖掉。
   */
  private batchRange(count: number | undefined): { readonly from: ChapterNo; readonly to: ChapterNo } {
    const max = this.rules.task.maxBatchChapters;
    if (!Number.isSafeInteger(count) || (count as number) < 1 || (count as number) > max) throw new ChapterWriteError(400, `一次最多排 ${max} 章，count 必须是 1 到 ${max} 之间的整数`);
    const planned = this.beats.filter((b) => b.provenance === "committed" || b.provenance === "authored").map((b) => b.chapter);
    const from = Math.max(this.nextChapter, ...planned.map((n) => n + 1));
    return { from, to: from + (count as number) - 1 };
  }

  /** 作品资料（随旧稿或单独上传收下的文件）。 */
  materials(): readonly MaterialFile[] {
    return new MaterialStore(this.root).list();
  }

  /**
   * 收下若干资料文件，逐份给出结果。
   *
   * 不因为一份失败就整批不收：作者选的可能是整个文件夹，里面混着图片和 zip ——
   * 该收的要收下，不该收的要点名说清楚为什么。
   */
  saveMaterials(files: readonly ImportFile[]): { readonly saved: readonly string[]; readonly skipped: readonly { readonly name: string; readonly reason: string }[] } {
    const store = new MaterialStore(this.root);
    const saved: string[] = [];
    const skipped: { name: string; reason: string }[] = [];
    for (const file of files) {
      const result = store.save(file.name, file.text);
      if ("saved" in result) saved.push(result.saved.name);
      else skipped.push({ name: file.name, reason: result.reason });
    }
    return { saved, skipped };
  }

  /** 本作品的模型消耗。余额是全局的，由工作区汇总各作品减出来。 */
  credits(): ReturnType<typeof summarize> {
    return summarize(readCreditEntries(this.root));
  }

  /** 全流程唯一的客户端出口：在这里包上计量，任何调用点都不会绕过记账。 */
  getModelClient(): ModelClient {
    if (this.modelClient === undefined) {
      try {
        this.modelClient = this.meter(createModelClient());
      } catch (error) {
        throw new ChapterWriteError(503, `写章模型尚未配置：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this.modelClient;
  }

  /** 「从正文识别人物」要看的材料：作者提供的资料文件 + 正文抽样。 */
  private characterSources(): ReturnType<typeof characterSource> {
    const store = new MaterialStore(this.root);
    return characterSource({
      materials: store.list().map((m) => ({ name: m.name, text: store.read(m.file) ?? "" })),
      chapterNumbers: this.chapterNumbers(),
      chapterText: (n) => this.chapterText(n),
    });
  }

  private meter(client: ModelClient): ModelClient {
    return metered(client, (entry) => appendCreditEntry(this.root, entry));
  }

  private agentContextInfo(): MainAgentContextInfo {
    const next = this.nextChapter;
    const beat = this.beatFor(next);
    const nextPlanReady = beat !== undefined && (beat.provenance === "committed" || beat.provenance === "authored");
    const pendingDrafts = this.listDrafts(next).filter((d) => d.status !== "adopted" && d.status !== "discarded").length;
    return {
      title: this.setting.title,
      genre: this.profile.genre,
      platform: this.profile.platform,
      currentChapter: this.currentChapter,
      nextChapter: next,
      nextPlanReady,
      pendingDrafts,
      autoRevisionLimit: automaticRevisionLimit(this.rules.task.maxAutoRevisions),
      readinessMissing: this.preparation.view().readiness.missing,
    };
  }

  /** 主 Agent 每次读工具查询当前正式资料；章节写作任务自身仍使用固定快照。 */
  private buildAgentContext(authorRequest: string): MainAgentToolContext {
    const readSource = () => buildChapterReadSource(this, Math.max(this.nextChapter, 1));
    const now = (): string => new Date().toISOString();
    const fail = (tool: string, message: string): AgentActionOutcome => ({
      message,
      effect: { kind: "action_failed", tool, message },
    });
    return {
      reviseDraft: async (options) => {
        try {
          const draft = this.reviseDraft({ ...options, chapter: chapterFromDraftId(options.draftId) });
          return { message: JSON.stringify(toDraftView(draft, this)), effect: { kind: "chapter_revised", chapter: draft.chapter, draftId: draft.draftId, status: draft.status, acceptable: draft.acceptable } };
        } catch (error) { return fail("revise_chapter_draft", error instanceof Error ? error.message : String(error)); }
      },
      getChapterDraft: (draftId) => {
        const chapter = chapterFromDraftId(draftId);
        const draft = this.getDraft(chapter, draftId);
        if (draft === undefined) throw new ChapterWriteError(404, "稿件不存在");
        return JSON.stringify(toDraftView(draft, this));
      },
      correctDraft: async (draftId, revisionToken, changes, summary) => {
        try {
          const draft = this.correctDraft({ chapter: chapterFromDraftId(draftId), draftId, revisionToken, changes, summary });
          return { message: JSON.stringify(toDraftView(draft, this)), effect: { kind: "chapter_revised", chapter: draft.chapter, draftId: draft.draftId, status: draft.status, acceptable: draft.acceptable } };
        } catch (error) { return fail("correct_draft_structure", error instanceof Error ? error.message : String(error)); }
      },
      checkDraft: async (draftId, revisionToken, adoptOnSuccess, selectedProposals) => {
        try {
          const draft = this.checkDraft({ chapter: chapterFromDraftId(draftId), draftId, revisionToken, adoptOnSuccess, ...(selectedProposals === undefined ? {} : { selectedProposals }) });
          const task = this.chapterTasks().find(item => item.draftId === draftId)!;
          return { message: JSON.stringify(toDraftView(draft, this)), effect: { kind: "task_updated", chapter: draft.chapter, draftId, status: task.status } };
        } catch (error) { return fail("check_chapter_draft", error instanceof Error ? error.message : String(error)); }
      },
      listChapterTasks: () => JSON.stringify(this.chapterTasks()),
      controlChapterTask: async (draftId, action) => {
        const match = /^ch([1-9]\d*)d[1-9]\d*$/u.exec(draftId);
        if (match === null) return fail("control_chapter_task", "请先定位有效的任务编号");
        const chapter = Number(match[1]);
        try {
          if (action === "resume") this.startChapter({ chapter, draftId });
          const task = action === "resume" ? this.chapterTasks().find((item) => item.draftId === draftId)!
            : this.controlChapter(chapter, draftId, action);
          return { message: JSON.stringify(task), effect: { kind: "task_updated", chapter, draftId, status: task.status } };
        } catch (error) { return fail("control_chapter_task", error instanceof Error ? error.message : String(error)); }
      },
      getPreparation: (proposalId) => JSON.stringify(proposalId === null ? { ...this.preparation.view(), ideas: this.listIdeas() } : this.preparation.get(proposalId)),
      proposePreparation: async (input, author) => {
        try {
          const proposal = author ? this.preparation.recordAuthor(input) : this.preparation.propose(input);
          return { message: JSON.stringify(proposal), effect: { kind: proposal.status === "confirmed" ? "preparation_confirmed" : "preparation_proposed", proposalId: proposal.id, summary: proposal.summary } };
        } catch (error) { return fail(author ? "record_author_details" : "propose_preparation", error instanceof Error ? error.message : String(error)); }
      },
      confirmPreparation: async (proposalId) => {
        try {
          const result = this.preparation.confirm(proposalId);
          return { message: `${result.changed ? "已确认" : "此前已确认"}方案「${result.proposal.summary}」。这些是资料和未来计划，尚未写成正式正文。`, effect: { kind: "preparation_confirmed", proposalId, summary: result.proposal.summary } };
        } catch (error) { return fail("confirm_preparation", error instanceof Error ? error.message : String(error)); }
      },
      getOverview: () => {
        const info = this.agentContextInfo();
        const { foreshadows } = this.derived.projections;
        const open = foreshadows.filter((f) => f.status === "open").length;
        const overdue = foreshadows.filter((f) => f.status === "open" && (f.overdueBy as number) > 0).length;
        return `《${info.title}》 题材=${info.genre} 平台=${info.platform}
已写到第 ${info.currentChapter} 章；下一章第 ${info.nextChapter} 章，节拍${info.nextPlanReady ? "已确认" : "未确认"}。
下一章待处理草稿 ${info.pendingDrafts} 份；未收伏笔 ${open} 条（逾期 ${overdue} 条）。`;
      },
      listChapterDrafts: (chapter) => {
        const n = chapter ?? this.nextChapter;
        const drafts = this.listDrafts(n);
        if (drafts.length === 0) return `第 ${n} 章还没有草稿。`;
        return JSON.stringify(
          drafts.map((d) => ({
            draftId: d.draftId,
            status: d.status,
            acceptable: d.acceptable,
            words: countWords(d.body),
            findings: d.findings.length,
          })),
        );
      },
      getChapterText: (chapter, excerpt) => readSource().loadChapter(chapter, excerpt),
      getCharacter: (name) => readSource().loadCharacter(name),
      listOpenForeshadows: (weight) => readSource().listOpenForeshadows(weight),
      getStoryProgress: () => JSON.stringify(this.storyProgress()),
      prepareTextExport: async selection => {
        try {
          const preview = this.exports.prepare(selection);
          if (preview.id === null) return fail("prepare_text_export", JSON.stringify(preview));
          return { message: JSON.stringify(preview), effect: { kind: "export_prepared", exportId: preview.id, chapters: preview.chapters.length } };
        } catch (error) { return fail("prepare_text_export", error instanceof Error ? error.message : String(error)); }
      },
      getNextPlan: () => {
        const next = this.nextChapter;
        const beat = this.beatFor(next);
        if (beat === undefined) return `第 ${next} 章还没有节拍表。`;
        const p = beat.plan;
        const w = beat.budget?.words;
        return JSON.stringify({
          chapter: next,
          confirmed: beat.provenance === "committed" || beat.provenance === "authored",
          chapterType: p.chapterType,
          coreEvent: p.coreEvent,
          secondaryThread: p.secondaryThread,
          stageFeedback: p.stageFeedback,
          hook: p.hook,
          resolves: p.resolves,
          characters: p.characters,
          locations: p.locations,
          wordBudget: w === undefined ? null : { min: w.min, max: w.max, sweet: w.sweet },
        });
      },
      addToNextChapter: async (input) => {
        const targetChapter = input.targetChapter ?? this.nextChapter;
        const action = toAlertAction(input, targetChapter);
        if (typeof action === "string") return fail("plan_add_to_chapter", action);
        try {
          const applied = this.planning.apply(action);
          return { message: applied.message, effect: { kind: "plan_updated", chapter: targetChapter, promotedToPayoff: applied.promotedToPayoff ?? false } };
        } catch (error) { return fail("plan_add_to_chapter", error instanceof Error ? error.message : String(error)); }
      },
      rescheduleForeshadow: async (foreshadowId, expectedBy) => {
        try {
          const applied = this.planning.apply({ kind: "reschedule", foreshadowId, expectedBy });
          return { message: applied.message, effect: { kind: "foreshadow_rescheduled", foreshadowId, expectedBy } };
        } catch (error) { return fail("plan_reschedule_foreshadow", error instanceof Error ? error.message : String(error)); }
      },
      abandonForeshadow: async (foreshadowId, reason) => {
        try {
          const applied = this.planning.apply({ kind: "abandon", foreshadowId }, { reason });
          return { message: applied.message, effect: { kind: "foreshadow_abandoned", foreshadowId } };
        } catch (error) { return fail("plan_abandon_foreshadow", error instanceof Error ? error.message : String(error)); }
      },
      recordIdea: async (text) => {
        const idea = this.conversation.recordIdea(text, now());
        return { message: `已记为备选：${idea.text}`, effect: { kind: "idea_recorded", id: idea.id, text: idea.text } };
      },
      writeNextChapter: async (proposalId) => {
        try {
          const draft = this.startChapter({ chapter: this.nextChapter, authorRequest, ...(proposalId === undefined ? {} : { proposalId }) });
          const running = draft.execution?.status === "running";
          return {
            message: running ? `第 ${draft.chapter} 章任务 ${draft.draftId} 已启动，正在处理，尚未写完。离开页面后服务会继续，作者可查看、暂停或结束。`
              : `第 ${draft.chapter} 章已有草稿 ${draft.draftId}，状态 ${draft.status}${draft.acceptable ? "（可采用）" : ""}`,
            effect: {
              kind: running ? "chapter_started" : "chapter_written",
              chapter: draft.chapter,
              draftId: draft.draftId,
              status: draft.status,
              acceptable: draft.acceptable,
            },
          };
        } catch (error) {
          return fail("write_next_chapter", error instanceof Error ? error.message : String(error));
        }
      },
      adoptChapter: async (draftId, options) => {
        const m = /^ch(\d+)d\d+$/u.exec(draftId);
        if (m?.[1] === undefined) return fail("adopt_chapter", `draftId 格式不对：${draftId}`);
        const chapter = Number(m[1]);
        try {
          const r = this.adopt(chapter, draftId, options);
          return {
            message: r.changed ? `已采用第 ${chapter} 章的 ${draftId}${(options?.selectedProposals?.length ?? 0) > 0 ? `，同时应用 ${options!.selectedProposals!.length} 条选定建议；未来伏笔仍是规划` : ""}` : `${draftId} 此前已采用`,
            effect: { kind: "chapter_adopted", chapter, draftId, superseded: r.superseded, staleMarked: r.staleMarked },
          };
        } catch (error) {
          return fail("adopt_chapter", error instanceof Error ? error.message : String(error));
        }
      },
    };
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
    this.progress = null;
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
        { candidates, nextPlan: this.nextBeat?.provenance === "authored" || this.nextBeat?.provenance === "committed" ? this.nextBeat.plan : null },
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

/**
 * PlanAddInput → AlertAction（三种 what）。返回错误字符串表示入参非法。
 * 品牌 ID 在此转换，真实存在性和当前可操作状态由 PlanningService 在保存前校验。
 */
function toAlertAction(input: PlanAddInput, targetChapter: ChapterNo): AlertAction | string {
  switch (input.what) {
    case "resolution": {
      if (input.weight !== "main" && input.weight !== "sub" && input.weight !== "detail") {
        return "weight 必须是 main/sub/detail";
      }
      if (input.completeness !== "full" && input.completeness !== "partial") {
        return "completeness 必须是 full/partial";
      }
      return {
        kind: "add_resolution_to_beat",
        targetChapter,
        foreshadowId: (input.foreshadowId ?? "") as ForeshadowId,
        weight: input.weight as ForeshadowWeight,
        completeness: input.completeness,
      };
    }
    case "advance":
      return { kind: "add_advance_to_beat", targetChapter, plotLine: (input.plotLine ?? "") as PlotLineId };
    case "character":
      return { kind: "add_character_to_beat", targetChapter, characterId: (input.characterId ?? "") as CharacterId };
  }
}

function chapterFromDraftId(draftId: string): number {
  const match = /^ch([1-9]\d*)d[1-9]\d*$/u.exec(draftId);
  if (match === null || !Number.isSafeInteger(Number(match[1]))) throw new ChapterWriteError(400, "请提供有效的稿件编号");
  return Number(match[1]);
}

export type { ProjectSnapshot };
