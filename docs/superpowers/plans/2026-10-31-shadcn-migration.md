# 全站 shadcn/ui Migration Plan

> 用户已选择真正的 shadcn/ui 组件迁移（2026-10-31），按页面验收并替换 Ant Design。按项目既定协作要求由当前代理独立执行与复核，不派生子代理。迁移方向已确定，不重复索取该方向的许可。

**Goal:** 将整站控件、导航和页面视觉统一到真正的 shadcn/ui，在迁移中保持创作与资料工作流可用。

**Architecture:** 组件源码放在 `web/src/components/ui/`，使用统一语义 tokens。按公共基础、页面和复杂创作流程逐步替换；过渡期只为尚未迁移的页面保留 Ant Design，最终删除 provider、theme、依赖和样式覆盖。业务 API、事件真源、任务恢复与作者确认流程保留。

**Tech Stack:** 现有 React 19 / Vite 6 / TypeScript 5.9；引入官方 shadcn/ui 源码、Tailwind 与 Lucide。具体版本、底层 primitives 与安装方式在基础批次按官方当前文档和 React 19 兼容性核实后锁定。

## 已完成的准备与明确边界

- [x] 先修复审查发现的重复补写，提交 `9ef2741`；全量 1409 passed / 1 skipped，类型检查通过。
- [x] 盘点 `web/src/pages/`：14 个页面容器（`ViewPage` 承载多张结构视图）。
- [x] 盘点直接依赖：29 个 TSX 文件引入 Ant Design；另有 `web/src/theme.ts` 与入口 provider。
- [x] 用户确认实际组件迁移；只给 Ant Design 调整颜色不算完成。
- [x] 第一批公共基础与应用外壳已实现和验收；见 `docs/reports/2026-10-31-shadcn-foundation.md`。第二至第五批尚未实施。

迁移在独立 `codex/` 分支与工作树中推进；首个独立 PR 对齐已合入的基线，避免把本轮写章修复和白板 PR 再栈成另一条 PR。可以先准备代码，不以此擅自合并 PR #32。

## 设计与产品约束

- 沿用已确认的白板方向：深色中性色、细边框、克制的层次、清晰的焦点和简洁控件。整个界面的标题与控件使用一致的 sans 字体；正文阅读区保留独立排版能力。
- 原文、计划、候选、已确认、失效和阻断须有文字状态；状态不能只靠颜色区别。主支线语义不能被通用灰度样式抹掉。
- 确认/采用/删除/恢复/导入/返修的既有规则保留，失败与待确认状态可见。切换路由、弹层或组件不丢失作者输入，不重复发请求。
- 章节数量仍由实际数据决定；迁移不能把测试规模写成数量上限。
- 不引入本任务无关的后端重构、模型策略调整、路由框架更换或运行时升级。

## Chunk 1: 公共基础与应用外壳

### Task 1: 安装与样式边界

**Files:** `package.json`、`package-lock.json`、`web/vite.config.ts`、`web/tsconfig.json`、新增 shadcn 配置、`web/src/lib/utils.ts`、`web/src/styles/tokens.css`；调整 `web/src/styles.css`。

- [x] 核实官方安装/主题文档、包维护状态、许可证、React 19 / Vite 6 兼容性；确定一套底层 primitives，不混用不同 base 的同名组件。
- [x] 配置前端 alias、Tailwind 构建与按需 shadcn 源码；不改后端 tsconfig 的模块解析语义。
- [x] 定义 background/foreground/card/popover/primary/secondary/muted/accent/destructive/border/input/ring tokens。旧页面通过过渡映射使用同一颜色源，避免两套独立配色继续增长。
- [x] 处理 `styles.css` 中 `button:not([class*="ant-"])`、全局 hover/focus、input、table 和弹层规则的 legacy 边界。不能依赖 CSS 加载顺序：现有 unlayered CSS 会压过 Tailwind layer。
- [x] 核对 Tailwind reset 对旧页面的影响，过渡期不让未迁移页面失去字号、表格、正文与按钮布局。本批未启用全局 Preflight。
- [x] 执行 `npm run typecheck`、`npm run web:build`；旧作品列表、对话、阅读器与白板各打开一次，确保未被全局样式意外改变。

### Task 2: 基础组件与外壳

**Files:** 新增 `web/src/components/ui/` 的 Button/Input/Textarea/Label/Badge/Separator/Tooltip/Sheet/Dialog/AlertDialog 等所需组件；`web/src/App.tsx`、`web/src/components/TaskPanel.tsx`、`web/src/components/ErrorBoundary.tsx`、`web/src/components/Chip.tsx`。

- [x] 使用官方组件源码与必要依赖，按实际页面需要引入；不建一个内部仍调用 Ant Design 的伪迁移层。首批只接入所需 Button、Badge、Separator、Sheet。
- [x] 替换应用导航、移动目录、任务状态与错误恢复按钮。Lucide 接管本批图标，保持相同操作语义。
- [x] 替换 Chip 的渲染基础，逐个映射业务状态；为真正存在风险的状态映射和交互新增失败用例，再实现。
- [x] 核验 Sheet/Dialog 的 Escape、初始焦点、关闭后焦点恢复、滚动锁与 portal 主题继承。阅读器与白板的键盘操作不能被隐藏弹层拦住。
- [x] 浏览器验证 1440×1000、1280×800、390×844；按迁移页面批量修正并保存截图。

**本批交付条件：** 实际 shadcn 基础已接入，外壳与任务/错误反馈可用；旧页面可继续运行。明确列出仍依赖 Ant Design 的页面，不宣称全站完成。

## Chunk 2: 作品入口与日常页面

### Task 3: 作品列表与作品管理

**Files:** `web/src/pages/Works.tsx`、本页样式；所需的 Form/Field/Select/Collapsible/AlertDialog 组件。

- [ ] 逐项核对原 Form 校验：必填、数字边界、空值、请求 ID 和提交期间重复点击。
- [ ] 迁移创建作品、归档/恢复、备份导入/导出交互；保留原有确认与错误信息。
- [ ] 用独立测试工作区验证：空列表→创建→进入→归档→恢复；导入失败保留已选内容，成功后展示真实结果。
- [ ] 测试弹层、窄屏表单、键盘、长作品名和处理中禁用，保存截图与验收记录。

### Task 4: 首页、告警、搜索、积分与导出

**Files:** `Home.tsx`、`AlertList.tsx`、`Search.tsx`、`Credits.tsx`、`Export.tsx`；`AlertCard.tsx`、`StoryProgressList.tsx`、`PlanningActionDialog.tsx`。

- [ ] 替换按钮、输入、数字输入、标签、提示、分段选择和规划弹窗，统一页面标题、内容间距、表格与空态。
- [ ] 数字输入显式处理清空与无效输入，不让 null/NaN 进入原 API。
- [ ] 验证搜索结果到原文跳转、告警动作后刷新、改期/放弃的确认、导出范围与下载文件。
- [ ] 使用空数据、密集告警、无匹配搜索、账本缺项和网络失败场景；确认加载/重试/禁用状态。

**本批交付条件：** 作品管理和日常页面真实控件完成替换；危险操作与 API 参数保持原语义。已有针对性测试、类型检查、构建与浏览器验收通过。

## Chunk 3: 创作与审查流程

### Task 5: 对话与阅读器

**Files:** `Chat.tsx`、`Reader.tsx`；`ReviewSettings.tsx`、`WorkStatus.tsx`。

- [ ] 迁移输入区、侧栏、分段选择、提示、章选择和开关；长文阅读内容不受 Tailwind prose/reset 意外影响。
- [ ] 受控响应验证发送/停止/恢复、流式输出、工具反馈与路由切换；不为纯 UI 验收依赖中转恢复。
- [ ] 验证章切换、原文高亮、返修跳转、键盘与窄屏长文本。开关值映射到 checked，不能沿用不兼容的事件签名。

### Task 6: 草稿与返修

**Files:** `Drafts.tsx`、`Revision.tsx`；`DraftEditing.tsx`、`DraftRewriteEditor.tsx`、`DraftProposals.tsx`、`StructureEditor.tsx`。

- [ ] 迁移选择器、数字输入、勾选、模态框、工具提示与操作栏；保存来源版本与范围定位状态。
- [ ] 浏览器走一遍选择草稿→编辑→保存→检查→候选确认→采用；也验证来源已变、范围不足和请求失败。
- [ ] 验证返修与原文互相跳转、离开页面后的迟到响应、异步操作期间禁用；不得因 UI 替换绕过确认或丢掉原稿。
- [ ] 重跑写章/局部修订/自动修订/返修相关测试及全量检查，确认只改界面。

## Chunk 4: 资料与旧稿流程

### Task 7: 资料编辑

**Files:** `Preparation.tsx`、`PreparationEditors.tsx`、`PlanningActionDialog.tsx` 及对应公共基础。

- [ ] 迁移人物、设定、情节线、卷、章计划编辑器的表单、列表和确认弹层；覆盖新增、编辑、删除、取消、校验错误与方案过期。
- [ ] 资料仍先进入方案和影响预览，确认后生效；不能因去掉 Modal/Popconfirm 而变成立即修改事实。
- [ ] 用真实测试副本验证长资料、动态列表、空选择和窄屏输入；操作后刷新核对持久化结果。

### Task 8: 导入与反推

**Files:** `Inference.tsx`、`ImportChapters.tsx`、`InferenceChooser.tsx`。

- [ ] 迁移文件选择、预览、冲突覆盖勾选、反推模式、估价与逐章状态反馈。
- [ ] 《雨夜当铺》175 章原稿只读；使用干净独立副本做导入和原文检查，不修改原始文件。
- [ ] 受控模型响应覆盖待确认/确认/失败/跳过/重试状态；真实中转不可用时明确记录缺项，不把网络失败当成结构成功。

## Chunk 5: 结构视图与收尾

### Task 9: 图表和剧情白板统一

**Files:** `ViewPage.tsx`、`PlotBoard.tsx`、`plot-board.css`；`Timeline.tsx`、`PlotTracks.tsx`、`ArcLanes.tsx`、`RelationMap.tsx`、`AnchorDot.tsx`；`chart.ts` 和对应样式。

- [ ] 将白板局部 button/badge/input 等纳入真实公共 shadcn 组件；图形本身继续使用现有 SVG / React Flow。
- [ ] 图表颜色使用统一语义 tokens，保留主支线、失效和已规划的视觉区别及文字说明；不要用通用 component border 覆盖图形语义。
- [ ] 验证 248 个确认事件的独立作品和 175 章原稿副本；拖动、缩放、收起、刷新恢复、作品隔离与原文跳转继续工作。

### Task 10: 删除旧体系并做整体验收

**Files:** `web/src/main.tsx`、`theme.ts`、`styles.css`、`package.json`、锁文件、项目 UI 设计文档与 MEMORY。

- [ ] `rg -n 'antd|@ant-design/icons|ant-' web/src` 逐项核对；所有生产组件完成迁移后再移除 AntApp/ConfigProvider/theme 与依赖，删除对应旧样式。
- [ ] 删除兼容边界与重复 tokens；补齐按最终实现提取的设计文档，不把临时兼容约定写成长期规范。
- [ ] 执行全量测试、根+web 类型检查、生产构建和 diff 检查；记录包体积，避免白板依赖重新进入所有页面的首包。
- [ ] 桌面与窄屏逐页验收键盘、焦点、空态、加载、错误、长内容、浏览器控制台及生产构建加载。
- [ ] 记录各批次截图、验收范围和剩余项；只有 Ant Design 生产依赖清零、关键创作闭环通过且无未处理的迁移回归时，才宣称全站迁移完成。

## 每批执行纪律

影响交互/参数/状态的改动先用真实失败场景或有价值的回归测试锁定，再实现；不为可逆的样式值编写镜像测试。每批包含代码、浏览器截图、适用检查和剩余清单，保持可评审的独立提交。本文不预设未经评估的工期，也不把迁移计划当作已交付界面。
