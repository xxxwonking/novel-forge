import { useState } from "react";
import { Button, HelpTooltip, StatusTag } from "./controls.js";
import {
  Check as CheckOutlined,
  X as CloseOutlined,
  LoaderCircle as LoadingOutlined,
  PenLine,
  Copy,
  Pencil,
  RotateCcw,
} from "lucide-react";
import type { AgentEffect, ConversationTurn, DraftView } from "../api.js";

interface ToolTrace {
  name: string;
  status: "started" | "finished";
  ok: boolean;
}
export interface Pending {
  text: string;
  tools: ToolTrace[];
  round: number;
}

const TOOL_LABELS: Readonly<Record<string, string>> = {
  get_overview: "查看作品概览",
  get_next_plan: "读取下一章计划",
  get_chapter_text: "读取章节正文",
  get_character: "查看人物资料",
  list_open_foreshadows: "查看未收伏笔",
  list_chapter_drafts: "查看草稿列表",
  get_chapter_draft: "读取草稿",
  get_preparation: "读取作品资料",
  get_story_progress: "查看故事进度",
  list_chapter_tasks: "查看任务",
  propose_preparation: "拟定资料方案",
  confirm_preparation: "确认资料方案",
  record_author_details: "记录作者设定",
  write_next_chapter: "提交写章任务",
  revise_chapter_draft: "提交修订任务",
  correct_draft_structure: "纠正结构记录",
  check_chapter_draft: "检查草稿",
  control_chapter_task: "控制任务",
  adopt_chapter: "采用章节",
  plan_add_to_chapter: "写入章节计划",
  plan_reschedule_foreshadow: "改期伏笔",
  plan_abandon_foreshadow: "放弃伏笔",
  record_alternative_idea: "记为备选",
  prepare_text_export: "准备导出",
};

export function Message({
  turn,
  onJump,
  onView,
  onAdopt,
  onRetry,
  onEdit,
  onRecover,
  disabled,
}: {
  turn: ConversationTurn;
  onJump: (chapter: number, quote: string) => void;
  onView: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
  onRetry: (() => void) | undefined;
  onEdit: (() => void) | undefined;
  onRecover: (() => void) | undefined;
  disabled: boolean;
}): React.ReactElement {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(turn.text);
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopyError(true);
    }
  };
  const time = new Date(turn.at);
  return (
    <div className="msg" data-role={turn.role}>
      <Avatar role={turn.role} />
      <div className="msg-main">
        <div className="msg-meta">
          <span>{turn.role === "user" ? "你" : "Agent"}</span>
          <time dateTime={turn.at}>
            {Number.isNaN(time.getTime())
              ? ""
              : time.toLocaleTimeString("zh-CN", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
          </time>
        </div>
        <div className="msg-body">{turn.text}</div>
        <div className="msg-actions">
          {onRecover && (
            <HelpTooltip title="编辑后重试">
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground max-[720px]:min-w-11"
                icon={<RotateCcw aria-hidden="true" />}
                aria-label="编辑后重试"
                disabled={disabled}
                onClick={onRecover}
              />
            </HelpTooltip>
          )}
          <HelpTooltip title={copied ? "已复制" : "复制消息"}>
            <Button
              size="icon-sm"
              variant="ghost"
              className="text-muted-foreground hover:text-foreground max-[720px]:min-w-11"
              icon={
                copied ? (
                  <CheckOutlined aria-hidden="true" />
                ) : (
                  <Copy aria-hidden="true" />
                )
              }
              aria-label="复制消息"
              onClick={() => void copy()}
            />
          </HelpTooltip>
          {copied && (
            <span className="sr-only" role="status">
              消息已复制
            </span>
          )}
          {onEdit && (
            <HelpTooltip title="编辑后发送">
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground max-[720px]:min-w-11"
                icon={<Pencil aria-hidden="true" />}
                aria-label="编辑后发送"
                disabled={disabled}
                onClick={onEdit}
              />
            </HelpTooltip>
          )}
          {onRetry && (
            <HelpTooltip title="重新发送">
              <Button
                size="icon-sm"
                variant="ghost"
                className="text-muted-foreground hover:text-foreground max-[720px]:min-w-11"
                icon={<RotateCcw aria-hidden="true" />}
                aria-label="重新发送"
                disabled={disabled}
                onClick={onRetry}
              />
            </HelpTooltip>
          )}
          {turn.status && (
            <span className="muted">
              {turn.status === "failed" ? "回复失败" : "回复未完成"}
              {!turn.retryable ? " · 已尝试工具操作，请先核对结果" : ""}
            </span>
          )}
          {copyError && (
            <span role="alert">复制失败，请选中文字后手动复制。</span>
          )}
        </div>
        {turn.effects !== undefined && turn.effects.length > 0 && (
          <div className="msg-effects">
            {turn.effects.map((e, i) => (
              <EffectCard
                key={i}
                effect={e}
                onJump={onJump}
                onView={onView}
                onAdopt={onAdopt}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function PendingMessage({
  pending,
}: {
  pending: Pending;
}): React.ReactElement {
  return (
    <div className="msg" data-role="agent" data-pending="true">
      <Avatar role="agent" />
      <div className="msg-main">
        <div className="msg-meta">
          <span>Agent</span>
          <span className="muted">
            {pending.round > 1 ? `第 ${pending.round} 轮` : ""}
          </span>
        </div>
        {pending.tools.length > 0 && (
          <div className="tool-trail" aria-live="polite">
            {pending.tools.map((t, i) => (
              <span
                key={i}
                className="tool-step"
                data-status={t.status}
                data-ok={t.ok}
              >
                {t.status === "started" ? (
                  <LoadingOutlined />
                ) : t.ok ? (
                  <CheckOutlined />
                ) : (
                  <CloseOutlined />
                )}
                {TOOL_LABELS[t.name] ?? t.name}
              </span>
            ))}
          </div>
        )}
        <div className="msg-body" aria-live="polite">
          {pending.text === "" && pending.tools.length === 0 ? (
            <span className="thinking-dots" aria-label="思考中">
              <i />
              <i />
              <i />
            </span>
          ) : (
            pending.text
          )}
          {pending.text !== "" && <span className="caret" aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
}

function Avatar({ role }: { role: "user" | "agent" }): React.ReactElement {
  return role === "agent" ? (
    <div className="avatar" data-role="agent" aria-hidden="true">
      <PenLine />
    </div>
  ) : (
    <div className="avatar" data-role="user" aria-hidden="true">
      你
    </div>
  );
}

function EffectCard({
  effect,
  onJump,
  onView,
  onAdopt,
}: {
  effect: AgentEffect;
  onJump: (chapter: number, quote: string) => void;
  onView: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
}): React.ReactElement {
  switch (effect.kind) {
    case "chapter_started":
    case "task_updated":
      return (
        <div className="effect">
          <StatusTag color="gold">
            {effect.kind === "chapter_started" ? "章节任务" : "任务状态已更新"}
          </StatusTag>
          <a href={`#/draft/${effect.chapter}/${effect.draftId}`}>
            第 {effect.chapter} 章 · 查看任务与结果
          </a>
        </div>
      );
    case "preparation_proposed":
    case "preparation_confirmed":
      return (
        <div className="effect">
          <StatusTag
            color={effect.kind === "preparation_confirmed" ? "cyan" : "gold"}
          >
            {effect.kind === "preparation_confirmed"
              ? "资料已确认"
              : "待确认方案"}
          </StatusTag>
          <span>{effect.summary}</span>
          <a
            href={`#/preparation?proposal=${encodeURIComponent(effect.proposalId)}`}
          >
            查看方案
          </a>
        </div>
      );
    case "chapter_written":
    case "chapter_revised":
      return (
        <div className="effect">
          <StatusTag>草稿 {effect.draftId}</StatusTag>
          <span className="muted">
            第 {effect.chapter} 章 · {effect.status}
          </span>
          <Button
            size="sm"
            onClick={() => onView(effect.chapter, effect.draftId)}
          >
            查看草稿
          </Button>
          <a href={`#/draft/${effect.chapter}/${effect.draftId}`}>完整结果</a>
          {effect.acceptable && (
            <Button
              size="sm"
              variant="default"
              onClick={() => onAdopt(effect.chapter, effect.draftId)}
            >
              采用
            </Button>
          )}
        </div>
      );
    case "chapter_adopted":
      return (
        <div className="effect">
          <StatusTag color="cyan">已采用 第 {effect.chapter} 章</StatusTag>
          <Button size="sm" onClick={() => onJump(effect.chapter, "")}>
            查看正文
          </Button>
          {effect.staleMarked.length > 0 && (
            <span className="muted">
              后续 {effect.staleMarked.length} 章需重核
            </span>
          )}
        </div>
      );
    case "plan_updated":
      return (
        <div className="effect">
          <StatusTag color="orange">第 {effect.chapter} 章计划已更新</StatusTag>
          {effect.promotedToPayoff && (
            <span className="muted">已升级为回收章</span>
          )}
        </div>
      );
    case "foreshadow_rescheduled":
      return (
        <div className="effect">
          <StatusTag>
            {effect.foreshadowId} 改期 → 第 {effect.expectedBy} 章
          </StatusTag>
        </div>
      );
    case "foreshadow_abandoned":
      return (
        <div className="effect">
          <StatusTag>{effect.foreshadowId} 已废弃</StatusTag>
        </div>
      );
    case "export_prepared":
      return (
        <div className="effect">
          <StatusTag color="gold">
            已固定 {effect.chapters} 章正式版本
          </StatusTag>
          <a href={`#/export?id=${encodeURIComponent(effect.exportId)}`}>
            查看导出预览并下载
          </a>
        </div>
      );
    case "idea_recorded":
      return (
        <div className="effect">
          <StatusTag>已记为备选</StatusTag>
          <span className="muted">{effect.text}</span>
        </div>
      );
    case "action_failed":
      return (
        <div className="effect">
          <StatusTag color="volcano">未完成</StatusTag>
          <span className="muted">
            {effect.tool}：{effect.message}
          </span>
        </div>
      );
  }
}

export function DraftBody({ draft }: { draft: DraftView }): React.ReactElement {
  return (
    <>
      {draft.error !== null && (
        <div
          className="finding"
          data-level="block"
          style={{ marginBottom: 12 }}
        >
          <div className="finding-rule">{draft.error.step}</div>
          <div className="finding-msg">{draft.error.detail}</div>
        </div>
      )}
      {draft.findings.length > 0 && (
        <div className="findings" style={{ marginBottom: 16 }}>
          {draft.findings.map((f, i) => (
            <div key={i} className="finding" data-level={f.level}>
              <div className="finding-rule">
                {f.rule} · {f.level}
              </div>
              <div className="finding-msg">{f.message}</div>
            </div>
          ))}
        </div>
      )}
      <div className="prose drawer-prose">
        {draft.body
          .split(/\n+/u)
          .map((p, i) => (p.trim() === "" ? null : <p key={i}>{p}</p>))}
      </div>
    </>
  );
}
