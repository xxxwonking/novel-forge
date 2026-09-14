/** 从正式记录及已确认计划重建处理进度；不存另一份“已解决”开关。 */
import type { ProjectSession } from "../server/state.js";
import type { TextAnchor } from "../types/primitives.js";
import type { ChapterBeat } from "../types/beat.js";
import { resolveAnchor } from "../anchor/resolve.js";
import { fullResolution } from "../planning/effective.js";
import type { PlanningAction } from "../planning/service.js";

export type StoryProgressState = "planned" | "pending" | "scheduled" | "rescheduled" | "partial" | "resolved" | "abandoned" | "exited";
export interface ProgressEvidence { readonly chapter: number; readonly label: string; readonly anchor?: TextAnchor }
export interface StoryProgress {
  readonly id: string;
  readonly kind: "foreshadow" | "plotline" | "character";
  readonly title: string;
  readonly state: StoryProgressState;
  readonly detail: string;
  readonly expectedBy?: number;
  readonly arrangements: readonly { readonly chapter: number; readonly goal: string }[];
  readonly evidence: readonly ProgressEvidence[];
  readonly history: readonly { readonly chapter: number; readonly state: StoryProgressState; readonly detail: string }[];
  readonly actions?: readonly PlanningAction[];
}
type Source = Pick<ProjectSession, "meta" | "events" | "derived" | "currentChapter" | "chapterText" | "rules">;

export function buildStoryProgress(source: Source): readonly StoryProgress[] {
  const confirmed = (provenance: string) => provenance === "authored" || provenance === "committed";
  const events = source.events().filter(e => confirmed(e.envelope.provenance));
  const facts = events.filter(e => e.envelope.origin !== "P4_outline" && e.envelope.chapter <= source.currentChapter && source.chapterText(e.envelope.chapter) !== undefined);
  const beats = source.meta.beats.filter(b => confirmed(b.provenance));
  const future = beats.filter(b => b.chapter > source.currentChapter);
  const verified = (anchor: TextAnchor) => Boolean(anchor.quote.trim()) && anchor.chapter <= source.currentChapter && resolveAnchor(anchor, chapter => source.chapterText(chapter), source.rules.anchor).status !== "stale";
  const out: StoryProgress[] = [];

  for (const f of source.derived.projections.foreshadows) {
    const scheduled = future.flatMap(beat => {
      const resolution = beat.plan.resolves.find(r => r.foreshadowId === f.id);
      if (resolution !== undefined) return [{ chapter: beat.chapter, goal: resolution.completeness === "full" ? "完整兑现" : "部分兑现" }];
      return f.status === "planned" && beat.plan.plants.some(p => p.label === f.label) ? [{ chapter: beat.chapter, goal: "埋设伏笔" }] : [];
    });
    const related = events.filter(e => "foreshadowId" in e.payload && e.payload.foreshadowId === f.id);
    const rescheduled = related.findLast(e => e.payload.type === "foreshadow_rescheduled");
    const abandoned = related.findLast(e => e.payload.type === "foreshadow_abandoned");
    const valid = f.resolutions.filter(r => verified(r.anchor));
    const full = fullResolution(f, chapter => chapter <= source.currentChapter ? source.chapterText(chapter) : undefined, source.rules.anchor) !== undefined;
    const arrangements = full || f.status === "abandoned" ? [] : scheduled;
    const state: StoryProgressState = f.status === "abandoned" ? "abandoned" : f.status === "planned" ? "planned"
      : full ? "resolved" : valid.length > 0 ? "partial" : rescheduled !== undefined ? "rescheduled" : arrangements.length > 0 ? "scheduled" : "pending";
    let detail = state === "abandoned" ? `作者已放弃：${abandoned?.payload.type === "foreshadow_abandoned" ? abandoned.payload.reason : "不再兑现"}。保留历史，未标为兑现。`
      : state === "planned" ? "已确认的未来规划，尚未在正文中埋设。"
        : state === "resolved" ? `已采用正文及对应记录支持完整兑现。${scheduled.length > 0 ? `第 ${scheduled.map(s => s.chapter).join("、")} 章原定回收已满足，后续按剩余计划开写。` : ""}`
          : state === "partial" ? `已采用正文只兑现了部分承诺；继续跟踪剩余目标：${f.intent}`
            : state === "rescheduled" ? `预期兑现期限已改为第 ${f.expectedBy} 章；具体章节安排另列，正文尚未完成兑现。`
              : state === "scheduled" ? "已经安排后续处理，尚未在已采用正文中兑现。" : `仍待兑现：${f.intent}`;
    if (valid.length < f.resolutions.length) detail += " 部分兑现记录缺少可定位的正式原文，需要核对。";
    const history: StoryProgress["history"][number][] = [];
    const actions: PlanningAction[] = [];
    if (f.status === "open" || f.status === "planned") {
      const next = future.find(b => b.chapter === source.currentChapter + 1);
      if (f.status === "open" && next !== undefined) for (const completeness of ["full", "partial"] as const) {
        actions.push({ kind: "add_resolution_to_beat", targetChapter: next.chapter, foreshadowId: f.id, weight: f.weight, completeness });
      }
      actions.push({ kind: "reschedule", foreshadowId: f.id, expectedBy: f.expectedBy }, { kind: "abandon", foreshadowId: f.id });
    }
    for (const beat of beats) {
      const resolution = beat.plan.resolves.find(r => r.foreshadowId === f.id);
      if (resolution !== undefined) history.push({ chapter: beat.chapter, state: "scheduled", detail: `原定第 ${beat.chapter} 章${resolution.completeness === "full" ? "完整" : "部分"}兑现` });
    }
    for (const e of related) {
      const p = e.payload;
      if (p.type === "foreshadow_planted") history.push({ chapter: e.envelope.chapter, state: e.envelope.origin === "P4_outline" ? "planned" : "pending", detail: e.envelope.origin === "P4_outline" ? "作者确认未来规划" : "已采用正文中的埋设" });
      if (p.type === "foreshadow_rescheduled") history.push({ chapter: e.envelope.chapter, state: "rescheduled", detail: `预期期限改为第 ${p.expectedBy} 章` });
      if (p.type === "foreshadow_abandoned") history.push({ chapter: e.envelope.chapter, state: "abandoned", detail: p.reason });
      if (p.type === "foreshadow_resolved" && e.envelope.origin !== "P4_outline" && verified(p.anchor)) history.push({ chapter: e.envelope.chapter, state: p.completeness === "full" ? "resolved" : "partial", detail: p.completeness === "full" ? "正文完整兑现" : "正文部分兑现，剩余承诺继续跟踪" });
    }
    out.push({ id: `foreshadow:${f.id}`, kind: "foreshadow", title: f.label, state, detail, expectedBy: f.expectedBy, arrangements, actions,
      evidence: state === "abandoned" || state === "planned" ? [] : valid.map(r => ({ chapter: r.chapter, label: r.completeness === "full" ? "完整兑现依据" : "部分兑现依据", anchor: r.anchor })), history: history.sort((a, b) => a.chapter - b.chapter) });
  }

  for (const line of source.meta.plotLines) {
    const targets = beats.filter(b => b.plan.events.some(e => e.plotLine === line.id));
    const records = facts.flatMap(e => e.payload.type === "plot_event" && e.payload.plotLine === line.id && verified(e.payload.anchor)
      ? [{ chapter: e.envelope.chapter, label: e.payload.summary, anchor: e.payload.anchor }] : []);
    out.push(scheduleProgress("plotline", line.id, line.label, "推进情节", targets, records, source.currentChapter, source.rules.crossChapter.plotLineGap[line.weight]));
  }
  for (const character of source.meta.characters.filter(c => confirmed(c.provenance))) {
    const targets = beats.filter(b => b.plan.characters.includes(character.id));
    const records = facts.flatMap(e => e.payload.type === "character_presence" && e.payload.characterId === character.id && e.payload.role !== "mentioned"
      ? [{ chapter: e.envelope.chapter, label: `${character.name}的已采用出场记录` }] : []);
    const authorExits = events.filter(e => e.envelope.origin === "user_edit" && e.envelope.chapter <= source.currentChapter && e.payload.type === "character_state_changed" && e.payload.characterId === character.id && e.payload.field === "vital" && e.payload.to === "missing" && !e.payload.anchor.quote.trim());
    const exitHistory: StoryProgress["history"] = authorExits.map(e => ({ chapter: e.envelope.chapter, state: "exited", detail: "作者确认退场" }));
    const lastVital = events.findLast(e => e.envelope.origin !== "P4_outline" && e.envelope.chapter <= source.currentChapter && e.payload.type === "character_state_changed" && e.payload.characterId === character.id && e.payload.field === "vital");
    const lastExit = authorExits.at(-1);
    if (lastExit !== undefined && lastVital === lastExit && !records.some(r => r.chapter > lastExit.envelope.chapter)) {
      const arrangements = targets.filter(b => b.chapter > source.currentChapter).map(b => ({ chapter: b.chapter, goal: "人物出场" }));
      const detail = "作者已确认退场；这项决定没有新增正文中的出场或死亡情节。" + (arrangements.length > 0 ? `第 ${arrangements.map(a => a.chapter).join("、")} 章仍有出场安排，请核对这些章节计划。` : "");
      out.push({ id: `character:${character.id}`, kind: "character", title: character.name, state: "exited", detail, arrangements, evidence: [], history: exitHistory });
    } else {
      const progress = scheduleProgress("character", character.id, character.name, "人物出场", targets, records, source.currentChapter, source.rules.crossChapter.characterAbsent[character.tier]);
      out.push({ ...progress, history: [...exitHistory, ...progress.history].sort((a, b) => a.chapter - b.chapter) });
    }
  }
  return out;
}

function scheduleProgress(kind: "plotline" | "character", id: string, title: string, goal: string, targets: readonly ChapterBeat[], records: readonly ProgressEvidence[], current: number, gapLimit: number): StoryProgress {
  const arrangements = targets.filter(b => b.chapter > current).map(b => ({ chapter: b.chapter, goal }));
  const past = targets.filter(b => b.chapter <= current);
  const targetChapter = Math.max(0, ...past.map(b => b.chapter));
  const last = [...records].sort((a, b) => a.chapter - b.chapter).at(-1);
  const satisfied = last !== undefined && last.chapter >= targetChapter && current - last.chapter <= gapLimit;
  const state: StoryProgressState = arrangements.length > 0 ? "scheduled" : satisfied ? "resolved" : targetChapter === 0 && records.length === 0 ? "planned" : "pending";
  const detail = state === "resolved" ? `已采用第 ${last!.chapter} 章的记录支持本次${goal}；不代表整条故事线结束。`
    : state === "scheduled" ? `已安排后续${goal}，等待对应正文生成并采用。`
      : state === "planned" ? `尚未安排${goal}，也没有对应正文记录。` : `${targetChapter > 0 ? `第 ${targetChapter} 章的` : "后续"}${goal}仍需处理或核对，没有用计划代替实际完成。`;
  return { id: `${kind}:${id}`, kind, title, state, detail, arrangements,
    evidence: state === "resolved" && last !== undefined ? [last] : [],
    history: targets.map(b => ({ chapter: b.chapter, state: "scheduled", detail: `计划第 ${b.chapter} 章${goal}` })),
  };
}
