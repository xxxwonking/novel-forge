# 写章输入与 API 接入计划

> 执行方式：使用 executing-plans，由当前代理实现和复核；遵循用户要求，不调用子代理。

**目标：** 完成 MEMORY §12 的下一项：把已落盘的作品资料装配为 `ChapterRunInput`，通过 HTTP 运行或恢复 Stage 1 章节任务，交付待采用草稿。

**架构：** `ProjectStore` 保存作品资料，`ProjectSession` 提供读写与写章入口；独立装配模块重用 L1/L2/L3、预算派生和锚点解析；章节协调器调用现有 `ChapterTaskService`。LangGraph JS 继续编排，模型调用继续使用原生 Claude SDK。API 异步分发层等待写章结果，原有同步查询与采用接口保留。

**技术：** TypeScript、Node HTTP、Vitest、LangGraph JS、`@anthropic-ai/sdk`。

## 验收约定

- 地点/组织库保存为 `settings.json`，写作纪律保存为 `discipline.json`；旧项目缺文件时分别默认空库与平台纪律，读取本身不改文件。
- 写章先校验章号、节拍与引用资料，并按当前规则重算预算。缺少必要资料时返回可操作的错误，不调用模型。
- 人物状态、已发生剧情和伏笔只读取目标章之前的 `committed`/`authored` 事件；草稿、被否决记录和后续章事实不进入写章上下文或读取工具。
- L3 按节拍顺序选人物及场景；待收伏笔带真实意图与埋设处上下文，暗线只加入避免直接提及的提示。上一章正文保持原文。
- 新伏笔 ID 避开事件历史与已有草稿声明；不能因重新打开项目而重复使用 ID。
- `POST /api/chapter/write` 接受 `{ chapter, draftId?, newDraft?, maxOutputTokens? }`。默认复用本章已有草稿，显式 `draftId` 恢复原稿，`newDraft: true` 另建版本。重叠的同一请求共享运行结果，冲突请求返回 409。
- 仅写下一章或最新已采用章的候选版本；生成成功不改变正式章节、事件流或作品版本。C5 失败保留正文，重新打开项目后可恢复，已过期草稿不能直接恢复或采用。
- 没有模型配置时仍可启动阅读 API；首次写章给出 503。测试通过注入假客户端验证，不调用真实模型。

## Task 1：持久化写作资料

文件：`src/store/persist.ts`、`src/server/state.ts`、`test/persist.test.ts`。

1. 添加资料往返、旧项目默认值、单独更新及损坏文件报错测试。
2. 运行 `npm test -- --run test/persist.test.ts`，确认新测试因功能缺失失败。
3. 扩展完整快照；`save` 兼容旧调用方未提供新字段。补独立写入方法和 Session 读写。
4. 重跑该测试及类型检查，确认已有作品数据格式兼容。

## Task 2：装配真实章节输入及读工具

文件：新增 `src/server/chapter-input.ts`、`test/chapter-input.test.ts`；按需新增测试夹具。

1. 用临时项目构造正式/候选/否决/后续事件、地点组织、待收与暗线伏笔。
2. 先测试 L1/L2/L3/volatile 内容、预算重算、引用校验、锚点移位、ID 分配和工具读取边界。
3. 实现 `buildChapterRunInput` 和共享资料来源的读取工具装配。剧情梗概由正式剧情事件汇总；跨卷衔接只汇总已有事实。
4. 运行 `npm test -- --run test/chapter-input.test.ts test/cache-stability.test.ts`。

## Task 3：接通运行、恢复与 HTTP

文件：新增 `src/server/chapter-writer.ts`、`test/server-write.test.ts`；修改 `src/server/state.ts`、`src/server/api.ts`、`src/server/http.ts`。

1. 编写假客户端集成测试：写出草稿、正式数据不变、工具读到持久化资料、C5 失败后跨 Session 恢复。
2. 补重复请求、另建版本、参数错误、缺配置、过期草稿和写章顺序测试，观察失败。
3. 实现会话级协调器，懒加载 Claude 客户端；同一活动任务共享 Promise，避免重复模型调用。
4. API 返回去掉内部模型会话的草稿；传输层通过异步分发等待结果。补真实本地 HTTP 测试验证响应与错误码。
5. 检查新入口暴露的采用状态约束；若复现过期或丢弃稿仍可采用，先加回归测试，再作针对性修复。

## Task 4：验证、复核与交付

文件：`README.md`、`MEMORY.md`、本计划。

1. 运行 `npm run typecheck`、`npm test`、`npm run web:build`。
2. 当前代理独立复核本次 diff：事实边界、草稿恢复、并发、API 参数、旧项目兼容、文件写入范围。
3. 记录实际测试结果、API 用法与尚未完成的用户体验，更新 MEMORY 的接手任务。
4. 核对 `git diff --check` 和工作区，按用户已有授权提交、整合回主项目并推送。保留已有 `data/demo`。

## 执行记录

- 基线：`b6ca4ee`，Windows；467 个测试、类型检查通过。
- 独立目录：`C:/Users/Administrator/Desktop/novel-forge-worktrees/chapter-write`；分支 `stage1-chapter-write`。
- 计划复核：任务范围与 MEMORY §12 一致；已有流程决策足够实施，无需重新确认框架或采用节奏。
- Task 1–3 已完成。新增草稿来源校验值与恢复输出预算，保持 runInput 不直接持久化；恢复/采用和异步生成结束时核对资料是否改变。
- 当前代理复核修复：非 ready 稿错误采用、旧 proposed 事件被一并采用、已采用稿被丢弃、草稿断号覆盖/同时间戳排序、仅规划伏笔混入事实索引、恢复时丢失调整后的输出预算。均有先失败后通过的回归证据。
- Task 4 验证：23 个文件、540 个测试通过；类型检查与前端构建通过。HTTP 断开后继续任务、生成/采用/续写使用假模型验证。README 与 MEMORY 已同步。
