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
import type { ChapterBeat, ChapterPlan, WorkProfile } from "../types/beat.js";
import type { WorkSetting, WritingDiscipline } from "../types/work.js";
import type { SettingCard } from "../context/select-l3.js";
import type { CharacterCard } from "../types/character.js";
import { deriveBudget } from "../beat/derive.js";
import { validatePlan } from "../beat/validate.js";
import type { AlertId, ChapterNo, CharacterId, ForeshadowId, PlotLineId, SettingId } from "../types/primitives.js";
import type { C5Declaration, ForeshadowWeight } from "../types/events.js";
import { ChapterWriter, type ChapterWriteOptions, type ChapterWriterOptions } from "./chapter-writer.js";
import { ChapterWriteError, buildChapterReadSource } from "./chapter-input.js";
import { ConversationStore } from "../agent/conversation-store.js";
import { MainAgentService } from "../agent/service.js";
import type { AgentActionOutcome, MainAgentToolContext, PlanAddInput } from "../agent/tool-exec.js";
import {
  DIRECTION_LABELS,
  bumpDisciplineVersion,
  mergeCharacter,
  mergeLocation,
  mergePlotLine,
  nextId,
  type DirectionInput,
} from "../agent/prep.js";
import type { MainAgentContextInfo } from "../agent/system-prompt.js";
import type { AlternativeIdea, ConversationReply, ConversationTurn } from "../agent/types.js";
import { applyActionToBeat } from "../alerts/apply.js";
import { createModelClient } from "../client/create.js";
import type { ModelClient } from "../client/model.js";

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
  private readonly conversation: ConversationStore;
  private modelClient: ModelClient | undefined;

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
    this.conversation = new ConversationStore(root);
    this.modelClient = writing.client;
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

  // ── 筹备写入口（Stage 2·切片 2）。均经受控入口写盘 + 失效缓存，记 authored 可信度 ──

  putSetting(setting: WorkSetting): void {
    this.store.writeSetting(setting);
    this.setting = setting;
    this.invalidate();
  }

  putProfile(profile: WorkProfile): void {
    this.store.writeProfile(profile);
    this.profile = profile;
    this.invalidate();
  }

  /** 新增或按 id 覆盖一张人物卡（设定块；state 由投影算出，不落盘）。 */
  upsertCharacter(card: Omit<CharacterCard, "state">): void {
    const rest = this.characters.filter((c) => c.id !== card.id);
    this.characters = [...rest, card].sort((a, b) => a.id.localeCompare(b.id));
    this.store.writeCharacters(this.characters);
    this.invalidate();
  }

  /** 新增或按 id 覆盖一个地点/组织设定卡。 */
  upsertSetting(card: SettingCard): void {
    const rest = this.settings.filter((s) => s.id !== card.id);
    this.putSettings([...rest, card].sort((a, b) => a.id.localeCompare(b.id)));
  }

  putPlotLine(def: PlotLineDef): void {
    const rest = this.plotLines.filter((p) => p.id !== def.id);
    this.plotLines = [...rest, def].sort((a, b) => a.id.localeCompare(b.id));
    this.store.writePlotLines(this.plotLines);
    this.invalidate();
  }

  /**
   * 排一章节拍：派生预算 + 记为 authored（可写）。
   * V2 合规校验由调用方（筹备工具层）先跑并拦 block —— 保证落盘的节拍必过 V2，
   * `nextPlanReady` 才成立。
   */
  planChapter(chapter: ChapterNo, plan: ChapterPlan, now = new Date().toISOString()): ChapterBeat {
    const beat: ChapterBeat = {
      chapter,
      volume: this.beatFor(chapter)?.volume ?? 1,
      plan,
      budget: deriveBudget(plan, this.profile, this.rules, { now }),
      provenance: "authored",
      updatedAt: now,
    };
    this.putBeat(beat);
    return beat;
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
      ctx: this.buildAgentContext(),
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

  /** 主 Agent 的作品状态快照；/api/prep 也用它算筹备缺项。 */
  agentContextInfo(): MainAgentContextInfo {
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
      prep: {
        premiseSet: this.setting.premise.trim() !== "",
        conflictSet: this.setting.centralConflict.trim() !== "",
        characters: this.characters.map((c) => ({ id: c.id, name: c.name, tier: c.tier })),
        locations: this.settings.map((s) => ({ id: s.id, name: s.name })),
        plotLines: this.plotLines.map((p) => ({ id: p.id, label: p.label, weight: p.weight })),
        disciplineVersion: this.discipline.version,
      },
    };
  }

  /**
   * 把主 Agent 工具绑到本会话受控入口。读侧复用写章 readSource（同一章号边界）；
   * 筹备类工具改了资料后重建它，同一回合内的后续读取不落后。
   */
  private buildAgentContext(): MainAgentToolContext {
    const now = (): string => new Date().toISOString();
    const fail = (tool: string, message: string): AgentActionOutcome => ({
      message,
      effect: { kind: "action_failed", tool, message },
    });
    /** 写章/重写共用的结果文案：把修订次数与剩余问题说给模型，它才不会承诺"再改改"。 */
    const written = (draft: ChapterDraft): AgentActionOutcome => {
      const blocks = draft.findings.filter((f) => f.level === "block").length;
      const revised = draft.revisions.length > 0 ? `，任务内已自动修订 ${draft.revisions.length} 次` : "";
      const tail = draft.acceptable
        ? "（可采用）"
        : draft.error?.step === "C7"
          ? `（${draft.error.detail}；仍有 ${blocks} 项必改，作者可选择重写一版或自行修改）`
          : draft.status === "needs_revision"
            ? `（仍有 ${blocks} 项必改，自动修订额度已用完；作者可选择重写一版或自行修改）`
            : "";
      return {
        message: `已写第 ${draft.chapter} 章草稿 ${draft.draftId}，状态 ${draft.status}${revised}${tail}`,
        effect: {
          kind: "chapter_written",
          chapter: draft.chapter,
          draftId: draft.draftId,
          status: draft.status,
          acceptable: draft.acceptable,
          revisions: draft.revisions.length,
        },
      };
    };
    let readSource = buildChapterReadSource(this, Math.max(this.nextChapter, 1));
    const refresh = (): void => {
      readSource = buildChapterReadSource(this, Math.max(this.nextChapter, 1));
    };
    return {
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
            words: d.body.length,
            findings: d.findings.length,
          })),
        );
      },
      getChapterText: (chapter, excerpt) => readSource.loadChapter(chapter, excerpt),
      getCharacter: (name) => readSource.loadCharacter(name),
      listOpenForeshadows: (weight) => readSource.listOpenForeshadows(weight),
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
          events: p.events,
          resolves: p.resolves,
          plants: p.plants,
          characters: p.characters,
          locations: p.locations,
          wordBudget: w === undefined ? null : { min: w.min, max: w.max, sweet: w.sweet },
        });
      },
      getDirection: () =>
        JSON.stringify({ setting: this.setting, targetWords: this.profile.targetWords, discipline: this.discipline }),
      setDirection: async (input) => {
        this.putSetting({ ...this.setting, ...input });
        refresh();
        const fields = Object.keys(input) as (keyof DirectionInput)[];
        return {
          message: `已更新作品方向：${fields.map((f) => DIRECTION_LABELS[f]).join("、")}`,
          effect: { kind: "setting_updated", fields },
        };
      },
      upsertCharacter: async (input) => {
        const byId = input.id === undefined ? undefined : this.characters.find((c) => c.id === input.id);
        if (input.id !== undefined && byId === undefined) return fail("upsert_character", `人物 ${input.id} 不存在；新建请不要传 id`);
        const existing =
          byId ?? this.characters.find((c) => c.name === input.name || (input.name !== undefined && c.aliases.includes(input.name)));
        const unknownTarget = (input.speech.addressForms ?? []).find(
          (a) => a.target !== null && !this.characters.some((c) => c.id === a.target),
        );
        if (unknownTarget !== undefined) return fail("upsert_character", `称谓表引用的人物 ${unknownTarget.target} 不存在，先建该人物`);
        const id = existing?.id ?? nextId("C", this.characters.map((c) => c.id));
        const card = mergeCharacter(existing, input, id, now());
        this.upsertCharacter(card);
        refresh();
        const created = existing === undefined;
        return {
          message: `${created ? "已新建人物" : "已更新人物"} ${card.name}（${card.id}，${card.tier}）`,
          effect: { kind: "character_upserted", id: card.id, name: card.name, created },
        };
      },
      upsertLocation: async (input) => {
        const byId = input.id === undefined ? undefined : this.settings.find((s) => s.id === input.id);
        if (input.id !== undefined && byId === undefined) return fail("upsert_location", `设定 ${input.id} 不存在；新建请不要传 id`);
        const existing = byId ?? this.settings.find((s) => s.name === input.name);
        const id = existing?.id ?? nextId("S", this.settings.map((s) => s.id));
        const card = mergeLocation(existing, input, id);
        this.upsertSetting(card);
        refresh();
        const created = existing === undefined;
        return {
          message: `${created ? "已新建" : "已更新"}${card.kind === "location" ? "地点" : "组织"} ${card.name}（${card.id}）`,
          effect: { kind: "location_upserted", id: card.id, name: card.name, created },
        };
      },
      definePlotLine: async (input) => {
        const byId = input.id === undefined ? undefined : this.plotLines.find((p) => p.id === input.id);
        if (input.id !== undefined && byId === undefined) return fail("define_plotline", `情节线 ${input.id} 不存在；新建请不要传 id`);
        const existing = byId ?? this.plotLines.find((p) => p.label === input.label);
        const id = existing?.id ?? nextId("P", this.plotLines.map((p) => p.id));
        const def = mergePlotLine(existing, input, id);
        this.putPlotLine(def);
        refresh();
        const created = existing === undefined;
        return {
          message: `${created ? "已定义情节线" : "已更新情节线"} ${def.label}（${def.id}，${def.weight}）`,
          effect: { kind: "plotline_defined", id: def.id, label: def.label, created },
        };
      },
      setDiscipline: async (rules) => {
        const version = bumpDisciplineVersion(this.discipline.version);
        this.putDiscipline({ version, rules });
        return {
          message: `已更新写作纪律，共 ${rules.length} 条（版本 ${version}）`,
          effect: { kind: "discipline_updated", version, count: rules.length },
        };
      },
      planChapter: async ({ chapter: requested, plan }) => {
        const chapter = requested ?? this.nextChapter;
        if (chapter < this.nextChapter) {
          return fail("plan_chapter", `第 ${chapter} 章已有正文，只能排第 ${this.nextChapter} 章及之后`);
        }
        const missing = this.planReferenceErrors(plan);
        if (missing !== null) return fail("plan_chapter", missing);
        const findings = validatePlan(plan, this.rules);
        const blocks = findings.filter((f) => f.level === "block");
        if (blocks.length > 0) return fail("plan_chapter", `节拍未通过校验，未写入：\n${blocks.map((f) => f.message).join("\n")}`);
        const beat = this.planChapter(chapter, plan, now());
        refresh();
        const warnings = findings.filter((f) => f.level === "warn");
        const w = beat.budget?.words;
        return {
          message:
            `已排第 ${chapter} 章节拍（${plan.chapterType}${w === undefined ? "" : `，字数预算 ${w.min}-${w.max}`}）` +
            (warnings.length === 0 ? "" : `；提醒：${warnings.map((f) => f.message).join("；")}`),
          effect: { kind: "chapter_planned", chapter, chapterType: plan.chapterType, warnings: warnings.length },
        };
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
      writeNextChapter: async () => {
        try {
          return written(await this.writeChapter({ chapter: this.nextChapter }));
        } catch (error) {
          return fail("write_next_chapter", error instanceof Error ? error.message : String(error));
        }
      },
      rewriteChapterDraft: async (chapter) => {
        try {
          return written(await this.writeChapter({ chapter: chapter ?? this.nextChapter, newDraft: true }));
        } catch (error) {
          return fail("rewrite_chapter_draft", error instanceof Error ? error.message : String(error));
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

  /** 节拍引用的人物/场景/情节线/伏笔必须已存在 —— 写章装配时同样会拦，这里提前到排章时说清。 */
  private planReferenceErrors(plan: ChapterPlan): string | null {
    const problems: string[] = [];
    const missing = <T extends string>(ids: readonly T[], known: readonly string[]): T[] => ids.filter((id) => !known.includes(id));
    const chars = missing(plan.characters, this.characters.map((c) => c.id));
    if (chars.length > 0) problems.push(`人物 ${chars.join("、")} 不存在（先 upsert_character）`);
    const locs = missing(plan.locations, this.settings.map((s) => s.id));
    if (locs.length > 0) problems.push(`场景 ${locs.join("、")} 不存在（先 upsert_location）`);
    const lines = missing(
      plan.events.flatMap((e) => (e.plotLine === null ? [] : [e.plotLine])),
      this.plotLines.map((p) => p.id),
    );
    if (lines.length > 0) problems.push(`情节线 ${lines.join("、")} 不存在（先 define_plotline）`);
    const open = this.derived.projections.foreshadows.filter((f) => f.status === "open").map((f) => f.id);
    const fs = missing(plan.resolves.map((r) => r.foreshadowId), open);
    if (fs.length > 0) problems.push(`伏笔 ${fs.join("、")} 不是未收伏笔，不能安排收束`);
    return problems.length === 0 ? null : problems.join("；");
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

export type { ProjectSnapshot };
