# shadcn/ui 基础组件

本目录为真正的 shadcn/ui 源码组件，基于 Radix；不包装 Ant Design。使用 `web/components.json`（new-york、Radix、zinc、Lucide）。后续可从仓库根运行 `npx shadcn@4.23.0 info --cwd web` 核对配置，添加组件时继续使用该前端目录。

2026-10-31 从官方 registry 获取：

| 组件 | 官方来源 | 原始 JSON SHA-256 |
| --- | --- | --- |
| Button | https://ui.shadcn.com/r/styles/new-york-v4/button.json | 4b8d7d848742727973c1b088af8d15f0b628272a1316f2d2fa344e73ddff9e9c |
| Badge | https://ui.shadcn.com/r/styles/new-york-v4/badge.json | 0f988b37cf1c56e7ecc83b1dcf24c9af4e73ce4341da5caf2c9d9b07a551319b |
| Sheet | https://ui.shadcn.com/r/styles/new-york-v4/sheet.json | bdf118300491675f05a9181af491217ba690929338aefd108437c2b07d25432f |
| Separator | https://ui.shadcn.com/r/styles/new-york-v4/separator.json | 4242a9fe839cae9083acff1280b7cccfda10e97bbc83283aed12d2d12bebdc6a |

项目适配：`cn` 指向本地 clsx/tailwind-merge 工具；Button 默认 `type="button"`（显式 submit 仍支持，asChild 链接不带 type）；720px 以下操作目标至少 44px；Sheet 关闭文案中文化、支持 overlay class、减少动态效果偏好；Lucide 图标隐藏装饰语义。升级时保留这些行为并运行对应测试。

原组件遵循 [shadcn/ui MIT License](https://github.com/shadcn-ui/ui/blob/main/LICENSE.md)。底层依赖许可证见各 npm 包，包含 Radix MIT、class-variance-authority Apache-2.0、Lucide ISC 等，不能将所有依赖统称为 MIT。

## 全站迁移追加组件（2026-10-31）

官方 registry 与 JSON SHA-256：

- dialog：https://ui.shadcn.com/r/styles/new-york-v4/dialog.json；`0115e3a57aa55a978c5fed0d77f7e98edd694215aae3e569def3fff722ba9f26`
- alert-dialog：https://ui.shadcn.com/r/styles/new-york-v4/alert-dialog.json；`03c0d4de131a9b049e9080724666045c8785074af7e07040a0a0f922a810e7c2`
- input：https://ui.shadcn.com/r/styles/new-york-v4/input.json；`b1fffa12ba72ce30a291749012b47235eda110648b8106725ced22b5b31c8f1b`
- textarea：https://ui.shadcn.com/r/styles/new-york-v4/textarea.json；`2367d3964326b19ca2355f872d08153c86932abd4b103b5fd02039a3f2cb8ae5`
- select：https://ui.shadcn.com/r/styles/new-york-v4/select.json；`ca3189ea8101a04f144b6d0f0e7330841639bfa5f4d57e7cca0894d39b30817b`
- checkbox：https://ui.shadcn.com/r/styles/new-york-v4/checkbox.json；`567b649e4cd68c05bfdc58ca00fa04aee38bca291cd6f16ed7776ec06ba3d6bd`
- switch：https://ui.shadcn.com/r/styles/new-york-v4/switch.json；`cc526c3a4827be315be746355a988e22dacc99d663ed31924fd30c2507cdc005`
- tooltip：https://ui.shadcn.com/r/styles/new-york-v4/tooltip.json；`1b7b452b34beab05b22bd653963abd1c88ebd8e9ebcc89dcaebf4ac4938c929e`
- popover：https://ui.shadcn.com/r/styles/new-york-v4/popover.json；`78793171b536e0c335ad51b1313619e533566b514d3503ef60c94dc9d3ccfbef`
- toggle：https://ui.shadcn.com/r/styles/new-york-v4/toggle.json；`8c9f96fb87e2aa88961f4ded82fa9867ef0dadbc3e5ec51d16f1ebfa820037ea`
- toggle-group：https://ui.shadcn.com/r/styles/new-york-v4/toggle-group.json；`7b010cdf719088efdf887e392fbdc9fdd0b76d4f7b3b0e9db319616a90e8cf16`
- collapsible：https://ui.shadcn.com/r/styles/new-york-v4/collapsible.json；`fdc6666e9c728d7e731b0e4d67e11db81020aff47408c259549fc1aefcc8e3e7`
- alert：https://ui.shadcn.com/r/styles/new-york-v4/alert.json；`413c97869ec0e53efa4a37f590833bcf4a7a57255f5a2e909c6bb5bac7b4570d`

本地适配：`cn`、registry 引用改为本地 alias；Dialog 关闭文案中文化。应用组合见 `components/controls.tsx`，使用相同 Radix primitives，支持可空数字、选项多选、受控对话框及确认动作。没有遗留 Ant Design 实现。

应用适配：Textarea 显式设置 rows 时切为固定行高，避免长原稿撑满页面；受控 Dialog/Sheet 的焦点归还、滚动区及固定底部由 `../controls.tsx` 和 application.css 组合。官方基础没有引入 Ant Design。
