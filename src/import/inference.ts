/**
 * 逐章反推结构的服务层：前置条件、跨章累积、确认与丢弃。
 *
 * 三条纪律决定了这里的形状：
 *
 * ① **顺序进行，不并行分片。** 第 N 章要兑现的伏笔编号是第 1..N-1 章分配出来的，
 *    跳章反推拿不到它们，模型只能编一个 —— 所以前面还没处理的章会挡住后面的章。
 *
 * ② **产物是 proposed，不是 authored。** 正文是作者的，但对正文的结构判断是模型的。
 *    投影只吃 committed/authored，所以反推完成后伏笔时间线仍是空的，直到作者确认。
 *
 * ③ **确认也要按顺序。** 先确认第 5 章、把埋下伏笔的第 1 章晾着，会得到一条
 *    "兑现了没埋过的伏笔"的记录 —— 投影会静默跳过它，作者却以为收束记下了。
 *
 * 跨章累积不在内存里攒：每章一落盘，下一章现从事件流读（committed 的进投影，
 * 本轮 proposed 的单独扫）。所以中断可续、重跑只影响一章。
 */

import type { ProjectSession } from "../server/state.js";
import { ChapterWriteError, foreshadowAllocator } from "../server/chapter-input.js";
import { countWords } from "../text/measure.js";
import type { ModelClient } from "../client/model.js";
import { declarationOf } from "../store/event-stream.js";
import type { C5Declaration, StructuralEvent } from "../types/events.js";
import type { ChapterNo, ForeshadowId } from "../types/primitives.js";
import { inferChapterStructure, SYNOPSIS_WINDOW, type PendingForeshadow } from "./infer.js";
import { InferenceStore, type InferenceRun } from "./inference-store.js";

export type InferenceState = "written" | "confirmed" | "pending" | "problem" | "failed" | "skipped" | "none";

export interface InferenceChapterView {
  readonly chapter: ChapterNo;
  readonly words: number;
  readonly state: InferenceState;
  readonly problems: readonly string[];
  readonly warnings: readonly string[];
  readonly at: string | null;
  /** 待确认的声明；其余状态为 null。 */
  readonly declaration: C5Declaration | null;
}

export interface InferenceView {
  readonly chapters: readonly InferenceChapterView[];
  /** 下一个可以反推的章号；前面有没处理完的章时为 null。 */
  readonly nextChapter: ChapterNo | null;
  readonly pending: readonly ChapterNo[];
  /** 资料不全时说清要先补什么；可以开跑时为 null。 */
  readonly blocked: string | null;
}

type Source = Pick<ProjectSession,
  "meta" | "rules" | "events" | "chapterNumbers" | "chapterText" | "allDrafts" | "derived" | "replaceInference" | "decideInference">;

export interface InferenceDeps {
  readonly source: Source;
  readonly client: () => ModelClient;
  readonly transaction: <T>(operation: () => T) => T;
}

const ORIGIN = "import_inference";

export class InferenceService {
  private readonly runs: InferenceStore;

  constructor(root: string, private readonly deps: InferenceDeps) {
    this.runs = new InferenceStore(root);
  }

  view(): InferenceView {
    const runs = this.runs.load();
    const chapters = this.deps.source.chapterNumbers().map((chapter) => this.chapterView(chapter, runs.get(chapter)));
    const first = chapters.find((c) => c.state === "none");
    const blocking = chapters.find((c) => c.state === "problem" || c.state === "failed");
    return {
      chapters,
      nextChapter: first === undefined || (blocking !== undefined && blocking.chapter < first.chapter) ? null : first.chapter,
      pending: chapters.filter((c) => c.state === "pending").map((c) => c.chapter),
      blocked: this.blocked(),
    };
  }

  /** 反推一章。重跑先作废上一轮的待确认声明，所以同一章永远只有一份记录。 */
  async infer(raw: unknown): Promise<InferenceChapterView> {
    const chapter = parseChapter(raw);
    const text = this.deps.source.chapterText(chapter);
    if (text === undefined) throw new ChapterWriteError(404, `第 ${chapter} 章还没有正文，先导入旧稿再反推结构`);

    const runs = this.runs.load();
    const current = this.chapterView(chapter, runs.get(chapter)).state;
    if (current === "written") throw new ChapterWriteError(409, `第 ${chapter} 章已经有正式的结构记录，要改它请走稿件修订`);
    if (current === "confirmed") throw new ChapterWriteError(409, `第 ${chapter} 章的结构记录已经确认，要改它请走稿件修订`);

    const blocked = this.blocked();
    if (blocked !== null) throw new ChapterWriteError(409, blocked);
    for (const earlier of this.deps.source.chapterNumbers().filter((n) => n < chapter)) {
      const state = this.chapterView(earlier, runs.get(earlier)).state;
      if (state === "none") throw new ChapterWriteError(409, `请先反推第 ${earlier} 章 —— 后面章节要兑现的伏笔编号是前面章节分配出来的，跳着反推会对不上。`);
      if (state === "problem" || state === "failed") {
        throw new ChapterWriteError(409, `第 ${earlier} 章的反推还没通过，请先处理它，或者明确跳过这一章再继续。`);
      }
    }

    const client = this.deps.client();
    const outcome = await inferChapterStructure(client, {
      chapter, chapterText: text, title: this.deps.source.meta.setting.title,
      ...this.accumulated(chapter),
    });
    const at = new Date().toISOString();
    const run: InferenceRun = outcome.kind === "ok"
      ? { outcome: "done", problems: [], warnings: outcome.warnings, at }
      : outcome.kind === "problem"
        ? { outcome: "problem", problems: outcome.problems, warnings: outcome.warnings, at }
        : { outcome: "failed", problems: [outcome.detail], warnings: [], at };

    this.deps.transaction(() => {
      // 先作废上一轮：重跑的结果替换旧的，不与旧的并存。失败的重跑同样清场 ——
      // 留着上一轮的待确认记录，作者会以为那是这一轮的结果。
      this.deps.source.replaceInference(chapter, outcome.kind === "ok" ? outcome.declaration : null);
      this.runs.save(chapter, run);
    });
    return this.chapterView(chapter, run);
  }

  /** 确认一章：proposed → committed，从此进投影。 */
  confirm(raw: unknown): { readonly chapter: ChapterNo; readonly committed: number } {
    const chapter = parseChapter(raw);
    const runs = this.runs.load();
    if (this.chapterView(chapter, runs.get(chapter)).state !== "pending") {
      throw new ChapterWriteError(409, `第 ${chapter} 章没有待确认的结构记录`);
    }
    for (const earlier of this.deps.source.chapterNumbers().filter((n) => n < chapter)) {
      if (this.chapterView(earlier, runs.get(earlier)).state === "pending") {
        throw new ChapterWriteError(409, `请先处理第 ${earlier} 章的待确认记录 —— 先收后埋会让这一章兑现一条并不存在的伏笔。`);
      }
    }
    return { chapter, committed: this.deps.transaction(() => this.deps.source.decideInference(chapter, "committed")) };
  }

  /** 丢弃一章：待确认的记录作废，这一章记为作者已跳过，不再挡住后面的章。 */
  reject(raw: unknown): { readonly chapter: ChapterNo; readonly rejected: number } {
    const chapter = parseChapter(raw);
    const run = this.runs.get(chapter);
    const state = this.chapterView(chapter, run).state;
    if (state === "written" || state === "confirmed") throw new ChapterWriteError(409, `第 ${chapter} 章的结构记录已经是正式事实，丢弃它请走稿件修订`);
    if (state === "none") throw new ChapterWriteError(409, `第 ${chapter} 章还没有反推过`);
    return this.deps.transaction(() => {
      const rejected = state === "pending" ? this.deps.source.decideInference(chapter, "rejected") : 0;
      this.runs.save(chapter, { outcome: "skipped", problems: run?.problems ?? [], warnings: [], at: new Date().toISOString() });
      return { chapter, rejected };
    });
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  /** 反推读不出人物就只能编 ID，`parseC5` 会整章丢掉 —— 与其空跑模型不如先说清。 */
  private blocked(): string | null {
    return this.confirmedCharacters().length === 0
      ? "还没有人物档案，反推出来的人物引用无处落脚。请先在资料页用「让 AI 起草资料」从正文补出人物，再回来反推结构。"
      : null;
  }

  private confirmedCharacters(): readonly Source["meta"]["characters"][number][] {
    return this.deps.source.meta.characters.filter((c) => c.provenance === "committed" || c.provenance === "authored");
  }

  private inferenceEvents(): readonly StructuralEvent[] {
    return this.deps.source.events().filter((e) => e.envelope.origin === ORIGIN);
  }

  private chapterView(chapter: ChapterNo, run: InferenceRun | undefined): InferenceChapterView {
    const text = this.deps.source.chapterText(chapter) ?? "";
    const events = this.deps.source.events().filter((e) => e.envelope.chapter === chapter);
    const formal = events.some((e) => e.envelope.origin !== ORIGIN && e.envelope.origin !== "P4_outline"
      && (e.envelope.provenance === "committed" || e.envelope.provenance === "authored"));
    const inferred = events.filter((e) => e.envelope.origin === ORIGIN);
    const pending = inferred.filter((e) => e.envelope.provenance === "proposed");
    const state: InferenceState = formal ? "written"
      : inferred.some((e) => e.envelope.provenance === "committed") ? "confirmed"
        : pending.length > 0 ? "pending"
          : run === undefined || run.outcome === "done" ? "none" : run.outcome;
    return {
      chapter, words: countWords(text), state,
      problems: state === "problem" || state === "failed" ? run?.problems ?? [] : [],
      warnings: state === "pending" ? run?.warnings ?? [] : [],
      at: run?.at ?? null,
      declaration: pending.length > 0 ? declarationOf(pending) : null,
    };
  }

  /**
   * 第 N 章反推时能看见的东西：已确认的资料、已埋设未兑现的伏笔、前情梗概。
   *
   * 伏笔来自两处 —— 已确认的走投影，本轮还没确认的从 proposed 事件现扫。
   * 两处都要，否则连着反推十章时，第 2 章之后就再也认不出前面埋的伏笔。
   */
  private accumulated(chapter: ChapterNo): {
    readonly parseContextBase: Parameters<typeof inferChapterStructure>[1]["parseContextBase"];
    readonly openForeshadows: readonly PendingForeshadow[];
    readonly synopses: readonly { readonly chapter: ChapterNo; readonly text: string }[];
  } {
    const meta = this.deps.source.meta;
    const characters = this.confirmedCharacters();
    const confirmed = this.deps.source.derived.projections.foreshadows;
    const proposed = this.inferenceEvents().filter((e) => e.envelope.provenance === "proposed" && e.envelope.chapter < chapter);

    const resolved = new Set(proposed.flatMap((e) =>
      e.payload.type === "foreshadow_resolved" && e.payload.completeness === "full" ? [e.payload.foreshadowId as string] : []));
    const inferredPlanted = proposed.flatMap((e) => e.payload.type === "foreshadow_planted" ? [{
      id: e.payload.foreshadowId as string, label: e.payload.label, intent: e.payload.intent,
      expectedBy: e.payload.expectedBy, status: resolved.has(e.payload.foreshadowId) ? "resolved" as const : "open" as const,
    }] : []);

    const open: PendingForeshadow[] = [
      ...confirmed.filter((f) => f.status === "open").map((f) => ({ id: f.id, label: f.label, intent: f.intent, expectedBy: f.expectedBy })),
      ...inferredPlanted.filter((f) => f.status === "open").map(({ id, label, intent, expectedBy }) => ({ id, label, intent, expectedBy })),
    ];

    return {
      parseContextBase: {
        chapter,
        knownCharacters: new Set(characters.map((c) => c.id)),
        knownSettings: new Set(meta.settings.map((s) => s.id)),
        knownForeshadows: new Set(open.map((f) => f.id)),
        foreshadows: [
          ...confirmed.map((f) => ({ id: f.id, label: f.label, status: f.status, intent: f.intent })),
          ...inferredPlanted.map((f) => ({ id: f.id as ForeshadowId, label: f.label, status: f.status, intent: f.intent })),
        ],
        knownPlotLines: new Set(meta.plotLines.map((p) => p.id)),
        allocateForeshadowId: foreshadowAllocator(this.deps.source),
      },
      openForeshadows: open,
      synopses: this.synopses(chapter),
    };
  }

  /** 前情：已确认与本轮反推出的事件摘要，按章合并，只带最近若干章。 */
  private synopses(chapter: ChapterNo): readonly { readonly chapter: ChapterNo; readonly text: string }[] {
    const byChapter = new Map<ChapterNo, string[]>();
    for (const event of this.deps.source.events()) {
      const { chapter: n, origin, provenance } = event.envelope;
      if (n >= chapter || event.payload.type !== "plot_event" || origin === "P4_outline") continue;
      if (provenance === "rejected" || (provenance === "proposed" && origin !== ORIGIN)) continue;
      byChapter.set(n, [...(byChapter.get(n) ?? []), event.payload.summary]);
    }
    return [...byChapter.entries()].sort(([a], [b]) => a - b).slice(-SYNOPSIS_WINDOW)
      .map(([n, texts]) => ({ chapter: n, text: texts.join("；") }));
  }
}

function parseChapter(raw: unknown): ChapterNo {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ChapterWriteError(400, "请求体必须是对象");
  const chapter = (raw as Record<string, unknown>)["chapter"];
  if (!Number.isSafeInteger(chapter) || (chapter as number) < 1) throw new ChapterWriteError(400, "chapter 必须是正整数");
  return chapter as ChapterNo;
}
