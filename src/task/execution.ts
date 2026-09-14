import type { ChapterDraft, ChapterTaskView, DraftExecution, TaskStage } from "./types.js";
import { countWords } from "../text/measure.js";

/** 由协调器持有；图和模型包装器仅在边界读取，不把 Promise 写入磁盘。 */
export interface TaskControl { requested: "pause" | "end" | null }

export const emptyUsage = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, unmeasuredCalls: 0, pendingCalls: 0 });
export function draftStage(draft: ChapterDraft): TaskStage {
  if (draft.status === "writing" || draft.body === "" || draft.error?.step === "C4") return "writing";
  return draft.declaration === null ? "declaring" : "checking";
}

export function taskView(draft: ChapterDraft, active: boolean, isHistory = false): ChapterTaskView {
  const execution: DraftExecution = draft.execution ?? {
    status: "running", stage: draftStage(draft), startedAt: draft.createdAt,
    updatedAt: draft.updatedAt, usage: emptyUsage(),
  };
  let status = execution.status;
  if (draft.status === "pending_check") status = "waiting";
  else if (["adopted", "ready", "needs_revision"].includes(draft.status)) status = "completed";
  else if (draft.status === "discarded") status = "ended";
  else if (status === "paused" || status === "ended") { /* 用户决定与步骤错误分别保留。 */ }
  else if (draft.status === "failed") status = "failed";
  else if (["running", "pausing", "ending"].includes(status) && !active) status = "interrupted";
  const usage = !active && (execution.usage.pendingCalls ?? 0) > 0 ? { ...execution.usage, pendingCalls: 0, unmeasuredCalls: execution.usage.unmeasuredCalls + execution.usage.pendingCalls! } : execution.usage;
  return { ...execution, usage, usageRecorded: draft.execution !== undefined, isHistory, status, chapter: draft.chapter, draftId: draft.draftId,
    draftStatus: draft.status, words: countWords(draft.body),
    detail: status === "interrupted" ? "服务中没有此任务的活动执行，已保存的内容仍可查看；继续需要你主动发起。" : draft.error?.detail ?? null };
}
