# 选段编辑闭环实施计划

**Goal:** 将段落助手的候选替代文字保存为版本稿，支持导入的无计划章节，保留原文和作者采用权。

**Architecture:** 复用 DraftStore、DraftRevisions、ChapterWriter 和采用事务。无计划章节只执行正文和结构检查，不能伪造预算或写作计划；正式正文的指纹参与来源校验。讨论回复与替代候选分开，保存只替换精确偏移。

**Tech Stack:** TypeScript、React、现有 shadcn 控件、Vitest、Playwright。

本轮主代理独立实施，按已有授权继续，不另行等待计划确认。许可证和多人在线不在实施范围，真机另行验收。

## 1. 无计划章节的版本与检查

- [x] `test/passage-editing.test.ts`：先验证无计划章精确选段保存、重复段落、来源冲突、幂等重试、正文不变；运行测试确认红灯。
- [x] `src/server/draft-revisions.ts`、`src/server/chapter-input.ts`、`src/server/chapter-writer.ts`：保存导入原文的历史版本，生成候选稿；检查输入允许没有计划，生成新章节仍要求真实计划。
- [x] `src/task/steps.ts`、`src/context/render-volatile.ts`：缺计划时只运行可执行规则并明确未检查范围。
- [x] 用现有检查、采用及后续章影响流程验证，确认正式文本只能显式采用后变化。

## 2. 候选应用

- [x] `src/server/passage-assistant.ts`、`src/server/api.ts`：结构化替代候选与问答分开；返回源指纹，拒绝截断结果成为候选。
- [x] `web/src/components/PassageAssistant.tsx`、`web/src/api.ts`：候选可编辑，前后对照，明确“保存新版本”，随后进入现有检查/采用页面。
- [x] `test/e2e/passage.spec.ts`：选中重复段落中的第二处，生成并修改候选，保存后核对范围外内容和正式原文。

## 3. 编辑恢复

- [x] `web/src/components/DraftEditing.tsx`：按作品、章、源版本隔离浏览器编辑缓冲，显式恢复/放弃；存储失败如实提示。
- [x] 浏览器测试刷新恢复、源版本变化冲突、丢弃候选与历史稿恢复。

## 4. 验收与交接

- [x] `npm run typecheck`、相关单测、`npm run web:build`、Chrome E2E；必要时再跑全量。
- [x] 更新路线图、验收记录和 MEMORY，已完成和待完成分别记录，提交可审查改动。
