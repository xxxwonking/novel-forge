# 谋篇模式：对话里先出方案，确认才落盘

2026-09-14 / 分支 `stage2-chat-dock` / 基线 `dc0d2f2`

## 目标

对话现在是「说一句 → 立刻落盘」。两类作者在这条路上走不通：

- **新手**：刚建完书，不知道要写什么。现在的对话会追着他问「前提是什么」，而他要的是有人陪着想。
- **熟手**：写到中途冒出灵感，想先把影响推演清楚再定。现在只要话说得像决定，模型就把设定改了。

补一个**谋篇模式**：模式内只读不写，讨论收敛成一份**方案**，作者点采纳才一次性落盘。

## 借鉴什么

借鉴开源编码工具的 plan 模式，取的是四条机制，不是它的界面：模式显式可见；模式内工具集**在代码层**裁成只读；讨论收敛成一份可读的方案；单点确认才执行。

第二、四条在本项目里已有同构物 —— **草稿在事件流之外，采用时才展开**。谋篇模式是它的平移：**方案在资料之外，采纳时才展开**。不引入新的概念层。

命名避开已有的 `plan_chapter` / `get_next_plan` / 「计划类工具」：对外叫**谋篇模式**与**方案**，内部标识 `planning` / `Proposal`。

## 范围决策

- **整案采纳，不做勾选式部分采纳。** 方案内部有依赖（首章节拍引用方案里新建的人物），勾掉一条就断。作者不满意就在对话里说，Agent 重提一版（`version` +1），与既有的「关键变化采用时打包确认」一致。
- **谋篇模式用 creative（opus），常规对话仍用 judge（haiku）。** 「不知道写什么」要的是出点子，判定型模型给不出。执行落盘不花模型钱，成本只在讨论回合。
- **执行器复用 `executeMainTool`，不写第二套写入路径。** 方案条目就是一次工具调用，采纳时还原成 `tool_use` 丢回既有执行器 —— 编号仍由代码分配、`plan_chapter` 的两道闸与 V2 校验原样生效、effect→chip 链路直接复用。
- **失败即停，不回滚。** 已落的保留（筹备类本就是幂等 upsert），提案转 `partially_applied`，失败项转述回对话让 Agent 重提剩余部分。资料层没有事务，全回滚的代价不值得。
- **不做深度一致性检查。** 中途改设定是否与已发生正文冲突，由模型在 `impact` 里声明，代码只轻校验引用的编号存在。真正的一致性诊断是 M4 的事。

## 实现

### T1 提案领域层
- `src/agent/proposal-types.ts`：`ConversationMode`（`normal` | `planning`）、`ProposalTool`（白名单：筹备 6 + 计划 3）、`ProposalItem`（`ref?` / `tool` / `input` / `note`）、`Proposal`（`id` / `version` / `scope` / `summary` / `impact` / `items` / `status` / `appliedEffects` / `failure`）。
- `src/agent/proposal-store.ts`：`proposals.json`（整份重写，同 `conversation-store`），`create` / `load` / `list` / `replace`（打回重提保留旧版本号 +1）/ `markApplied`。
- `src/agent/proposal-exec.ts`：`applyProposal(p, ctx)` 顺序执行；`resolveRefs` 把 `@名字` 占位换成前面条目实际产出的编号（从 `character_upserted.id` 等 effect 回读）；失败即停并回 `{ status, applied, failedAt, message }`。

### T2 只读锁与 `propose_plan`
- `tools.ts`：新增 `propose_plan`（`summary` / `impact` / `items[]`），导出 `PLANNING_MODE_TOOLS = 读类 7 + propose_plan`，`EXPECTED_MAIN_AGENT_TOOL_ORDER` 同步。
- `tool-exec.ts`：`MainAgentToolContext` 加 `mode` 与 `proposePlan`；执行前若 `mode === "planning"` 且命中写类工具，直接 `is_error` 兜底（工具集已裁过，这是防将来改错的第二道）。
- `conversation-store.ts`：`ConversationState.mode` 持久化（模式是对话的属性，刷新不丢）。
- `service.ts`：按模式选工具集、模型角色、轮数上限。

### T3 系统提示
- `system-prompt.ts` 按模式分支。谋篇模式下：不写入的声明；`scope` 判定（`prepGaps` 非空 → preparation，否则 revision）；preparation 给提问顺序（一句话冲动 → 主角 → 核心冲突 → 开局情境 → 人物/场景/情节线 → 首章节拍），一次只推进一个分歧；revision 要求先读再提、`impact` 必须回答牵动哪些未收伏笔与哪几章计划。

### T4 服务端
- `state.ts`：`conversationMode()` / `setConversationMode()` / `listProposals()` / `getProposal()` / `adoptProposal()`（跑执行器 + 落状态 + `refreshDerived`）。
- `api.ts`：`POST /api/conversation/mode`、`GET /api/proposals`、`GET /api/proposal?id=`、`POST /api/proposal/adopt`（走 `handleAsync`，执行器是异步的）。
- `rules.yaml` + schema/load：`agent.maxPlanningRounds`（谋篇要多读几轮）、`agent.maxProposalItems`（防一口气提几十条）。

### T5 前端
- `ChatDock`：头部模式标签与切换按钮；谋篇态 composer 换石青 + 一行「此模式不写入作品」；`proposal_ready` chip 自动把中间区切到方案页（复用写出草稿自动切草稿页那套）。
- `pages/ProposalPage.tsx`：摘要走稿本（宋体）、条目按 方向·人物·场景·情节线·章节 分组走仪器、影响单列；朱批栏给顶部「这份要你拍板」；底部「采纳整案」/「打回重改」。
- `api.ts` / `App.tsx` `/proposal/:id` 路由 / `styles.css`。

## 验证

typecheck（根 + web）、`npm test`、`npm run web:build`。新增测试覆盖：提案存储、执行器（占位解析 / 失败即停 / 重放幂等）、只读锁（工具集 + 兜底）、`propose_plan` 入参解析、四个端点、系统提示分支。
