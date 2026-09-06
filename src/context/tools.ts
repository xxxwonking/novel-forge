/**
 * 段 0：工具定义（§13.2）。
 *
 * 顺序是硬约束 —— 它排在缓存前缀最前面，一旦变动整个缓存全冷。
 * 三条禁令（§13.2）：
 *   ❌ 不用 Object.keys()/values()/动态 map 生成 —— 顺序不保证
 *   ❌ 不按条件增删（"这章不需要地点工具就不给"）
 *   ❌ description 里不插动态内容（`当前共 ${n} 人` 会让每次人数变化冷掉全部缓存）
 *
 * 这个模块刻意不 import 任何状态类型，从物理上杜绝把动态值写进 description。
 */

import type Anthropic from "@anthropic-ai/sdk";

/**
 * 写作工具集。**模块顶层常量，绝不动态生成。**
 *
 * 全部是读类工具 + 提议类工具 —— §4.2：写小说 agent 不需要代码执行，
 * 也不允许直接改状态（§12.0 一切模型产出先进待接受区）。
 */
export const WRITING_TOOLS: readonly Anthropic.Tool[] = [
  {
    name: "load_character",
    description:
      "读取一位人物的完整档案（外貌、性格、说话方式、当前状态）。当你需要写某个人物的台词或行动，而 L2 名录那一行不足以支撑时调用。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "人物姓名或别名" },
      },
      required: ["name"],
    },
  },
  {
    name: "load_setting",
    description: "读取一个地点或组织的设定详情。写到未在本章上下文中给出的场景时调用。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "地点或组织名称" },
      },
      required: ["name"],
    },
  },
  {
    name: "load_chapter",
    description:
      "读取某一章的正文。用于确认较早章节的具体写法，例如要收的伏笔当初是怎么埋的。返回内容较长，仅在确有必要时调用。",
    input_schema: {
      type: "object",
      properties: {
        chapter: { type: "integer", description: "章号" },
        excerpt: {
          type: "string",
          enum: ["full", "head", "tail"],
          description: "full 全文，head 前三分之一，tail 后三分之一。默认 full。",
        },
      },
      required: ["chapter"],
    },
  },
  {
    name: "list_open_foreshadows",
    description:
      "列出未收伏笔的完整意图（intent）。L2 索引只给了标签，需要知道某条伏笔具体埋的是什么意图时调用。",
    input_schema: {
      type: "object",
      properties: {
        weight: {
          type: "string",
          enum: ["main", "sub", "detail", "all"],
          description: "按权重筛选，默认 all",
        },
      },
      required: [],
    },
  },
  {
    name: "propose_character_update",
    description:
      "提议修改人物档案的设定字段（不是当前状态）。例如本章揭示了该人物其实是左撇子。提议进入待确认区，由作者裁决，不会直接改档案。",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "人物姓名" },
        field: { type: "string", description: "字段路径，如 profile.appearance.惯用手" },
        value: { type: "string", description: "建议的新值" },
        reason: { type: "string", description: "为什么需要改，引用本章依据" },
      },
      required: ["name", "field", "value", "reason"],
    },
  },
  {
    name: "propose_foreshadow",
    description:
      "在写作过程中提议一条本章之外的伏笔安排（例如发现某条线需要提前预收）。提议进入待确认区，不影响本章的结构声明。",
    input_schema: {
      type: "object",
      properties: {
        label: { type: "string", description: "伏笔短标签" },
        intent: { type: "string", description: "作者意图：这条伏笔将来要兑现什么" },
        weight: { type: "string", enum: ["main", "sub", "detail"] },
        expected_by: { type: "integer", description: "打算在第几章之前收" },
      },
      required: ["label", "intent", "weight", "expected_by"],
    },
  },
] as const;

/** §13.8 回归测试的期望顺序。改动工具集必须同步改这里，让测试逼你确认一次。 */
export const EXPECTED_TOOL_ORDER: readonly string[] = [
  "load_character",
  "load_setting",
  "load_chapter",
  "list_open_foreshadows",
  "propose_character_update",
  "propose_foreshadow",
] as const;
