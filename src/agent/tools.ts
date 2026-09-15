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
import { PREPARATION_INPUT_SCHEMA } from "../preparation/schema.js";
import { CORRECTION_VALUE_SCHEMAS } from "../chapter/c5-correction.js";

export const MAIN_AGENT_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: "prepare_text_export",
    description: "按作者要求准备已采用正文的 TXT 导出预览。scope=all 选择全部；scope=range 必须提供 from/to 正整数章号。返回固定的正式版本清单、未采用项和可打开的预览编号；只创建导出产物，不写章、不采用。之后新采用不会改变这份导出，需要新版时重新调用。没有已采用正文时说明可调整范围。",
    input_schema: { type: "object", additionalProperties: false, properties: {
      scope: { type: "string", enum: ["all", "range"] }, from: { type: "integer", minimum: 1 }, to: { type: "integer", minimum: 1 },
    }, required: ["scope"] },
  },
  {
    name: "get_story_progress",
    description: "读取故事安排与处理进度：未来规划、未处理、已安排、改期、放弃、部分兑现、已兑现，以及情节推进、人物出场和作者确认退场。返回具体章节、依据和历史。安排或改期不代表正文已解决；部分兑现仍需跟踪剩余承诺。只读，不启动写作或采用。",
    input_schema: { type: "object", additionalProperties: false, properties: {}, required: [] },
  },
  {
    name: "revise_chapter_draft",
    description: "按作者要求启动正文局部改写或未完成片段续写，保存新版本，随后核对与检查，不自动采用。先 get_chapter_draft 取得正文和 revisionToken。rewrite 必须以 scope.quote 指定精确原文，重复出现时 occurrence 从 0 开始；scope=null 仅用于作者明确允许修改整章。continue 仅追加并保留已有片段，scope=null。需要扩大范围时只返回建议。requestId 为本次操作稳定且唯一的字符串，重试沿用。返回 running 仅表示已启动，不等于已完成。",
    input_schema: { type: "object", additionalProperties: false, properties: {
      draftId: { type: "string" }, revisionToken: { type: "string" }, instruction: { type: "string" },
      requestId: { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" }, mode: { type: "string", enum: ["rewrite", "continue"] },
      scope: { anyOf: [{ type: "null" }, { type: "object", additionalProperties: false, properties: { quote: { type: "string" }, occurrence: { type: "integer", minimum: 0 } }, required: ["quote"] }] },
    }, required: ["draftId", "revisionToken", "instruction", "requestId", "mode", "scope"] },
  },
  {
    name: "get_chapter_draft",
    description: "读取确切稿件的完整正文、结构声明、检查、来源版本和 revisionToken。修改或纠错前必须读取；候选内容不能当成已采用事实。返回的原文和 token 是后续操作依据。",
    input_schema: { type: "object", properties: { draftId: { type: "string" } }, required: ["draftId"] },
  },
  {
    name: "correct_draft_structure",
    description: "作者要求正文保持、纠正误读的结构记录时调用。仅修改指定类别和索引，保留其他记录和整章正文，保存待检查新版本。先读 get_chapter_draft，沿用其 revisionToken；index 从 0 开始，等于类别数组长度时新增，value=null 删除。value 使用领域字段名，quote 必须真实存在，不能伪造锚点。随后检查新版本；未获采用授权时不要采用。",
    input_schema: { type: "object", properties: {
      draftId: { type: "string" }, revisionToken: { type: "string" }, summary: { type: "string" },
      changes: { type: "array", items: { type: "object", additionalProperties: false, properties: {
        section: { type: "string", enum: Object.keys(CORRECTION_VALUE_SCHEMAS) }, index: { type: "integer", minimum: 0 },
        occurrence: { type: "integer", minimum: 0 }, value: { anyOf: [...Object.values(CORRECTION_VALUE_SCHEMAS), { type: "null" }] },
      }, required: ["section", "index", "value"] } },
    }, required: ["draftId", "revisionToken", "summary", "changes"] },
  },
  {
    name: "check_chapter_draft",
    description: "启动已保存版本的后台检查，复用有效正文和结构，只补必要步骤。adoptOnSuccess=true 仅用于作者明确要求检查并采用；有 block 时保留结果，不采用。启动不等于完成。使用新版本返回的 revisionToken，失败恢复保留本次明确请求。",
    input_schema: { type: "object", properties: { draftId: { type: "string" }, revisionToken: { type: "string" }, adoptOnSuccess: { type: "boolean" }, selectedProposals: { type: "array", items: { type: "integer", minimum: 0 }, description: "仅检查并采用时，作者明确选择的写作建议索引；从 get_chapter_draft 的 proposalOptions 读取" } }, required: ["draftId", "revisionToken", "adoptOnSuccess"] },
  },
  {
    name: "list_chapter_tasks",
    description: "读取本作品的真实任务状态、稿件状态、步骤、字数和已报告用量。查看或返回页面不启动任何任务；没有活动执行的旧运行记录会显示 interrupted。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "control_chapter_task",
    description: "按确切 draftId 暂停、结束或恢复任务。pause/end 会阻止后续模型请求，当前请求返回后保留内容再生效，pausing/ending 不能说已经暂停/结束。resume 仅在作者明确要求继续时执行，已完成步骤不重跑，已结束任务不能静默恢复。",
    input_schema: { type: "object", properties: { draftId: { type: "string" }, action: { type: "string", enum: ["pause", "end", "resume"] } }, required: ["draftId", "action"] },
  },
  {
    name: "get_preparation",
    description: "读取作者已经指定/确认的作品设定、人物完整档案、地点组织、写作规则、情节线、章节计划、开写缺项与候选方案。准备作品或修改资料前先读，baseFingerprint 必须沿用本次读到的值。传 proposalId 则只读取那一份方案详情。",
    input_schema: { type: "object", properties: { proposalId: { type: "string" } }, required: [] },
  },
  {
    name: "propose_preparation",
    description: "保存一份有编号的资料/章节计划建议，不改变正式资料。changes 只填要改的类别，人物/地点/情节线按 ID 更新，章节按 chapter 更新；writingRules 是完整规则列表，更新偏好时保留仍适用的旧规则。人物 profile 和 speech 必须完整，未发生的出场不得编造。预算与来源由系统生成。先 get_preparation，再提交 baseFingerprint。展示建议后等待作者选择，不自行确认。",
    input_schema: PREPARATION_INPUT_SCHEMA,
  },
  {
    name: "confirm_preparation",
    description: "作者明确选择某方案后确认该方案。必须用确切 proposalId，不能仅因讨论、查看或含糊的继续就调用。若作者说按第二个方向直接写，确认所指方案后可继续 write_next_chapter。",
    input_schema: { type: "object", properties: { proposalId: { type: "string" } }, required: ["proposalId"] },
  },
  {
    name: "record_author_details",
    description: "直接记录作者明确指定的资料或写作偏好，例如“记住，以后台词少用感叹号”。只填作者已经说清的更改，不能夹带你补充的创意或代替作者选择方案。先 get_preparation 并沿用 baseFingerprint。writingRules 是完整列表，应保留其他仍适用规则。影响已有正文时只保留候选并说明影响。",
    input_schema: PREPARATION_INPUT_SCHEMA,
  },
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
    name: "plan_add_to_chapter",
    description:
      "把一项安排写进指定的未来已确认章节；targetChapter 省略时使用下一章。多章安排逐章调用，不能把其他章的安排算作已保存。what=resolution 收一条伏笔（需 foreshadowId/weight/completeness）；what=advance 推进情节线（需 plotLine）；what=character 安排人物出场（需 characterId）。这是计划态；主线回收可能升级章节类型并重算预算。",
    input_schema: {
      type: "object",
      properties: {
        what: { type: "string", enum: ["resolution", "advance", "character"] },
        targetChapter: { type: "integer", minimum: 1, description: "作者指定的未来章号；省略时使用下一章" },
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
      "启动下一章后台任务并立即返回任务编号；写完后交付待采用稿。启动不等于写完，需如实转述状态，不自行等待或重复启动。仅当用户明确要求写章时调用。作者只授权先试写时传具体 proposalId，基于该候选方案试写，采用章节时一并确认依赖。相同请求复用原任务或草稿。",
    input_schema: { type: "object", properties: { proposalId: { type: "string", description: "仅明确要求基于候选方案先试写时传入" } }, required: [] },
  },
  {
    name: "adopt_chapter",
    description:
      "采用一份已就绪（ready）的草稿，使其正文与结构变化成为正式创作依据。必须给出确切的 draftId。作者明确选择写作中补充的建议时，先 get_chapter_draft 展示 proposalOptions 的前后变化，沿用 revisionToken 和 selectedProposals 索引；未选择的建议不应用，未来伏笔仍是规划。含糊的继续不能用来采用。",
    input_schema: {
      type: "object",
      properties: { draftId: { type: "string", description: "草稿编号，如 ch53d1" }, revisionToken: { type: "string" }, selectedProposals: { type: "array", items: { type: "integer", minimum: 0 }, description: "作者明确选择的建议索引，从 0 开始；提供时必须同时提供 revisionToken" } },
      required: ["draftId"],
    },
  },
] as const;

/** 回归测试的期望顺序。改动工具集必须同步改这里，让测试逼你确认一次（§13.8 同款纪律）。 */
export const EXPECTED_MAIN_AGENT_TOOL_ORDER: readonly string[] = [
  "prepare_text_export",
  "get_story_progress",
  "revise_chapter_draft",
  "get_chapter_draft",
  "correct_draft_structure",
  "check_chapter_draft",
  "list_chapter_tasks",
  "control_chapter_task",
  "get_preparation",
  "propose_preparation",
  "confirm_preparation",
  "record_author_details",
  "get_overview",
  "list_chapter_drafts",
  "get_chapter_text",
  "get_character",
  "list_open_foreshadows",
  "get_next_plan",
  "plan_add_to_chapter",
  "plan_reschedule_foreshadow",
  "plan_abandon_foreshadow",
  "record_alternative_idea",
  "write_next_chapter",
  "adopt_chapter",
] as const;
