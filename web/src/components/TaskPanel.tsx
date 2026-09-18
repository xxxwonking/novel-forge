import { useState } from "react";
import { Button } from "antd";
import { api, type ChapterTaskView, type RunStopReason } from "../api.js";
import { usePolling } from "../hooks.js";

const stages = { writing: "创作正文中", revising: "根据检查修改中", declaring: "核对结构中", checking: "检查中" };
const labels = { waiting: "待检查", awaiting_input: "等待你的决定", running: "正在处理", pausing: "正在暂停", ending: "正在结束", paused: "已暂停", ended: "本次任务已结束", completed: "本次任务完成", failed: "执行未完成", interrupted: "执行已中断" };
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
    <div className="task-heading"><strong>第 {task.chapter} 章 · {task.draftId}</strong><span role="status">{task.isHistory ? "历史结果" : task.status === "running" ? stages[task.stage] : labels[task.status]}</span></div>
    {live && <p>{task.stage === "writing" ? "正在生成正文，随后核对结构和检查。" : task.stage === "revising" ? "正在根据检查修订，初稿与原检查已保留。" : "正在核对、检查已保存的正文。"}离开页面后服务继续处理。</p>}
    {task.autoRevisionLimit > 0 && <p className="muted">本次一份初稿，自动修订最多 {task.autoRevisionLimit} 次；已使用 {task.autoRevisionsUsed} 次。修订后仍需检查和采用。</p>}
    {task.status === "waiting" && <p>修改已保存。选择检查后才开始核对，尚未调用模型。</p>}
    {task.status === "awaiting_input" && <p>需要你决定修改范围，原文已保留。请查看结果中的建议，再选择范围。</p>}
    {(task.status === "pausing" || task.status === "ending") && <p>正在等待当前模型请求返回，内容会保存，随后停止；不会发起后续模型请求。</p>}
    {task.isHistory ? <p>这是较早版本，正文和当时的检查结果仍保留。可通过版本列表查看当前结果。</p> : task.status === "completed" && <p>{task.draftStatus === "ready" ? "结果等待你采用。" : task.draftStatus === "needs_revision" ? "检查发现必须处理项，请查看结果并修改。" : task.draftStatus === "adopted" ? "本版本已采用。" : "结果已保留。"}</p>}
    {task.detail && <p className="muted">{task.detail}</p>}
    <div className="task-actions">
      {!detailed && <a href={`#/draft/${task.chapter}/${task.draftId}`}>查看任务与结果 →</a>}
      {!detailed && task.automaticResultDraftId && <a href={`#/draft/${task.chapter}/${task.automaticResultDraftId}`}>查看自动修订稿 →</a>}
      {task.status === "running" && <Button size="small" disabled={busy} onClick={() => void act("pause")}>暂停任务</Button>}
      {resumable && <Button size="small" disabled={busy} onClick={() => void act("resume")}>{(task.stage === "writing" || task.stage === "revising") && task.words > 0 ? "重试当前任务" : "继续任务"}</Button>}
      {(live || resumable || task.status === "awaiting_input") && <Button size="small" type="text" disabled={busy || task.status === "ending"} onClick={() => void act("end")}>结束本次任务</Button>}
    </div>
    {task.status === "running" && <small className="muted">暂停或结束在当前模型请求返回后生效，已完成内容会保留。</small>}
    {detailed && <p className="task-usage">{task.usageRecorded ? <>模型调用 {task.usage.calls} 次 · 已报告输入 {task.usage.inputTokens.toLocaleString()} / 输出 {task.usage.outputTokens.toLocaleString()} tokens{task.usage.unmeasuredCalls > 0 ? `；另有 ${task.usage.unmeasuredCalls} 次调用未返回用量` : ""}</> : "这份历史结果未记录模型用量。"}</p>}
    {error && <p className="finding" data-level="block" role="alert">{error}</p>}
  </section>;
}

const STOP_REASONS: Record<RunStopReason, string> = {
  key_change: "这一章有需要你亲自确认的变化", needs_revision: "检查没有通过", failed: "任务没交出可用结果",
  blocked: "前置条件不满足", author: "你停下了连写", interrupted: "上次连写被中断",
};

/**
 * 连写卡片：进度、停下、停下原因。
 *
 * 自动采用是「逐章采用」的例外，所以卡片把已采用的章号列出来 —— 作者一眼能看到
 * 这次授权替他做了哪些决定；停在哪一章、为什么停，直接链到那一章的结果页。
 */
export function RunCard({ reload }: { reload: () => void }): React.ReactElement | null {
  const run = usePolling(api.run);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = run.data;
  if (view === null || view.status === "idle") return null;
  const act = async (action: "stop" | "acknowledge"): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try { if (action === "stop") await api.stopRun(); else await api.acknowledgeRun(); run.reload(); reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const adopted = view.adopted.length === 0 ? "还没有自动采用的章" : `已自动采用第 ${view.adopted.join("、")} 章`;
  return <section className="task-card" data-running={view.status === "running"} aria-label="连写">
    <div className="task-heading"><strong>连写到第 {view.through} 章</strong><span role="status">{view.status === "running" ? (view.stopRequested ? "这一章写完就停" : `正在写第 ${view.current ?? view.nextChapter} 章`) : STOP_REASONS[view.stopped?.reason ?? "interrupted"]}</span></div>
    <p>{adopted}。{view.status === "running" ? "每章检查通过且没有关键变化才自动采用；否则停下等你。" : ""}</p>
    {view.stopped !== null && <p className="muted">第 {view.stopped.chapter} 章：{view.stopped.detail}</p>}
    <div className="task-actions">
      {view.stopped?.draftId && <a href={`#/draft/${view.stopped.chapter}/${view.stopped.draftId}`}>查看第 {view.stopped.chapter} 章的结果 →</a>}
      {view.status === "running" && <Button size="small" disabled={busy || view.stopRequested} onClick={() => void act("stop")}>{view.stopRequested ? "正在停下" : "写完这一章就停"}</Button>}
      {view.status === "stopped" && <Button size="small" type="text" disabled={busy} onClick={() => void act("acknowledge")}>知道了</Button>}
    </div>
    {error && <p className="finding" data-level="block" role="alert">{error}</p>}
  </section>;
}

export function TaskPanel({ tasks, error, route, reload }: { tasks: readonly ChapterTaskView[]; error: string | null; route: string; reload: () => void }): React.ReactElement | null {
  const pending = tasks.filter((t) => !t.isHistory && !["adopted", "discarded"].includes(t.draftStatus) && route !== `/draft/${t.chapter}/${t.draftId}`)
    .sort((a, b) => Number(taskRunning(b)) - Number(taskRunning(a)) || b.updatedAt.localeCompare(a.updatedAt));
  return <aside className="task-panel" aria-label="作品任务">
    <RunCard reload={reload} />
    {error && <p className="finding" data-level="warn">暂时无法更新任务状态：{error}。正在重连；当前显示上次读到的状态。</p>}
    {pending.slice(0, 3).map((task) => <TaskCard key={task.draftId} task={task} reload={reload} />)}
    {pending.length > 3 && <p className="muted">还有 {pending.length - 3} 份历史结果，可在对应章节的版本列表查看。</p>}
  </aside>;
}
