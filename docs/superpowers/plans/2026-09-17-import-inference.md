# 逐章反推结构：从旧稿正文补出结构事实（差距第 2 项下半场）

2026-09-17 / 分支 `import-structure-inference` / 基线 master `93d4a83`

## 目标

第 29 节把旧作正文放进了库里，但伏笔时间线仍是空的 —— 没有声明就没有事实。这一批补上另一半：**逐章读旧正文，反推出结构声明**，交作者确认后才成为正式事实。

## 复用什么（不重做）

`parseC5` + `C5_OUTPUT_SCHEMA` 本来就是「从正文得出结构」，且已有完整的丢弃/报错纪律（未知人物 ID、重复声明、引文定位、伏笔生命周期）。方向从「写完后声明」换成「读旧稿反推」，解析侧一字不改。

不能复用 `buildChapterRunInput`：它要求该章有已采用的节拍表，而旧稿没有节拍表，也不该为了反推伪造一份。反推只需要 `ParseContext`，所以单独装配。

## 范围决策

- **顺序进行，不并行分片**：第 N 章的 `foreshadow_resolved` 要引用第 1..N-1 章分配出的 `F` 编号。服务端拒绝跳章反推。
- **产物是 proposed 事件，不是 authored**：正文是作者的，但对正文的结构判断是模型的（第 28 节）。落进事件流的 proposed 区，投影不受影响，作者确认才 committed。
- **新 origin `import_inference`**：与 `C5_declaration`（同会话第二轮）区分，归因和准确率统计才有意义。`supersedeChapter` 同时作废这个 origin —— 否则旧作章被章节修订采用后，两份结构事实会并存。
- **跨章累积在一次运行之外**：每章一次请求、立刻落盘，所以中断可续、失败只影响一章。累积上下文从事件流现读（committed + 本轮 proposed），不在内存里攒。
- **解析报错不落事件**：`parseC5` 的 errors 是身份冲突（未登记人物、重复声明、伏笔生命周期），这一章记 `problem` 让作者先补资料再重跑，不半落一半。
- **确认按章**，与「逐章采用」同构；界面另给「确认全部」循环调用。前面还有未处理的反推章时拒绝确认后面的章，避免"收了没埋的伏笔"。

## 实现

- `src/import/infer.ts`：`buildInferenceContext`（从 session 现读已确认资料 + 已反推伏笔）、`buildInferenceTask`（反推特有纪律：只依据本章正文、不得新造人物 ID、只能兑现列出的伏笔）、`inferChapterStructure`（一次模型调用 + `parseC5`）。模型档位照抄 C5：role creative、effort medium、`C5_OUTPUT_SCHEMA`。
- `src/import/inference-store.ts`：`import-inference.json` 记每章最后一次运行的 problems/warnings/at。事实在事件流，这里只有运行结果。
- `src/import/inference.ts`：`InferenceService` —— 前置条件（有正文、无正式结构、前序章已处理）、重跑先 reject 旧 proposed、逐章视图、确认/丢弃。
- `src/server/state.ts`：`inferChapter` / `inferenceView` / `confirmInference` / `rejectInference`，事件写入走 `transact` + `rewriteEvents`。
- `src/server/api.ts`：`POST /api/import/infer`（走 handleAsync，它 await 模型）、`GET /api/import/inference`、`POST /api/import/inference/{confirm,reject}`。
- `src/store/event-stream.ts`：`supersedeChapter` 覆盖 `import_inference`。
- Web：`pages/Inference.tsx`（逐章进度表 + 连续反推/停止 + 每章展开确认）、路由 `/inference`、资料页与导入回执给入口。

## 验证

先写失败测试 `test/import-inference.test.ts`：反推落 proposed 而投影不变、确认后投影出现伏笔、第 2 章能引用第 1 章尚未确认的伏笔、F 编号跨章不冲突、未登记人物记 problem 且不落事件、重跑作废旧 proposed、已有正式结构/跳章/无正文的拒绝、模型输出非法时记 failed、章节修订采用后旧反推事实被作废。四件套 + 浏览器端到端（脚本化客户端，0 次真实调用）。
