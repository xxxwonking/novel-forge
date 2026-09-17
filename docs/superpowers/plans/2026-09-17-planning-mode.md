# 谋篇模式：作者可切入的只读讨论态，方案层复用 PreparationService

2026-09-17 / 分支 `planning-mode-on-master` / 基线 master `c65a314`

## 目标

借鉴开源编码工具的 plan 模式：新手不知道写什么，要先和 AI 规划再定方案；熟手写到中途冒出灵感，也要先讨论再定。现有对话靠提示词说「讨论可能性时不改动设定」，没有代码层的锁；`PREPARATION_DRAFT_TOOLS` 那套只读工具集只给「让 AI 起草」按钮用，作者切不进去。

## 复用什么（不重做）

master 的 `PreparationService` 已经是完整的方案层：有编号方案、版本指纹（资料变了自动 stale）、代码算出的 impacts、节拍校验 findings、资料页的确认/试写/丢弃。谋篇模式只补三样：**作者能切进去的只读模式**、**新手冷启动的带法**、**中途灵感先读再提的纪律**。

## 范围决策

- 模式存后端 `conversation.json`：它决定这一轮能不能写入，必须与工具集是同一份真相；刷新页面不能把锁打开。
- 只读锁两道：`PLANNING_MODE_TOOLS` 裁掉写类；`executeMainTool` 按 mode 兜底。
- 谋篇用 creative 角色；chat provider 单模型时无区别，只在 Claude provider 生效。
- 方案的采纳/丢弃留在资料页，对话里不确认 —— `confirm_preparation` 不进谋篇工具集。
- scope 由 `readiness.missing` 判定，不让模型选：非空 → preparation 从零带；空 → revision 先读再提。
- 伏笔改期/废弃、章节安排（`plan_*`）不进方案 —— 它们是计划态动作，退出谋篇再做。

## 实现

- `src/agent/types.ts` / `conversation-store.ts`：`ConversationMode`、`ConversationState.mode`、`ConversationReply.mode`、`mode()` / `setMode()`。
- `src/agent/tools.ts`：`PLANNING_MODE_TOOLS`（读类 + `record_alternative_idea` + `propose_preparation`）、`PLANNING_ALLOWED_TOOLS`、`EXPECTED_PLANNING_MODE_TOOL_ORDER`。
- `src/agent/tool-exec.ts`：`executeMainTool(block, ctx, mode)`、`runAgentLoop(..., mode)`。
- `src/agent/service.ts`：`MODE_PROFILE`；`deps.maxPlanningRounds`。
- `src/agent/system-prompt.ts`：`MainAgentContextInfo.readinessMissing`；`buildMainAgentSystem(info, mode)` 谋篇分支。
- `src/server/state.ts` / `api.ts`：`conversationMode` / `setConversationMode`；`POST /api/conversation/mode`；GET 带 `mode`。
- `rules.yaml` + schema/load：`agent.maxPlanningRounds`。
- Web：`Chat.tsx` 栏头 Segmented、谋篇态样式与起手句；`api.ts`。

## 验证

先写失败测试：`test/agent-planning-mode.test.ts`（工具集、兜底、提示分支、服务按模式选工具）、`test/server-conversation.test.ts` 补端点与「谋篇回合出方案但资料不动」。四件套 + 浏览器端到端（脚本化客户端，0 次真实调用）。
