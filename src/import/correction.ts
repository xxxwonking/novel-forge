import { crossCheckC5 } from "../chapter/c5-crosscheck.js";
import { InferenceStore } from "./inference-store.js";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
/** 已确认旧稿的结构纠正：候选、版本校验、影响分析和作者确认，正文不改。 */
import { randomUUID } from "node:crypto";
import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { stableFingerprint } from "../task/revision.js";
import { declarationOf } from "../store/event-stream.js";
import {
  correctDeclaration,
  type StructureCorrection,
} from "../chapter/c5-correction.js";
import {
  foreshadowAllocator,
  ChapterWriteError,
} from "../server/chapter-input.js";
import {
  diffDeclarations,
  impactedChapters,
  type RevisionImpact,
} from "../revise/impact.js";
import { project } from "../store/project.js";
import { isPlanOrigin, type C5Declaration } from "../types/events.js";
import type { ProjectSession } from "../server/state.js";
export interface InferenceCorrection {
  id: string;
  chapter: number;
  sourceToken: string;
  summary: string;
  changes: readonly StructureCorrection[];
  declaration: C5Declaration;
  impact: RevisionImpact;
  status: "proposed" | "confirmed";
}
type Source = Pick<
  ProjectSession,
  | "meta"
  | "rules"
  | "events"
  | "chapterNumbers"
  | "chapterText"
  | "allDrafts"
  | "applyInferenceCorrection"
>;
interface Deps {
  source: Source;
  transaction: <T>(fn: () => T) => T;
}
export class InferenceCorrections {
  constructor(
    private readonly root: string,
    private readonly deps: Deps,
  ) {}
  view(chapter: number) {
    if (!Number.isSafeInteger(chapter) || chapter < 1)
      throw new ChapterWriteError(400, "章号必须是正整数");
    const text = this.deps.source.chapterText(chapter);
    if (text === undefined) throw new ChapterWriteError(404, "本章尚无正文");
    const events = this.deps.source.events();
    const formal = events.filter(
      (e) =>
        e.envelope.chapter === chapter &&
        ["import_inference", "user_edit"].includes(e.envelope.origin) &&
        (e.envelope.provenance === "committed" ||
          e.envelope.provenance === "authored"),
    );
    if (
      formal.length === 0 &&
      new InferenceStore(this.root).get(chapter)?.confirmedEmptyBody !==
        stableFingerprint(text)
    )
      throw new ChapterWriteError(
        409,
        "请先确认旧稿反推；平台创作的章节请在草稿结果页纠正",
      );
    return {
      chapter,
      declaration: declarationOf(formal),
      sourceToken: stableFingerprint({
        chapter,
        text,
        meta: this.deps.source.meta,
        events,
      }),
    };
  }
  propose(raw: unknown): InferenceCorrection {
    const input = object(raw);
    const current = this.view(input.chapter as number);
    if (current.sourceToken !== input.sourceToken)
      throw new ChapterWriteError(409, "正式结构或来源已变化，请重新核对");
    if (
      typeof input.summary !== "string" ||
      !input.summary.trim() ||
      !Array.isArray(input.changes)
    )
      throw new ChapterWriteError(400, "缺少纠正说明或记录");
    const previous = this.candidates(current.chapter).find(
      (p) =>
        p.sourceToken === current.sourceToken &&
        p.summary === (input.summary as string).trim() &&
        stableFingerprint(p.changes) === stableFingerprint(input.changes),
    );
    if (previous) return previous;
    const source = this.deps.source;
    const declaration = this.parseCorrection(
      current,
      input.changes as StructureCorrection[],
    );
    const changes = diffDeclarations(current.declaration, declaration);
    const later = source
      .chapterNumbers()
      .filter((n) => n > current.chapter)
      .map((chapter) => ({
        chapter,
        payloads: source
          .events()
          .filter(
            (e) =>
              e.envelope.chapter === chapter &&
              ["committed", "authored"].includes(e.envelope.provenance) &&
              !isPlanOrigin(e.envelope.origin),
          )
          .map((e) => e.payload),
      }));
    const proposal: InferenceCorrection = {
      id: `inference-edit-${randomUUID()}`,
      chapter: current.chapter,
      sourceToken: current.sourceToken,
      summary: input.summary.trim(),
      changes: input.changes as StructureCorrection[],
      declaration,
      impact: {
        source: current.chapter,
        changes,
        chapters: impactedChapters(current.chapter, changes, later),
      },
      status: "proposed",
    };
    this.save(proposal);
    return proposal;
  }
  private parseCorrection(
    current: {
      chapter: number;
      declaration: C5Declaration;
    },
    changes: readonly StructureCorrection[],
  ): C5Declaration {
    const source = this.deps.source;
    const prior = project({
      events: source
        .events()
        .filter(
          (e) =>
            ["committed", "authored"].includes(e.envelope.provenance) &&
            (e.envelope.chapter < current.chapter ||
              isPlanOrigin(e.envelope.origin)),
        ),
      currentChapter: current.chapter - 1,
      characterProfiles: [],
      plotLineDefs: [],
      plotLineGap: source.rules.crossChapter.plotLineGap,
    });
    const declaration = correctDeclaration(current.declaration, changes, {
      chapter: current.chapter,
      chapterText: source.chapterText(current.chapter)!,
      knownCharacters: new Set(
        source.meta.characters
          .filter((c) => ["committed", "authored"].includes(c.provenance))
          .map((c) => c.id),
      ),
      knownSettings: new Set(source.meta.settings.map((s) => s.id)),
      knownPlotLines: new Set(source.meta.plotLines.map((p) => p.id)),
      knownForeshadows: new Set(
        prior.foreshadows.filter((f) => f.status === "open").map((f) => f.id),
      ),
      foreshadows: prior.foreshadows.map((f) => ({
        id: f.id,
        label: f.label,
        intent: f.intent,
        status: f.status,
      })),
      allocateForeshadowId: foreshadowAllocator(source),
    });
    if (
      crossCheckC5({
        declaration,
        chapterText: source.chapterText(current.chapter)!,
      }).some((f) => f.level === "block" && f.rule === "c5_anchor_unresolvable")
    )
      throw new ChapterWriteError(
        400,
        "保留记录的原文出处已经失效，请先纠正引文或排除该记录",
      );
    return declaration;
  }
  candidates(chapter: number): readonly InferenceCorrection[] {
    const directory = join(this.root, "inference-corrections");
    if (!existsSync(directory)) return [];
    return readdirSync(directory)
      .filter((name) => /^inference-edit-[a-f0-9-]{36}\.json$/u.test(name))
      .map((name) => this.get(name.slice(0, -5)))
      .filter((p) => p.chapter === chapter && p.status === "proposed");
  }
  get(id: string): InferenceCorrection {
    if (!/^inference-edit-[a-f0-9-]{36}$/u.test(id))
      throw new ChapterWriteError(400, "纠正候选编号无效");
    const text = readProjectFile(this.root, `inference-corrections/${id}.json`);
    if (!text) throw new ChapterWriteError(404, "纠正候选不存在");
    const proposal = JSON.parse(text) as InferenceCorrection;
    if (
      proposal.id !== id ||
      !["proposed", "confirmed"].includes(proposal.status)
    )
      throw new Error("纠正候选损坏");
    return proposal;
  }
  confirm(raw: unknown): InferenceCorrection {
    const input = object(raw),
      id = input.id;
    if (typeof id !== "string" || !/^inference-edit-[a-f0-9-]{36}$/u.test(id))
      throw new ChapterWriteError(400, "纠正候选编号无效");
    return this.deps.transaction(() => {
      const text = readProjectFile(
        this.root,
        `inference-corrections/${id}.json`,
      );
      if (!text) throw new ChapterWriteError(404, "纠正候选不存在");
      const proposal = JSON.parse(text) as InferenceCorrection;
      if (
        proposal.id !== id ||
        !["proposed", "confirmed"].includes(proposal.status)
      )
        throw new Error("纠正候选损坏");
      if (proposal.status === "confirmed") return proposal;
      const current = this.view(proposal.chapter);
      if (current.sourceToken !== proposal.sourceToken)
        throw new ChapterWriteError(
          409,
          "确认前正式结构或来源发生变化，请重新核对",
        );
      const checked = this.parseCorrection(current, proposal.changes);
      if (
        stableFingerprint(checked) !== stableFingerprint(proposal.declaration)
      )
        throw new ChapterWriteError(409, "候选记录损坏或变化，校验未通过");
      this.deps.source.applyInferenceCorrection(proposal.chapter, checked);
      const runs = new InferenceStore(this.root);
      if (Object.values(checked).every((items) => items.length === 0))
        runs.save(proposal.chapter, {
          outcome: "done",
          confirmedEmptyBody: stableFingerprint(
            this.deps.source.chapterText(proposal.chapter),
          ),
          problems: [],
          warnings: ["作者核对后排除了本章全部误判记录，正文未改"],
          at: new Date().toISOString(),
        });
      const confirmed = { ...proposal, status: "confirmed" as const };
      this.save(confirmed);
      return confirmed;
    });
  }
  private save(proposal: InferenceCorrection) {
    writeProjectFile(
      this.root,
      `inference-corrections/${proposal.id}.json`,
      JSON.stringify(proposal),
    );
  }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new ChapterWriteError(400, "请求必须是对象");
  return value as Record<string, unknown>;
}
