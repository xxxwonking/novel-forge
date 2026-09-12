# Stage 2·切片 2：作品准备（多作品 + 对话式筹备）

2026-09-11 / 分支 `stage2-work-preparation` / 基线 master `aeff8b3`（PR #2 已合）

## 目标

把 Stage 2 的入口补全：**从空工作区新建一本书，用对话把方向/人物/地点/情节线/写作纪律/首章节拍定下来，直到「可以写章」**。切片 1 已经能对话写章/采用，但作品必须事先由 seed 脚本造出来 —— 这一片补掉这个缺口，并顺带把单作品服务变成多作品工作区。

## 范围决策

- **多作品用「活动作品指针」而非每请求带 work id。** 服务是单用户、绑 127.0.0.1、已按作品缓存 `ProjectSession`。活动指针让既有全部端点与前端调用零改动，只在最外层把 session 从「构造期钉死的一个」换成 `workspace.active()`。代价：同一 server 同时只有一个活动作品 —— 对本地单用户工具可接受。
- **回兼单作品模式。** serve 的目录自身就是作品（含 `setting.json`，如 `data/demo`）时走单作品模式，活动恒为它、不支持新建。`npm run serve -- data/demo` 与既有测试照旧。
- **筹备写入走对话工具，不做表单。** 新建表单只填书名/题材/平台/目标字数（题材与平台决定预算与阈值派生，之后不改）；其余一律由 judge 模型在对话中调用增量字段工具落成。Web 的筹备面板**只读**。
- **编号由代码分配（§5.8）。** 模型永不生成 ID：`nextId("C"|"S"|"P", existing)` 取同前缀最大序号 +1。模型只能引用系统提示「筹备状态」里列出的编号；传了不存在的 id 即 `action_failed`。

## 实现

### T1–T2 多作品基础设施
- `src/server/workspace.ts`：`Workspace`（scan/list/create/select/active/session 懒建缓存）、`scaffoldSnapshot(seed)`（最小合法快照，premise/conflict 等**留空**交给对话，不编造内容）、`isGenre`/`isPlatform`、slugify + 去重 id。
- `api.ts`：`handleWorkspace` 前置 —— `/api/works*` 落工作区，其余解析活动作品（无则 **409**）后交给原 `handleAsync`。`http.ts`/`main.ts`：构造 Workspace、允许空目录（`mkdirSync`）。

### T3 持久化 + Session 筹备写入口
- `persist.ts` 补 `writeSetting`/`writeProfile`/`writePlotLines`。
- `state.ts` 补 `putSetting`/`putProfile`/`upsertCharacter`/`upsertSetting`/`putPlotLine`/`planChapter`（派生预算 + 记 `authored`），全部落盘 + 失效缓存。

### T4 筹备类 agent 工具（judge 增量字段）
- `src/agent/prep.ts`：`parse*`（只看形状与枚举，非法回错误串→模型自纠，不产 effect）/ `merge*`（部分字段 → 完整领域对象）/ `nextId` / `DEFAULT_SPEECH` / `bumpDisciplineVersion`（`d1`→`a1`→`a2`，版本变即缓存前缀冷一次）。
- `tools.ts` +7 工具（`get_direction`/`set_direction`/`upsert_character`/`upsert_location`/`define_plotline`/`set_discipline`/`plan_chapter`），共 19，顺序由 `EXPECTED_MAIN_AGENT_TOOL_ORDER` 守住。
- `plan_chapter` 两道闸：① 引用的人物/场景/情节线/未收伏笔必须已存在；② `validatePlan` 有 block（阶段反馈写"继续铺垫"、章末钩子空钩、回收章无收束…）→ 回 `action_failed` 并转述打回项，**不落盘**。过闸才 `planChapter` 落 `authored`，`nextPlanReady` 随之成立。
- 同一回合内筹备写入后重建 readSource，后续读工具不落后。

### T5 系统提示就绪度
- `MainAgentContextInfo.prep` + `prepGaps()`：缺项按「方向 → 人物 → 地点 → 情节线 → 节拍」顺序提示；已建对象以「编号 名字」列出（模型唯一合法的引用来源）。第三条硬规矩：编号由系统分配，绝不自造。

### T6 Web
- `pages/Works.tsx`：作品列表（进度/题材平台）+ 切换 + 新建（4 字段）。
- `App.tsx`：`/works` 路由；无活动作品（409）时整站强制停在作品页，导航只留「作品」。`hooks.ts` 的 `useFetch` 暴露 `errorStatus`（`ApiError` 带状态码）以区分 409。
- `Chat.tsx`：只读筹备面板（缺项 + 方向/人物/地点/情节线/世界观/禁忌）+ 6 个新 effect chip；每回合与采用后刷新面板。`GET /api/prep` 提供数据。

## 验证

- typecheck（根 + web）干净；`npm test` **636 通过**（602 基线 + 34：workspace 7 / server-works 6 / session-prep 4 / agent-prep-tools 14 / agent-system-prompt 3）；`npm run web:build` 通过。
- HTTP 层真实 smoke（临时工作区起服务 + curl）：空列表 → 409 → 新建即激活 → `/api/prep` 列全部缺项 → overview 200 → 非法题材 400 → 第二本 + 切换 → 未知 id 404 → 落盘两个作品目录。
- **真机 live 全流程（2026-09-12，Mac，真实 Gemini via chat 代理）**：新建《青州旧事》→ 5 个回合对话筹备（方向 6 字段 / C01+C02 人物 / S01+S02 地点 / P01+P02 情节线 / 第 1 章节拍 0 warn 落 authored）→ `gaps` 归空、`nextPlanReady` 为 true → 「按计划写第一章」真实生成 2562 字草稿 `ch1d1`（2 轮工具），C6 给出 4 项（1 block 字数差 155、1 warn 密度 0.93 超 0.4、1 warn 锚点引用未写出内容、1 info），状态 `needs_revision` → 随后「采用 ch1d1」**按设计被拒**（`action_failed`「草稿未就绪」），Agent 如实转述并给出修订/查看选项。
  - 全程编号由代码分配、模型只引用不自造，无一次 ID 伪造。
  - 尚未 live 验证：自动修订到 `ready` 后的采用与第 2 章续写。

## 已知限制

- 同一 server 同时只有一个活动作品（多标签页切作品会互相影响）。
- 人物同名即视为同一人（工具描述里已写明）；需要同名两人得先建再改名。
- 新建人物时在 `addressForms` 里自引用会失败（该编号尚未存在），第二次调用可补。
- `set_discipline` 每次调用都递增版本 → 冷一次缓存前缀；这是刻意的（纪律进 L1 缓存前缀）。
