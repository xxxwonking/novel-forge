/**
 * 一条告警 + 它的一键动作（§12.6.7）。
 *
 * 这个组件的要点不是排版，是**按钮的文案**：告警若只是通知，用户看完还得
 * 自己记着"下一章要收母亲的信"，规划时会忘。所以每个按钮都要写清它会把
 * 什么写到哪一章去 —— `[加入第 53 章回收]` 而不是 `[处理]`。
 */

import type { Alert, AlertAction } from "../api.js";

const CATEGORY_LABEL: Record<string, string> = {
  foreshadow_overdue: "伏笔逾期",
  foreshadow_stale: "伏笔停滞",
  plotline_gap: "情节线断线",
  character_missing: "角色消失",
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
  rank?: number;
  busy?: boolean;
  onAction: (alert: Alert, action: AlertAction) => void;
  onIgnore?: (alert: Alert) => void;
}

export function AlertCard({ alert, rank, busy = false, onAction, onIgnore }: AlertCardProps): React.ReactElement {
  return (
    <article className="alert" data-migrated={alert.migratedTo !== null}>
      <div className="alert-head">
        {rank !== undefined && <span className="alert-rank">{rank}</span>}
        <span className="alert-title">{alert.title}</span>
        <span className="tag" data-tone={alert.migratedTo !== null ? "done" : "warn"}>
          {CATEGORY_LABEL[alert.category] ?? alert.category}
        </span>
        {/* score 平时没用，但校准期要能一眼看到排序依据（§12.6.9）。 */}
        <span className="alert-score" title={`impact ${alert.impact} × decay ${alert.decay.toFixed(2)}`}>
          {alert.score.toFixed(2)}
        </span>
      </div>

      <p className="alert-detail">{alert.detail}</p>

      <div className="alert-actions">
        {alert.actions.map((action) => (
          <button
            key={`${action.kind}:${"targetChapter" in action ? action.targetChapter : ""}`}
            disabled={busy}
            data-primary={isPrimary(action) || undefined}
            data-quiet={action.kind === "acknowledge" || action.kind === "open_view" || undefined}
            onClick={() => onAction(alert, action)}
          >
            {actionLabel(action)}
          </button>
        ))}
        {onIgnore !== undefined && (
          <button data-quiet disabled={busy} onClick={() => onIgnore(alert)}>
            {alert.fatigueCount > 0 ? `暂不处理（已忽略 ${alert.fatigueCount} 次）` : "暂不处理"}
          </button>
        )}
      </div>
    </article>
  );
}
