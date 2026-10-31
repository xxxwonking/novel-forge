# 剧情白板 Implementation Plan

> 按用户既定要求，由当前代理独立实现与复核，不派生子代理。用户已授权执行，不另设审批。

**Goal:** 以 shadcn 风格提供无限剧情画布，不限制章节数量，不改动作品事实。

**Architecture:** 新增服务端只读模型与 GET API，消费已确认事件和未来章计划；React Flow 负责视口与节点交互。自动连线仅代表同线时序。浏览器保存布局，按工作区 origin + 作品 ID 隔离，内容版本变化清理旧位置。

**Tech Stack:** React 19、TypeScript、React Flow 12（MIT），局部 CSS tokens 与语义 HTML 控件；保留原有 Ant Design 页面，不为视觉风格引入另一套全局预设。

状态：第 1、2 批已完成；验收证据在 `docs/reports/2026-10-31-plot-whiteboard.md`。用户新增授权《雨夜当铺》测试，中转失败后用户选择先交付白板；模型全书反推不计入本次通过项。

## Chunk 1: 数据

- [x] 新增 `test/plot-board.test.ts`，验证确认状态、来源、人物、有效/失效锚点、无分线事件、未来计划去重、稳定 ID、稀疏及 1000+ 章。
- [x] 执行 `npx vitest run test/plot-board.test.ts`，确认缺少实现时失败。
- [x] 实现 `src/view/plot-board.ts`，在 `src/server/api.ts` 接 GET `/api/plot-board`；不增加写端点。
- [x] 重跑数据测试与类型检查，确认通过。

## Chunk 2: 布局与 UI

- [x] 新增 `web/src/plot-board-layout.test.ts`，验证稀疏布局、坏数据降级、失效位置清理和按内容更新的计划 ID。
- [x] 实现 `web/src/plot-board-layout.ts`、`web/src/pages/PlotBoard.tsx` 与局部 CSS；加载、错误、空态可恢复。
- [x] `web/src/api.ts` 声明传输类型，`web/src/App.tsx` 增加白板入口，保留章节轨道。
- [x] 主支线/章节分组展开收起、拖动、适配、定位选中、明示已写/计划、节点详情和有效原文跳转；键盘和移动端可操作。
- [x] 布局与视口使用 localStorage，展示保存失败并保留操作；切作品不串状态。

## Chunk 3: 验证与交接

- [x] 用原作品的独立复制件浏览器检查实际内容、平移缩放、详情/跳转、折叠和刷新恢复、空态/错误、窄屏与键盘。另按用户新增授权尝试真实 Gemini，失败边界见报告。
- [x] `npm test`、`npm run typecheck`、`npm run web:build`、`git diff --check`。
- [x] 更新规格、MEMORY 和验收记录，记录首版限制（当前浏览器保存、规划暂只读）。

## Direction contract

模式 Operate。作者在长时间写作中查看剧情，用当前应用深色外壳，白板内采用用户指定 shadcn 风格的 zinc 中性色、细边框、清晰焦点。顶部紧凑操作条；左侧情节线和章节折叠目录，中部最大化点阵画布，选中节点后右侧展示来源和人物，窄屏改为上下流。事件卡按时序布置，计划卡虚线且有文字状态，所有连线仅表示先后。无预设章节总数。用户已指定功能与风格，直接扩展既有结构视图，不进行视觉概念抽签。完成标准为实际交互、响应式截图与测试证据，不以静态样式代替验收。
