# 连续创作：排后面 K 章 + 授权连写到第 M 章（差距第 5 项上半场）

2026-09-17 / 分支 `continuous-run`（栈在 `works-first-screen` 之上）/ 基线 `ff40fcd`

## 目标

现在严格一次一章：写一章、看一章、采用一章、再排下一章。作者想「今晚让它写完这一卷」做不到。这一批做两件事：一次排后面 K 章的章计划，以及作者授权后逐章连写并自动采用到第 M 章。跨多章返修留下一批。

## 为什么连写必须配排章

写任何一章都要求该章有已确认的章计划（`buildChapterRunInput` 的前置条件），而章计划只有两个来源：「让 AI 起草」只排下一章，或作者手填。没有排章，连写到第二章就停。排章是卷循环 V1 的精简版：一次起草 K 份章计划落成**一份**方案，作者确认一次；V2 校验（阶段反馈黑名单、连续无反馈、伏笔期限未安排）在方案层已有，不重写。

## 范围决策

- **自动采用是「逐章采用」的显式例外**：只在作者授权一个范围时发生，且关键变化会打断。关键变化由代码判定：人物生死变化、关系变化、主线伏笔埋设、写作中提出的新人物/新设定建议。命中任一项 → 停在这一章，作者用现有结果页高亮确认后可再启动。
- **每章一次任务、逐章落盘**：复用 `ChapterWriter.write`，不另起图。停下只在章与章之间生效（与「停下」现有语义一致：当前章跑完、结果保留）。
- **运行状态落 `continuous-run.json`**：重启后能看到停在哪、为什么；进程里没有活动循环而文件说 running → 报 interrupted。
- **一次授权的章数上限**放 `rules.task.maxBatchChapters`，排章与连写共用；代码里没有数字。
- 连写期间作者手动写章/修订会被现有「已有稿件正在执行」拦下；反之运行中的任务存在时不能启动连写。

## 实现

- `src/run/service.ts`：`ContinuousRunService` —— `view / start / stop / acknowledge`、`keyChanges(draft)`、后台循环。
- `src/server/state.ts`：`run` 属性；`draftPreparation` 增加 `focus: "chapters"` + `count`。
- `src/server/api.ts`：`GET /api/run`、`POST /api/run/{start,stop,acknowledge}`；`/api/preparation/draft` 接受 `chapters` + `count`。
- `rules.yaml` + schema/load：`task.maxBatchChapters`。
- Web：`Drafts.tsx`「采用并连写到第 M 章」；`TaskPanel.tsx` 连写卡片（进度 / 停下 / 停下原因 + 链接）；`Preparation.tsx`「让 AI 排后面 K 章」；`api.ts`。

## 验证

先写失败测试 `test/continuous-run.test.ts`：两章自动采用并推进、人物死亡停下且不采用、需修订停下、缺节拍停下、作者中途停下在章间生效、重启后读到状态、超上限拒绝、运行中拒绝再启动、排 K 章方案含 K 份计划。四件套 + 浏览器端到端（脚本化替身，0 次真实调用）+ 真机 gemini-3-flash 排章加连写两章。
