/** 写章前从项目正式资料装配上下文；读工具使用相同的章号边界。 */
import { createHash } from "node:crypto";
import { deriveBudget } from "../beat/derive.js";
import { validatePlan } from "../beat/validate.js";
import { C4_TASK, type ChapterRunInput } from "../chapter/pipeline.js";
import { buildL2Snapshot } from "../context/build-l2.js";
import { selectL3, type PlantedExcerpt } from "../context/select-l3.js";
import { anchorContext, resolveAnchor } from "../anchor/resolve.js";
import { project, projectCharacterState } from "../store/project.js";
import { fullResolution, remainingPlan } from "../planning/effective.js";
import type { ToolReadSource } from "../task/service.js";
import type { ChapterBeat } from "../types/beat.js";
import type { CharacterCard } from "../types/character.js";
import type { VolumeBoundary } from "../types/l2.js";
import type { ChapterNo, ForeshadowId } from "../types/primitives.js";
import type { ForeshadowTimelineItem } from "../types/projections.js";
import type { ProjectSession } from "./state.js";

/** 只读写作资料。试写可提供独立视图，复用相同的装配、引用检查和读工具。 */
export type ChapterSource = Pick<ProjectSession, "meta" | "rules" | "events" | "chapterNumbers" | "chapterText" | "beatFor" | "allDrafts">;

/** HTTP 可展示的准备/状态错误；模型失败仍由 ChapterDraft.error 表达。 */
export class ChapterWriteError extends Error {
  /** 502 = 模型这一轮没交出可用的东西（如起草没产出方案）；不是作者输入的问题，也不等于服务没配好。 */
  constructor(readonly status: 400 | 404 | 409 | 502 | 503, message: string) {
    super(message);
    this.name = "ChapterWriteError";
  }
}

export interface ChapterInputOptions {
  readonly maxOutputTokens?: number;
  /** 当前作者的写章请求；新任务保存后，恢复使用已冻结的值。 */
  readonly authorRequest?: string;
}

/** §13.5：埋设处前后各 200 字，是上下文窗口而非创作规则阈值。 */
const PLANTED_CONTEXT_WINDOW = 200;

export function validateChapterNumber(chapter: ChapterNo): void {
  if (!Number.isSafeInteger(chapter) || chapter < 1) {
    throw new ChapterWriteError(400, "章号必须是正整数");
  }
}

function readContext(session: ChapterSource, chapter: ChapterNo) {
  validateChapterNumber(chapter);
  const meta = session.meta;
  const events = session.events()
    .filter((e) => (e.envelope.chapter < chapter || e.envelope.origin === "P4_outline" ||
      (e.envelope.origin === "user_edit" && (e.payload.type === "foreshadow_rescheduled" || e.payload.type === "foreshadow_abandoned"))) &&
      (e.envelope.provenance === "committed" || e.envelope.provenance === "authored"))
    .sort((a, b) => a.envelope.seq - b.envelope.seq);
  const characters: readonly CharacterCard[] = meta.characters
    .filter((c) => c.provenance === "committed" || c.provenance === "authored")
    .map((c) => ({ ...c, state: projectCharacterState(events, c.id, c.introducedAt) }));
  const projections = project({
    events,
    currentChapter: chapter - 1,
    characterProfiles: characters,
    plotLineDefs: meta.plotLines,
    plotLineGap: session.rules.crossChapter.plotLineGap,
  });
  // 复制正文索引：异步工具往返期间不跟随其他请求改变读取内容。
  const chapters = new Map(session.chapterNumbers()
    .filter((n) => n < chapter)
    .map((n) => [n, session.chapterText(n)!] as const));
  const summaries = new Map<ChapterNo, string[]>();
  for (const event of events) {
    if (event.payload.type !== "plot_event" || event.envelope.origin === "P4_outline") continue;
    const existing = summaries.get(event.envelope.chapter) ?? [];
    existing.push(event.payload.summary);
    summaries.set(event.envelope.chapter, existing);
  }
  const chapterSynopses = [...summaries.entries()]
    .sort(([a], [b]) => a - b)
    .map(([n, texts]) => ({ chapter: n, text: texts.join("；") }));
  return { meta, events, characters, projections, chapters, chapterSynopses };
}

type ChapterContext = ReturnType<typeof readContext>;

/** 恢复和采用前核对完整读取来源，包括可能经工具召回而未进入 L3 的资料。 */
export function chapterInputFingerprint(session: ChapterSource, chapter: ChapterNo): string {
  const ctx = readContext(session, chapter);
  const source = {
    setting: ctx.meta.setting, discipline: ctx.meta.discipline, profile: ctx.meta.profile,
    settings: ctx.meta.settings, characters: ctx.characters, plotLines: ctx.meta.plotLines,
    beats: ctx.meta.beats.filter((b) => b.chapter <= chapter),
    events: ctx.events, chapters: [...ctx.chapters], rules: session.rules,
  };
  const serialized = JSON.stringify(source, (_key, value: unknown) =>
    value instanceof RegExp ? { source: value.source, flags: value.flags } : value);
  return createHash("sha256").update(serialized).digest("hex");
}

export function buildChapterRunInput(
  session: ChapterSource,
  chapter: ChapterNo,
  options: ChapterInputOptions = {},
): ChapterRunInput {
  validateChapterNumber(chapter);
  if (options.authorRequest !== undefined && (typeof options.authorRequest !== "string" || !options.authorRequest.trim())) {
    throw new ChapterWriteError(400, "authorRequest 必须是非空文本");
  }
  if (options.maxOutputTokens !== undefined &&
      (!Number.isSafeInteger(options.maxOutputTokens) || options.maxOutputTokens < 1)) {
    throw new ChapterWriteError(400, "maxOutputTokens 必须是正整数");
  }
  const originalBeat = session.beatFor(chapter);
  if (originalBeat === undefined) throw new ChapterWriteError(404, `第 ${chapter} 章没有节拍表，请先排章`);
  if (originalBeat.provenance !== "committed" && originalBeat.provenance !== "authored") {
    throw new ChapterWriteError(409, `第 ${chapter} 章的节拍表尚未采用`);
  }
  const blockers = validatePlan(originalBeat.plan, session.rules).filter((f) => f.level === "block");
  if (blockers.length > 0) throw new ChapterWriteError(400, blockers.map((f) => f.message).join("\n"));

  const ctx = readContext(session, chapter);
  const previousText = ctx.chapters.get(chapter - 1);
  if (chapter > 1 && previousText === undefined) {
    throw new ChapterWriteError(409, `第 ${chapter - 1} 章尚无正式正文，请先完成并采用上一章`);
  }
  const fulfilledResolutions = ctx.projections.foreshadows.flatMap(f => {
    if (!originalBeat.plan.resolves.some(r => r.foreshadowId === f.id)) return [];
    const resolution = fullResolution(f, n => ctx.chapters.get(n), session.rules.anchor);
    return resolution === undefined ? [] : [{ id: f.id, label: f.label, chapter: resolution.chapter }];
  });
  const fulfilledPlants = originalBeat.plan.plants.flatMap(plant => {
    const matches = ctx.projections.foreshadows.filter(f => f.label.trim() === plant.label.trim());
    const f = matches.length === 1 ? matches[0] : undefined;
    return f === undefined || f.status === "planned" || !f.plantedAnchor.quote.trim() || resolveAnchor(f.plantedAnchor, n => ctx.chapters.get(n), session.rules.anchor).status === "stale"
      ? [] : [{ id: f.id, label: f.label, chapter: f.plantedAt }];
  });
  const plan = remainingPlan(originalBeat.plan, new Set(fulfilledResolutions.map(f => f.id)), new Set(fulfilledPlants.map(f => f.label.trim())));
  const beat: ChapterBeat = {
    ...originalBeat,
    plan,
    budget: deriveBudget(plan, ctx.meta.profile, session.rules, { now: originalBeat.updatedAt }),
  };
  const characters = beat.plan.characters.map((id) => {
    const card = ctx.characters.find((c) => c.id === id);
    if (card === undefined) throw new ChapterWriteError(400, `节拍引用的人物 ${id} 没有已确认的档案`);
    return card;
  });
  const settings = beat.plan.locations.map((id) => {
    const card = ctx.meta.settings.find((s) => s.id === id);
    if (card === undefined) throw new ChapterWriteError(400, `节拍引用的设定 ${id} 不在地点/组织库中`);
    return card;
  });
  for (const event of beat.plan.events) {
    if (event.plotLine !== null && !ctx.meta.plotLines.some((p) => p.id === event.plotLine)) {
      throw new ChapterWriteError(400, `节拍引用的情节线 ${event.plotLine} 不存在`);
    }
  }
  const resolves = beat.plan.resolves.map((planned) => {
    const f = ctx.projections.foreshadows.find((item) => item.id === planned.foreshadowId);
    if (f === undefined || f.status !== "open") {
      throw new ChapterWriteError(400, `伏笔 ${planned.foreshadowId} 尚未正式埋设或已结束，不能安排本章收束`);
    }
    if (f.weight !== planned.weight) throw new ChapterWriteError(400, `伏笔 ${f.id} 的节拍权重与正式记录不一致`);
    return { foreshadow: f, completeness: planned.completeness };
  });
  const resolvingIds = new Set(resolves.map((r) => r.foreshadow.id));
  const l3 = selectL3({
    beat, characters, settings,
    volumeBoundary: volumeBoundary(session, beat, ctx),
    plantedExcerpts: resolves.map((r) => plantedExcerpt(session, ctx, r.foreshadow)),
  });
  if (l3.trimStage === "overflow") throw new ChapterWriteError(400, l3.overflowNote ?? "本章资料超出上下文预算，请拆章");

  return {
    chapter,
    assembleInput: {
      l1: { setting: ctx.meta.setting, discipline: ctx.meta.discipline },
      l2: buildL2Snapshot({
        currentChapter: chapter - 1, characters: ctx.characters,
        chapterSynopses: ctx.chapterSynopses,
        // 当前没有独立的卷梗概存储；不把规划中的卷纲伪装成已发生剧情。
        volumeSummaries: [], pendingAppend: [],
        foreshadows: ctx.projections.foreshadows.filter((f) => f.status !== "planned"), plotLines: ctx.projections.plotLines,
      }),
      l3,
      volatile: {
        previous: previousText === undefined ? null : { chapter: chapter - 1, headSummary: null, tailText: previousText },
        beat,
        fulfilledResolutions,
        fulfilledPlants,
        resolves: resolves.map(({ foreshadow: f, completeness }) => ({ id: f.id, label: f.label, intent: f.intent, weight: f.weight, completeness })),
        avoid: ctx.projections.foreshadows
          .filter((f) => f.status === "open" && f.visibility === "covert" && !resolvingIds.has(f.id))
          .map((f) => ({ id: f.id, label: f.label })),
        plannedForeshadows: ctx.projections.foreshadows
          .filter(f => f.status === "planned" && beat.plan.plants.some(p => p.label.trim() === f.label.trim()))
          .map(f => ({ id: f.id, label: f.label, intent: f.intent, weight: f.weight, expectedBy: f.expectedBy })),
        task: options.authorRequest === undefined ? C4_TASK : [
          C4_TASK, "", "# 作者本轮写章请求", options.authorRequest,
          "仅执行其中与本章正文创作有关的要求。采用、导出、开始其他章节等操作由平台处理，不写进正文，也不将讨论或操作指令当作已发生的故事事实。仍只输出本章正文。",
        ].join("\n"),
      },
    },
    parseContextBase: {
      chapter,
      knownCharacters: new Set(ctx.characters.map((c) => c.id)),
      knownSettings: new Set(ctx.meta.settings.map(setting => setting.id)),
      knownForeshadows: new Set(ctx.projections.foreshadows.filter((f) => f.status === "open").map((f) => f.id)),
      foreshadows: ctx.projections.foreshadows.map(f => ({ id: f.id, label: f.label, status: f.status })),
      knownPlotLines: new Set(ctx.meta.plotLines.map((p) => p.id)),
      allocateForeshadowId: foreshadowAllocator(session),
    },
    promisedResolutions: beat.plan.resolves.map((r) => ({ foreshadowId: r.foreshadowId, completeness: r.completeness })),
    ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: options.maxOutputTokens }),
    gate: { profile: ctx.meta.profile, rules: session.rules },
  };
}

function plantedExcerpt(session: ChapterSource, ctx: ChapterContext, f: ForeshadowTimelineItem): PlantedExcerpt {
  const anchor = f.plantedAnchor;
  const resolution = resolveAnchor(anchor, (n) => ctx.chapters.get(n), session.rules.anchor);
  const body = ctx.chapters.get(anchor.chapter);
  const text = body === undefined ? null : anchorContext(body, resolution, PLANTED_CONTEXT_WINDOW);
  if (text === null) throw new ChapterWriteError(409, `伏笔 ${f.id} 的埋设原文已失效，请校正原文锚点后再写章`);
  return { foreshadowId: f.id, label: f.label, anchor, excerpt: text.before + text.hit + text.after };
}

function volumeBoundary(session: ChapterSource, beat: ChapterBeat, ctx: ChapterContext): VolumeBoundary | null {
  const previous = session.beatFor(beat.chapter - 1);
  if (previous === undefined || previous.volume === beat.volume) return null;
  const summaries = ctx.chapterSynopses.filter((s) => session.beatFor(s.chapter)?.volume === previous.volume);
  if (summaries.length === 0) return null;
  return {
    volume: previous.volume,
    summary: summaries.map((s) => `第 ${s.chapter} 章：${s.text}`).join("\n"),
    endState: ctx.characters.filter((c) => c.tier === "protagonist" || c.tier === "major")
      .map((c) => `${c.name}：${c.state.condition || c.state.vital}`).join("；"),
  };
}

/** 保留历史及候选声明占用的 ID；分配本身不写正式事件流。 */
export function foreshadowAllocator(session: ChapterSource): () => ForeshadowId {
  const ids: string[] = session.events().flatMap((e) => e.payload.type === "foreshadow_planted" ? [e.payload.foreshadowId] : []);
  for (const draft of session.allDrafts()) {
    for (const f of draft.declaration?.foreshadowPlanted ?? []) ids.push(f.foreshadowId);
  }
  let last = 0;
  for (const id of ids) {
    const match = /^F(\d+)$/u.exec(id);
    if (match?.[1] !== undefined) last = Math.max(last, Number(match[1]));
  }
  return () => `F${String(++last).padStart(2, "0")}` as ForeshadowId;
}

export function buildChapterReadSource(session: ChapterSource, chapter: ChapterNo): ToolReadSource {
  const ctx = readContext(session, chapter);
  return {
    loadCharacter: (name) => {
      const card = ctx.characters.find((c) => c.id === name || c.name === name || c.aliases.includes(name));
      return card === undefined ? null : JSON.stringify(card);
    },
    loadSetting: (name) => {
      const setting = ctx.meta.settings.find((s) => s.id === name || s.name === name);
      return setting === undefined ? null : JSON.stringify(setting);
    },
    loadChapter: (n, excerpt) => {
      if (!Number.isSafeInteger(n) || n < 1 || n >= chapter) return null;
      const body = ctx.chapters.get(n);
      if (body === undefined) return null;
      const length = Math.ceil(body.length / 3);
      return excerpt === "head" ? body.slice(0, length) : excerpt === "tail" ? body.slice(-length) : body;
    },
    listOpenForeshadows: (weight) => JSON.stringify(ctx.projections.foreshadows
      .filter((f) => f.status === "open" && (weight === "all" || f.weight === weight))),
  };
}
