# 有界分场生成 Implementation Plan

> 沿用用户明确的主代理独立实施要求，不派生代理；用户已授权按优先级实施，保存计划后直接执行。

**Goal:** 在保留现有检查与作者确认的前提下，提供可恢复、调用次数受限、按已报告积分停止的分场写章方式。

**Architecture:** 显式选择新方式，新建任务冻结配置。拆场仅细化已确认章计划，不写正式事件。分场检查点保存在同一草稿，每场完成就落盘；完整正文重新使用现有C5/声音/语义/采用。预算由任务统一客户端包装器执行，覆盖所有调用并随自动修订继承。

**Tech Stack:** 现有TypeScript / LangGraph / ModelClient / DraftStore / shadcn，不新增依赖。

## Chunk 1：协议与可恢复分场

文件：新增`src/task/scene-writing.ts`、`test/scene-writing.test.ts`；修改`src/task/types.ts`、`src/task/graph.ts`、`src/task/service.ts`。

- [x] 先写失败测试：合法场景拆分与原计划覆盖、场景按序串联；下一场读取前文，最后一场才收束；无效拆场/重复场景不继续发请求；同一原事件可由多个不同阶段引用。
- [x] 实现拆场schema（有限场数、动作目标、原事件索引），每场预算从原章预算派生，不能修改原字数门槛。新场景只输出正文。
- [x] 增加草稿检查点；完成场景保存，失败保留当前片段但不算完成；重启仅续未完成场景，断点和正文不一致时拒绝。C5使用合成全文，不拼接伪造assistant响应。
- [x] 暂停/结束在调用边界生效；每场保存后再查控制；依据变化沿用现有fingerprint保护。

验证：`npm test -- test/scene-writing.test.ts test/chapter-task.test.ts test/automatic-revision.test.ts`，先记录失败再转绿。

## Chunk 2：统一任务预算

文件：新增`src/task/generation-budget.ts`；修改`src/task/service.ts`、`src/task/types.ts`、`src/server/chapter-writer.ts`、`src/server/api.ts`。

- [x] 配置`sceneWriting: { maxCalls, maxCredits }`，校验正有限数、次数安全整数及合理上限；新任务冻结、同requestId冲突拒绝，旧任务不默默启用。
- [x] 调用前检查累计次数/已记录积分；调用前持久化次数，在途重启计未知用量；返回后按当前价格表折算并保存。未知价格/用量明确停止，不记零费用。
- [x] 上限涵盖拆场、正文、工具、C5、审查和自动修订；恢复和修订不重置，禁止隐式自动提高额度。
- [x] 预算耗尽保存正文与具体停止原因；没有声明/审查的产物不能冒充合格自动采用。

验证：`npm test -- test/scene-writing.test.ts test/automatic-revision.test.ts test/server-write.test.ts`；覆盖刚好耗尽、自动修订继承、重启与配置冲突。

## Chunk 3：单章与连写界面

文件：按现有入口定位后修改`web/src/components/SceneWritingSettings.tsx`、`web/src/pages/Preparation.tsx`、`web/src/pages/Drafts.tsx`及对话工具入口、`web/src/api.ts`、`web/src/components/TaskPanel.tsx`、`src/run/service.ts`、`src/server/state.ts`；更新相关测试。

- [x] 复用shadcn控件展示明确选择、次数和积分停止线；文案说明已在途调用可能越线、项目计价不是供应商账单。
- [x] 连写配置每章冻结并显示每章额度，授权章数决定总范围；遇缺计划、关键变化、审查不可用仍停下。
- [x] 任务显示场景完成数、调用与积分记录、恢复/停止原因；兼容旧任务。
- [x] 浏览器验证手机/桌面，输入错误、取消、暂停/恢复及关闭页面保留任务。新增合成E2E，不让CI调用模型。

## Chunk 4：真实验收与交付

- [x] 独立安装Node24.22.1依赖，类型检查、全量单测、构建、E2E和diff自审。
- [x] 使用隔离小说副本与原Gemini配置，先两章普通样本；记录所有调用、字数、状态、采用数，未达标不改闸门或隐藏追加调用。
- [x] 关键变化、网络失败、预算停止、暂停恢复核对；语义/文学质量单独记录。
- [x] 更新报告、MEMORY和路线状态；已提交推送并创建PR #39，首轮CI通过（run 41285940953）。后续高优先级项从此保存点继续，最终提交以PR Checks为准。
