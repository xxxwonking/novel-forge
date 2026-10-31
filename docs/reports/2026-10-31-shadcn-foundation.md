# shadcn/ui 第一批：公共基础与应用外壳

2026-10-31。用户确认真正的 shadcn/ui、按页面替换 Ant Design 后，实施迁移计划第一批。当前代理独立实现与复核，没有启动子代理。

## 已交付范围

- 官方 Radix 版 Button、Badge、Separator、Sheet 源码，来源、原始 registry 哈希及项目适配记在 `web/src/components/ui/README.md`，保留上游 MIT 许可。
- Tailwind v4 构建、前端 `@/` alias、`cn`、语义 tokens 与 shadcn 配置。官方 CLI `shadcn@4.23.0 info --cwd web` 能识别 Vite、Tailwind v4、Radix、四个已安装组件及源码路径。
- 应用桌面导航、移动 Sheet 目录、路由当前状态、任务操作与错误恢复按钮；业务 Chip 改用 Badge。装饰图标改用 Lucide，动态章节号保留。
- `PRODUCT.md` 保存已确认产品约束；`DESIGN.md` 和 `.impeccable/design.json` 只提取首批实际实现，未把旧页面当作已迁移设计。

这是第一批交付。仍有 **25 个 TSX 文件直接引入 Ant Design（含入口 provider）**：12 个页面和 13 个其他组件/入口尚待后续批次。白板内部工具栏和节点控件也未在本批替换；共用的新导航不代表这些页面已整体完成迁移。

## 样式共存与依赖

样式层顺序为 `theme → antd → legacy → base → components → utilities`。旧 `styles.css` 放入 legacy layer；通过官方 `StyleProvider layer` 限定 Ant Design 规则，防止其全局链接规则压过新导航选中态。没有启用全局 Tailwind Preflight，只对已迁移的 `data-slot` 控件做基础重置，保留旧表格、输入和正文排版。旧 theme/provider 读取共享 CSS 颜色变量，待后续页面完成后删除。

新增运行依赖：Radix UI 1.8.1、class-variance-authority 0.7.1、clsx 2.1.1、tailwind-merge 3.7.0、Lucide React 1.66.0、tw-animate-css 1.4.0；构建依赖 Tailwind / Vite 插件 4.3.3。`@ant-design/cssinjs` 2.1.2 从既有传递依赖声明为直接依赖，以使用迁移期 layer provider。锁文件核对未改变已有包版本。

许可分别为 MIT（Radix、clsx、tailwind-merge、Tailwind、tw-animate-css、cssinjs）、Apache-2.0（class-variance-authority）和 ISC（Lucide）。现有 React 19.1 / Vite 6.4.3 / TypeScript 5.9.3 保留，安装和类型检查通过。

官方依据：[shadcn Vite 安装](https://ui.shadcn.com/docs/installation/vite)、[组件配置](https://ui.shadcn.com/docs/components-json)、[Sheet](https://ui.shadcn.com/docs/components/sheet)、[Tailwind Preflight](https://tailwindcss.com/docs/preflight)、[Ant Design CSS layer 共存](https://ant.design/docs/react/compatible-style/)。组件源码链接和许可见组件目录。

## 工程验证

最终复核使用原工作区相同的 Node **24.20.0**，命令前显式设置其 PATH；没有修改全局 Node。新工作树默认命中 Homebrew Node 26.6.0，早期检查也通过，但不以不同运行时的结果替代最终复核。

| 检查 | 结果 |
| --- | --- |
| `npm test` | 88 文件，1420 passed / 1 skipped，退出 0 |
| `npm run typecheck` | 根目录与 web 均通过 |
| `npm run web:build` | 通过，React Flow 白板保持路由拆包 |
| `git diff --check` | 通过 |
| 官方 `shadcn info` | 识别真实四个组件及配置 |

新增 11 项回归先观察失败，再实现：状态文字与语义映射、Tooltip 所需 DOM 属性透传、普通按钮不隐式提交表单、显式 submit 与 asChild 链接，以及查询参数/正文深链的导航当前状态和动态章号。没有为纯样式值添加镜像断言。

最终主 JS **1064.95 kB / gzip 345.38 kB**，白板独立 JS **199.60 kB / gzip 65.40 kB**。主包原约 974.68 kB，双组件体系共存有实际体积成本，既有超过 500 kB 的警告仍存在；未通过调高警告阈值隐藏。后续移除旧页面依赖与按页拆包仍需验收。

运行时安全核对记录：本机两个运行时均早于官方 [2026-10-21 安全修复](https://nodejs.org/en/blog/vulnerability/october-2026-security-releases) 列出的 24.22.1 / 26.12.1，不能因 LTS 标识就宣称已包含最新补丁。本批未升级全局运行时，补丁升级是独立维护项。

## 浏览器验收

独立生产服务 `127.0.0.1:5184`，Vite 预览 `127.0.0.1:5183`；工作区为 `/tmp/nf-plotboard-qa/library`。生产验收服务使用空密钥和不可用的本机模型端点，防止纯 UI 操作意外调用真实模型。没有请求 Gemini，没有动原有小说。

- **1440×1000**：新侧栏、当前入口、中性任务/状态样式；旧情节线表格和图形、反推列表、作品列表与弹窗保持可读可操作。
- **1280×800**：阅读器原文与体检栏布局保持，正文深链激活阅读入口；跳过导航将焦点移到 main，同时不破坏 hash 路由。
- **390×844**：Sheet 初始焦点在关闭按钮，Tab 在弹层内循环；Escape 关闭后回到目录按钮，解除滚动锁。关闭按钮 44×44；目录独立滚动，能访问底部入口。打开关闭不丢失未发送的对话输入。选择页面关闭目录；打开时跨到桌面宽度自动关闭并解除锁。
- 旧备份弹窗打开、未选文件的校验、Escape 关闭通过，未导入新数据。新 Chip 在旧 Tooltip 内可触发说明，且带 `aria-describedby`。
- 独立合成暂停任务验证重试失败提示（第 1501 章没有节拍表）和结束操作；最终 execution 为 ended、正文完整保留、模型调用 0。没有以原有任务测试结束操作。
- 《雨夜当铺》175 章独立验收副本：新导航显示 175/176；剧情白板到第 175 章原文跳转、逐字高亮与阅读入口状态通过。白板仍是前轮四条明确标为验收节选的人工标注，**不是完整 Gemini 反推**。
- 生产标签控制台 warn/error 为空；移动和桌面检查均无水平溢出。177 份桌面原始输入哈希复核全部一致。

设计 detector 运行一次，返回三条字号文档 advisory（15/12/11px）；这些尺寸符合实际渲染的作品名、分组说明和非交互计数，已补入 DESIGN 的 typography，并人工复核。没有隐藏或伪称 detector 无提示；未发现本批尚未处理的阻断项。

截图、测试日志、detector 原始输出与原文完整性结果保存在本工作树 `data/acceptance-2026-10-31/shadcn-foundation/`（Git 忽略，不提交小说内容）。截图：`board-desktop-1440.jpg`、`reader-1280.jpg`、`mobile-navigation-390.jpg`、`board-mobile-390.jpg`。

## 分支和接续

分支 `codex/shadcn-ui`，工作树 `/Users/others/Desktop/novel-forge-worktrees/shadcn-ui`，从 `a36efc0` 准备。原 `codex/live-run-acceptance` 工作树未改。PR #32 在本批结束时仍为 OPEN，因此不另建依赖它的叠栈 PR，也不擅自合并；独立提交保存在迁移分支，待基线合入后再对齐 PR。

下一批为 Works 创建/归档/恢复/备份表单与日常页面，重点保留校验、请求期间禁用、错误后输入和确认流程。全站迁移结束条件仍是旧生产依赖清零及关键流程整体验收，不是本批四组件接入。
