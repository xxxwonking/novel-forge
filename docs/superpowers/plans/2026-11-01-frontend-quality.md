# 前端复核问题修复 Implementation Plan

> 沿用用户已定的主代理独立实施与复核，不派生代理；用户已要求继续修复，计划保存后直接执行。

**Goal:** 修复手机白板详情不可见、设计token重复、无障碍结构及文档过时，并建立可持续的浏览器回归和CI。

**Architecture:** 复用现有shadcn Sheet，在720px及以下将选中详情作为可关闭弹层呈现，桌面保留详情栏；画布、选中与布局继续由原React Flow状态持有。测试使用隔离临时项目和禁用模型的真实HTTP服务，不读取用户作品或凭据。

**Tech Stack:** React19 / Radix-shadcn / React Flow / Tailwind4 / Node24.22.1 / Vitest；新增Playwright Test及axe测试适配，npm单锁文件。

## Chunk 1: 可复现回归与手机详情

- [x] 建立Playwright配置、独立临时作品/服务及浏览器回归：手机选中资料节点应立即出现可见详情，Escape关闭并归还焦点；画布布局和视口保留，桌面详情栏及跨断点正确。
- [x] 在修改产品代码前运行并记录上述失败；增加资料页、人物弹窗、阅读页axe结构失败用例。
- [x] 修改`web/src/pages/PlotBoard.tsx`，复用Sheet与既有详情内容；兼容组折叠、搜索定位和手机/桌面切换，不伪造正文跳转。
- [x] 原失败用例转绿；手机390×844、平板768×1024、桌面1440×1000核对详情、焦点、滚动和布局。

## Chunk 2: 设计与语义收尾

- [x] 修改`web/src/pages/plot-board.css`和`web/src/styles/tokens.css`，白板颜色、圆角、字号使用公共token；保留结构图语义，不调整故事数据或重新设计配色。
- [x] 在`App.tsx`、`Preparation.tsx`、`Reader.tsx`命名complementary区域；`PreparationEditors.tsx`与Reader体检标题接续层级，调整必要样式保持原排版。
- [x] axe及人工键盘复验；使用Impeccable作定点收尾，区分真实问题和规则误报；不安装无用途的动画库。

## Chunk 3: 工程与文档

- [x] Playwright回归覆盖导入资料/候选确认、人物弹窗、检索原文、阅读章末、手机白板及网络失败恢复。使用自有合成作品，不依赖真实模型或小说文本。
- [x] `package.json`增加E2E/typecheck入口，`vitest.config.ts`排除E2E目录；`.gitignore`忽略报告/trace；`.nvmrc`锁定已验证Node24.22.1。
- [x] 增加GitHub Actions：最小只读权限、npm ci、类型/单测/构建/浏览器检查，失败上传报告，不提供模型凭据。官方action版本核实后使用固定提交。
- [x] 更新README、MEMORY入口、DESIGN及报告，保留历史事实与模型验收边界，不宣称真实连写或全书反推完成。

## Chunk 4: 验证与交付

- [x] Node24.22.1下全量单测、根/web/E2E类型检查、构建、E2E通过；自审完整diff，确认无emoji图标、无凭据/小说入Git。
- [x] agent-browser独立会话人工验收与截图，保留只读真实小说副本复验；不重启用户服务。
- [ ] 提交、推送并创建PR，检查远端CI结果；交付修复范围、证据与剩余限制。
