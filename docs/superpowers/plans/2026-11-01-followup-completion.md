# 后续路线实施计划

**Goal:** 按既定优先级交付全文资料覆盖、结构纠正、白板规划编辑、创作闭环与导入/工程改进。

**Architecture:** 在独立工作树本地组合已验证的#39/#40，正式master及两PR保持不变。主代理独立实施。复用Preparation候选、事实事件流、逐章返修、shadcn及既有测试，不直接修改作者小说。

**Tech Stack:** Node24.22.1、TypeScript、React/shadcn、React Flow、Vitest/Playwright。

## Chunk 1：全文人物与结构复核

- [x] `src/preparation/full-text.ts`新增完整连续分块（保留原抽样入口），读取范围/出处明确，不再将6个章首抽样称为全文；`test/character-intake.test.ts`先验证跨章/章尾不遗漏与块大小。
- [x] `src/server/state.ts`、`src/server/api.ts`和`web/src/pages/Preparation.tsx`接入可恢复的逐批人物提取，候选合并、同名冲突和逐字出处，作者确认前不写正式资料。
- [x] `src/import/inference.ts`及页面增加章节覆盖核对与版本保护的结构纠正入口；不允许直接修改已确认事实，复用现有返修。
- [x] 隔离副本实测人物遗漏、41章事件与F68/F70，语义无法自动证明的保留给作者复核。

## Chunk 2：白板规划编辑

- [x] `web/src/pages/PlotBoard.tsx`新增未来节点/编辑规划，复用`api.proposeAuthorDetails`、来源指纹与确认；已写节点导向返修。
- [x] 浏览器覆盖取消/确认/刷新/冲突、手机和键盘；不把拖动或时序当故事因果。

## Chunk 3：创作、导入与工程

- [x] 隔离故事完成3～5章及作者改稿影响后文、多章返修；实测模型费用与失败分别报告。
- [x] Word/PDF支持有文本层的文档，扫描PDF明确不支持OCR；导入保持预览、大小限制及原稿保护。
- [x] 长资料分块与来源/去重复用全文提取，不静默截断。
- [x] `web/src/App.tsx`路由懒加载，记录构建体积与实际流程回归。
- [x] 扩展备份/导出/恢复、任务恢复与返修冲突回归。
- [ ] 真机触控/软键盘/安全区：用户明确选择稍后单独验收；本批不执行，不用桌面模拟冒充。

## 交付标准

- [x] 每批先失败测试、实现、相关测试；最终单测/类型/构建/浏览器、自审；远端最终head CI待推送后补验。
- [x] 更新总路线、MEMORY和报告，仅声称已执行的项目通过；代码/凭证/原文分离。

详细结果与内容边界见 `docs/reports/2026-11-01-followup-completion.md`。17章与身份疑点保留作者核对；文学质量结论与程序通过分开。
