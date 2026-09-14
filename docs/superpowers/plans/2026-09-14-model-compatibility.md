# Model Compatibility Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans in the current agent. 用户要求单代理实现与复核，不使用子代理。

**Goal:** 国内官方模型与代理／聚合模型通过可配置的 Chat 协议完成对话、写章与恢复。

**Architecture:** 保留 ModelClient 工厂和 LangGraph；集中解析 Chat 能力配置，在 wire 层处理 JSON 与思考参数，在主 Agent 内部保存完整会话。旧 Gemini 默认行为不变。

**Tech Stack:** TypeScript、Node.js fetch、Vitest、本地 HTTP 测试、现有 React/Vite。

设计：`docs/superpowers/specs/2026-09-14-model-compatibility-design.md`。

## Task 1：配置与 Chat 协议能力

Files:
- Create: `src/client/chat-config.ts`
- Modify: `src/client/chat.ts`, `src/client/chat-wire.ts`, `src/client/create.ts`, `src/client/model.ts`
- Test: `test/model-config.test.ts`, `test/chat-client.test.ts`

- [x] 建立 `feat-model-compatibility` worktree，按锁文件安装依赖；基线 31 文件／602 测试通过。
- [x] 写失败测试：预设、能力覆盖、枚举/数字校验、不泄露配置、路径拼接、三种 JSON、思考字段、token cap、stream/usage、国内停止原因。
- [x] 运行 `npm.cmd test -- test/model-config.test.ts test/chat-client.test.ts --reporter=dot`，确认新增行为失败。
- [x] 实现 `chatOptionsFromEnv(env)` 和能力默认／校验；工厂和 ChatClient 共用。
- [x] wire 根据能力生成 response_format、JSON schema 提示及显式 thinking/effort。有效预算先限额，再选择流式。
- [x] 保持默认会话摘要兼容；思考配置加入非默认目标标记；资源不足／终止明确分类且不执行残缺工具。
- [x] 重跑目标测试与类型检查，确认旧 Gemini 用例通过。

## Task 2：主 Agent 完整历史

Files:
- Modify: `src/agent/types.ts`, `src/agent/conversation-store.ts`, `src/agent/service.ts`, `src/agent/tool-exec.ts`
- Test: `test/agent-service.test.ts`, `test/agent-tool-exec.test.ts`, `test/server-conversation.test.ts`
- Create: `test/chat-conversation.test.ts`

- [x] 写失败测试：工具与最终 assistant 的 reasoning_content 跨 Session 保存；HTTP API 无内部字段；旧历史／切换目标安全迁移。
- [x] 写失败测试：失败、截断和工具上限不回放未执行工具；回合内 idea 保留；并发 send 有序。
- [x] 运行对应测试，确认失败来自缺失功能。
- [x] 增加可选 ModelClient.conversationKey 与内部 modelHistory，只有 Chat 使用完整回放。
- [x] AgentLoopResult 返回完整、有效的模型历史；成功含最终 assistant，异常只保留完整前缀并加用户上下文说明。
- [x] 一次保存完整对话对及历史；同一个 store 串行处理回合。旧文件继续可读。
- [x] 目标测试和类型检查通过，单代理复核 effects、正式事实和会话隔离边界。

## Task 3：章节回归与配置文档

Files:
- Modify: `src/harness/chat-smoke.ts`, `test/chat-chapter.test.ts`, `.env.example`, `README.md`, `docs/gemini-chat.md`
- Create: `docs/model-configuration.md`

- [x] 为 DeepSeek 风格的 JSON Object、思考工具和 C5 失败后恢复添加本地 HTTP 回归；保留所有本地校验。
- [x] 实测工装使用与服务完全一致的环境配置，报告标题改为通用 Chat。
- [x] 文档写明协议支持范围、官方／代理样例、地址规则、可选参数与能力限制；不收录凭证。
- [x] 明确本轮为本地协议和工作流验证，DeepSeek 官方实测待用户提供对应凭证。

## Task 4：验证、交接与集成

- [x] 当前代理复核全部 diff，重点检查默认兼容、草稿恢复目标、完整思考回放、错误分支与 API 隔离。
- [x] `npm.cmd test -- --reporter=dot`、`npm.cmd run typecheck`、`npm.cmd run web:build` 全部通过。
- [x] 更新 `MEMORY.md` 最新入口和本轮进展／待办／实测边界。
- [x] 按持续授权提交、快进合入 master、推送；确认主目录数据和 Gemini 配置保留，清理已合入 worktree。

## 执行与复核记录

- 基线 602 项通过。第一批新增测试出现 29 个预期失败，配置与协议实现后通过；第二批 10 个预期失败覆盖完整历史和回合有序执行，修复后通过。
- 最终 32 个文件、650 项测试通过；类型检查与前端构建通过；无新增依赖。
- 当前代理自审：旧默认摘要、思考配置隔离、JSON 提示、异常工具前缀、ideas 保存和 API 内部字段隔离均已核对。测试类型标注问题已修正。
- 对真实 Gemini 旧稿的 2 个会话目标进行只读核对，新客户端与当前配置一致；本轮没有真实模型请求。
- 未提供 DeepSeek 官方凭证，真实官方验收留待对应配置可用后执行；本轮交付为协议与本地工作流兼容。
- 功能提交 `0a12c17` 已快进合入并推送到 origin/master；主目录复测 650 项、类型检查和前端构建均通过，工作分支与临时 worktree 已清理。
