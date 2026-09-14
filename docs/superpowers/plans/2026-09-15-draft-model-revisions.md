# 稿件局部改写与片段续写实施计划

> **执行方式：** 当前代理使用 `superpowers:executing-plans`，按 TDD 实现并自行复核。用户禁止独立 Agent。本文细化总计划 Chunk 4，不替代持续项目目标。

**Goal:** 作者能通过对话或结果页改写指定段落、保留已有片段续完；新版本完成检查后等待采用，范围外内容由代码保留。

**Architecture:** 复用 ChapterWriter 的单作品活动任务、LangGraph write/declare/check 和 DraftStore。修订创建新稿，持久化冻结的源正文、已解析的范围及要求；恢复不重新猜范围。部分生成的真实响应完整保留，C5 另收到代码合成后的完整正文。扩大范围只交付建议。

**Tech Stack:** TypeScript、LangGraph JS、原生 ModelClient、React、Vitest、Playwright。

## 范围与规则

- 依据用户流程 §5、§6、§8.2、§8.3；局部范围采用原文片段及出现序号，存在歧义时拒绝猜测。
- 正文合成固定为 `source.slice(0, start) + replacement + source.slice(end)`；全章改写必须明确传 `scope: null`，局部请求不能自动扩大。
- 续写仅面向未完成正文，固定保留原片段作为前缀。再次达到上限时保存新增片段，不进入声明或采用。
- 模型改写返回替换内容/摘要或扩大范围建议；后者不改变正文，不调用 C5，显示等待作者决定。
- 新修订不继承采用授权，旧正文和检查保留。当前最新正式章可修订；旧的多章正式返修仍不属于首版。
- 请求编号去重、暂停/结束/恢复、来源过期保护、用量记录沿用同一任务服务；不另建独立活动任务池。
- 自动修订至多一次仍是总计划的后续必需任务；本切片建立可复用修订执行能力，不能宣称自动修订已完成。

## Task 1：可恢复的正文修订任务

**Files:** 新增 `src/task/rewrite.ts`、`src/server/draft-rewrite.ts`、`test/draft-rewrite.test.ts`；修改 `src/task/{types,graph,service,steps,execution}.ts`、`src/server/{chapter-writer,state,api,draft-view}.ts`。

- [x] 用临时作品写 API 失败用例：精确段落替换、歧义拒绝、源凭据变化、请求去重、当前正式章与新依据。
- [x] 运行 `npm.cmd test -- test/draft-rewrite.test.ts --reporter=dot`，确认失败原因是缺少修订能力。
- [x] 保存冻结修订输入，接入既有写章节点；完整响应与合成正文分别用于 C5 同会话续接。
- [x] 增加范围建议、模型错误/截断、暂停与重开只恢复必要步骤的失败用例并实现。
- [x] 增加片段续写用例：前缀精确保留、再次截断保存新增内容、重开后继续完成和重检。
- [x] 运行新测试及 `test/{draft-revisions,chapter-task,task-control,chat-chapter}.test.ts`，然后 typecheck。

## Task 2：对话与结果页

**Files:** `src/agent/{tools,tool-exec,system-prompt}.ts`、`src/server/state.ts`、`web/src/api.ts`、新增 `web/src/components/DraftRewriteEditor.tsx`，修改结果页/任务卡及样式。

- [x] 增加真实工具循环用例：读确切草稿 → 指定范围改写 → 查询同一任务 → 采用新稿 → 下一章读到变化。
- [x] 接入同一服务的 Agent 工具；仅有含糊的修改意图时先定位范围，不能把局部请求转成全章改写。
- [x] 结果页允许在原文中选范围、填写要求并开始；手机可通过选中范围或明确整章选项操作。
- [x] 失败正文提供“保留片段继续完成”，范围建议显示原文未改和建议；使用稳定 requestId 重试。
- [x] 展示本次范围和前后差异、真实任务阶段；原来的手动编辑/纠错入口继续可用。

## Task 3：验证、记录与继续总计划

- [x] 完整 `npm.cmd test -- --reporter=dot`、`npm.cmd run typecheck`、`npm.cmd run web:build`、`git diff --check`。
- [x] 临时作品浏览器验收选段改写、刷新恢复、扩大范围建议、片段续完；桌面/390/320px，无真实模型调用。
- [x] 当前代理按用户流程复核范围、事实与恢复边界；发现问题先复现再修复。
- [x] 更新 API、MEMORY 和总计划，按已有授权提交。
- [ ] 继续自动修订上限、C4 提议应用、问题状态、导出、Gemini 连续真实验收和总流程审计。

验证结果：40 文件 / 776 项通过。最新浏览器证据在 `C:/Users/ADMINI~1/AppData/Local/Temp/nf-rewrite-browser-31RPUN/`，包含结束等待范围任务后刷新仍保持结束的回归场景。6 次脚本模型调用，无真实 API 调用。
