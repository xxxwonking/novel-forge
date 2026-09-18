# 2026-09-18 当前代码审查报告

本轮对 `cross-chapter-revision` 分支（HEAD `0de5128`，base `master` `7df8960`）做整体排查，覆盖测试与类型、长篇规模下的耗时、规则与代码的一致性、依赖、以及上一批新增代码的边界。排查后按第 1 → 2 → 3 项的次序修掉了前三项；第四节（流式超时诊断）**未动代码**，理由见该节。修复内容与取舍记录在本文末尾的「本轮修复」一节。

排查时：62 个测试文件 1113 项通过。修复后：**62 个文件 1141 项通过（1 skipped）**，`typecheck` 与 `web:build` 干净，`npm audit --omit=dev`（公共源）0 漏洞。浏览器端到端复跑一次跨章返修全链路，使用脚本化模型替身，真实模型调用 0 次。用户作品与 `data/demo` 未作为排查对象。

前次审计是 `docs/reports/2026-09-15-code-audit.md`（基线 `c5b3359`，948 项测试）。其间合入约十个功能批次（antd 界面、方案层、旧作反推、连续创作、跨章返修），本报告只列**新出现或仍未处理**的问题。

## 一、上一批引入的回归（P1）· 已修

| 触发与影响 | 证据 |
| --- | --- |
| `revision-impact.json` 读坏之后，`ImpactStore.load()` 抛出 → `ReviseService.view()` 抛出 → **`/api/overview` 返回 500**。overview 被 `App.tsx` 在应用层拉取，所以**整个作品的所有页面一起失效**。又因为 `save()` 先调 `load()`，读坏之后也写不回去，界面没有任何自救路径，只能手工删文件。 | 见下 |

复现（工装 `~/.claude/jobs/nf-audit/.tmp-corrupt.mts`，临时工作区、空事件流、正常作品）：

```
正常 overview: 200
文件损坏后 overview 直接抛出 → revision-impact.json 读取失败：Expected property name or '}' in JSON at position 2
首页告警 /api/alerts: 200
```

`src/revise/store.ts` 头部注明了「读坏了直接报错，不静默当空」这条取舍，理由（空态会把「有未处理的返修」变成「没有」）成立；问题出在**调用点的选择**：同一份判断被 overview 继承，代价从「这一页看不到返修清单」放大成「整个应用白屏」。可选的收法有三种，取舍是产品判断，需作者定：

1. `view()` 吞掉读取错误、返回空清单 + 一条「清单读不出来」的显式状态（保住 overview，返修页单独报错）；
2. overview 改用不读清单的计数源；
3. 保留抛错，但给一个界面上的「重建返修清单」入口。

## 二、长篇规模（P2）· 已修

产品目标是百万字长篇，此前没有在长篇下实测过。补测（工装 `.tmp-scale.mts`，每章 3000 字、每 5 章一条伏笔、每章 6 条状态变化，单位毫秒）：

| 章数 | 开库 | 投影 | 指纹 | 装配 | 进度 | 返修清单 |
| --- | --- | --- | --- | --- | --- | --- |
| 300 | 23 | 15 | 8 | 3 | 46 | 0 |
| 1000 | 50 | 53 | 23 | 5 | 444 | 0 |
| 2000 | 87 | 170 | 47 | 6 | 1720 | 1 |

2000 章 ≈ 600 万字，已超过目标一个量级。开库、装配（L2/L3 装配 + 章节输入）都是线性且很便宜；**唯一的问题是 `buildStoryProgress`**，300 → 1000 涨 9.7 倍、1000 → 2000 涨 3.9 倍，是实测的二次增长。

两处让它比应有的更贵：

- **它没有缓存。** `ProjectSession.derived` 有 `this.cache ??= this.recompute()`，`storyProgress()` 直接 `return buildStoryProgress(this)`，每次调用重算。
- **它在按条循环里扫全量事件。** `src/alerts/progress.ts` 第 40 行（每条伏笔做一次 `events.filter`）、第 86/91 行（每个人物做一次 `events.filter` / `findLast`）、以及伏笔循环内嵌的 `for (const beat of beats)`。改成先按编号建一次索引即可降到线性。

影响面：`/api/alerts`（全部提示页）与 `/api/issues` 会调它，主 Agent 的 `getStoryProgress` 工具也会。`/api/overview` **不**调它，所以不是每页都付这个钱。

## 三、规则与代码的分歧（P2）· 已修

三处，前两处是同一概念存了两个值：

| 位置 | 问题 |
| --- | --- |
| `src/context/build-l2.ts:33` | `DUE_SOON_WINDOW = 5`，与 `rules.yaml` 的 `crossChapter.foreshadowDueSoon: 3` 是同一个概念。后果是**模型在 L2 索引里看到的「临近」比代码判的早 2 章** —— `gate/cross-chapter.ts:64` 与 `alerts/compute.ts:107` 都读 rules 的 3 |
| `src/chapter/c5-crosscheck.ts:145` | 打回文案里写死「补写该条收束 300-400 字」，而 `rules.yaml` 的 `resolutionPatchWords: [300, 400]`（`gate/route.ts:53` 读它）才是真值。改规则，这句给模型的提示就开始撒谎 |
| `test/rules.test.ts` 的 `SCANNED` | 「代码里没有数字」的扫描只覆盖 `beat/gate/text/store/alerts/anchor/view` 七个目录。`context/ chapter/ import/ revise/ run/ agent/ task/ server/ planning/ preparation/ export/ metrics/ workspace/` 全在扫描之外 —— 上面两条正是因为不在范围内才没被挡住 |

顺带记录，`src/context/` 里还有一批同类常量：`MINOR_CHARACTER_WINDOW = 20`、`SYNOPSIS_DECAY = { recent: 8, mid: 30, midBucket: 5, farBucket: 15 }`、`L3_TOKEN_BUDGET = 5000`。它们与「阈值随章节类型/题材/平台派生」不是一回事（更像上下文布局常量），**是否该进 `rules.yaml` 需要产品判断**；但在判断之前，扫描不覆盖它们等于这条防线在那一半代码上不存在。

## 四、队列头「流式空闲超时」的诊断需要重做

上一批收尾时把「流式响应没有空闲超时，真机一次调用挂了 940 秒」记为待办（仓库 `MEMORY.md` §33 末）。本轮核了一遍，**这个说法按字面不成立，940 秒也讲不通**，建议不要带着它进入下一批。

代码事实：`src/client/chat.ts:42` 把 `AbortSignal.timeout(this.capabilities.timeoutMs)`（默认 300000，`CHAT_TIMEOUT_MS` 可配）挂在 `fetch` 上。这是**总预算**，覆盖到响应头也覆盖读流体。

实测（工装 `.tmp-timeout.mts`，自建只发心跳不结束的 SSE 服务器）：

```
配置超时 3000ms → 实际 3009ms 返回 {"kind":"error","error":{"type":"connection",...,"message":"The operation was aborted due to timeout"}}
```

即流开始之后超时仍然生效，会按时放弃并带回 `partialText`。所以「没有超时」是不对的，有一个 300 秒的总闸。

对不上的地方在 940 秒本身。`~/.claude/jobs/nf-run-browser/live-chapters-draft.log` 记录同一次真机运行的 call#1/2/3 分别是 2438 / 7585 / 14910 ms，call#4 是 `error 940959ms`。`pmset -g log` 显示当天 07:05–08:25 之间机器反复睡眠与暗醒，单段睡眠 330–979 秒（07:58:47→08:13:04 计 857 秒，08:13:49→08:21:43 计 474 秒）。按 940959 ms 与日志落盘时间反推，该调用发出于 08:09:39——**那一刻机器正在睡眠**，进程不可能在此时发起请求。三种读法（墙钟计时、单调计时、进程被冻结）都算不出一致的账。

结论：**940 秒目前没有可验证的解释。** 下一步不是改超时，是先给调用加墙钟与单调两个时间戳、复跑一次真机，看差值出现在哪一段。除此之外还有一条与睡眠无关、无条件成立的缺口值得单独记：**300 秒是总预算而不是空闲预算** —— 代理只要持续滴字符，一次调用就能一直烧到 300 秒才被砍；对 2000 字以上、思考开启的章节，300 秒并不宽裕，且被砍时整次生成的代价已经付掉了。

## 五、查过、确认没问题的

- **全量验证**：`npm test` 62 文件 1113 通过（1 skipped）；`npm run typecheck`（含 web）干净；`npm run web:build` 通过。
- **依赖**：7 个运行时依赖，无新增。`npm audit --omit=dev --registry=https://registry.npmjs.org` 报 0 漏洞。注意本机默认源 `registry.npmmirror.com` **不实现 audit 端点**，直接 `npm audit` 只会回 `NOT_IMPLEMENTED`，需要显式换源才有结论。
- **返修闸门的范围正确**：`assertCanStart` 只在 `src/run/service.ts:109`（连写启动）被调用，单章手写路径不经过它 —— 与 2026-09-18「未处理的硬矛盾只挡连写不挡单章」的拍板一致。
- **连续创作的进程外状态**：`src/run/service.ts` 把运行态落 `continuous-run.json`，并明确处理「文件说 running 而进程里没有活动循环」= 被杀，报 `interrupted`，不假装还在跑。
- **浏览器端到端复跑**（`~/.claude/jobs/nf-revise-browser/harness.mts`，脚本替身，**0 次真实调用**）：第 1 章结果页采用前预览给出「采用这一稿会牵连后面 2 章 / 第 3 章的事实会直接对不上」→ 采用 → 导航亮起「跨章返修 2」→ 清单里第 2 章「建议复核」、第 3 章「必须处理」且理由是「本章收束的伏笔 F01 已经不再埋设」→ 点「也查一下」手动查第 2 章，模型编造的引文被丢弃并如实说明「引用的原文在本章里找不到，已丢弃」。全链路通过。
- **上轮记的一条 UI 问题作废**：此前怀疑「手动检查章号的 `InputNumber` 从空值开始、按钮恒灰」。实测该控件 `value=2`、`aria-valuemin=2`、未禁用，点击后正常工作（无障碍快照里显示的 `valuemax="0"` 是快照渲染产物，DOM 上并无该属性）。**不需要修。**
- **上一批新代码的性能**：2000 章下 `session.revise.view()` 耗时 1 ms，不是瓶颈。

## 六、复现方式

工装已移出工作树，避免污染仓库根目录：

```
~/.claude/jobs/nf-audit/.tmp-scale.mts      # 长篇规模（N=300|1000|2000 npx tsx）
~/.claude/jobs/nf-audit/.tmp-corrupt.mts    # 清单读坏的连锁反应
~/.claude/jobs/nf-audit/.tmp-timeout.mts    # 流式超时是否生效
~/.claude/jobs/nf-revise-browser/           # 跨章返修浏览器工装（替身）
~/.claude/jobs/nf-run-browser/              # 连续创作浏览器工装（替身）
```

前三个脚本按仓库根目录写相对导入，复跑时需复制回根目录。

## 七、本轮修复

顺序按优先级：先收回归，再修性能，最后归位分歧。全部改动落在 `cross-chapter-revision` 分支，与 PR #11 一起走 —— 第 1 项修的本来就是那条分支自己引入的回归，合入前就该修掉。

### 第 1 项 · 清单读坏不再拖垮应用

- `ReviseView` 新增 `error`；`view()` 读坏时返回空清单加原因，overview 与每个页面照常起得来。
- **`assertNoConflicts()` 不走 `view()`**，直接读文件并在失败时抛 409：读坏时 `view()` 报 0，闸门若跟着报 0 就是静默放行连写，而那份读不出来的清单里可能正压着没处理的硬矛盾。**失败关闭。**
- `view()` 的容错只包住读文件这一步。把 `buildView` 也包进去的话，那里真出程序 bug 会被说成「清单读不出来」，而重建会据此把一份**完好**的清单归档 —— 那才是真丢数据。
- 新增 `ImpactStore.moveAside()` 与 `POST /api/revision/rebuild`：坏文件**改名留档**（`revision-impact.json.broken-<时间戳>`）再起空清单，界面把留档名说给作者。只在确实读不动时才允许重建，否则这是一键抹掉进度的按钮。
- 回归测试 6 项；浏览器实测：采用早章 → 写坏文件 → 页面给出横幅与真实错误、导航计数归零 → 点「重建清单」→ 提示「原文件留档改名为 …，没有删除」，磁盘上两份文件俱在。

### 第 2 项 · `buildStoryProgress` 的二次增长

三个来源，缺一不可：

1. `progress.ts` 里每个伏笔 / 每个人物 / 每条情节线各扫一遍全量事件与节拍表 → 改成一次性分桶（`byForeshadow` / `byCharacter` / `byPlotLine` / `beatsBy*`）。分桶只换查找方式，桶内仍是原数组顺序，判定与输出不变。
2. `session.currentChapter` 是 `Math.max(...chapters.keys())`，每次调用都要展开全部章号，而它被 `verified()` 逐条调到 —— 只取一次。
3. `storyProgress()` 没有缓存（`derived` 有、它没有）→ 与 `derived` 同构地缓存，`invalidate()` 里一并清。

| 章数 | 投影 | 进度（修前） | 进度（修后） |
| --- | --- | --- | --- |
| 300 | 13 | 46 | 2 |
| 1000 | 52 | 444 | 9 |
| 2000 | 175 | 1720 | 9 |

新增测试 3 项（缓存复用与失效、按名称排的埋设安排两条路径 —— 后者此前**一条测试都没有**，是这次改写里最绕的一处，已用变异测试确认它咬得住）。

### 第 3 项 · 分歧归位与扫描

- `DUE_SOON_WINDOW` 从 `build-l2.ts` 删除，改由调用方从 `rules.crossChapter.foreshadowDueSoon` 传入（`L2BuildInput.dueSoonWindow`）。**行为变化：L2 索引里标 `due_soon` 的伏笔比原来少 2 章**，从此与 gate / 告警同源。
- `c5-crosscheck.ts` 的「补写该条收束 300-400 字」改从 `rules.resolutionPatchWords` 生成（`ChapterRunInput.patchWords`）。
- 扫描扩到 `src/context`、`src/metrics`、`src/types`。新增**具名登记**机制：登记过的常量声明内部，数字不再视为回退；登记按声明名，所以新加一个阈值常量仍会被挡住（实测：往 `build-l2.ts` 塞 `FORESHADOW_STALE_WINDOW = 7` 立即失败）。每条登记都必须写理由，另有一条测试守着理由非空。
- 三处裸数字提成具名常量并登记：`CJK_TOKENS_PER_CHAR`、`EXCERPT_MAX_CHARS`、`HIT_TOLERANCE`、`LAST_CACHEABLE_SEGMENT`。

**逐条定性（这是我替你拍的板，若要改归属现在说最省事）：**

| 常量 | 归属 | 理由 |
| --- | --- | --- |
| `DUE_SOON_WINDOW` | **进 rules.yaml** | 与 `crossChapter.foreshadowDueSoon` 是同一概念两个值，这是本轮的 bug 本体 |
| `MINOR_CHARACTER_WINDOW` / `SYNOPSIS_DECAY` / `L1_TOKEN_BUDGET` / `L3_TOKEN_BUDGET` | 留原地，登记 | §13 的上下文**布局**预算。它们决定模型看到多少，但不随章节类型/题材/平台派生 —— 挪进 rules.yaml 会把这个文件从「故事约束」稀释成「什么都放」 |
| `MIN_CACHEABLE_TOKENS` | 留原地，登记 | 上游 API 的事实，不是我们的设定 |
| `HIT_TOLERANCE` / `LAST_CACHEABLE_SEGMENT` | 提成具名常量后登记 | §13.8 度量契约与段序，结构不是阈值 |
| `L2_REBUILD_LIMITS` / `M1_CACHE_TARGETS` / `C5_LIMITS` | 留原地，登记 | 落盘格式契约与验收门槛，不参与运行期判断 |
| `EventWeight` / `ContextSegment` | 留原地，登记 | 类型字面量，取值本身就是格式定义 |

新增测试 2 项（邻近截止标记跟着传入窗口走、登记常量都写了理由）。

### 未做

第四节（940 秒）**没动代码**。理由不变：超时是存在的、会按时放弃，只是那 940 秒在墙钟、单调时钟、进程冻结三种读法下都算不平。先加双时间戳复跑真机，再决定改什么 —— 照着一个没验证的诊断去改超时，改对了是运气。
