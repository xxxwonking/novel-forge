# 真实连写与跨章返修验收计划

**Goal:** 用当前 Gemini 配置验收连写与返修定位，保留真实失败，不放宽采用规则。

**Architecture:** 使用独立测试作品和现有 ProjectSession/API。真实调用、正文、草稿和账本留在被 Git 忽略的 data/acceptance-2026-10-31；可复用临时工装在收尾时归档。当前主代理独立执行与自审。

**Tech Stack:** TypeScript、Gemini Chat API、LangGraph、Vitest。

- [x] 检查配置、调用连通性与单章基线。
- [x] 受控跨章矛盾：真实定位引文、建议、不改正文、冲突阻止连写、销账与再次变更。
- [x] 修复名录缺 ID：test/cache-stability.test.ts 先增加人物 ID/姓名对应关系断言并观察失败；src/context/render-l2.ts 在人物行包含 ID；src/types/l2.ts 与 src/context/build-l2.ts 同步提升格式版本。
- [x] 验证名录、预算和缓存稳定性测试，再复跑真实连写；普通两章自动采用与关键变化停下分别记录结果（两场景均未到达通过采用条件，见报告）。
- [x] 全量测试、类型检查、前端构建；报告注明短稿、引文、审查与模型输出问题，区分通过和未完成。
