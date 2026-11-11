import { resolveAnchor, type ChapterTextSource } from "../anchor/resolve.js";
import type { InferenceChapterView } from "../import/inference.js";
import type { AnchorRules } from "../rules/schema.js";
import type { Projections } from "../store/project.js";
import type { ChapterNo, TextAnchor } from "../types/primitives.js";
import type { Alert } from "../types/projections.js";

export interface AlertEvidence {
  coverageKnown: boolean;
  source: { chapter: number; quote: string | null; status: "exact" | "shifted" | "stale" | "record" } | null;
  /** 只计算提醒涉及的已存在章节；不把章号空档算成未抽取。 */
  unrecorded: number[];
  pending: number[];
}

export function structureCoverage(chapters: readonly Pick<InferenceChapterView, "chapter" | "state">[]) {
  return {
    total: chapters.length,
    recorded: chapters.filter(c => c.state === "written" || c.state === "confirmed").length,
    pending: chapters.filter(c => c.state === "pending").length,
    unrecorded: chapters.filter(c => !["written", "confirmed", "pending"].includes(c.state)).length,
  };
}

/** 展示依据与完整度，不修改告警分数、状态或作者确认结果。 */
export function alertEvidence(
  alerts: readonly Alert[], projections: Pick<Projections, "foreshadows" | "plotLines" | "arcs">,
  chapters: readonly Pick<InferenceChapterView, "chapter" | "state">[] | null, source: ChapterTextSource, rules: AnchorRules,
): Record<string, AlertEvidence> {
  const texts = new Map<ChapterNo, string | undefined>();
  const cached: ChapterTextSource = chapter => {
    if (!texts.has(chapter)) texts.set(chapter, source(chapter));
    return texts.get(chapter);
  };
  const output: Record<string, AlertEvidence> = {};
  for (const alert of alerts) {
    const subject = alert.subject;
    let anchor: TextAnchor | undefined;
    let chapter: number | undefined;
    if (subject.kind === "foreshadow") anchor = projections.foreshadows.find(f => f.id === subject.id)?.plantedAnchor;
    if (subject.kind === "plotline") {
      const line = projections.plotLines.find(p => p.id === subject.id);
      chapter = line?.lastAdvancedAt;
      anchor = line?.points.findLast(p => !p.planned && p.chapter === chapter)?.anchor;
    }
    if (subject.kind === "character") chapter = projections.arcs.find(a => a.characterId === subject.id)?.lastSeenAt;
    if (subject.kind === "anchor") anchor = subject.anchor;
    if (subject.kind === "chapter") chapter = subject.chapter;
    chapter = anchor?.chapter ?? chapter;
    const relevant = (chapters ?? []).filter(c => chapter === undefined || c.chapter >= chapter);
    output[alert.id] = {
      coverageKnown: chapters !== null,
      source: anchor ? { chapter: anchor.chapter, quote: anchor.quote, status: resolveAnchor(anchor, cached, rules).status }
        : chapter && chapter > 0 ? { chapter, quote: null, status: cached(chapter) === undefined ? "stale" : "record" } : null,
      unrecorded: relevant.filter(c => !["written", "confirmed", "pending"].includes(c.state)).map(c => c.chapter),
      pending: relevant.filter(c => c.state === "pending").map(c => c.chapter),
    };
  }
  return output;
}
