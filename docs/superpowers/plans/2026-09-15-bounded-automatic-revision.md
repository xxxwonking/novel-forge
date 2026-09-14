# 有界自动修订与过期下一章验收计划

> **执行方式：** 当前代理按 `superpowers:executing-plans` 和 TDD 实现、自审；用户禁止独立 Agent，不委派。沿用已确认的用户流程 §6.1、§8.2、§8.3，总计划 Chunk 4。

**Goal:** 新写章任务在检查需要时至多自动修订一次，保留初稿和新版本，失败、范围不足或重开不会产生无限修改；验证前章更新后下一章按新事实修订的完整过程。

**Architecture:** 在现有 LangGraph 的 check 后增加有界 revision 分支，再复用 write/declare/check。TaskService 在文件事务中保存初稿到自动修订稿的链接及冻结修订输入；ChapterWriter 保持同一个活动任务，切换其当前 draftId。手动编辑、纠错、局部改写、续写不自动扩大作者授权。旧草稿没有新任务额度时保持原行为。

**Tech Stack:** TypeScript、LangGraph JS、原生 ModelClient、DraftStore 文件事务、React、Vitest、Playwright。

## 设计约束

- 新写章冻结 `writeContext.autoRevisionLimit` 为规则额度与 1 的较小值，正文请求上限沿用本次 maxOutputTokens；0 关闭自动修订。所有恢复读取保存的额度，不按新规则追加额度。
- `autoRevisionsUsed` 在创建修订稿时消耗；初稿的 `automaticResultDraftId` 指向子版本。两者原子保存，子版本保存源正文、检查要求、sourceDraftId 和自动修订 kind。
- 仅对 `route_patch`、`resolution_missing`、`resolution_downgraded` 等有本章目标支持的正文处理项尝试；存在其他 block（尤其引文/结构依据矛盾）时停下，不修改正文迎合错误记录。warn 不触发额外调用。
- 修订指令携带真实 findings 及补写优先级，不改规则、计划或作品资料；需要额外范围/方向决定时仅给建议。修订后重新 C5/C6；仍有 block 不再创建第三版。
- 初稿完整保留，自动修订失败保留原文和具体失败步骤；正文已修好而 C5 失败只恢复 C5。主动重试是用户的新指令，不能自动重试模型失败。
- 创建自动稿前核对作品依据和停止请求，避免资料已过期或已暂停后追加模型调用。跨重启只查询不执行。
- 原任务 ID/请求编号能够找到后续稿；检查具体旧版本必须仍检查所选正文，不能被自动链接偷偷换稿。控制原任务可作用于当前自动稿。
- 用量沿同一任务累计，初稿记录保留初次生成用量；当前稿显示两轮合计。界面说明最多一次自动修订和离开页面后的行为，显示当前修订状态、初稿及新版本入口。

## Task 1：先复现有界任务所需行为

**Files:** 新增 `test/automatic-revision.test.ts`，复用 `test/writing-fixtures.ts`。

- [x] 测试正常初稿不增加调用；短稿触发一次补写，C5 读取新全文，原稿检查和正文保留，未自动采用。
- [x] 测试仍短、非法修订 JSON、范围建议、C5 失败恢复、暂停/重开、重复启动和来源变更；断言持久化版本数、调用数、正式事实。
- [x] 测试规则上限大于 1 仍只一次，0 时不调用，恢复按冻结额度；作者编辑/结构纠错/局部范围不自动改正文。
- [x] 运行 `npm.cmd test -- test/automatic-revision.test.ts --reporter=dot`，确认因缺少自动分支失败，记录 RED。

## Task 2：实现同一图中的有界分支与版本保存

**Files:** 新增 `src/task/automatic-revision.ts`；修改 `src/task/{graph,service,types,execution}.ts`、`src/server/chapter-writer.ts`、`src/server/draft-view.ts`。

- [x] 将判断及修订要求构造保持为独立纯函数；Graph 在 check 后进入至多一次分支，再走原 write/declare/check，所有模型调用仍由现有包装器记录用量。
- [x] TaskService 在创建新稿时事务保存源链接、已用次数、冻结输入及真实初稿；更新当前活动稿回调。失败写入不留半个链接。
- [x] Writer 冻结额度、跟随任务结果链接、保留具体版本检查，并在追加修订前验证最新依据。暂停与查询沿同一活动任务。
- [x] 运行新用例及 `test/{chapter-task,task-control,draft-revisions,draft-rewrite,chat-chapter}.test.ts`，按实际新行为更新有明确职责的旧用例，不放松闸门。

## Task 3：页面、对话和过期下一章场景

**Files:** `web/src/{api.ts,components/TaskPanel.tsx,pages/Drafts.tsx,pages/Preparation.tsx}`、`src/agent/system-prompt.ts`、`test/draft-rewrite.test.ts`。

- [x] 展示根据检查修改、已用/允许次数、保留初稿与后续稿链接；作者可查看原文与对比，控制当前任务。
- [x] 写章入口展示一次初稿及至多一次修订，刷新只连回同一任务。对话区分已启动、自动修订中、失败和可采用。
- [x] 验证正式第 N 章修订采用 → N+1 草稿过期且不能采用 → 明确按新事实改写 → C5/C6 重核 → 采用后查询读到新依据。

## Task 4：自审、验证与提交

- [x] 当前代理检查次数、事务、用量、丢失启动响应、旧版检查、停止与资料变更边界；发现缺陷先增加失败用例。
- [x] 完整 `npm.cmd test -- --reporter=dot`、`npm.cmd run typecheck`、`npm.cmd run web:build`、`git diff --check`。
- [x] 浏览器验证初稿→自动修订→暂停→刷新恢复→查看原稿→采用；第二次仍失败应停下。桌面/390/320px，无真实 API 调用。
- [x] 更新 API、MEMORY、总计划和本计划，按授权提交；继续 C4 提议、问题状态、导出与 Gemini 全流程验收。

## 验证记录

- 自动修订 16 项业务测试；完整 41 文件 / 794 项通过，类型检查与 Web 构建通过。引文无依据的两个失败用例修复后通过。
- 浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-automatic-browser-EAvLKu/verification.json`，8 次脚本模型调用，无真实 API；关键桌面与 320px 截图已人工查看。
- 规则变化仍使旧任务过期；不为验证冻结额度绕过来源指纹保护。旧的单轮协议测试显式使用额度 0，默认新写章与新业务测试继续覆盖额度 1。
