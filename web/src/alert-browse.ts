import type { Alert, AlertEvidence } from "./alert-types.js";

export type AlertGroup = "source" | "coverage" | "structure" | "prose";
const RECORD_CATEGORIES = new Set(["foreshadow_overdue", "foreshadow_stale", "plotline_gap", "character_missing"]);
export function isRecordReminder(alert: Pick<Alert, "category">): boolean { return RECORD_CATEGORIES.has(alert.category); }
export function alertGroup(alert: Alert, evidence?: AlertEvidence): AlertGroup {
  if (alert.category === "anchor_stale" || evidence?.source?.status === "stale") return "source";
  if (isRecordReminder(alert) && evidence && (evidence.coverageKnown === false || evidence.unrecorded.length + evidence.pending.length > 0)) return "coverage";
  return isRecordReminder(alert) ? "structure" : "prose";
}

/** 相同对象相邻展示，保留每条提醒的操作；只消除列表之间重复的同一 ID。 */
export function groupAlerts(alerts: readonly Alert[], evidence: Record<string, AlertEvidence> = {}): { kind: AlertGroup; subjects: Alert[][]; count: number }[] {
  const groups = new Map<AlertGroup, Map<string, Alert[]>>();
  const seen = new Set<string>();
  for (const alert of alerts) {
    if (seen.has(alert.id)) continue;
    seen.add(alert.id);
    const kind = alertGroup(alert, evidence[alert.id]);
    let subjects = groups.get(kind);
    if (!subjects) { subjects = new Map(); groups.set(kind, subjects); }
    const subject = alert.subject;
    const key = subject.kind + ":" + ("id" in subject ? subject.id : subject.kind === "chapter" ? subject.chapter : JSON.stringify(subject.anchor));
    const list = subjects.get(key) ?? [];
    list.push(alert); subjects.set(key, list);
  }
  return (["source", "coverage", "structure", "prose"] as const).flatMap(kind => {
    const subjects = groups.get(kind);
    return subjects ? [{ kind, subjects: [...subjects.values()], count: [...subjects.values()].reduce((n, list) => n + list.length, 0) }] : [];
  });
}
