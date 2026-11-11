import { useState } from "react";
import { ActionLink, Button } from "../components/controls.js";
import { api, type Alert, type AlertAction, type PlanningAction } from "../api.js";
import { useFetch, useRouteActive } from "../hooks.js";
import { AlertCard } from "../components/AlertCard.js";
import { StoryProgressList } from "../components/StoryProgressList.js";
import { groupAlerts, type AlertGroup } from "../alert-browse.js";

const REASON_LABEL: Record<string, string> = {
  scheduled: "已安排，等待正文完成并采用",
  acknowledged: "已标「有意为之」",
  fatigued: "忽略多次，仅退出首页，仍在当前提示中",
};
const GROUPS: Record<AlertGroup, { title: string; description: string }> = {
  source: { title: "先核对出处", description: "原文引文无法在当前正文中定位。先确认记录是否需要更新。" },
  coverage: { title: "先核对结构记录", description: "相关章节缺少已确认结构、等待确认，或暂时无法读取覆盖情况。先核对记录，再决定是否修改正文。" },
  structure: { title: "结构安排提醒", description: "根据已记录的伏笔、推进和出场间隔生成。核对实际剧情后，再决定后续安排。" },
  prose: { title: "正文复核", description: "结合原文核对冲突或表达问题，确认后再形成候选修改。" },
};
export interface AlertListProps {
  onAction: (alert: Alert, action: AlertAction) => void;
  onIgnore: (alert: Alert) => void;
  refreshKey: number;
  onPlanningAction: (title: string, action: PlanningAction) => void;
}
export function AlertList({ onAction, onIgnore, refreshKey, onPlanningAction }: AlertListProps): React.ReactElement {
  const { data, error, reload } = useFetch(() => api.alerts(), [refreshKey]);
  const isCurrent = useRouteActive();
  const [filter, setFilter] = useState<AlertGroup | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  if (data === null) return <div className="empty">{error ?? "读取提示…"} <Button onClick={reload}>重新读取</Button></div>;
  const groups = groupAlerts([...data.fullList, ...data.repairQueue], data.evidence);
  const count = groups.reduce((total, group) => total + group.count, 0);
  const coverage = data.coverage;
  const revision = data.revision;
  const undo = async (id: string): Promise<void> => {
    if (busy !== null) return;
    setBusy(id); setActionError(null);
    try { await api.unacknowledge(id); if (isCurrent()) reload(); }
    catch (cause) { if (isCurrent()) setActionError((cause as Error).message); }
    finally { if (isCurrent()) setBusy(null); }
  };
  return <>
    <div className="page-head"><h1>全部提示</h1><p>先看记录是否齐全，再核对结构安排和正文。提示数量不等于已确认的正文问题数量。</p></div>
    {(error ?? actionError) && <p role="alert" className="finding" data-level="warn">{error ?? actionError} <Button size="sm" onClick={reload}>重新读取</Button></p>}
    <section className="alert-coverage" aria-label="结构记录覆盖情况">
      <h2>结构记录覆盖情况</h2>
      {data.coverageError && <p className="finding" data-level="warn" role="alert">{data.coverageError} <Button size="sm" onClick={reload}>重新读取覆盖情况</Button></p>}
      {coverage ? <><p>共 {coverage.total} 章正文：{coverage.recorded} 章已有正式结构，{coverage.pending} 章待确认，{coverage.unrecorded} 章尚无已确认结构。</p><p className="muted">“已有正式结构”只表示留下了记录，不保证所有剧情均已提取；跳过或提取失败的章节也需要按需核对。</p></> : <p className="muted">暂未取得结构覆盖情况，请重新读取后核对。</p>}
      <div className="row"><ActionLink href="#/inference">查看逐章记录</ActionLink><ActionLink href="#/revision">查看跨章返修{revision && !revision.error ? `（${revision.pending} 章待复核）` : ""}</ActionLink></div>
      {revision?.error && <p role="alert" className="finding" data-level="warn">返修记录读取失败：{revision.error}。请到跨章返修页面核对。</p>}
      {revision && !revision.error && revision.conflicts > 0 && <p className="muted">其中 {revision.conflicts} 章存在结构冲突，请结合原文复核。</p>}
    </section>
    <div className="alert-filters" role="group" aria-label="提示分类">
      <Button variant={filter === "all" ? "secondary" : "ghost"} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>全部（{count}）</Button>
      {groups.map(group => <Button key={group.kind} variant={filter === group.kind ? "secondary" : "ghost"} aria-pressed={filter === group.kind} onClick={() => setFilter(group.kind)}>{GROUPS[group.kind].title}（{group.count}）</Button>)}
    </div>
    {count === 0 && <p className="empty">现有结构记录未触发提醒。是否还需补齐记录，请查看上方覆盖情况。</p>}
    {filter !== "all" && !groups.some(group => group.kind === filter) && <p className="empty">这一类当前没有提示。<Button onClick={() => setFilter("all")}>查看全部</Button></p>}
    {groups.filter(group => filter === "all" || filter === group.kind).map(group => <section className="section alert-review-group" key={group.kind}>
      <h2>{GROUPS[group.kind].title}（{group.count}）</h2><p className="muted">{GROUPS[group.kind].description}</p>
      <div className="alerts">{group.subjects.map(list => <div className="alert-subject" key={list[0]!.id}>
        {list.length > 1 && <p className="muted">同一对象的 {list.length} 条提示</p>}
        {list.map(alert => <AlertCard key={alert.id} alert={alert} evidence={data.evidence?.[alert.id]} onAction={onAction} onIgnore={onIgnore} />)}
      </div>)}</div>
    </section>)}
    <details className="alert-history"><summary>后续安排与完成依据（{data.progress.length}）</summary><StoryProgressList entries={data.progress} onAction={onPlanningAction} /></details>
    <details className="alert-history"><summary>已安排、有意保留与暂缓的提示（{data.suppressed.length}）</summary>
      <p className="muted">安排到章节计划中不等于已在正文完成。多次忽略只影响首页展示。</p>
      {data.suppressed.length === 0 ? <p className="muted">没有这类提示。</p> : <ul className="alert-suppressed">{data.suppressed.map(({ alert, reason }) => <li key={alert.id}><strong>{alert.title}</strong><p className="muted">{REASON_LABEL[reason]}</p>{reason === "acknowledged" && <Button size="sm" disabled={busy !== null} loading={busy === alert.id} onClick={() => void undo(alert.id)}>恢复提醒</Button>}</li>)}</ul>}
    </details>
  </>;
}
