---
name: novel-forge
description: 分批迁移中的小说创作工作区，shadcn/ui 外壳与公共控件
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

用户已指定真正的 shadcn/ui 与深色中性色方向。本文件从首批实际实现提取，仅规范已迁移的外壳和公共控件；后续页面按迁移计划接入。旧页面仍有衬线标题、渐变面板和 Ant Design 控件，不能把它们当作新页面继续沿用的规范，也不能宣称它们已迁移。

## Colors

运行时颜色源为 `web/src/styles/tokens.css`；Tailwind 通过 `@theme inline` 引用语义变量，过渡期 Ant Design 在入口读取相同变量。CSS layers 顺序为 theme → antd → legacy → base → components → utilities。旧结构图的主支线色保持独立，不将主线语义直接映射为通用 primary。

## Typography

导航、任务和控件使用相同 sans 字体。作品名 15px/600，导航 13px，分组说明 12px，非交互待办计数 11px，控件通常 14px。正文阅读区的衬线排版独立保留；不使用全局 Preflight 重置它。

## Layout

桌面侧栏 236px，内容列 `minmax(0,1fr)`；720px 及以下切为移动标题栏与左侧 Sheet。移动 Sheet 宽度不超过 20rem/90vw，固定标题与关闭按钮，目录独立滚动。跨回桌面自动关闭 Sheet 并释放焦点/滚动锁。

## Elevation & Depth

任务卡使用中性填色与细边框，不加渐变和侧边状态条。Sheet 通过遮罩和官方 overlay 阴影表达覆盖层级；业务状态同时有文字，不能只靠色彩。

## Shapes

控件基准圆角 8px，导航项 6px，任务卡 10px。手机操作目标至少 44px。焦点使用 ring token，可见且不改变布局。

## Components

已接入 Button、Badge、Separator、Sheet 官方源码，来源与适配记录在 `web/src/components/ui/README.md`。Chip 是业务状态到 Badge 的映射，保留 warning/info/danger 语义，并透传事件、说明与 ref。Button 默认不提交表单。移动导航具备焦点循环、Escape 和焦点恢复；所有装饰图标使用 Lucide 并隐藏于辅助技术。

## Do's and Don'ts

- 使用语义 tokens 和组件源码；分批替换旧控件，不创建底层仍调用 Ant Design 的同名外观包装。
- 兼容层必须有移除边界；完成所有页面前保留旧 provider，不能提前删除以求依赖数字清零。
- 不用 emoji/字符代替图标，不在普通标签里加入只用于实现调试的信息。
- 不把后续批次的未验收页面或模型流程列为已完成。
