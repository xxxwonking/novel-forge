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
