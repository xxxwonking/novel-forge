/**
 * 主 Agent 的工具集（Stage 2·切片 1）。
 *
 * 与 `context/tools.ts`（章内写作工具，排在缓存前缀最前、顺序是硬约束）**不同** ——
 * 这是**对话编排**的工具，不走缓存装配路径。但仍固定顺序、由 EXPECTED 常量守住，
 * 保持与写作工具同一套纪律（改动工具集必须同步改 EXPECTED，测试逼你确认一次）。
 *
 * 三类，副作用策略分明：
 *   读类（get_/list_）—— 零副作用，从项目快照取数。
 *   计划类（plan_）—— 改下一章节拍表 / 伏笔安排，属"计划态"（§7.3），非正式正文事实。
 *   任务类（write_/adopt_）—— 走 ProjectSession 受控入口：写章产出草稿（proposed），
 *     采用按版本、幂等。Agent 永不直接改正式事实（§12.0）。
 */

import type Anthropic from "@anthropic-ai/sdk";

export const MAIN_AGENT_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: "get_overview",
    description:
      "读取当前作品概览：书名、题材、平台、写到第几章、下一章是第几章、下一章计划是否就绪、待处理草稿数、需要处理的结构问题数。回答“写到哪了/接下来能做什么”时先调用。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_chapter_drafts",
    description:
      "列出某一章的全部草稿及其状态（writing/declaring/checking/needs_revision/ready/adopted/…）。用户说“采用”“继续”而当前有待采用稿时，先用它确认有哪些版本、哪一版可采用。不传 chapter 时默认下一章。",
    input_schema: {
      type: "object",
      properties: { chapter: { type: "integer", description: "章号，默认下一章" } },
      required: [],
    },
  },
  {
    name: "get_chapter_text",
    description: "读取某一章已采用的正文，用于核对已发生的事实。excerpt：full 全文 / head 前三分之一 / tail 后三分之一，默认 full。",
    input_schema: {
      type: "object",
      properties: {
        chapter: { type: "integer", description: "章号" },
        excerpt: { type: "string", enum: ["full", "head", "tail"], description: "默认 full" },
      },
      required: ["chapter"],
    },
  },
  {
    name: "get_character",
    description: "读取一位人物的档案（外貌、性格、说话方式、当前状态）。回答关于某人物的问题、或规划涉及该人物时调用。",
    input_schema: {
      type: "object",
      properties: { name: { type: "string", description: "人物姓名或别名" } },
      required: ["name"],
    },
  },
  {
    name: "list_open_foreshadows",
    description: "列出未收伏笔及其完整意图（intent）。按 weight 筛选：main/sub/detail/all，默认 all。安排“把某条线索收进下一章”前先看它。",
    input_schema: {
      type: "object",
      properties: { weight: { type: "string", enum: ["main", "sub", "detail", "all"], description: "默认 all" } },
      required: [],
    },
  },
  {
    name: "get_next_plan",
    description: "读取下一章的节拍表（章节类型、核心事件、要收的伏笔、点名人物、派生字数预算）。写下一章或讨论下一章方向前调用。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "plan_add_to_next_chapter",
    description:
      "把一项安排写进下一章节拍表（计划态，不是已发生的事实）。what=resolution 收一条伏笔（需 foreshadowId/weight/completeness）；what=advance 推进一条情节线（需 plotLine）；what=character 让某人物在下一章出场（需 characterId）。收一条主线伏笔会把该章升级为回收章并放宽字数预算。",
    input_schema: {
      type: "object",
      properties: {
        what: { type: "string", enum: ["resolution", "advance", "character"] },
        foreshadowId: { type: "string" },
        weight: { type: "string", enum: ["main", "sub", "detail"] },
        completeness: { type: "string", enum: ["full", "partial"] },
        plotLine: { type: "string" },
        characterId: { type: "string" },
      },
      required: ["what"],
    },
  },
  {
    name: "plan_reschedule_foreshadow",
    description: "更新一条伏笔的预期收束章号（改期）。伏笔仍未兑现，只是把截止时间挪后。",
    input_schema: {
      type: "object",
      properties: {
        foreshadowId: { type: "string" },
        expectedBy: { type: "integer", description: "新的预期收束章号" },
      },
      required: ["foreshadowId", "expectedBy"],
    },
  },
  {
    name: "plan_abandon_foreshadow",
    description: "把一条伏笔标记为废弃（作者决定不再兑现）。保留决定与历史，不显示为已兑现。",
    input_schema: {
      type: "object",
      properties: {
        foreshadowId: { type: "string" },
        reason: { type: "string", description: "废弃原因，可空" },
      },
      required: ["foreshadowId"],
    },
  },
  {
    name: "record_alternative_idea",
    description:
      "把讨论中的一个想法记为“备选”（§7.3）。仅当用户明确要求“记下来/记为备选”时调用；只讨论一种可能性时不要记，更不要改动正式设定。",
    input_schema: {
      type: "object",
      properties: { text: { type: "string", description: "备选想法的一句话描述" } },
      required: ["text"],
    },
  },
  {
    name: "write_next_chapter",
    description:
      "按已确认的下一章节拍表发起写章任务，产出一份待采用草稿（正文+结构声明+检查）。仅当用户明确要求写章时调用；查询、讨论、规划都不要调用它。若已有正在生成的任务，会返回其进度而非另起一轮。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "adopt_chapter",
    description:
      "采用一份已就绪（ready）的草稿，使其正文与结构变化成为正式创作依据。必须给出确切的 draftId（先用 list_chapter_drafts 确认）。含糊的“继续”不要调用它——先向用户确认采用哪一版。",
    input_schema: {
      type: "object",
      properties: { draftId: { type: "string", description: "草稿编号，如 ch53d1" } },
      required: ["draftId"],
    },
  },
] as const;

/** 回归测试的期望顺序。改动工具集必须同步改这里，让测试逼你确认一次（§13.8 同款纪律）。 */
export const EXPECTED_MAIN_AGENT_TOOL_ORDER: readonly string[] = [
  "get_overview",
  "list_chapter_drafts",
  "get_chapter_text",
  "get_character",
  "list_open_foreshadows",
  "get_next_plan",
  "plan_add_to_next_chapter",
  "plan_reschedule_foreshadow",
  "plan_abandon_foreshadow",
  "record_alternative_idea",
  "write_next_chapter",
  "adopt_chapter",
] as const;
