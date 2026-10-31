# 按本章计划扩写与剧情白板排期

**Goal:** 修复通用补写要求与场景不匹配、固定章末插入引发重复的问题；将剧情白板排为下一项。

**Architecture:** C7 从 ChapterPlan 生成适用的补写目标。纯短稿修订冻结原稿段落目录，让模型选择合法插入编号，代码校验并拼接；兼容已经保存的旧 insertionOffset。模型仍只有一轮修订，不调整字数与采用规则。当前主代理独立执行和复核。

**Tech Stack:** TypeScript、Vitest、现有 Chat 模型。

- [x] RED：计划适配、选择较早扩写位置、未知编号失败关闭、原稿字节保留。
- [x] GREEN：更新 src/gate/route.ts、src/task/automatic-revision.ts、src/task/rewrite.ts、src/task/types.ts，新增段落范围纯函数模块。
- [x] 复验现有暂停恢复、旧稿件兼容、混合缺项与一轮修订上限。
- [x] 三轮独立夹具真实复跑，均因字数不足停下；记录在报告中。全量串行测试、类型检查、构建通过。
- [x] 写剧情白板首版范围与分批实现顺序，更新 MEMORY 队列；随当前 PR 提交。
