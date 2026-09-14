/** 已采用正文满足原定目标后，装配剩余计划；原计划保留供展示和修订重放。 */
import { resolveAnchor, type ChapterTextSource } from "../anchor/resolve.js";
import type { AnchorRules } from "../rules/schema.js";
import type { ChapterPlan } from "../types/beat.js";
import type { ForeshadowTimelineItem } from "../types/projections.js";

export function fullResolution(f: ForeshadowTimelineItem, read: ChapterTextSource, rules: AnchorRules): ForeshadowTimelineItem["resolutions"][number] | undefined {
  if (f.status !== "resolved") return undefined;
  return f.resolutions.find(r => r.completeness === "full" && r.anchor.quote.trim() && resolveAnchor(r.anchor, read, rules).status !== "stale");
}

export function remainingPlan(plan: ChapterPlan, completed: ReadonlySet<string>, planted: ReadonlySet<string>): ChapterPlan {
  const resolves = plan.resolves.filter(r => !completed.has(r.foreshadowId));
  const plants = plan.plants.filter(p => !planted.has(p.label.trim()));
  if (resolves.length === plan.resolves.length && plants.length === plan.plants.length) return plan;
  const chapterType = resolves.length === 0 && (plan.chapterType === "payoff" || plan.chapterType === "climax")
    ? plan.events.length > 0 ? "event" : "setup" : plan.chapterType;
  return { ...plan, resolves, plants, chapterType };
}
