/**
 * 章节任务与草稿的类型（Stage 1）。
 *
 * 两个核心判断（见计划「集成原则」）：
 *
 * ① **草稿在事件流之外。** 任务产出的 C5 声明先存进草稿（`declaration`），
 *    不追加进 `events.jsonl`；只有 `adoptDraft` 时才展开成 committed 事件。
 *    这让「同章多稿、采用只生效选中稿」天然成立，废弃稿也不污染 append-only 日志。
 *
 * ② **跨重启恢复靠草稿这份领域产物**，不依赖 LangGraph checkpoint。C4 正文一写好
 *    就落 `body`，C5 失败后 `resume` 从声明步重入 —— 状态机在哪一步，从 `status`
 *    与已有字段就能判定。
 */

import type { ChapterNo, IsoTimestamp } from "../types/primitives.js";
import type { C5Declaration, ForeshadowWeight } from "../types/events.js";
import type { GateFinding } from "../types/beat.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import type Anthropic from "@anthropic-ai/sdk";

/** 草稿主键：`ch{章号}d{该章内序号}`，如 `ch7d2`。人类可读、按章聚簇。 */
export type DraftId = string;

/**
 * 章节草稿的生命周期（对应流程草案 §7.2）。
 *
 * writing → declaring → checking → (needs_revision ⇄ declaring) → ready → adopted
 * 任何步骤失败落 `failed`（正文已生成时仍保留 body，可 resume）。
 * `stale`：更早章被改后，本草稿依赖的事实已过期，需重核。
 */
export type ChapterDraftStatus =
  | "writing"
  | "pending_check"
  | "declaring"
  | "checking"
  | "needs_revision"
  | "ready"
  | "adopted"
  | "discarded"
  | "stale"
  | "failed";

/** 写作过程中经 propose_* 工具产生的待确认提议（进「待确认区」，采用时一并处理）。 */
export type DraftProposal =
  | {
      readonly kind: "character_update";
      readonly name: string;
      readonly field: string;
      readonly value: string;
      readonly reason: string;
    }
  | {
      readonly kind: "foreshadow";
      readonly label: string;
      readonly intent: string;
      readonly weight: ForeshadowWeight;
      readonly expectedBy: ChapterNo;
    };

export interface DraftProposalOption {
  readonly index: number;
  readonly kind: DraftProposal["kind"];
  readonly title: string;
  readonly from: string | null;
  readonly to: string;
  readonly reason: string;
  readonly available: boolean;
  readonly problem: string | null;
  readonly status: "suggested" | "applied" | "not_selected";
  readonly foreshadowId?: string;
}

export interface DraftProposalAdoption {
  readonly sourceToken: string;
  readonly selected: readonly number[];
  readonly options: readonly DraftProposalOption[];
  readonly at: string;
}

export interface DraftAdoptOptions {
  readonly revisionToken?: string;
  readonly selectedProposals?: readonly number[];
}

/** 步骤失败的可展示信息。正文已生成时 body 仍在草稿里。 */
export interface DraftError {
  readonly step: "C4" | "C5" | "C6";
  readonly detail: string;
}

/**
 * C4 会话快照 —— C5 是**同会话第二轮**，resume 到声明步必须能重建这轮会话
 * （capability-map §3.1：不能只存纯文本，要保留完整 C4 响应）。因此这里存
 * 系统块、工具、含工具往返的消息序列与 C4 响应。正文本身另存 .txt。
 */
export interface DraftSession {
  readonly system: readonly Anthropic.TextBlockParam[];
  readonly tools: readonly Anthropic.Tool[];
  readonly messages: readonly Anthropic.MessageParam[];
  /** 作者提交的正文没有模型响应；不能为它伪造 assistant/thinking 内容。 */
  readonly c4Response: Anthropic.Message | null;
  /** C4 仅返回局部替换/续文时，C5 同时读取代码合成后的完整正文。 */
  readonly declarationBody?: boolean;
}

export interface DraftTextRange {
  readonly quote: string;
  readonly occurrence: number;
  readonly start: number;
  readonly end: number;
}

/** 冻结正文与范围，失败恢复不得重新猜测或扩大作者的选择。内部执行数据不放进 API。 */
export interface DraftGeneration {
  readonly mode: "rewrite" | "continue";
  readonly instruction: string;
  readonly originalBody: string;
  readonly range: DraftTextRange | null;
}

export interface DraftRevision {
  readonly kind: "manual" | "structure" | "model" | "continuation" | "automatic" | "recheck";
  readonly sourceDraftId: DraftId;
  readonly sourceToken: string;
  readonly summary: string;
  readonly rebased: boolean;
  readonly requestId?: string;
  readonly requestFingerprint?: string;
  readonly scope?: DraftTextRange | null;
  readonly resultSummary?: string;
  readonly scopeAdvice?: string;
}

export interface DraftReview {
  /** 只由明确的“检查并采用”请求设置，新修订不继承这份授权。 */
  readonly adoptOnSuccess: boolean;
  readonly requestToken: string;
  readonly selectedProposals?: readonly number[];
  readonly adoptionError?: string;
}

/** 可序列化的写章来源校验；不保存带函数和 Set 的 runInput。旧草稿可缺。 */
export interface DraftWriteContext {
  readonly fingerprint: string;
  /** 新写章时冻结的自动修订额度；缺省的历史任务不追加额度。 */
  readonly autoRevisionLimit?: 0 | 1;
  /** 创建请求的幂等编号，恢复时保留，不被新一轮检查覆盖。 */
  readonly requestId?: string;
  readonly maxOutputTokens?: number;
  /** 新建任务时冻结的作者原请求；后续对话和旧任务恢复不能覆盖。 */
  readonly authorRequest?: string;
  /** 试写依赖的具体资料方案；采用章节时一并确认，恢复时重建相同资料视图。 */
  readonly proposalId?: string;
}

/**
 * 一份章节草稿 —— 任务的持久化产物，落盘即权威。
 *
 * `body` 一旦 C4 成功即写入，之后步骤失败也不清空（修复「失败即丢稿」）。
 * `declaration` 在 C5 成功前为 null；`findings`/`acceptable` 在 C6/C7 前为空/false。
 */
export interface ChapterDraft {
  readonly chapter: ChapterNo;
  readonly draftId: DraftId;
  readonly status: ChapterDraftStatus;
  readonly body: string;
  readonly declaration: C5Declaration | null;
  readonly findings: readonly GateFinding[];
  readonly acceptable: boolean;
  readonly proposals: readonly DraftProposal[];
  readonly proposalAdoption?: DraftProposalAdoption;
  /** C4 会话快照，供 resume 到声明步重建同会话第二轮。ready/adopted 后可为 null。 */
  readonly session: DraftSession | null;
  readonly writeContext?: DraftWriteContext;
  /** 执行状态独立于内容状态；旧草稿缺省时按内容及活动句柄推断。 */
  readonly execution?: DraftExecution;
  readonly revision?: DraftRevision;
  readonly generation?: DraftGeneration;
  readonly review?: DraftReview;
  /** 同一次写章已消耗的自动修订轮数，创建修订版本时即落盘。 */
  readonly autoRevisionsUsed?: number;
  /** 初稿保留原文与检查，通过此链接定位同任务的自动修订结果。 */
  readonly automaticResultDraftId?: DraftId;
  /**
   * 生成时的作品版本号（每次采用 +1，见 DraftStore.workVersion）。
   * 采用更早章后，`baseVersion` 落后的后续章草稿被标 `stale`。
   */
  readonly baseVersion: number;
  /** 生成时已采用到的最大章号，用于判断「改的是本草稿之前的章」。 */
  readonly baseAdoptedThrough: ChapterNo;
  readonly error: DraftError | null;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
}

/** 任务结束的形态。ready 才可采用；needs_revision/refused/failed 停在结果页。 */
export type ChapterTaskOutcome = "ready" | "needs_revision" | "refused" | "failed" | "paused" | "ended";

export type TaskStage = "writing" | "revising" | "declaring" | "checking";
export type TaskStatus = "waiting" | "awaiting_input" | "running" | "pausing" | "ending" | "paused" | "ended" | "completed" | "failed" | "interrupted";
export interface TaskUsage {
  readonly calls: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly unmeasuredCalls: number;
  /** 进程退出时用于识别尚未返回用量的请求；兼容旧记录缺省。 */
  readonly pendingCalls?: number;
}
export interface DraftExecution {
  readonly status: TaskStatus;
  readonly stage: TaskStage;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly usage: TaskUsage;
}
export interface ChapterTaskView extends DraftExecution {
  readonly autoRevisionLimit: number;
  readonly autoRevisionsUsed: number;
  readonly automaticResultDraftId: DraftId | null;
  readonly isHistory: boolean;
  readonly usageRecorded: boolean;
  readonly chapter: ChapterNo;
  readonly draftId: DraftId;
  readonly draftStatus: ChapterDraftStatus;
  readonly words: number;
  readonly detail: string | null;
}

/**
 * LangGraph 章节任务的状态通道（graph.ts 据此建 Annotation）。
 *
 * 与 ChapterDraft 分开：这是**图运行中的可变工作区**（含 runInput、修订计数、
 * 拒绝文案等只在运行期有意义的字段），草稿是它每步落盘的**领域快照**。
 */
export interface ChapterTaskState {
  readonly runInput: ChapterRunInput;
  readonly chapter: ChapterNo;
  readonly draftId: DraftId;
  readonly baseVersion: number;
  readonly baseAdoptedThrough: ChapterNo;
  readonly body: string;
  readonly declaration: C5Declaration | null;
  readonly findings: readonly GateFinding[];
  readonly acceptable: boolean;
  readonly proposals: readonly DraftProposal[];
  readonly revisionsUsed: number;
  readonly outcome: ChapterTaskOutcome | null;
  readonly error: DraftError | null;
  /** C4 被拒时给用户的文案（§2：空白页面是最差处理）。 */
  readonly refusalMessage: string | null;
}

/** 采用一份草稿的结果。 */
export interface AdoptResult {
  /** false = 幂等命中（该草稿已采用），未做任何写入。 */
  readonly changed: boolean;
  readonly chapter: ChapterNo;
  readonly draftId: DraftId;
  /** 采用的是「已采用章的修订」时，旧 C5 事件被作废的条数。 */
  readonly superseded: number;
  /** 因本次采用而被标记为需重核（stale）的后续章。 */
  readonly staleMarked: readonly ChapterNo[];
}
