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
import type { AlertAction, AlertState } from "../types/projections.js";
import type { ChapterBeat, WorkProfile } from "../types/beat.js";
import type { WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import type { CharacterCard } from "../types/character.js";
import type { AlertId, ChapterNo, CharacterId, ForeshadowId, PlotLineId } from "../types/primitives.js";
import type { C5Declaration, ForeshadowWeight } from "../types/events.js";
import { ChapterWriter, type ChapterWriteOptions, type ChapterWriterOptions } from "./chapter-writer.js";
import { ChapterWriteError, buildChapterReadSource, buildChapterRunInput, type ChapterSource } from "./chapter-input.js";
import { ConversationStore } from "../agent/conversation-store.js";
import { MainAgentService } from "../agent/service.js";
import type { AgentActionOutcome, MainAgentToolContext, PlanAddInput } from "../agent/tool-exec.js";
import type { MainAgentContextInfo } from "../agent/system-prompt.js";
import type { AlternativeIdea, ConversationReply, ConversationTurn } from "../agent/types.js";
import { applyActionToBeat } from "../alerts/apply.js";
import { createModelClient } from "../client/create.js";
import type { ModelClient } from "../client/model.js";
import { countWords } from "../text/measure.js";
import { withFileTransaction } from "../store/transaction.js";
import { PreparationService } from "../preparation/service.js";
import type { PreparationContent } from "../preparation/types.js";
import { DraftRevisions, type DraftEditOptions, type DraftCheckOptions, type DraftCorrectionOptions } from "./draft-revisions.js";
import { toDraftView } from "./draft-view.js";
import type { DraftRewriteOptions } from "./draft-rewrite.js";

export interface SessionDerived {
  readonly projections: Projections;
  readonly candidates: readonly AlertCandidate[];
  readonly selection: AlertSelection;
  readonly views: ViewModel;
}

export class ProjectSession {
  readonly preparation: PreparationService;
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
  private beats: readonly ChapterBeat[];
  private alertStates: Map<AlertId, AlertState>;
  private chapters: Map<ChapterNo, string>;
  private cache: SessionDerived | null = null;
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
    this.beats = snap.beats;
    this.alertStates = new Map(snap.alertStates.map((s) => [s.id, s]));
    this.chapters = new Map(snap.chapters);
    this.stream = EventStream.restore(snap.events);
    this.writer = new ChapterWriter(this, this.drafts, writing);
    this.revisions = new DraftRevisions(this, this.drafts, this.writer);
    this.conversation = new ConversationStore(root);
    this.modelClient = writing.client;
    this.preparation = new PreparationService(root, {
      snapshot: () => this.snapshot(), apply: (content) => this.applyPreparation(content),
      transaction: (operation) => this.transact(operation), rules: this.rules,
      checkChapter: (chapter) => { buildChapterRunInput(this, chapter); },
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

  private snapshot(): ProjectSnapshot {
    return { setting: this.setting, discipline: this.discipline, settings: this.settings, profile: this.profile,
      characters: this.characters, plotLines: this.plotLines, beats: this.beats,
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

  putChapter(chapter: ChapterNo, text: string): void {
    this.store.writeChapter(chapter, text);
    this.chapters = new Map(this.chapters).set(chapter, text);
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
      rules: this.rules, meta: { ...content, currentChapter, nextChapter: currentChapter + 1, chapterCount: numbers.length },
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
    return this.transact(() => {
      if (draft?.status !== "adopted" && draft?.writeContext?.proposalId !== undefined) this.preparation.confirm(draft.writeContext.proposalId);
      return adoptDraft(
      {
        draftStore: this.drafts,
        commitDeclaration: (ch, decl) => this.commitDraftDeclaration(ch, decl),
        putChapter: (ch, body) => this.putChapter(ch, body),
      },
      chapter,
      draftId,
      );
    });
  }

  /** 文件失败时也恢复内存；各写入口只替换状态引用，不原地修改旧对象。 */
  private transact<T>(operation: () => T): T {
    const before = { setting: this.setting, discipline: this.discipline, settings: this.settings,
      profile: this.profile, characters: this.characters, plotLines: this.plotLines, beats: this.beats,
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
  async converse(text: string): Promise<ConversationReply> {
    const client = this.getModelClient();
    const service = new MainAgentService({
      client,
      store: this.conversation,
      // 排队的回合在真正开始时取资料，包含前一回合已采用的正文和状态。
      ctx: () => this.buildAgentContext(),
      contextInfo: () => this.agentContextInfo(),
      maxRounds: this.rules.agent.maxConversationRounds,
    });
    return service.send(text);
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
  private getModelClient(): ModelClient {
    if (this.modelClient === undefined) {
      try {
        this.modelClient = createModelClient();
      } catch (error) {
        throw new ChapterWriteError(503, `写章模型尚未配置：${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return this.modelClient;
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
    };
  }

  /** 主 Agent 每次读工具查询当前正式资料；章节写作任务自身仍使用固定快照。 */
  private buildAgentContext(): MainAgentToolContext {
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
      checkDraft: async (draftId, revisionToken, adoptOnSuccess) => {
        try {
          const draft = this.checkDraft({ chapter: chapterFromDraftId(draftId), draftId, revisionToken, adoptOnSuccess });
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
        const next = this.nextChapter;
        const beat = this.beatFor(next);
        if (beat === undefined) return fail("plan_add_to_next_chapter", `第 ${next} 章还没有节拍表，先排章`);
        const action = toAlertAction(input, next);
        if (typeof action === "string") return fail("plan_add_to_next_chapter", action);
        const applied = applyActionToBeat({ beat, action, profile: this.profile, now: now() }, this.rules);
        if (applied.changed) this.putBeat(applied.beat);
        return {
          message: applied.changed
            ? `已加入第 ${next} 章计划${applied.promotedToPayoff ? "；该章升级为回收章，字数预算随之放宽" : ""}`
            : "该安排已在计划中，无需重复",
          effect: { kind: "plan_updated", chapter: next, promotedToPayoff: applied.promotedToPayoff },
        };
      },
      rescheduleForeshadow: async (foreshadowId, expectedBy) => {
        this.appendEvents([
          {
            chapter: this.currentChapter,
            origin: "user_edit",
            provenance: "authored",
            payload: { type: "foreshadow_rescheduled", foreshadowId: foreshadowId as ForeshadowId, expectedBy },
          },
        ]);
        return {
          message: `已把伏笔 ${foreshadowId} 的预期收束改到第 ${expectedBy} 章`,
          effect: { kind: "foreshadow_rescheduled", foreshadowId, expectedBy },
        };
      },
      abandonForeshadow: async (foreshadowId, reason) => {
        this.appendEvents([
          {
            chapter: this.currentChapter,
            origin: "user_edit",
            provenance: "authored",
            payload: {
              type: "foreshadow_abandoned",
              foreshadowId: foreshadowId as ForeshadowId,
              reason: reason || "作者在对话中废弃",
            },
          },
        ]);
        return { message: `已废弃伏笔 ${foreshadowId}`, effect: { kind: "foreshadow_abandoned", foreshadowId } };
      },
      recordIdea: async (text) => {
        const idea = this.conversation.recordIdea(text, now());
        return { message: `已记为备选：${idea.text}`, effect: { kind: "idea_recorded", id: idea.id, text: idea.text } };
      },
      writeNextChapter: async (proposalId) => {
        try {
          const draft = this.startChapter({ chapter: this.nextChapter, ...(proposalId === undefined ? {} : { proposalId }) });
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
      adoptChapter: async (draftId) => {
        const m = /^ch(\d+)d\d+$/u.exec(draftId);
        if (m?.[1] === undefined) return fail("adopt_chapter", `draftId 格式不对：${draftId}`);
        const chapter = Number(m[1]);
        try {
          const r = this.adopt(chapter, draftId);
          return {
            message: r.changed ? `已采用第 ${chapter} 章的 ${draftId}` : `${draftId} 此前已采用`,
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

/**
 * PlanAddInput → AlertAction（三种 what）。返回错误字符串表示入参非法。
 * 品牌 ID（ForeshadowId/PlotLineId/CharacterId）在此按用户输入断言 —— 真实存在性由
 * applyActionToBeat 之后的写章/派生环节校验（引用不存在的 ID 会在写章装配时报错）。
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
