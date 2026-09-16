import { Button } from "antd";
import { Chip } from "./Chip.js";
import type { StoryProgress, PlanningAction } from "../api.js";
import { actionLabel } from "./AlertCard.js";

const LABEL: Record<StoryProgress["state"], string> = {
  planned: "未来规划", pending: "待处理", scheduled: "已安排", rescheduled: "已改期",
  partial: "部分兑现 · 继续跟踪", resolved: "已兑现", abandoned: "已放弃", exited: "作者确认退场",
};

export function StoryProgressList({ entries, onAction }: { entries: StoryProgress[]; onAction: (title: string, action: PlanningAction) => void }): React.ReactElement {
  return <section className="section" aria-label="故事安排与处理进度">
    <h2>故事安排与处理进度</h2>
    <p className="muted">安排和改期会继续跟踪。正文生成并采用后，才按实际记录更新完成情况。</p>
    {entries.length === 0 ? <p className="empty">还没有需要跟踪的故事安排。</p> : <div className="story-progress-grid">
      {entries.map(entry => <article className="story-progress-card" key={entry.id} data-progress-id={entry.id} data-state={entry.state}>
        <div className="row"><strong>{entry.title}</strong><Chip color={entry.state === "resolved" ? undefined : entry.state === "pending" || entry.state === "partial" ? "orange" : undefined}>
          {entry.state === "resolved" && entry.kind !== "foreshadow" ? "已完成本次安排" : LABEL[entry.state]}
        </Chip></div>
        <p>{entry.detail}</p>
        {entry.expectedBy !== undefined && <p className="muted">预期兑现期限：第 {entry.expectedBy} 章</p>}
        {entry.arrangements.length > 0 && <div className="story-arrangements">{entry.arrangements.map((item, index) => <Chip key={index}>第 {item.chapter} 章 · {item.goal}</Chip>)}</div>}
        {entry.evidence.length > 0 && <div className="story-evidence">{entry.evidence.map((item, index) => <a key={index} href={`#/chapter/${item.chapter}${item.anchor === undefined ? "" : `?quote=${encodeURIComponent(item.anchor.quote)}`}`}>第 {item.chapter} 章 · {item.label}</a>)}</div>}
        {(entry.actions?.length ?? 0) > 0 && <div className="alert-actions">{entry.actions!.map((action, index) => <Button key={index} size="small" type="text" onClick={() => onAction(entry.title, action)}>{action.kind === "add_resolution_to_beat" ? `第 ${action.targetChapter} 章${action.completeness === "full" ? "完整" : "部分"}兑现` : actionLabel(action)}</Button>)}</div>}
        {entry.history.length > 0 && <details><summary>查看处理记录（{entry.history.length}）</summary><ol>{entry.history.map((item, index) => <li key={index}>第 {item.chapter} 章 · {item.detail}</li>)}</ol></details>}
      </article>)}
    </div>}
  </section>;
}
