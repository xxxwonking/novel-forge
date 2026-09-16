# 资料手改表单实施计划

> **执行方式：** 当前代理独立实现、测试与复核，不使用独立 Agent、不调用真实模型。依据 2026-09-16 差距盘点第 1 项（用户已确认从该项开始），范围锁定「改 + 增」，不做删除。

**Goal:** 作者在作品资料页直接手改人物、地点／组织、情节线与章节计划，不必只能通过对话让 Agent 改。改完能从空书一路搭到「第 N 章资料已就绪」。

**Architecture:** 后端 `/api/preparation/author` 早已支持这些字段（`PREPARATION_CHANGES_SCHEMA`），缺的只是界面。所以本批是**纯前端 + 契约测试**，不改后端业务逻辑。新增一层 `preparation-changes.ts` 负责把服务端实体裁成 schema 精确形状，四个 antd Modal 编辑器负责录入，两者用同一份类型定义。

**Tech Stack:** React、antd 6、TypeScript、Vitest（根目录契约测试）、Playwright。

## 为什么需要「裁剪」这一层

`changes` 按 `id` / `chapter` **整体 upsert**，服务端 schema 又是 `additionalProperties: false`，于是两个方向都会 400：

| 送错 | 服务端反应 |
| --- | --- |
| 把读回来的人物卡原样回传（多带 `provenance`/`updatedAt`/`introducedAt`） | 「不允许字段 introducedAt」 |
| 从表单字段凭空拼人物（少带 `speech.sentenceLength` 等没露面的子字段） | 「缺少 sentenceLength」 |

所以每个编辑器都是「**以服务端对象为底稿展开覆盖**」，再由 `characterInput` / `settingInput` / `plotLineInput` / `beatInput` 只挑选 schema 认得的字段。`beatInput` 还会丢掉 `budget` —— 那是纯代码派生物，回传等于让客户端自报预算。

## 设计与边界

- **编号不可改。** upsert 按 `id`/`chapter` 定位，改编号等于新增一条并留下旧的。编辑既有条目时编号输入框锁住，只有新增时可填。
- **不做删除。** 不传某个 ID 只是「不动它」。删除涉及引用完整性（被节拍表点名、被称谓表引用、被已采用正文引用），用户已确认留作下一批。
- **沿用既有 impacts 闸门。** 改了已出现人物的姓名／档案、或已采用章的计划，`build()` 会判为影响既有正文，方案落为**候选**而不自动确认。这是既有保护，不绕过、不放宽。
- **列表字段用「一行一条」文本框**，与既有基本设定表单的写作规则一致；空行自动丢弃。外貌、称谓、事件、埋设、兑现这类定长条目用行式列表，可增可删。
- **客户端守卫只挡明显错误**（未点名人物/地点、正例台词为空），其余交给服务端 schema 与业务校验，避免两套规则各说各话。
- **新增空白底稿必须本身能通过 schema**：`emptyCharacter` 的句长上限给 40（`max` 必须 ≥1）、`emptyBeat` 预置一行空白事件并默认点名主角与第一个地点。

## Task 1：载荷契约与裁剪函数

**Files:** 新建 `web/src/preparation-changes.ts`；修改 `web/src/api.ts`。

- [x] 修正 `web/src/api.ts` 的 `PreparationContent`：原 `characters[].speech` 只声明 4 个字段（实际 11 个）、`profile.appearance` 缺 `establishedAt`/`immutable`。类型不实会让「从表单构造对象」静默丢字段。
- [x] 定义出站形状 `CharacterInput`/`SettingInput`/`PlotLineInput`/`BeatInput` 与 `PreparationChanges`，`api.ts` 从同一处 re-export，避免两份定义走样。
- [x] 输入侧数组一律 `readonly` —— 服务端实体是 `readonly string[]`，可变类型接不住。
- [x] `addressForms[].condition` 为空时省略而不是给 `undefined`（`exactOptionalPropertyTypes` 下两者不同）。

## Task 2：根目录契约测试（先写失败）

**Files:** 修改 `test/preparation.test.ts`。

- [x] 只改说话方式时，其余说话字段与身份字段原样保留。
- [x] 服务端人物卡必须裁掉只读字段才能提交（原样回传报「不允许字段 introducedAt」）。
- [x] 新增人物、新增／修改地点与情节线。
- [x] 改未采用章计划：`budget` 被裁掉并由代码重新派生；原样回传带 `budget` 的节拍被拒。
- [x] 改已采用章计划只形成候选并列出受影响章节。
- [x] 新增章计划能通过写章装配校验（预算可派生）。

首轮 3 项失败暴露了三个真实约束：`sentenceLength.max` 必须 ≥1、`event` 章必须有事件、改已采用章的计划必然走候选。均按上述规则修正，未放宽校验。

## Task 3：四个编辑器

**Files:** 新建 `web/src/components/PreparationEditors.tsx`；修改 `web/src/pages/Preparation.tsx`、`web/src/styles.css`。

- [x] `CharacterEditor`：身份、档案、外貌键值表（含 `immutable`）、说话方式全字段、称谓表。
- [x] `SettingEditor` / `PlotLineEditor`。
- [x] `BeatEditor`：章节类型、核心事件、阶段反馈、章末钩子、出场人物/地点多选、计划事件、埋设、兑现。
- [x] 每份实体单独保存，摘要写明改了谁（「作者修改人物「沈砚」」）；打开表单时的指纹由服务端提交时再核对。
- [x] 只读视图按段加编辑／新增入口；方案预览复用同一组件但不传 `onEdit`，那里不能编辑。

## 验证

- `npm run typecheck`（根 + web）、`npm test` **49 文件 / 976 项通过**（969 基线 + 7 条契约测试）、`npm run web:build`、`git diff --check` 全通过。
- Playwright + Chromium 实机走通 15 项：空书 → 新增主角（含说话方式）→ 新增地点 → 新增情节线 → 新增第 1 章计划 → 取消点名时守卫拦截 → 重选 → 编辑人物语言并核对**未露面的子字段没被抹掉** → 刷新保留 → 补基本设定后提示「第 1 章资料已就绪」→ 方案记录留痕 → 390px 无横向溢出 → 无脚本错误。
- 证据：`C:/Users/Administrator/AppData/Local/Temp/nf-manual-edit/`（`drive.mjs`、`verification.json`、`preparation.png`、`editor-mobile.png`）。**0 次真实模型调用**，测试服务已停；主目录 5174 端口的既有服务未动。

## 未做（明确记录，非遗漏）

- **删除**人物／地点／情节线／章计划：需要扩 schema 与 `build()` 并加引用完整性校验（被节拍表 `characters`/`locations`/`plotLine` 引用、被他人称谓表 `target` 引用、被已采用正文引用的不能删）。用户已确认留作下一批。
- 情节线编号在事件行里是**下拉选择**而非自由文本，是为了避免输入不存在的 `P_xx`；但 `resolves` 的伏笔编号仍是自由文本（视图只提供「已规划」伏笔，不含已埋设的全部 open 伏笔，补全需要扩 API），依赖服务端报错文案提示。
- `/api/preparation/author` 没有 `requestId`：响应丢失后重试会多留一份同内容方案（`propose` 的去重只在 `proposed` 状态生效）。与本批前的行为一致，未新增。
