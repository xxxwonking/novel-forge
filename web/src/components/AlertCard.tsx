/**
 * 一条告警 + 它的一键动作（§12.6.7）。
 *
 * 这个组件的要点不是排版，是**按钮的文案**：告警若只是通知，用户看完还得
 * 自己记着"下一章要收母亲的信"，规划时会忘。所以每个按钮都要写清它会把
 * 什么写到哪一章去 —— `[加入第 53 章回收]` 而不是 `[处理]`。
 */

import { ActionLink, Button } from "./controls.js";
import { Chip } from "./Chip.js";
import type { Alert, AlertAction, AlertEvidence } from "../api.js";
import { alertGroup, isRecordReminder } from "../alert-browse.js";
import "../styles/alert-review.css";

const CATEGORY_LABEL: Record<string, string> = {
  foreshadow_overdue: "伏笔逾期",
  foreshadow_stale: "伏笔停滞",
  plotline_gap: "推进间隔",
  character_missing: "出场间隔",
  setting_conflict: "设定矛盾",
  attribute_conflict: "属性冲突",
  anchor_stale: "锚点失效",
  pacing_soft: "节奏偏软",
  style_drift: "文风偏差",
};

/** 动作文案。每一条都必须说出「写到哪一章」。 */
export function actionLabel(action: AlertAction): string {
  switch (action.kind) {
    case "add_resolution_to_beat":
      return `加入第 ${action.targetChapter} 章回收`;
    case "add_advance_to_beat":
      return `加入第 ${action.targetChapter} 章推进`;
    case "add_character_to_beat":
      return `加入第 ${action.targetChapter} 章出场`;
    case "reschedule":
      return "改期";
    case "abandon":
      return "废弃这条伏笔";
    case "confirm_exit":
      return "确认已退场";
    case "acknowledge":
      return "有意为之";
    case "open_view":
      return "查看视图";
    case "jump_to_anchor":
      return `跳到第 ${action.anchor.chapter} 章原文`;
  }
}

/** 主按钮是"写进节拍表"那一类 —— 它是闭环的入口，别的都是旁路。 */
function isPrimary(action: AlertAction): boolean {
  return (
    action.kind === "add_resolution_to_beat" ||
    action.kind === "add_advance_to_beat" ||
    action.kind === "add_character_to_beat"
  );
}

export interface AlertCardProps {
  alert: Alert;
  evidence?: AlertEvidence | undefined;
  rank?: number;
  busy?: boolean;
  onAction: (alert: Alert, action: AlertAction) => void;
  onIgnore?: (alert: Alert) => void;
}

export function AlertCard({ alert, evidence, rank, busy = false, onAction, onIgnore }: AlertCardProps): React.ReactElement {
  const group = alertGroup(alert, evidence);
  const source = evidence?.source;
  const guidance = group === "source" ? "原文出处已变动，请先核对记录与当前正文。"
    : evidence?.coverageKnown === false ? "结构提取进度暂时无法读取，当前无法判断记录是否齐全。请先核对来源，避免仅据此修改正文。"
    : group === "coverage" ? `相关章节中，${evidence!.unrecorded.length} 章尚无已确认结构，${evidence!.pending.length} 章待确认；建议先补齐记录。`
    : isRecordReminder(alert) ? "这是根据现有结构记录生成的提醒，请先核对正文；已有记录也不代表内容全部提取。"
    : "请结合原文复核，再决定是否修改正文。";
  return (
    <article className="alert" data-migrated={alert.migratedTo !== null}>
      <div className="alert-head">
        {rank !== undefined && <span className="alert-rank">{rank}</span>}
        <span className="alert-title">{alert.title}</span>
        <Chip color={alert.migratedTo === null ? "orange" : undefined}>{CATEGORY_LABEL[alert.category] ?? alert.category}</Chip>
      </div>

      <p className="alert-detail">{alert.detail}</p>
      <div className="alert-guidance"><p>{guidance}</p>
        {group === "coverage" && <ActionLink href="#/inference">核对章节结构</ActionLink>}
        {source && <ActionLink href={`#/chapter/${source.chapter}`}>查看第 {source.chapter} 章</ActionLink>}
      </div>
      <details className="alert-evidence"><summary>查看提示依据与排序</summary>
        {source ? <><p>{source.status === "stale" ? source.quote ? "以下是旧记录中的引文，目前无法在正文定位。" : "结构记录指向的章节正文已无法读取。" : source.status === "record" ? "依据：本章已有的结构记录；未提供逐字引文。" : source.status === "shifted" ? "引文仍在正文中，位置发生了变化。" : "引文可以在当前正文中定位。"}</p>{source.quote && <blockquote>{source.quote}</blockquote>}</> : <p>请从相应结构视图或原文入口核对；全部提示页提供逐章记录覆盖情况。</p>}
        {evidence && evidence.unrecorded.length > 0 && <p>尚无已确认结构的章节：{evidence.unrecorded.join("、")}</p>}
        {evidence && evidence.pending.length > 0 && <p>待确认的章节：{evidence.pending.join("、")}</p>}
        <p>排序值 {alert.score.toFixed(2)}：结合影响、间隔增长与忽略次数计算，用于排列提醒，不代表正文问题的确定程度。</p>
      </details>

      <div className="alert-actions">
        {alert.actions.map((action) => (
          <Button
            key={`${action.kind}:${"targetChapter" in action ? action.targetChapter : ""}`}
            size="sm"
            disabled={busy || (action.kind === "jump_to_anchor" && source?.status === "stale")}
            variant={isPrimary(action) ? "default" : action.kind === "acknowledge" || action.kind === "open_view" ? "ghost" : "outline"}
            onClick={() => onAction(alert, action)}
          >
            {actionLabel(action)}
          </Button>
        ))}
        {onIgnore !== undefined && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => onIgnore(alert)}>
            {alert.fatigueCount > 0 ? `暂不处理（已忽略 ${alert.fatigueCount} 次）` : "暂不处理"}
          </Button>
        )}
      </div>
    </article>
  );
}
