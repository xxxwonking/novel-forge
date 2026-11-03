import { gateChapter, gateText } from "../gate/code-channel.js";
import { gateCrossChapter } from "../gate/cross-chapter.js";
import { validatePlan } from "../beat/validate.js";
import { deriveBudget } from "../beat/derive.js";
import { project } from "../store/project.js";
import { isPlanOrigin } from "../types/events.js";
import type { ProjectSession } from "./state.js";

/** 缺少某类依据只跳过对应检查，不阻断旧稿的基础正文检查。 */
export function chapterHealth(session: ProjectSession, chapter: number) {
  const beat = session.beatFor(chapter);
  const text = session.chapterText(chapter);
  if (beat === undefined && text === undefined) return null;
  const meta = session.meta;
  const events = session.events().filter(event => event.envelope.chapter <= chapter &&
    (event.envelope.provenance === "committed" || event.envelope.provenance === "authored"));
  const recorded = events.filter(event => !isPlanOrigin(event.envelope.origin));
  const weights = recorded.flatMap(event => event.envelope.chapter === chapter && event.payload.type === "plot_event" ? [event.payload.weight] : []);
  const textGate = text === undefined ? null : gateText({ chapterText: text, profile: meta.profile }, session.rules);
  const gate = text === undefined || beat === undefined ? null : gateChapter({
    chapterText: text, plan: beat.plan, profile: meta.profile, declaredEventWeights: weights,
    budget: beat.budget ?? deriveBudget(beat.plan, meta.profile, session.rules, { now: beat.updatedAt }),
  }, session.rules);
  const projections = project({ events, currentChapter: chapter,
    characterProfiles: meta.characters.filter(character => character.introducedAt <= chapter),
    plotLineDefs: meta.plotLines, plotLineGap: session.rules.crossChapter.plotLineGap });
  return {
    chapter, textGate,
    plan: beat === undefined ? [] : validatePlan(beat.plan, session.rules),
    chapterGate: gate === null ? null : { ...gate,
      density: weights.length === 0 ? null : gate.density,
      findings: weights.length === 0 ? gate.findings.filter(finding => !finding.rule.startsWith("density_")) : gate.findings },
    crossChapter: recorded.length === 0 ? [] : gateCrossChapter({ currentChapter: chapter, ...projections }, session.rules),
    unavailable: {
      plan: beat === undefined ? "尚未建立章节计划，仅跳过计划完整性与字数预算检查；基础正文检查仍可使用。" : null,
      density: weights.length === 0 ? "本章没有已确认的剧情事件记录，暂不计算事件密度。" : beat === undefined ? "缺少章节计划与密度预算，暂不评判事件疏密。" : null,
      crossChapter: recorded.length === 0 ? "尚无已确认的正文结构记录，暂不能核对跨章关联；可在作品资料中反推故事结构并确认。" : null,
    },
  };
}
