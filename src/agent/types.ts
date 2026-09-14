/**
 * 对话式主 Agent 的领域类型（Stage 2·切片 1）。
 *
 * 主 Agent 是「作者用自然语言下达任务 → Agent 自主选工具」的入口（用户流程 §1、
 * 能力映射 §3.3）。它**不产生正式事实**：读类工具零副作用；写章/采用/改计划
 * 一律走 ProjectSession 的既有受控入口（写章→草稿/proposed，采用→按版本/幂等），
 * 正式事实边界留在代码里（§12.0）。
 *
 * `AgentEffect` 是一次对话回合里**真实发生的状态变化**的结构化记录 —— 它由工具
 * 执行产生，前端据此渲染可点 chip（查看草稿 / 采用 / 采用并继续）。回合的自然语言
 * 回复是模型最后一次非 tool_use 的文本。
 */

import type { IsoTimestamp } from "../types/primitives.js";
import type { ChapterDraftStatus, DraftId } from "../task/types.js";
import type { ChapterNo, CharacterId, PlotLineId, SettingId } from "../types/primitives.js";
// 纯类型互引（两边都是 import type，编译后全部擦除，没有运行时环）。
import type { ConversationMode, ProposalScope } from "./proposal-types.js";

/** 一次对话回合里发生的状态变化。只记真实副作用与失败，不记纯问答。 */
export type AgentEffect =
  | {
      readonly kind: "chapter_written";
      readonly chapter: ChapterNo;
      readonly draftId: DraftId;
      readonly status: ChapterDraftStatus;
      readonly acceptable: boolean;
      /** 任务内自动修订的次数。>0 时前端提示可看新旧对比。 */
      readonly revisions: number;
    }
  | {
      readonly kind: "chapter_adopted";
      readonly chapter: ChapterNo;
      readonly draftId: DraftId;
      readonly superseded: number;
      readonly staleMarked: readonly ChapterNo[];
    }
  | { readonly kind: "plan_updated"; readonly chapter: ChapterNo; readonly promotedToPayoff: boolean }
  | { readonly kind: "foreshadow_rescheduled"; readonly foreshadowId: string; readonly expectedBy: ChapterNo }
  | { readonly kind: "foreshadow_abandoned"; readonly foreshadowId: string }
  | { readonly kind: "idea_recorded"; readonly id: string; readonly text: string }
  // 筹备类（Stage 2·切片 2）：改 L1/资料，authored 可信度，不入事件流。
  | { readonly kind: "setting_updated"; readonly fields: readonly string[] }
  | { readonly kind: "character_upserted"; readonly id: CharacterId; readonly name: string; readonly created: boolean }
  | { readonly kind: "location_upserted"; readonly id: SettingId; readonly name: string; readonly created: boolean }
  | { readonly kind: "plotline_defined"; readonly id: PlotLineId; readonly label: string; readonly created: boolean }
  | { readonly kind: "discipline_updated"; readonly version: string; readonly count: number }
  | { readonly kind: "chapter_planned"; readonly chapter: ChapterNo; readonly chapterType: string; readonly warnings: number }
  /** 谋篇模式出了一份方案。它不改动作品 —— 前端据此把中间区切到方案页等作者拍板。 */
  | {
      readonly kind: "proposal_ready";
      readonly id: string;
      readonly version: number;
      readonly scope: ProposalScope;
      readonly items: number;
      readonly summary: string;
    }
  /** 动作类工具被拒或失败（如采用一份未就绪草稿、写章 409）。让 Agent 如实转述。 */
  | { readonly kind: "action_failed"; readonly tool: string; readonly message: string };

/** 一条对话记录。user 回合无 effects；agent 回合可能带若干 effects。 */
export interface ConversationTurn {
  readonly role: "user" | "agent";
  readonly text: string;
  readonly at: IsoTimestamp;
  readonly effects?: readonly AgentEffect[];
}

/**
 * 备选想法（§7.3）。讨论中产生、用户认可后才可能进正式设定；本切片只负责记录，
 * 不自动转正 —— "只讨论一种可能性不改变正式设定"（首版验收场景）。
 */
export interface AlternativeIdea {
  readonly id: string;
  readonly text: string;
  readonly at: IsoTimestamp;
}

/** 持久化到 conversation.json 的整体形态。 */
export interface ConversationState {
  readonly turns: readonly ConversationTurn[];
  readonly ideas: readonly AlternativeIdea[];
  /**
   * 当前对话模式。存在后端而不是前端 localStorage —— 模式决定这一轮能不能写入，
   * 它得和工具集是同一份真相；刷新页面、换个标签页都不该把锁打开。
   */
  readonly mode: ConversationMode;
}

/** 一次 converse() 的返回：回复文本 + 本回合的 effects + 工具轮数（成本可见）。 */
export interface ConversationReply {
  readonly text: string;
  readonly effects: readonly AgentEffect[];
  readonly toolRounds: number;
  readonly mode: ConversationMode;
}
