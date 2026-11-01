---
name: novel-forge
description: 小说创作工作区，统一的 shadcn/ui 页面与公共控件
colors:
  background: "#09090b"
  foreground: "#fafafa"
  card: "#18181b"
  muted: "#27272a"
  muted-foreground: "#a1a1aa"
  border: "#27272a"
  input: "#3f3f46"
  ring: "#d4d4d8"
  warning: "#e9b55e"
  info: "#94c8dc"
  danger: "#be123c"
  danger-foreground: "#fda4af"
typography:
  body:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  navigation:
    fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", -apple-system, sans-serif'
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  work-title:
    fontSize: "15px"
    fontWeight: 600
  caption:
    fontSize: "12px"
    fontWeight: 400
  navigation-count:
    fontSize: "11px"
    fontWeight: 400
rounded:
  control: "8px"
  navigation: "6px"
  task: "10px"
components:
  button-primary:
    backgroundColor: "{colors.foreground}"
    textColor: "{colors.card}"
    rounded: "{rounded.control}"
    height: "36px"
  navigation-active:
    backgroundColor: "{colors.muted}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.navigation}"
---

## Overview

用户已指定真正的 shadcn/ui 与深色中性色方向。全站控件已迁移至官方 Radix 版 shadcn/ui 源码；页面继续使用原有业务 API、SVG 与 React Flow。移除 Ant Design provider、theme 和生产依赖。本文规范迁移后的实际实现。

## Colors

运行时颜色源为 `web/src/styles/tokens.css`；Tailwind 通过 `@theme inline` 引用语义变量。CSS layers 顺序为 theme → layout → base → components → utilities；原页面布局置于 layout，控件样式不再被低层全局选择器覆盖。旧结构图的主支线色保持独立，不将主线语义直接映射为通用 primary。

## Typography

页面标题、导航、任务和控件使用相同 sans 字体。作品名 15px/600，导航 13px，分组说明 12px，非交互待办计数 11px，控件通常 14px。正文阅读区的衬线排版独立保留；不使用全局 Preflight 重置它。

## Layout

桌面侧栏 236px，内容列 `minmax(0,1fr)`；720px 及以下切为移动标题栏与左侧 Sheet。移动 Sheet 宽度不超过 20rem/90vw，固定标题与关闭按钮，目录独立滚动。跨回桌面自动关闭 Sheet 并释放焦点/滚动锁。

## Elevation & Depth

页面、资料卡和任务卡使用中性填色与细边框，不加装饰渐变和侧边状态条。Sheet 通过遮罩和官方 overlay 阴影表达覆盖层级；业务状态同时有文字，不能只靠色彩。

## Shapes

控件基准圆角 8px，导航项 6px，任务卡 10px。手机操作目标至少 44px。焦点使用 ring token，可见且不改变布局。

## Components

已接入 Button、Badge、Separator、Sheet、Dialog、AlertDialog、Input、Textarea、Select、Checkbox、Switch、Tooltip、Popover、Toggle/ToggleGroup、Collapsible、Alert 官方源码，来源与适配记录在 `web/src/components/ui/README.md`。`controls.tsx` 组合异步按钮、可清空数字输入、多选和业务弹层；不依赖另一套 UI 框架。Chip 是业务状态到 Badge 的映射，保留 warning/info/danger 语义，并透传事件、说明与 ref。Button 默认不提交表单。移动导航具备焦点循环、Escape 和焦点恢复；受控业务弹层显式归还触发按钮焦点，联开弹层时不抢新弹层焦点。弹窗固定标题/底部操作，正文独立滚动。Textarea 显式 rows 时固定行数并内部滚动；聊天输入最小 124px，仅输入框显示聚焦 ring。所有装饰图标使用 Lucide 并隐藏于辅助技术。

## Do's and Don'ts

消息正文下方的复制、编辑与重试操作只显示图标，桌面32px按钮、手机44px触控区域。使用中性色与ghost样式，悬停/聚焦显示操作提示，保留无障碍名称；复制成功以勾选图标反馈。

- 使用语义 tokens 和实际组件源码；新增控件组合放在应用层，不重新引入 Ant Design。
- 业务变更先检查 API 参数、空值和确认边界；组件替换不能让候选立即成为正式事实。
- 不用 emoji/字符代替图标，不在普通标签里加入只用于实现调试的信息。
- 组件迁移完成不代表模型稳定性或175章逐章反推验收完成；证据范围见交付报告。
- 整项目导入预览可逐文件纠正分类，正文与资料分别计数；自动整理阶段与导入保存阶段分开反馈。大纲节点使用“资料推断”文字、虚线与可展开出处，未知章号不填0，也不提供正文定位按钮。

## 白板质量收尾（2026-11-01）

手机（≤720px）点选或按Enter/Space打开节点时，以底部Sheet展示有界滚动的详情；仅聚焦不弹层。Escape/关闭返回节点，保留画布与坐标；切回桌面恢复详情栏，不残留遮罩。沿用已有Radix/shadcn组件，无新动画库。

白板颜色读取tokens.css中的background/card/input/ring及专用canvas-panel/planned/grid/edge/node-border。公共字号尺度为11/12/13/14/18/20px，圆角4/6/8/12px；颜色源统一，几何尺寸仍由React Flow布局决定。


## 主题与关系动效（2026-11-01）

主题为浅色、深色和跟随系统。默认保留深色；作品库、作品导航、手机页头与独立供应商页使用同一图标Select入口。首屏脚本在样式加载前恢复浏览器偏好，跨标签与系统变化同步；公共语义token覆盖正文、提示、弹层和React Flow画布，结构权重颜色保留语义。

动效仅用于人物关系图，沿用当前圆周坐标、人物/关系数据与正文来源边界，不改其他视图布局。聚焦人物时，正式正文关系显示少量往返粒子（上限24），细线、无辉光、无背景星尘；粒子仅强调关联，不编码因果方向或关系强度。仅设定关系保留静态虚线。可暂停，页面隐藏或系统减少动态时停止；鼠标、键盘和触屏均可选择，表格保留关系方向、历史及正文定位。
