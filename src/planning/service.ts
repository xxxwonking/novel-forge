/** 作者的单项计划操作。按钮与对话共用校验；事件、计划和提示状态成组保存。 */
import type { ProjectSession } from "../server/state.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import { applyActionToBeat, acknowledgeAlert, initialAlertState } from "../alerts/apply.js";
import { deriveBudget } from "../beat/derive.js";
import { projectCharacterState } from "../store/project.js";
import type { AppendInput } from "../store/event-stream.js";
import type { AlertAction, AlertState } from "../types/projections.js";
import type { ChapterBeat } from "../types/beat.js";

export type PlanningAction = Extract<AlertAction, { kind: "add_resolution_to_beat" | "add_advance_to_beat" | "add_character_to_beat" | "reschedule" | "abandon" | "confirm_exit" }>;
export interface PlanningResult {
  readonly changed: boolean;
  readonly message: string;
  readonly beat?: ChapterBeat;
  readonly promotedToPayoff?: boolean;
  readonly adjustedChapters: readonly number[];
}
type Host = Pick<ProjectSession, "meta" | "currentChapter" | "derived" | "rules" | "events" | "beatFor" | "putBeat" | "appendEvents" | "alertState" | "putAlertState" | "syncAlertStates">;
const confirmed = (provenance: string) => provenance === "authored" || provenance === "committed";
const fail = (status: 400 | 404 | 409, message: string): never => { throw new ChapterWriteError(status, message); };
const text = (value: unknown, field: string): string => typeof value === "string" && value.trim() ? value.trim() : fail(400, `${field} 不能为空`);

export class PlanningService {
  constructor(private readonly source: Host, private readonly transaction: <T>(operation: () => T) => T) {}

  apply(raw: unknown, options: { readonly alertId?: string; readonly reason?: string } = {}): PlanningResult {
    const action = this.parse(raw);
    if (options.reason !== undefined && typeof options.reason !== "string") fail(400, "原因必须是文字");
    if (options.alertId !== undefined) this.assertSubject(action, options.alertId);
    return this.transaction(() => {
      const now = new Date().toISOString();
      const beats: ChapterBeat[] = [];
      const events: AppendInput[] = [];
      let alertState: AlertState | undefined;
      let beat: ChapterBeat | undefined;
      let promotedToPayoff = false;
      let message = "原安排已生效，无需重复";
      const append = (payload: AppendInput["payload"]) => events.push({ chapter: this.source.currentChapter, origin: "user_edit", provenance: "authored", payload });

      if (action.kind === "add_resolution_to_beat" || action.kind === "add_advance_to_beat" || action.kind === "add_character_to_beat") {
        const target = this.futureBeat(action.targetChapter);
        if (action.kind === "add_resolution_to_beat") {
          const f = this.foreshadow(action.foreshadowId);
          if (f.status !== "open") fail(409, "只有已埋设且尚未完全兑现的伏笔才能安排回收");
          if (action.weight !== f.weight) fail(400, `伏笔 ${f.id} 的权重与正式记录不一致`);
        } else if (action.kind === "add_advance_to_beat") {
          if (!this.source.meta.plotLines.some(line => line.id === action.plotLine)) fail(404, `情节线 ${action.plotLine} 不存在`);
        } else this.character(action.characterId);
        const applied = applyActionToBeat({ beat: target, action, profile: this.source.meta.profile, now }, this.source.rules);
        beat = applied.beat;
        promotedToPayoff = applied.promotedToPayoff;
        if (applied.changed) {
          beats.push(beat);
          message = `已安排在第 ${beat.chapter} 章处理；正文尚未完成这项变化${promotedToPayoff ? "。该章改为回收章并重算字数预算" : ""}`;
        }
      } else if (action.kind === "reschedule") {
        const f = this.foreshadow(action.foreshadowId);
        if (f.status === "resolved" || f.status === "abandoned") fail(409, "已兑现或已放弃的伏笔不能再改期");
        if (action.expectedBy !== f.expectedBy) {
          append({ type: "foreshadow_rescheduled", foreshadowId: f.id, expectedBy: action.expectedBy });
          message = `已将「${f.label}」的预期兑现期限改到第 ${action.expectedBy} 章；已有章节安排保留，伏笔尚未兑现`;
        }
      } else if (action.kind === "abandon") {
        const f = this.foreshadow(action.foreshadowId);
        if (f.status === "resolved") fail(409, "这条伏笔已兑现，不能再标为放弃");
        if (f.status !== "abandoned") append({ type: "foreshadow_abandoned", foreshadowId: f.id, reason: options.reason?.trim() || "作者决定不再兑现" });
        for (const original of this.source.meta.beats) {
          if (original.chapter <= this.source.currentChapter || !confirmed(original.provenance)) continue;
          const resolves = original.plan.resolves.filter(r => r.foreshadowId !== f.id);
          const plants = f.status === "planned" ? original.plan.plants.filter(p => p.label !== f.label) : original.plan.plants;
          if (resolves.length === original.plan.resolves.length && plants.length === original.plan.plants.length) continue;
          const chapterType = resolves.length === 0 && (original.plan.chapterType === "payoff" || original.plan.chapterType === "climax")
            ? original.plan.events.length > 0 ? "event" : "setup" : original.plan.chapterType;
          const plan = { ...original.plan, resolves, plants, chapterType };
          beats.push({ ...original, plan, provenance: "authored", updatedAt: now, budget: deriveBudget(plan, this.source.meta.profile, this.source.rules, { now }) });
        }
        message = `已放弃「${f.label}」，保留原因与历史${beats.length > 0 ? `；已移除第 ${beats.map(b => b.chapter).join("、")} 章的相关安排并重算预算` : ""}；未标为已兑现`;
      } else {
        const character = this.character(action.characterId);
        const effective = this.source.events().filter(event => confirmed(event.envelope.provenance));
        const state = projectCharacterState(effective, character.id, character.introducedAt);
        if (state.vital === "dead") fail(409, "人物已经死亡，不能将生存状态改成退场");
        const prior = effective.findLast(event => event.payload.type === "character_state_changed" && event.payload.characterId === character.id && event.payload.field === "vital");
        if (prior?.envelope.origin !== "user_edit" || prior.payload.type !== "character_state_changed" || prior.payload.to !== "missing") {
          append({ type: "character_state_changed", characterId: character.id, field: "vital", from: state.vital, to: "missing", anchor: { chapter: this.source.currentChapter, quote: "", offsetHint: -1, occurrence: 0 } });
        }
        const id = `character_missing:${character.id}`;
        const previous = this.source.alertState(id);
        if (!previous?.acknowledged) alertState = acknowledgeAlert(previous ?? initialAlertState(id, now));
        message = `已按作者决定确认「${character.name}」退场；没有新增正文中的出场或死亡记录`;
        const future = this.source.meta.beats.filter(b => b.chapter > this.source.currentChapter && confirmed(b.provenance) && b.plan.characters.includes(character.id));
        if (future.length > 0) message += `。第 ${future.map(b => b.chapter).join("、")} 章仍保留出场安排，请核对是否需要调整这些章节计划`;
      }

      const changed = beats.length > 0 || events.length > 0 || alertState !== undefined;
      // 告警已消失后只接受无副作用的同结果重试，旧按钮不能更改新的作品状态。
      if (options.alertId !== undefined && !this.source.derived.candidates.some(c => c.alert.id === options.alertId) && changed) {
        fail(404, "这条提示已不适用，请刷新作品后重新查看安排");
      }
      if (events.length > 0) this.source.appendEvents(events);
      for (const updated of beats) this.source.putBeat(updated);
      if (alertState !== undefined) this.source.putAlertState(alertState);
      if (changed) this.source.syncAlertStates();
      return { changed, message, adjustedChapters: beats.map(b => b.chapter), ...(beat === undefined ? {} : { beat, promotedToPayoff }) };
    });
  }

  private foreshadow(id: string) {
    return this.source.derived.projections.foreshadows.find(f => f.id === id) ?? fail(404, `伏笔 ${id} 不存在或尚未确认`);
  }
  private character(id: string) {
    return this.source.meta.characters.find(c => c.id === id && confirmed(c.provenance)) ?? fail(404, `人物 ${id} 不存在或尚未确认`);
  }
  private futureBeat(chapter: number): ChapterBeat {
    if (chapter <= this.source.currentChapter) fail(409, "已采用章节的计划不能通过未来安排操作改写");
    const beat = this.source.beatFor(chapter) ?? fail(404, `第 ${chapter} 章还没有计划，请先准备该章`);
    if (!confirmed(beat.provenance)) fail(409, "请先确认该章计划，再修改其中的具体安排");
    return beat;
  }
  private assertSubject(action: PlanningAction, alertId: string): void {
    const subject = "foreshadowId" in action ? action.foreshadowId : "plotLine" in action ? action.plotLine : action.characterId;
    const categories = "foreshadowId" in action ? ["foreshadow_overdue", "foreshadow_stale"] : "plotLine" in action ? ["plotline_gap"] : ["character_missing"];
    if (!categories.some(category => alertId === `${category}:${subject}`)) fail(400, "操作对象与这条提示不一致，请重新读取当前提示");
  }
  private parse(raw: unknown): PlanningAction {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail(400, "安排操作必须是对象");
    const value = raw as Record<string, unknown>;
    const kind = value["kind"];
    if (typeof kind !== "string" || !["add_resolution_to_beat", "add_advance_to_beat", "add_character_to_beat", "reschedule", "abandon", "confirm_exit"].includes(kind)) fail(400, "不支持的安排操作");
    const field = kind === "add_advance_to_beat" ? "plotLine" : kind === "add_character_to_beat" || kind === "confirm_exit" ? "characterId" : "foreshadowId";
    const id = text(value[field], field);
    if (String(kind).startsWith("add_")) {
      if (!Number.isSafeInteger(value["targetChapter"]) || (value["targetChapter"] as number) < 1) fail(400, "目标章号必须是正整数");
      if (kind === "add_resolution_to_beat" && (!["main", "sub", "detail"].includes(String(value["weight"])) || !["full", "partial"].includes(String(value["completeness"])))) fail(400, "伏笔权重或兑现目标无效");
    }
    if (kind === "reschedule" && (!Number.isSafeInteger(value["expectedBy"]) || (value["expectedBy"] as number) <= this.source.currentChapter)) fail(400, "预期兑现章号必须是未来的正整数");
    return { ...value, [field]: id } as PlanningAction;
  }
}
