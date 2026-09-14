import { useState } from "react";
import { api, type ChapterTaskView } from "../api.js";

const stages = { writing: "创作正文中", declaring: "核对结构中", checking: "检查中" };
const labels = { running: "正在处理", pausing: "正在暂停", ending: "正在结束", paused: "已暂停", ended: "本次任务已结束", completed: "本次任务完成", failed: "执行未完成", interrupted: "执行已中断" };
export const taskRunning = (task: ChapterTaskView | undefined): boolean => task !== undefined && ["running", "pausing", "ending"].includes(task.status);

export function TaskCard({ task, reload, detailed = false }: { task: ChapterTaskView; reload: () => void; detailed?: boolean }): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "pause" | "end" | "resume"): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      if (action === "resume") await api.writeChapter({ chapter: task.chapter, draftId: task.draftId });
      else await api.controlTask(task.chapter, task.draftId, action);
      reload();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const live = taskRunning(task);
  const resumable = ["paused", "failed", "interrupted"].includes(task.status) && task.draftStatus !== "stale";
  return <section className="task-card" data-running={live} aria-label={`第 ${task.chapter} 章任务`}>
    <div className="task-heading"><strong>第 {task.chapter} 章 · {task.draftId}</strong><span role="status">{task.status === "running" ? stages[task.stage] : labels[task.status]}</span></div>
    {live && <p>本次生成一版正文并核对、检查。离开页面后服务继续处理。</p>}
    {(task.status === "pausing" || task.status === "ending") && <p>正在等待当前模型请求返回，内容会保存，随后停止；不会发起后续模型请求。</p>}
    {task.status === "completed" && <p>{task.draftStatus === "ready" ? "结果等待你采用。" : task.draftStatus === "needs_revision" ? "检查发现必须处理项，请查看结果并修改。" : task.draftStatus === "adopted" ? "本版本已采用。" : "结果已保留。"}</p>}
    {task.detail && <p className="muted">{task.detail}</p>}
    <div className="task-actions">
      {!detailed && <a href={`#/draft/${task.chapter}/${task.draftId}`}>查看任务与结果 →</a>}
      {task.status === "running" && <button disabled={busy} onClick={() => void act("pause")}>暂停任务</button>}
      {resumable && <button disabled={busy} onClick={() => void act("resume")}>{task.stage === "writing" && task.words > 0 ? "重新生成正文" : "继续任务"}</button>}
      {(live || resumable) && <button data-quiet="true" disabled={busy || task.status === "ending"} onClick={() => void act("end")}>结束本次任务</button>}
    </div>
    {task.status === "running" && <small className="muted">暂停或结束在当前模型请求返回后生效，已完成内容会保留。</small>}
    {detailed && <p className="task-usage">{task.usageRecorded ? <>模型调用 {task.usage.calls} 次 · 已报告输入 {task.usage.inputTokens.toLocaleString()} / 输出 {task.usage.outputTokens.toLocaleString()} tokens{task.usage.unmeasuredCalls > 0 ? `；另有 ${task.usage.unmeasuredCalls} 次调用未返回用量` : ""}</> : "这份历史结果未记录模型用量。"}</p>}
    {error && <p className="finding" data-level="block" role="alert">{error}</p>}
  </section>;
}

export function TaskPanel({ tasks, error, route, reload }: { tasks: readonly ChapterTaskView[]; error: string | null; route: string; reload: () => void }): React.ReactElement | null {
  const pending = tasks.filter((t) => !["adopted", "discarded"].includes(t.draftStatus) && route !== `/draft/${t.chapter}/${t.draftId}`)
    .sort((a, b) => Number(taskRunning(b)) - Number(taskRunning(a)) || b.updatedAt.localeCompare(a.updatedAt));
  if (pending.length === 0 && error === null) return null;
  return <aside className="task-panel" aria-label="作品任务">
    {error && <p className="finding" data-level="warn">暂时无法更新任务状态：{error}。正在重连；当前显示上次读到的状态。</p>}
    {pending.slice(0, 3).map((task) => <TaskCard key={task.draftId} task={task} reload={reload} />)}
    {pending.length > 3 && <p className="muted">还有 {pending.length - 3} 份历史结果，可在对应章节的版本列表查看。</p>}
  </aside>;
}
