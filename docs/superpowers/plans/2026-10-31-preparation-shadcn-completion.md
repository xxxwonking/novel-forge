# 资料缺陷修复与全站组件迁移执行计划

**目标：** 修复资料验收缺陷、完成现有 shadcn 迁移计划的剩余页面、验收后自审并合并推送。当前代理独立执行，不派生子代理。

**架构：** 先修后端资料上下文、稳定指纹、初次补录语义和前置检查；UI 公共控件由现有 Radix 版 shadcn 源码组合，逐页移除 Ant Design，保留业务 API 和作者确认边界。长稿问题单独诊断与验证，不放宽验收阈值或增加隐含重试。

## 1. 缺陷回归与修复

- [x] `test/preparation.test.ts`：真实导入超过10章→提案→重开确认；首次补录空核心设定与已有设定改写区分。先失败再修 `src/preparation/service.ts`。
- [x] `test/preparation-draft.test.ts`：full读取已导入资料与末章上下文；排章缺人物/地点时调用前拒绝。先失败再修 `src/server/state.ts`。
- [x] `web/src/preparation-numbering.ts` 与测试：新增卷、未来章计划不会复用已有编号；人物导入成功后重新读取候选。浏览器复验原导入流程。
- [x] 诊断字数不足，形成有范围与预算约束的修复；受控回归及真实模型复验，失败如实记录，禁止改小下限。

## 2. 真正的公共组件

- [x] 获取同一 Radix/new-york 系列官方 Dialog、AlertDialog、Input、Textarea、Select、Checkbox、Switch、Tooltip、Popover、ToggleGroup 源码；记录来源。
- [x] 应用组合控件处理数字空值、异步按钮、选项列表、多选与模态框；保持原请求参数、焦点、键盘与禁用语义。
- [x] 本次交互边界补有价值的测试；纯视觉值不写镜像测试。

## 3. 按页面替换

- [x] Works 创建/归档/恢复/备份；Home、AlertList、Search、Credits、Export。
- [x] Chat、Reader、Drafts、Revision 与相关编辑器；ReviewSettings、WorkStatus。
- [x] Preparation、PreparationEditors、ImportChapters、InferenceChooser、Inference。
- [x] PlotBoard 与结构图控件统一、保留图形语义和原文跳转。
- [x] 删除 Ant Design provider、theme、依赖及旧样式；去除旧衬线标题、装饰渐变，保留正文独立排版。

## 4. 验证、审查和交付

- [x] `npm test`、`npm run typecheck`、`npm run web:build`、`git diff --check`；记录包体积和依赖清零证据。
- [x] 新服务和全新独立作品：175章真实导入、人物候选立即可见、整份资料补齐及确认；桌面/窄屏、弹层键盘、动态长内容。具体复测与未穷尽场景见交付报告，不把上一轮全部 CRUD 的证据冒充本轮重新执行。
- [x] 作品归档恢复/备份、搜索/原文、草稿/采用边界、阅读底部与聊天输入、白板缩放折叠持久化。
- [x] 主代理逐项审查 diff 与报告中的全部问题；修复审查发现、更新 MEMORY/DESIGN/迁移计划。
- [ ] 分批提交、推送、创建PR，检查后按用户授权合并到 master 并同步推送，确认远端与本地一致。

验收说明：组件迁移完成；真实短稿两次2332/2886字，前者仍被拦截。没有提高自动修订次数或降低2700字门槛。主代理独立自审，未派生代理。最终证据见 `docs/reports/2026-11-01-preparation-shadcn-completion.md`。
