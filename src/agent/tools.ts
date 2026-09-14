/**
 * 主 Agent 的工具集（Stage 2·切片 1；谋篇模式加入只读工具集）。
 *
 * 与 `context/tools.ts`（章内写作工具，排在缓存前缀最前、顺序是硬约束）**不同** ——
 * 这是**对话编排**的工具，不走缓存装配路径。但仍固定顺序、由 EXPECTED 常量守住，
 * 保持与写作工具同一套纪律（改动工具集必须同步改 EXPECTED，测试逼你确认一次）。
 *
 * 四类，副作用策略分明：
 *   读类（get_/list_）—— 零副作用，从项目快照取数。
 *   筹备类（set_/upsert_/define_/plan_chapter，切片 2）—— 改 L1/资料/节拍，authored 可信度，
 *     编号由代码分配（§5.8）；不入事件流。
 *   计划类（plan_）—— 改下一章节拍表 / 伏笔安排，属"计划态"（§7.3），非正式正文事实。
 *   任务类（write_/adopt_）—— 走 ProjectSession 受控入口：写章产出草稿（proposed），
 *     采用按版本、幂等。Agent 永不直接改正式事实（§12.0）。
 *
 * 谋篇模式另有一套工具集（`PLANNING_MODE_TOOLS`）：只留读类与 propose_plan，
 * 写类工具**不在数组里**，模型无从调用 —— 只读锁是结构性的，不靠提示词约束。
 */

import type Anthropic from "@anthropic-ai/sdk";
import { PROPOSAL_TOOLS } from "./proposal-types.js";

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
    name: "get_direction",
    description:
      "读取作品方向与写作纪律的当前全文：前提、核心冲突、视角/时态、主角性格与禁忌、金手指及其限制、世界观要点、开局情境、风格关键词、感情线、禁忌、目标字数，以及写作纪律条目。修改这些内容前先读，避免覆盖已有条目。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "set_direction",
    description:
      "设定或修改作品方向（作品级设定，整本书恒定）。只传要改的字段；数组字段整体替换，先 get_direction 读现状再改。书名/题材/平台不在此改。仅当作者明确表达了决定时调用，讨论可能性时不要调用。",
    input_schema: {
      type: "object",
      properties: {
        premise: { type: "string", description: "全书要讲的一句话" },
        centralConflict: { type: "string", description: "核心冲突" },
        pov: { type: "string", enum: ["first", "third_limited", "third_omniscient"], description: "叙事视角" },
        tense: { type: "string", enum: ["past", "present"] },
        protagonistTraits: { type: "array", items: { type: "string" }, description: "主角性格标签" },
        protagonistForbidden: { type: "array", items: { type: "string" }, description: "主角明确禁止的行为" },
        specialAbility: { type: "string", description: "金手指/特殊能力" },
        abilityLimits: { type: "array", items: { type: "string" }, description: "能力的限制（无限制即无冲突）" },
        worldRules: { type: "array", items: { type: "string" }, description: "世界观要点，每条一句" },
        openingSituation: { type: "string", description: "故事起点的时间与地点（故事内时间）" },
        styleKeywords: { type: "array", items: { type: "string" } },
        romanceLine: { type: "string", description: "感情线定位" },
        taboos: { type: "array", items: { type: "string" }, description: "这本书绝对不写的东西" },
      },
      required: [],
    },
  },
  {
    name: "upsert_character",
    description:
      "新建或修改一张人物卡。新建：不传 id，必给 name 与 tier，编号由系统分配（C01、C02…）；修改：传 id（同名也视为同一人物），只传要改的字段，数组字段整体替换。speech 是可被机器检查的说话方式，尽量给 exemplars（真实例句）。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "人物编号，仅修改时传" },
        name: { type: "string" },
        aliases: { type: "array", items: { type: "string" } },
        tier: { type: "string", enum: ["protagonist", "major", "minor", "extra"], description: "出场权重" },
        role: { type: "string", description: "一句话定位" },
        appearance: {
          type: "array",
          description: "可比对的外貌属性",
          items: {
            type: "object",
            properties: {
              key: { type: "string", description: "如 眼睛颜色 / 惯用手" },
              value: { type: "string" },
              immutable: { type: "boolean", description: "不可变属性 true（瞳色），会变的 false（伤势）；默认 true" },
            },
            required: ["key", "value"],
          },
        },
        traits: { type: "array", items: { type: "string" }, description: "性格标签" },
        forbiddenBehaviors: { type: "array", items: { type: "string" }, description: "明确禁止的行为" },
        wants: { type: "string", description: "表层诉求" },
        fears: { type: "string", description: "深层恐惧" },
        background: { type: "string" },
        speech: {
          type: "object",
          properties: {
            sentenceLength: {
              type: "object",
              description: "台词句长区间（字）",
              properties: { min: { type: "integer" }, max: { type: "integer" } },
              required: ["min", "max"],
            },
            verbalTics: { type: "array", items: { type: "string" }, description: "口头习惯语" },
            signatureLexicon: { type: "array", items: { type: "string" }, description: "专属词汇" },
            forbiddenLexicon: { type: "array", items: { type: "string" }, description: "禁用词" },
            addressForms: {
              type: "array",
              description: "称谓表",
              items: {
                type: "object",
                properties: {
                  target: { type: ["string", "null"], description: "目标人物编号，null 表示对所有人的默认称谓" },
                  form: { type: "string" },
                  condition: { type: "string", description: "仅在特定情境下使用，可空" },
                },
                required: ["target", "form"],
              },
            },
            syntaxBias: {
              type: "object",
              description: "句式占比目标（0-1）",
              properties: { question: { type: "number" }, imperative: { type: "number" }, elliptical: { type: "number" } },
              required: ["question", "imperative", "elliptical"],
            },
            register: { type: "string", enum: ["vulgar", "colloquial", "neutral", "formal", "literary", "archaic"], description: "语域" },
            emotionalExpression: { type: "string", enum: ["suppressed", "direct", "ironic", "explosive", "oblique"], description: "情绪表达方式" },
            exemplars: { type: "array", items: { type: "string" }, description: "正例台词 2-5 条" },
            counterExemplars: { type: "array", items: { type: "string" }, description: "反例台词 0-3 条" },
          },
          required: [],
        },
      },
      required: [],
    },
  },
  {
    name: "upsert_location",
    description:
      "新建或修改一个地点/组织设定卡。新建：不传 id，必给 name，编号由系统分配（S01…）；修改：传 id（同名视为同一处），只传要改的字段。facts 是可核对的事实条目，整体替换。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "编号，仅修改时传" },
        name: { type: "string" },
        kind: { type: "string", enum: ["location", "organization"], description: "默认 location" },
        description: { type: "string" },
        facts: { type: "array", items: { type: "string" }, description: "可核对的事实，每条一句" },
      },
      required: [],
    },
  },
  {
    name: "define_plotline",
    description:
      "定义或修改一条情节线（主线/支线/细节线），编号由系统分配（P01…）；修改时传 id 或同名 label。节拍表里的事件要归属到情节线，先定义再排章。",
    input_schema: {
      type: "object",
      properties: {
        id: { type: "string", description: "编号，仅修改时传" },
        label: { type: "string", description: "情节线名称" },
        weight: { type: "string", enum: ["main", "sub", "detail"], description: "默认 sub" },
      },
      required: [],
    },
  },
  {
    name: "set_discipline",
    description:
      "整体替换写作纪律条目（全书写作时常驻的硬规则，如视角纪律、禁写句式）。先 get_direction 读现有条目，改动后把完整列表传回；版本号由系统递增。",
    input_schema: {
      type: "object",
      properties: { rules: { type: "array", items: { type: "string" }, description: "完整的纪律条目列表" } },
      required: ["rules"],
    },
  },
  {
    name: "plan_chapter",
    description:
      "为某一章排节拍表（默认下一章），整体覆盖该章现有计划。events 每条要归属情节线；characters/locations 引用已存在的编号。写入前做合规校验：阶段反馈写“继续铺垫”类推迟、章末钩子用“更大的风暴”类空钩会被打回，需重填。仅当作者确认了本章安排时调用。",
    input_schema: {
      type: "object",
      properties: {
        chapter: { type: "integer", description: "章号，默认下一章" },
        chapterType: { type: "string", enum: ["transition", "setup", "event", "payoff", "climax"] },
        coreEvent: { type: "string", description: "核心事件一句话" },
        secondaryThread: { type: "string", description: "次级推进，可空" },
        stageFeedback: { type: "string", description: "本章给读者的具体兑现或升级" },
        hook: { type: "string", description: "章末钩子：具体的动作、信息或抉择落点" },
        events: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: { type: "string", enum: ["action", "info", "relation", "resource", "decision"] },
              summary: { type: "string", description: "含具体变化的一句话" },
              weight: { type: "integer", enum: [1, 2, 3], description: "3 改变全书格局 / 2 改变本卷局面 / 1 局部推进" },
              plotLine: { type: ["string", "null"], description: "归属情节线编号" },
            },
            required: ["kind", "summary", "weight"],
          },
        },
        resolves: {
          type: "array",
          description: "本章要收的伏笔（须是已埋设的未收伏笔）",
          items: {
            type: "object",
            properties: {
              foreshadowId: { type: "string" },
              weight: { type: "string", enum: ["main", "sub", "detail"] },
              completeness: { type: "string", enum: ["full", "partial"] },
            },
            required: ["foreshadowId", "weight", "completeness"],
          },
        },
        plants: {
          type: "array",
          description: "本章计划要埋的伏笔",
          items: {
            type: "object",
            properties: { label: { type: "string" }, weight: { type: "string", enum: ["main", "sub", "detail"] } },
            required: ["label", "weight"],
          },
        },
        characters: { type: "array", items: { type: "string" }, description: "出场人物编号" },
        locations: { type: "array", items: { type: "string" }, description: "场景编号" },
      },
      required: ["chapterType", "coreEvent", "stageFeedback", "hook"],
    },
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
      "按已确认的下一章节拍表发起写章任务，产出一份待采用草稿（正文+结构声明+检查）。任务内部会按检查结果自动修订，次数有上限；到上限仍未通过就停在 needs_revision 交作者处理。仅当用户明确要求写章时调用；查询、讨论、规划都不要调用它。该章已有待处理草稿时会原样返回那份草稿而不重写——要重来用 rewrite_chapter_draft。",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "rewrite_chapter_draft",
    description:
      "放弃当前待处理草稿的内容，为同一章从头另写一版（新的 draftId，旧稿保留可查）。这是作者对一份未就绪/不满意草稿唯一的“再来一次”手段——你没有其他修改草稿的工具，不要承诺“我再优化一下”。仅当用户明确要求重写/再写一版时调用。",
    input_schema: {
      type: "object",
      properties: { chapter: { type: "number", description: "章号，缺省为下一章" } },
      required: [],
    },
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
  "get_direction",
  "set_direction",
  "upsert_character",
  "upsert_location",
  "define_plotline",
  "set_discipline",
  "plan_chapter",
  "plan_add_to_next_chapter",
  "plan_reschedule_foreshadow",
  "plan_abandon_foreshadow",
  "record_alternative_idea",
  "write_next_chapter",
  "rewrite_chapter_draft",
  "adopt_chapter",
] as const;

// ── 谋篇模式 ────────────────────────────────────────────────────────────

/**
 * 谋篇模式下仍可调用的既有工具。
 *
 * 七个读类之外留了 `record_alternative_idea`：它写的是对话域的备选清单，不碰作品 ——
 * 而只读锁要守的是「不改动作品」。讨论中冒出的岔路当场记下来，正是谋篇该干的事。
 */
const PLANNING_KEPT_TOOLS: readonly string[] = [
  "get_overview",
  "list_chapter_drafts",
  "get_chapter_text",
  "get_character",
  "list_open_foreshadows",
  "get_next_plan",
  "get_direction",
  "record_alternative_idea",
];

/** 谋篇模式下允许执行的工具名。tool-exec 的兜底照它判 —— 工具集之外的第二道。 */
export const PLANNING_ALLOWED_TOOLS: ReadonlySet<string> = new Set([...PLANNING_KEPT_TOOLS, "propose_plan"]);

const PROPOSE_PLAN_TOOL: Anthropic.Tool = {
  name: "propose_plan",
  description:
    "把这次讨论收敛成一份方案交作者拍板。**方案本身不改动任何东西** —— 作者点「采纳」后系统才按 items 顺序执行。" +
    "summary 写给作者看：这份方案要做什么、为什么这么安排，用 markdown。" +
    "impact 写它会牵动哪些既有内容（已埋未收的伏笔、已排的章节计划、已定的设定），每条一句；确实没有就给空数组。" +
    "items 是采纳时要执行的动作，每条对应一次筹备或计划工具调用，按依赖排好顺序（先建人物再排章）。" +
    "新建人物/地点/情节线的条目给 ref 起个占位名（如 沈砚），后面的条目用 \"@沈砚\" 引用它 —— 编号由系统在执行时分配，你不要自造。" +
    "作者还在犹豫、或关键信息不足时不要调用它，先把问题问清楚。已有方案时再次调用就是提交修改后的新一版。",
  input_schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "给作者看的方案正文" },
      impact: { type: "array", items: { type: "string" }, description: "会牵动的既有内容，每条一句" },
      items: {
        type: "array",
        description: "采纳时按顺序执行的动作",
        items: {
          type: "object",
          properties: {
            ref: { type: "string", description: "本条新建对象的占位名，供后续条目以 @占位名 引用；不新建就不传" },
            tool: { type: "string", enum: [...PROPOSAL_TOOLS], description: "要执行的工具" },
            input: { type: "object", description: "该工具的入参，字段见系统提示里的「条目格式」" },
            note: { type: "string", description: "这一条做什么，给作者看的一句话" },
          },
          required: ["tool", "input", "note"],
        },
      },
    },
    required: ["summary", "items"],
  },
};

/** 谋篇模式的工具集：读类 + 备选 + propose_plan。写类不在其中，模型无从调用。 */
export const PLANNING_MODE_TOOLS: readonly Anthropic.Tool[] = [
  ...MAIN_AGENT_TOOLS.filter((t) => PLANNING_KEPT_TOOLS.includes(t.name)),
  PROPOSE_PLAN_TOOL,
];

/** 同 EXPECTED_MAIN_AGENT_TOOL_ORDER：改动即改这里。 */
export const EXPECTED_PLANNING_MODE_TOOL_ORDER: readonly string[] = [
  "get_overview",
  "list_chapter_drafts",
  "get_chapter_text",
  "get_character",
  "list_open_foreshadows",
  "get_next_plan",
  "get_direction",
  "record_alternative_idea",
  "propose_plan",
] as const;
