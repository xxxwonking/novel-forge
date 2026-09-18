/**
 * 跨多章返修的服务层（差距第 5 项下半场）。
 *
 * 旧代码把早章返修直接挡死，理由写在报错文案里：「更早章节需先分析后续影响」。
 * 这一层就是那份分析 —— 有了它，`draft-revisions` 才敢放开早章。
 *
 * 三条纪律决定了这里的形状：
 *
 * ① **代码判硬矛盾，模型找段落。** 结构事实对不上（悬空兑现、死人再出场、状态与
 *    关系链断裂）由 `impact.ts` 免费判死；正文里的牵连才花一次模型调用，而且
 *    **一次只查一章、由作者点**，不在服务端起长任务。
 * ② **产物是建议，不是改稿。** 与「逐章采用」「模型产出先 proposed」同一条原则：
 *    系统指出哪几句话不成立、该怎么改，落笔仍是作者的事。
 * ③ **没处理完的硬矛盾挡住连写，不挡单章。** 连写是批量，会在错误的事实上一口气
 *    堆好几章；单章手写作者本来就盯着结果页，挡住只会碍事。
 */

import { ChapterWriteError } from "../server/chapter-input.js";
import { declarationOf } from "../store/event-stream.js";
import type { ModelClient } from "../client/model.js";
import type { ProjectSession } from "../server/state.js";
import type { C5Declaration, StructuralEventPayload } from "../types/events.js";
import type { ChapterNo } from "../types/primitives.js";
import { diffDeclarations, impactedChapters, PROSE_ONLY_CHANGE, type ImpactReason, type ImpactSeverity, type LaterChapter, type RevisionImpact } from "./impact.js";
import { buildLocateTask, parseLocateVerdict, REVISION_LOCATE_SYSTEM, REVISION_PASSAGE_SCHEMA, type RevisionPassage } from "./locate.js";
import { ImpactStore, impactFingerprint, type ImpactRecord, type ImpactTrigger, type LatestRevision } from "./store.js";

/** 定位只报要改的段落，输出不长；这是上限而非目标（管线常量，同 steps.ts）。 */
const LOCATE_MAX_TOKENS = 4_000;

export type ReviseState = "pending" | "located" | "resolved";

export interface ReviseChapterView {
  readonly chapter: ChapterNo;
  readonly state: ReviseState;
  readonly severity: ImpactSeverity;
  readonly triggers: readonly ImpactTrigger[];
  readonly changes: readonly string[];
  readonly reasons: readonly ImpactReason[];
  readonly passages: readonly RevisionPassage[];
  readonly notes: readonly string[];
  /** 定位过，但之后又被新的修订牵连：这批段落是按旧基准找的。 */
  readonly outdated: boolean;
  readonly at: string;
}

export interface ReviseView {
  readonly chapters: readonly ReviseChapterView[];
  readonly pending: number;
  /** 未处理且判定为硬矛盾的章数。连写闸门看的就是它。 */
  readonly conflicts: number;
  readonly latest: LatestRevision | null;
}

type Source = Pick<ProjectSession, "events" | "chapterNumbers" | "chapterText" | "getDraft">;

export interface ReviseDeps {
  readonly source: Source;
  readonly client: () => ModelClient;
  readonly transaction: <T>(operation: () => T) => T;
}

export class ReviseService {
  private readonly store: ImpactStore;

  constructor(root: string, private readonly deps: ReviseDeps) {
    this.store = new ImpactStore(root);
  }

  view(): ReviseView {
    const { chapters, latest } = this.store.load();
    const list = [...chapters.values()]
      .sort((a, b) => a.chapter - b.chapter)
      .map((record) => toView(record));
    return {
      chapters: list,
      pending: list.filter((item) => item.state !== "resolved").length,
      conflicts: list.filter((item) => item.state !== "resolved" && item.severity === "conflict").length,
      latest,
    };
  }

  /** 该章当前正式的结构记录。采用前预览与采用时取「改动前」都用它。 */
  adoptedDeclaration(chapter: ChapterNo): C5Declaration {
    return declarationOf(this.deps.source.events().filter((event) =>
      event.envelope.chapter === chapter
      && (event.envelope.provenance === "committed" || event.envelope.provenance === "authored")
      && (event.envelope.origin === "C5_declaration" || event.envelope.origin === "import_inference")));
  }

  /** 采用前看一眼这一稿会牵连到哪些章。只读，不落盘、不调模型。 */
  preview(raw: unknown): RevisionImpact {
    const { chapter, draftId } = parseDraftRef(raw);
    const draft = this.deps.source.getDraft(chapter, draftId);
    if (draft === undefined) throw new ChapterWriteError(404, "草稿不存在");
    if (draft.declaration === null) throw new ChapterWriteError(409, "这一稿还没有结构记录，先完成结构核对再看影响");
    const changes = diffDeclarations(this.adoptedDeclaration(chapter), draft.declaration);
    return { source: chapter, changes, chapters: impactedChapters(chapter, changes, this.laterChapters(chapter)) };
  }

  /**
   * 采用一份早章新稿之后落清单。同一受影响章**合并**而不是攒成一摞；
   * 合并态指纹一变，作者此前标的「已处理」自动失效。
   */
  record(source: ChapterNo, before: C5Declaration | null, after: C5Declaration | null, proseChanged = false): void {
    const facts = diffDeclarations(before, after);
    // 结构一字未动但正文改了，仍算一次修订：代码指认不出对象，紧接的下一章照样要复核。
    const changes = facts.length > 0 ? facts : proseChanged ? [PROSE_ONLY_CHANGE] : [];
    if (changes.length === 0) return;
    const at = new Date().toISOString();
    const texts = changes.map((change) => `第 ${source} 章：${change.text}`);
    const impacts = impactedChapters(source, changes, this.laterChapters(source));
    const trigger: ImpactTrigger = { chapter: source, at };

    const records = impacts.map((impact) => {
      const prior = this.store.get(impact.chapter);
      // 已处理过的旧影响不再累积：那一笔账结清了，这是新的一次。
      const carry = prior !== undefined && prior.resolvedFor !== prior.fingerprint;
      const merged = {
        triggers: carry ? dedupe([...prior.triggers, trigger], (t) => `${t.chapter}@${t.at}`) : [trigger],
        changes: carry ? dedupe([...prior.changes, ...texts], (text) => text) : texts,
        reasons: carry ? dedupe([...prior.reasons, ...impact.reasons], (r) => `${r.rule}|${r.text}`) : impact.reasons,
      };
      // 基准变了，上一轮定位出的段落随之作废 —— 留着会让作者照旧结论去改。
      return { chapter: impact.chapter, ...merged, fingerprint: impactFingerprint(merged),
        passages: [], notes: [], locatedFor: null, resolvedFor: null, at } satisfies ImpactRecord;
    });
    this.store.save(records, { chapter: source, at, changes: texts });
  }

  /** 在一个后续章里定位受影响段落。作者点一章查一章，不自动全书扫。 */
  async locate(raw: unknown): Promise<ReviseChapterView> {
    const chapter = parseChapter(raw);
    const base = this.baseRecord(chapter);
    const chapterText = this.deps.source.chapterText(chapter);
    if (chapterText === undefined) throw new ChapterWriteError(404, `第 ${chapter} 章还没有正文`);

    const result = await this.runLocate(base, chapterText);
    return this.deps.transaction(() => {
      const saved: ImpactRecord = { ...base, ...result, at: new Date().toISOString() };
      this.store.save([saved]);
      return toView(saved);
    });
  }

  /** 作者处理完（或判定不用改）这一章。 */
  resolve(raw: unknown): ReviseChapterView {
    const chapter = parseChapter(raw);
    const record = this.store.get(chapter);
    if (record === undefined) throw new ChapterWriteError(404, `第 ${chapter} 章没有待处理的返修`);
    return this.deps.transaction(() => {
      const saved: ImpactRecord = { ...record, resolvedFor: record.fingerprint, at: new Date().toISOString() };
      this.store.save([saved]);
      return toView(saved);
    });
  }

  /** 连写前置：还有没处理的硬矛盾就不开始。单章手写不走这里。 */
  assertNoConflicts(): void {
    const blocking = this.view().chapters.filter((item) => item.state !== "resolved" && item.severity === "conflict");
    if (blocking.length === 0) return;
    throw new ChapterWriteError(409,
      `还有未处理的跨章返修：${blocking.map((item) => `第 ${item.chapter} 章`).join("、")}。` +
      "改早章之后，这些章的事实已经对不上了，先把它们处理掉再连写 —— 否则接下来的每一章都建立在错的基准上。");
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private async runLocate(base: ImpactRecord, chapterText: string): Promise<Pick<ImpactRecord, "passages" | "notes" | "locatedFor">> {
    const task = buildLocateTask({
      source: base.triggers[base.triggers.length - 1]?.chapter ?? base.chapter,
      chapter: base.chapter, changes: base.changes,
      reasons: base.reasons.map((reason) => reason.text), chapterText,
    });
    let call: Awaited<ReturnType<ModelClient["call"]>>;
    try {
      call = await this.deps.client().call({
        role: "judge", maxTokens: LOCATE_MAX_TOKENS,
        system: [{ type: "text", text: REVISION_LOCATE_SYSTEM }],
        messages: [{ role: "user", content: [{ type: "text", text: task }] }],
        outputSchema: REVISION_PASSAGE_SCHEMA,
      });
    } catch (error) {
      return unavailable(base, error instanceof Error ? error.message : String(error));
    }
    // 降级而不是失败：这一轮没查成，清单与其余结论照常成立。
    if (call.kind === "error") return unavailable(base, call.error.message);
    if (call.kind === "refusal") return unavailable(base, `模型拒绝了这次核对：${call.userMessage}`);
    if (call.kind === "max_tokens") return unavailable(base, "核对达到模型输出上限，未完成");
    if (call.message.stop_reason !== "end_turn" && call.message.stop_reason !== "stop_sequence") {
      return unavailable(base, "核对响应尚未完整结束");
    }
    const text = call.message.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
    let json: unknown;
    try { json = JSON.parse(text); } catch { return unavailable(base, "核对输出不是合法 JSON"); }
    const parsed = parseLocateVerdict(json, chapterText);
    return { passages: parsed.passages, notes: parsed.notes, locatedFor: base.fingerprint };
  }

  /**
   * 要查的那一章的底稿。已在清单里就用清单那条；不在清单里说明是**作者自己指定**
   * 的章 —— 代码圈不出的牵连由他来指，用最近一次修订的变化清单现做一条。
   */
  private baseRecord(chapter: ChapterNo): ImpactRecord {
    const { chapters, latest } = this.store.load();
    const existing = chapters.get(chapter);
    if (existing !== undefined) return existing;
    if (latest === null) throw new ChapterWriteError(409, "还没有需要复核的修订");
    if (chapter <= latest.chapter) throw new ChapterWriteError(400, `第 ${chapter} 章不在第 ${latest.chapter} 章之后，不受这次修订影响`);
    const merged = { triggers: [{ chapter: latest.chapter, at: latest.at }], changes: latest.changes, reasons: [] };
    return { chapter, ...merged, fingerprint: impactFingerprint(merged), passages: [], notes: [], locatedFor: null, resolvedFor: null, at: latest.at };
  }

  /** 被改章之后的各章结构记录。已有正文但没有事件的章也要在 —— 它可能正是紧接的下一章。 */
  private laterChapters(source: ChapterNo): readonly LaterChapter[] {
    const byChapter = new Map<ChapterNo, StructuralEventPayload[]>();
    for (const event of this.deps.source.events()) {
      const { chapter, origin, provenance } = event.envelope;
      if (chapter <= source || origin === "P4_outline") continue;
      if (provenance !== "committed" && provenance !== "authored") continue;
      byChapter.set(chapter, [...(byChapter.get(chapter) ?? []), event.payload]);
    }
    for (const chapter of this.deps.source.chapterNumbers()) {
      if (chapter > source && !byChapter.has(chapter)) byChapter.set(chapter, []);
    }
    return [...byChapter.entries()].map(([chapter, payloads]) => ({ chapter, payloads })).sort((a, b) => a.chapter - b.chapter);
  }
}

function unavailable(base: ImpactRecord, detail: string): Pick<ImpactRecord, "passages" | "notes" | "locatedFor"> {
  return {
    passages: base.passages, locatedFor: base.locatedFor,
    notes: [`这一章本轮没查成：${detail}。清单与其余结论不受影响，可以稍后再查。`],
  };
}

function toView(record: ImpactRecord): ReviseChapterView {
  const { fingerprint, locatedFor, resolvedFor } = record;
  return {
    chapter: record.chapter,
    state: resolvedFor === fingerprint ? "resolved" : locatedFor === fingerprint ? "located" : "pending",
    severity: record.reasons.some((reason) => reason.severity === "conflict") ? "conflict" : "review",
    triggers: record.triggers, changes: record.changes, reasons: record.reasons,
    passages: record.passages, notes: record.notes,
    outdated: locatedFor !== null && locatedFor !== fingerprint,
    at: record.at,
  };
}

function dedupe<T>(items: readonly T[], key: (item: T) => string): readonly T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const k = key(item);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function parseChapter(raw: unknown): ChapterNo {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ChapterWriteError(400, "请求体必须是对象");
  const chapter = (raw as Record<string, unknown>)["chapter"];
  if (!Number.isSafeInteger(chapter) || (chapter as number) < 1) throw new ChapterWriteError(400, "chapter 必须是正整数");
  return chapter as ChapterNo;
}

function parseDraftRef(raw: unknown): { readonly chapter: ChapterNo; readonly draftId: string } {
  const chapter = parseChapter(raw);
  const draftId = (raw as Record<string, unknown>)["draftId"];
  if (typeof draftId !== "string" || !new RegExp(`^ch${chapter}d[1-9]\\d*$`, "u").test(draftId)) {
    throw new ChapterWriteError(400, "draftId 必须是本章的草稿编号");
  }
  return { chapter, draftId };
}
