/**
 * 谋篇模式的领域类型：方案（Proposal）。
 *
 * 与草稿同构 —— 草稿在事件流之外、采用时才展开；方案在资料之外、**采纳时才展开**。
 * 讨论期间一个字都不落盘，作者点「采纳整案」后系统才按条目逐条执行。
 *
 * 条目就是一次工具调用：`tool` + `input` 与常规对话里那个工具完全一致，采纳时还原成
 * tool_use 丢回 `executeMainTool`。所以编号仍由代码分配、plan_chapter 的两道闸与
 * V2 校验原样生效，没有第二套写入路径。
 */

import type { IsoTimestamp } from "../types/primitives.js";
import type { AgentEffect } from "./types.js";

/** 对话模式。planning 下工具集被裁成只读，唯一的出口是 propose_plan。 */
export type ConversationMode = "normal" | "planning";

/**
 * 方案条目可用的工具白名单：筹备 6 + 计划 3。
 *
 * 写章与采用**刻意不在内** —— 它们是作者当下的决定，也各自会产生要看的产物，
 * 打包进方案只会让「采纳」这一次点击的后果变得不可预期。
 */
export const PROPOSAL_TOOLS = [
  "set_direction",
  "upsert_character",
  "upsert_location",
  "define_plotline",
  "set_discipline",
  "plan_chapter",
  "plan_add_to_next_chapter",
  "plan_reschedule_foreshadow",
  "plan_abandon_foreshadow",
] as const;

export type ProposalTool = (typeof PROPOSAL_TOOLS)[number];

export function isProposalTool(v: unknown): v is ProposalTool {
  return typeof v === "string" && (PROPOSAL_TOOLS as readonly string[]).includes(v);
}

/**
 * 声明占位名的工具 → 它产出的编号前缀。
 *
 * 方案里的第 3 条要引用第 1 条新建的人物，但那时编号还不存在（§5.8 编号由代码分配）。
 * 于是第 1 条给 `ref: "沈砚"`，第 3 条写 `"@沈砚"`，执行到第 3 条时换成真编号。
 * 提案期做形状校验也要用它 —— 把占位替换成前缀正确的哨兵，才能过 parsePlan 的编号格式检查。
 */
export const REF_PREFIX: Readonly<Partial<Record<ProposalTool, "C" | "S" | "P">>> = {
  upsert_character: "C",
  upsert_location: "S",
  define_plotline: "P",
};

/** 方案里的一条动作。采纳时按数组顺序执行。 */
export interface ProposalItem {
  /** 本条新建对象的占位名，供后续条目以 `@占位名` 引用。只有新建类工具给得出。 */
  readonly ref?: string;
  readonly tool: ProposalTool;
  readonly input: Readonly<Record<string, unknown>>;
  /** 给作者看的一句话。方案页按它渲染，不展示 input。 */
  readonly note: string;
}

/** preparation = 从零筹备（新手冷启动）；revision = 已在写作中途的变更。由代码按筹备缺项判定，不让模型选。 */
export type ProposalScope = "preparation" | "revision";

/**
 * open 可采纳；adopted 全部执行完；partially_applied 中途失败、已落的保留。
 * 没有 rejected —— 作者不满意就让 Agent 重提一版（同 id、version +1），一次讨论只留一份最新方案。
 */
export type ProposalStatus = "open" | "adopted" | "partially_applied";

/** 执行停在第几条与原因。作者在方案页看得到，Agent 也据此重提剩余部分。 */
export interface ProposalFailure {
  readonly index: number;
  readonly tool: string;
  readonly message: string;
}

export interface Proposal {
  readonly id: string;
  /** 打回重改后重提递增。同一份方案的第几版。 */
  readonly version: number;
  readonly scope: ProposalScope;
  /** 给作者读的方案正文（markdown）。 */
  readonly summary: string;
  /** 这份方案会牵动的既有内容，每条一句。 */
  readonly impact: readonly string[];
  readonly items: readonly ProposalItem[];
  readonly status: ProposalStatus;
  readonly at: IsoTimestamp;
  readonly appliedAt?: IsoTimestamp;
  /** 采纳时真实发生的变化，与对话回合的 effects 同构。 */
  readonly appliedEffects?: readonly AgentEffect[];
  readonly failure?: ProposalFailure;
}

/** propose_plan 传上来的部分：id/version/scope/status 都由代码定。 */
export interface ProposalDraft {
  readonly summary: string;
  readonly impact: readonly string[];
  readonly items: readonly ProposalItem[];
}

/**
 * 谋篇提示里的「条目格式参考」。
 *
 * 谋篇模式下写类工具**不在工具集里**（只读锁是结构性的），模型看不到它们的 input_schema，
 * 这张表就是它唯一的字段来源。改工具入参必须同步改这里 —— 测试会逼你确认覆盖面。
 */
export const PROPOSAL_TOOL_FIELDS: Readonly<Record<ProposalTool, string>> = {
  set_direction:
    "premise, centralConflict, pov(first|third_limited|third_omniscient), tense(past|present), protagonistTraits[], protagonistForbidden[], specialAbility, abilityLimits[], worldRules[], openingSituation, styleKeywords[], romanceLine, taboos[]｜只传要改的字段，数组整体替换",
  upsert_character:
    "name, tier(protagonist|major|minor|extra), role, aliases[], traits[], forbiddenBehaviors[], wants, fears, background, appearance[{key,value,immutable?}], speech{sentenceLength{min,max}, verbalTics[], signatureLexicon[], forbiddenLexicon[], addressForms[{target,form,condition?}], syntaxBias{question,imperative,elliptical}, register, emotionalExpression, exemplars[], counterExemplars[]}｜新建给 ref，不传 id",
  upsert_location: "name, kind(location|organization), description, facts[]｜新建给 ref，不传 id",
  define_plotline: "label, weight(main|sub|detail)｜新建给 ref，不传 id",
  set_discipline: "rules[]｜整体替换，先读 get_direction 再把完整列表写进来",
  plan_chapter:
    "chapter(默认下一章), chapterType(transition|setup|event|payoff|climax), coreEvent, secondaryThread, stageFeedback, hook, events[{kind(action|info|relation|resource|decision), summary, weight(1|2|3), plotLine}], resolves[{foreshadowId,weight,completeness}], plants[{label,weight}], characters[], locations[]｜characters/locations/plotLine 填编号或 @占位名",
  plan_add_to_next_chapter:
    "what(resolution|advance|character) 及其所需字段：resolution 要 foreshadowId+weight+completeness，advance 要 plotLine，character 要 characterId",
  plan_reschedule_foreshadow: "foreshadowId, expectedBy(章号)",
  plan_abandon_foreshadow: "foreshadowId, reason",
};
