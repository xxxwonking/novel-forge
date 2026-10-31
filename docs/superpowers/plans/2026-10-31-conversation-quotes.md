# 普通对话原文引用修复 Implementation Plan

> 用户已要求继续修复，按项目要求由当前代理独立实施、自审和验收，不派生子代理，不重复询问执行许可。

**Goal:** 对话中已标记为原文的引用使用当前作品的连续原文，不能把模型改写当成出处展示。

**Architecture:** 复用 C5 quoteCatalog 的连续片段目录，在 get_chapter_text 的结果中提供带章节、节选范围和内容版本的引用编号。新增独立的对话引用模块完成编号回填、Markdown 引文校验、历史出处的当前版本核对和流式安全输出；不改变 C5 协议、模型签名消息或正式小说文件，不增加自动模型重试。

**Tech Stack:** 现有 TypeScript / Vitest / ModelClient / SSE；不新增依赖。独立工作树 codex/conversation-quotes 从已合入的 master 起步，不叠栈待合并的 UI PR #34。

## Chunk 1: 回归、引用解析与流式边界

### Task 1: 先锁住真实失败

Files: `test/agent-tool-exec.test.ts`、`test/agent-service.test.ts`、新增 `test/conversation-quotes.test.ts`。

- [x] 用真实反例“他停在巷子尽头”→“许临川停在巷子尽头”脚本化模型回复，验证改写不得出现在最终回复/落盘/任何流式事件中；先运行观察失败。
- [x] 覆盖正确编号、未知/残缺编号、多章同号、节选范围、正文换版、跨回合和跨作品；引用必须是当前源文本的逐字子串，不做模糊改写修补。
- [x] 覆盖无引用的普通回复仍流式、引用跨 chunk、拒绝/截断/错误、已有动作 effects 保留；不增加额外模型调用。

### Task 2: 实现最小引用出口

Files: 新增 `src/agent/conversation-quotes.ts`；修改 `src/agent/tool-exec.ts`、`src/agent/system-prompt.ts`、`src/agent/tools.ts`。

- [x] 工具读文生成引用目录；编号绑定 chapter/excerpt/内容摘要/序号。新模块从 ctx 读取当前正文，历史引用仅在本作品当前版本匹配时回填。
- [x] 仅将验证通过的编号回填为原文；Markdown `>` 引文必须逐字存在于可核验来源。错误引用显示明确的隐藏/重新读取提示，不悄悄改为“已验证”。概括、假设与文学质量不由此机械保证。
- [x] 在流式边界识别潜在引用开头，缓冲到完整内容后核验；安全普通文本继续增量输出。引用片段不得先显示再撤回。
- [x] 模型原始消息/签名保持可回放，校验改变展示时追加程序说明，避免错误引文被当成已核实事实继续回放。
- [x] 运行定向测试与类型检查，失败先排根因，不放宽测试。

## Chunk 2: 完整验证与交付

- [x] 全量 `npm test`、`npm run typecheck`、`npm run web:build`、`git diff --check`。
- [x] 使用空历史的《雨夜当铺》独立副本和真实 Gemini：原只读请求至少复跑两次，原文编号回填及逐字核对；记录真实调用/计量。另用受控错误回复验证网页 SSE 不泄漏改写。
- [x] 浏览器查看最终引用、流式过程、刷新后的记录；原始 177 份输入和测试副本的正式故事文件哈希不得改变。
- [x] 当前代理自审差异与验证证据，更新报告/MEMORY，提交、推送并创建独立 PR；不擅自合并。
