# novel-forge 工作记忆

更新时间：2026-09-16（Asia/Shanghai；本轮为资料手改表单，差距盘点第 1 项；“继续完成项目”总目标保持暂停，最新进展见第 21 节）

记录范围：本文件汇总项目调研、用户流程设计、能力映射和开发进展。Stage 1 见第 12 节，写章 API 见第 13 节，Gemini 真实单章见第 14 节，对话式主 Agent 见第 15 节，国内模型兼容见第 16 节。**接手先读第 21 节（资料手改表单），产品差距盘点仍见第 20 节（可直接当任务清单；第 1 项已闭合，余 9 项待指定），再按需读第 19 节、第 18 节、第 17 节末尾和 `docs/superpowers/plans/2026-09-14-project-completion.md`。界面已引入 antd 6 重做并支持对话流式输出；最新 49 文件 / 976 项测试、两个类型检查与 Web 构建通过，提交状态以 Git 历史核对。Gemini 真实验收《雾港封签》三章（ch1d3 / ch2d4 / ch3d4，共 9745 字）已逐章采用并完成 1–3 章固定版本 TXT 导出，累计 62 次真实调用。尚未完成：作者要求传递修复后的真实 C4 复测、三章正文人工核对、用户流程 §10 全项审计与最终验收报告。沿用 LangGraph、当前代理独立实施与复核；不擅自恢复暂停的总目标或调用 Claude。**

## 1. 当前状态与接续位置

- 用户正在开发小说 Agent，已实现一部分代码，目前希望理清产品和后续开发方向。
- 前期完成了：阅读项目核心源码和历史记忆；核对工程进度；调研 LangChain / LangGraph 官方 JavaScript 文档及 OpenFic 核心实现；梳理首版用户流程；将作者操作映射到现有模块与缺口，提出能力建设顺序。
- ~~当前处于用户流程设计与能力映射阶段。尚未选定流程框架，尚未开始本轮讨论对应的新功能开发。~~ **已过时（2026-09-10 下午）**：用户已评审并锁定 v1 决策（逐章采用、引入 LangGraph JS、不用 Codex/Gemini），Stage 1「可靠的章节任务基础」已实现并提交（第 12 节）。
- 前期设计整理只新增本 MEMORY.md、docs/superpowers/specs/2026-09-09-novel-forge-user-flow-design.md，以及同目录的 2026-09-09-novel-forge-user-flow-capability-map.md，没有实现新功能或安装编排框架。2026-09-10 的发布准备另补充 README、忽略规则和 Node.js 类型依赖，见第 10 节。
- **现接续入口是第 18 节及第 17 节末尾的真实验收保存点**：官方／代理 Chat 兼容、作品准备、创作/修订/采用、建议采用、故事安排、伏笔生命周期和固定版本 TXT 导出已实现。最新完整 948 项测试、类型检查和构建通过；本轮修复中断片段、未完成响应、HTTP 与凭证边界、Windows 会话及 Web 页面问题。真实连续验收尚未完成；用户 Gemini 配置未切换，DeepSeek 官方仍需对应凭证。不要重复仓库调研、模型适配或框架讨论。
- 助手提出的建议不等于用户批准的决策；下文分别标注。
- 2026-09-09 的独立审查曾成功提出两项缺口：结构误读的纠正入口、生成中离开页面后的行为。两项均已补入流程草案及能力映射；之后的复核因服务限流失败。
- 2026-09-10 早前曾再次尝试独立复核，仍因模型服务 rate limit 未完成。用户随后明确要求不使用独立 Agent，后续复核统一由当前主代理完成；不再将独立代理服务可用性作为后续工作的前置条件。
- 用户随后明确授权把当前代码提交到 https://github.com/xxxwonking/novel-forge.git。该授权涵盖现有项目进展与本次文档的提交、推送，不代表批准实现全部流程草案。
- 前期主代理已完成用户流程与能力映射的文档复核，并补清待采用稿与续写、基础导出、工具循环接入顺序三处说明。内部复核不等于用户批准全部草案；后续已确认的 v1 决策见第 3 节。

## 2. 项目与参考资料

- 当前项目：C:/Users/Administrator/Desktop/novel-forge
- 当前交接文件：C:/Users/Administrator/Desktop/novel-forge/MEMORY.md
- 首版用户流程评审草案：C:/Users/Administrator/Desktop/novel-forge/docs/superpowers/specs/2026-09-09-novel-forge-user-flow-design.md。
- 用户流程与现有能力映射：C:/Users/Administrator/Desktop/novel-forge/docs/superpowers/specs/2026-09-09-novel-forge-user-flow-capability-map.md。包含作者操作、可复用模块、衔接缺口和建议的开发顺序。
- 用户提供的历史记忆索引：C:/Users/Administrator/Downloads/MEMORY.md。它只是多个项目的索引，不是本项目的完整进度记录。
- 用户提供的小说项目记忆：C:/Users/Administrator/Downloads/agent-aggregation-platform.md。
- 历史记忆引用的创作规范：C:/Users/Administrator/Downloads/novel-engine.md，文件存在，本轮阅读了部分定位、规划和质量审查内容。
- 历史完整设计文档位置为 /Users/others/Desktop/agent-platform-design.md。本轮未在对应的 Windows Desktop / Downloads 路径找到完整设计文档，不能声称已经阅读其全文。
- 历史文件中的 /Users/others/... 是旧 Mac 环境路径；当前工作环境是 Windows / PowerShell。
- 主要参考仓库：https://github.com/syrizelink/OpenFic 。用户明确说本项目主要借鉴该仓库，同时融入自己的想法。

## 3. 用户明确确认的方向

- 产品是小说创作 Agent / 创作工作区，服务持续的小说创作。
- 需要保留 OpenFic 式的交互：用户通过对话下达任务，Agent 根据意图自主选择工具和推进任务。
- 用户明确要求：先从用户使用的角度梳理总体流程。
- 用户明确要求：不使用独立 Agent，当前协作中的复核统一由本代理完成。接续时沿用此要求，不再发起子代理复核。
- 工作记忆只记录小说项目的进展、决策与待办，其他临时任务不纳入。
- 早期框架未定；已被下方 Mac 会话确认的 LangGraph JS 决策覆盖。
- 用户要求保存工作记忆后又说“continue”，本轮据此继续细化用户流程并保存草案。继续细化不等于已经批准所有产品默认行为、框架或实现计划。
- **2026-09-10 下午（Mac 会话）用户明确拍板，勿再重复讨论**：① 创作节奏 = 逐章采用（+「采用并继续」衔接），关键变化采用时打包高亮确认；② **框架 = 引入 LangGraph JS 做编排层**——用户明确推翻了设计文档 §8.3「原生 + Tool Runner」的倾向和助手的同向建议，接手者勿擅自改回原生；执行约束：事件流仍是小说事实唯一真源，LangGraph 只管任务编排/恢复，模型调用保持原生 SDK（不引 LangChain）；③ **不用 Codex/Gemini，不 spawn 子代理**，由主代理独立产出并自审；④ v1 首目标 = Stage 1「可靠的章节任务基础」（已完成）；⑤ v1 推迟：旧作导入、跨多章返修、批量生成、可配置角色、富导出、M4 Haiku 诊断通道、关系图 nodes 填充。
- **同日 Windows 会话的最新要求**：真实写作测试使用用户已有代理网站提供的 **Gemini**，明确使用 **chat 接口**，暂时不调用 Claude。配置位于 `C:/Users/Administrator/Desktop/新建文本文档.txt`；只在本地读取连接信息，密钥不写进记忆或提交。用户提供配置后明确要求 continue，继续最小适配与单章测试。这是小说产品的写作模型选择，不是启动独立开发/复核 Agent；LangGraph JS、逐章采用及当前代理独立工作要求保持。

## 4. 既有项目设计约定

以下来自用户提供的历史设计记忆及现有代码，是本轮沿用的项目背景；不要与本轮新提出的建议混为一谈。

- 产品定位：AI 长篇小说创作工作区 + 可配置 Agent；重视用户积累的创作资产及导出能力。
- 技术栈 TypeScript，章节服务支持原生 Claude SDK 和 Gemini chat 代理客户端，由开发环境配置选择。历史产品方案由平台提供模型、按流程分工，用户侧使用积分，不做 BYOK / 自定义模型端点入口；本轮测试配置不新增产品侧模型选择界面。
- 核心体验：作者可以主要看结构视图，按需跳读关键正文。四种结构视图为伏笔时间线、情节线、人物弧线和关系图。
- 写作与结构声明分两次调用：C4 写正文，C5 在同一会话追加一轮声明事件、伏笔及人物变化，保留完整的前一轮响应内容。
- 模型产出先进入 proposed；用户接受后才 committed。正式投影消费 committed / authored 内容。
- 章节字数预算等约束根据章节类型、事件 / 伏笔权重、题材和平台派生，规则集中在 rules.yaml。
- 代码处理能机械校验的规则；人物动机、POV、伏笔是否合理兑现等语义问题仍需另外验证。
- 首页优先展示少量需要处理的问题，按修复成本增长趋势排序，允许把处理安排写进下一章节拍表。
- 历史字数口径：计汉字与西文词，剔除标点空白。不要把它直接等同于发布平台显示字数。
- 历史“元层穿帮”检测约定：主要检查引号内和心理标记句，叙述部分不按同样方式检查，以减少误报。
- 历史记忆中的“当时不用 Codex/Gemini 协作”是旧会话记录；当前用户正明确委托 Codex 阅读、讨论和保存此文件，不能据此拒绝当前任务。

## 5. 当前工程进展：以本轮源码检查为准

### Git 状态

- 分支：master。
- 前一轮功能交付：`1ee6bcf872ca841076ba8ae3e26bf4605cb7ff37`，`feat(chapter): 新增写章输入装配与草稿恢复接口`，已合入并推送到 `origin/master`。本轮 Gemini chat 交付见第 14 节，提交和推送状态以 Git 历史核对。Windows 远端为 `https://github.com/xxxwonking/novel-forge.git`。
- 设计阶段核对的 HEAD：4b4cb0d，2026-09-07，M3 引擎层：告警计算 + 锚点重定位 + 视图模型 + 落盘。后续提交结果以 Git 历史为准。
- 前序提交：a10713e 为 M2 约束层；3319139 为 M1 章循环与验收工装；7e8535d 为 M1 上下文装配、C5 解析、事件流及投影。
- 历史项目记忆停在 a10713e / M2，因此其“下一步做 M3”已落后于当前代码。
- ~~写入本文件前已有修改：package.json、package-lock.json、src/alerts/apply.ts、src/alerts/compute.ts、src/types/projections.ts、test/alerts.test.ts。~~
- ~~写入本文件前已有未跟踪内容：data/、src/.vscode/、src/harness/seed-demo.ts、src/server/、test/server.test.ts、web/。~~
- ~~上述是已有工作，不是本轮新增功能；接续工作时重新检查 Git 状态，保留这些改动。~~ 以上三条已随 7528bd8 提交，不再是工作区状态。
- **Stage 1 历史提交（2026-09-10，Mac 会话）**：`06021b9` feat(task) 章节任务基础层 + `9847ae2` feat(server) 章节草稿端点，从分支 `stage1-chapter-task` 经 **PR #1**（https://github.com/xxxwonking/novel-forge/pull/1）合入 master，合并提交为 `b6ca4ee`。Mac 侧 origin 使用 SSH（`git@github.com:xxxwonking/novel-forge.git`）。

### 已有实现

| 部分 | 当前源码中可见的能力 | 主要位置 |
| --- | --- | --- |
| 上下文 | 分层内容选择、渲染、装配及缓存布局 | src/context/ |
| 模型接入 | Claude SDK / Gemini chat 配置选择、工具消息、SSE、响应分类及会话元数据保留 | src/client/ |
| 章节流程（遗留验收路径） | C4 正文 → C5 同会话声明 → 校验 → proposed 事件；可接 C6 / C7 | src/chapter/pipeline.ts |
| 章节任务 | LangGraph 编排正文、声明与检查；草稿保存、失败恢复、按版本采用及失效保护 | src/task/ |
| 结构声明 | JSON schema、解析、引用定位及声明交叉检查 | src/chapter/c5-schema.ts、c5-crosscheck.ts |
| 约束 | 节拍表校验、预算派生、章内与跨章检查、补写 / 删减 / 拆章分流建议 | rules.yaml、src/beat/、src/gate/、src/text/ |
| 小说状态 | 事件流、接受 / 拒绝、结构投影、JSON / JSONL / 正文文件持久化 | src/store/、src/types/ |
| 告警及视图 | 告警计算和筛选、动作应用、锚点重定位、四种视图模型 | src/alerts/、src/anchor/、src/view/ |
| 服务端 | 项目会话、写章输入装配、写章与草稿 API，以及概览、章节读取、体检、锚点、告警动作 | src/server/ |
| Web | React + Vite；首页、告警、结构视图、正文跳读与体检 | web/src/ |
| 验收与演示 | Gemini 单章实测、遗留 Claude 连续 10 章缓存验收、52 章演示数据脚本 | src/harness/ |

### 主要衔接缺口

> **2026-09-10 最新状态**：以下保留前期缺口编号。第 2、7、8 项已解决；第 1 项的写章输入、资料持久化及写章/草稿 API 已完成，网页尚未接入；第 6 项的落盘与失败恢复已完成，主动暂停及任务界面仍待做。第 3、4、5 项仍待推进；自动修订阈值存在不代表图已接线。实现细节与边界见第 12、13 节。

1. 网页尚未接通写作流程：服务端已有 `/api/chapter/write` 及草稿列表、详情、采用、丢弃端点；对话入口、结果页和修改操作待接。`runChapter` 仍供独立验收工装使用，产品入口复用 `ChapterTaskService`。
2. **已解决**：`src/task/tool-exec.ts` 执行 `tool_use` 并回传 `tool_result`；写章读取工具使用项目快照，变更提议进入草稿，未经采用不成为正式事实。
3. 对话式的创作任务调度还没有完整落地。验收脚本内的作品设定和章节计划是预置内容，不能视为用户通过对话创建作品和规划章节的实现。
4. C7 当前产出补写、删减等分流建议；完整的自动修订、重新检查、等待用户采用流程仍需衔接。
5. 结构声明存在可信度问题需要验收：模型声称“已收伏笔”、声明引用存在，不足以证明正文在语义上合理兑现。现有源码也把语义判定留给后续模型审查。
6. **部分完成**：章节任务按步骤保存草稿、会话和版本，失败后能恢复未完成步骤；主动暂停与任务界面仍待接。小说剧情事件流不承担全部运行状态。
7. **已解决**：任务路径在 C4 后保存正文与会话，C5 失败跨 Session 恢复不重写正文；遗留 `runChapter` 失败结果也保留已生成正文。
8. **已解决**：采用按草稿版本核对正文、声明、检查和资料依据，只提交该稿产生的事件 ID，不会顺带确认其他 proposed 事件；修订会使旧事实和依赖旧版本的后续稿失效。

### 验证边界

- 前期为静态源码评估；后续已补做类型检查、自动化测试与前端构建。2026-09-10 Gemini 单章真实流程已验证，见第 14 节；对话式产品流程、连续创作质量和官方缓存收益尚未验收。
- 旧记忆中的“284 测试通过”是旧版本的历史记录，不是当前 Windows 工作区的新验证结果。
- 前期检查发现 node_modules 存在但缺少 Windows 执行入口；2026-09-10 实际检查还发现 Windows Rollup 组件和 Node.js 类型缺失，已通过依赖安装补齐并重跑常规检查。
- seed-demo.ts 明确使用模板构造 52 章演示内容，用于结构视图和告警演示，不能作为真实小说写作质量的证据。
- 历史待验收项：连续 10 章缓存命中率 ≥70%，需要可信的官方 usage 数据；当时的中转凭证不能通过 SDK 直连。本轮没有重新验证凭证状态，也没有完成该实测。

## 6. OpenFic 调研与框架讨论

### 已核对的上游事实

本轮查看了 OpenFic 在 2026-09-09 的 main 分支部分源码，未固定上游 commit，也未完整运行该项目。

- backend/pyproject.toml 声明了 LangChain、多个模型适配包、LangGraph 和 langgraph-checkpoint-sqlite。
- graph/react_agent.py 使用 LangChain 消息 / 工具接口，并自行构建 LangGraph StateGraph：llm_call → dispatch_tools → tool_exec → tools_join，再决定继续调用模型或结束。
- graph/orchestrator/graph.py 的外层图为 START → primary → END。主 Agent 通过自己的工具循环执行任务、按需调度角色；不能把它理解为预先固定串行执行所有角色。
- runner/checkpointer.py 使用 AsyncSqliteSaver 保存运行检查点；上层另有会话、任务和作品数据持久化代码。
- agents/definitions.py 定义 Build / Plan 主角色，以及 Explore、Composer、Auditor、Writer、Reviewer、Actor 等子角色。
- OpenFic 自己实现小说业务工具、上下文、角色配置等；安装 LangChain / LangGraph 不会自动获得这些产品能力。

参考源码：

- https://github.com/syrizelink/OpenFic/blob/main/backend/pyproject.toml
- https://github.com/syrizelink/OpenFic/blob/main/backend/app/agent_runtime/graph/react_agent.py
- https://github.com/syrizelink/OpenFic/blob/main/backend/app/agent_runtime/graph/orchestrator/graph.py
- https://github.com/syrizelink/OpenFic/blob/main/backend/app/agent_runtime/runner/checkpointer.py
- https://github.com/syrizelink/OpenFic/blob/main/backend/app/agent_runtime/agents/definitions.py

### 早期方案讨论（已确认的决策以第 3 节为准）

- 原生 TypeScript + Claude SDK 可以先验证小规模章节流程，并非必须安装框架才能成为 Agent。
- 若要正式支持长任务、人工确认、分支修订、暂停和恢复，助手倾向评估 LangGraph JavaScript 作为编排层，节点复用现有 Claude SDK 和小说业务模块。
- LangChain 可提供现成的模型 / 工具接口、Agent 循环和中间件，是否使用单独决定；无需先假定整仓库迁入其抽象。
- 建议组合：主 Agent 理解用户意图并选择能力；章节流程负责正文、结构声明、校验、修订和采用；小说事件流与存储维护正式创作资产。
- LangGraph 检查点与小说事实存储职责不同。恢复能力需要合理划分步骤并配置持久化存储，不能仅靠安装依赖。
- 典型恢复需求：C4 已生成正文、C5 失败时保留正文并重试声明；等待作者采用时允许离开；修改多次后按次数 / 消耗上限停止。
- 以上记录的是早期讨论；后续用户已确认 LangGraph JS、原生模型 SDK 及 Stage 1 范围。Stage 2 文件级实施计划仍待形成。

已查阅的官方 JavaScript 文档：

- https://docs.langchain.com/oss/javascript/langchain/overview
- https://docs.langchain.com/oss/javascript/langgraph/overview

## 7. 用户使用流程草案：待继续细化

以下是上一轮已经向用户提出的目标体验，包含现有能力及未来能力，不代表全部已实现或已经逐项批准。

### 已补充的首版使用规格

- 独立文档：docs/superpowers/specs/2026-09-09-novel-forge-user-flow-design.md。
- 补充映射：docs/superpowers/specs/2026-09-09-novel-forge-user-flow-capability-map.md。它是设计分析及能力依赖顺序，尚不是已批准的文件级实现计划。
- 已细化：用户入口、首次创作、对话意图与作品影响、单章交付和采用、任务 / 章节 / 故事状态、返回继续、局部修改、失败恢复、贯穿示例及用户验收场景。
- 草案对比了逐章采用、按阶段集中采用和预先授权自动采用三种节奏，推荐首版逐章采用，可用“采用并继续”连接两章。
- 草案提出的其他默认值：每次写章至多一次自动修订；支持当前草稿和最新已采用章的修改；基础已采用正文导出。均为待用户评审的建议。
- 更早章节的跨多章返修、批量创作、旧作导入和更细的角色配置保留在完整产品路线中，当前草案聚焦从新作品到连续写作的主线。
- 文档内部审查与用户批准是不同状态；不能把内部一致性审查通过当成用户已经批准实施。
- 本次自查补清了已改期 / 已放弃 / 已兑现的区别、已结束任务、手动编辑后的待检查与检查并采用、需要修改的章节状态，以及采用成功但后续生成失败时的恢复方式。
- 审查历史：最初两次独立审查因服务限流失败；后续成功返回一轮 Issues Found，指出结构记录纠错和生成中离开页面的流程缺口；已据此修改。之后的独立复核未完成；用户现已指定由当前主代理复核，本次已完成该复核，不将其表述为独立代理审查通过。
- 新增的建议行为：正文正确而结构摘要或检查判断有误时，允许保持正文、纠正候选记录并复核；最新已采用章仍通过候选新版本采用。
- 新增的建议默认值：关闭页面不等于暂停；运行服务可用时在既定次数和消耗范围内继续，返回连接同一任务。若服务中断使任务未完成，保留已完成步骤，用户继续或重试后恢复；页面重开本身不触发生成。
- 本次主代理复核补充：在推荐的逐章采用节奏下，当前稿未采用时先处理该稿再续写；同一写章请求的重试连接原任务。基础导出明确选择范围、列出包含版本和未采用内容，并用同一版本集合生成文本文件。

### 总体主线

创建 / 导入作品 → 明确创作方向 → 建立设定与规划 → 对话推进任务 → 查看结果 → 修改或采用 → 持续创作 → 导出。

用户进入一本书后，在同一作品工作区使用对话、作品资料、结构视图和正文；对话可以随时发起讨论、查询、规划、创作和修订。

1. **进入作品**：新建或导入已有小说。已有作品先展示进度和概要；导入时推测出的伏笔 / 意图标为待确认。
2. **明确方向**：用户可以从一句想法开始，Agent 只追问影响方向的信息，协助明确主角目标、核心冲突、风格和禁忌。认可的内容形成作品设定，未决定的内容保留为备选。
3. **建立规划**：整理人物、必要设定、全书阶段及近期章节计划；全书方向可以较粗，近期几章更具体。用户通过对话修改，资料和结构视图同步呈现规划。
4. **下达任务**：用户可说“按计划写下一章”“先讨论结尾”“检查人物是否知道这件事”。明确的任务直接执行，影响故事方向的未决问题先提出建议。
5. **执行并展示结果**：显示准备、创作、检查等进度；完成后先展示本章摘要、关键事件、人物变化、伏笔变化及待处理问题，每项关键变化可跳到原文。此时是待采用草稿。
6. **修改 / 采用**：用户用自然语言要求修改，也可手改正文；修改后检查受影响记录。说“采用”后，正文与结构变化一起成为后续依据；“采用并继续”可直接接下一章。
7. **持续管理**：再次进入作品能看到当前进度、待处理草稿、少量优先问题和下一步安排。告警可以加入下一章、改期、讨论或主动放弃。
8. **导出**：按章节、卷或整部作品导出已采用正文，也可导出设定和大纲；导出前看清范围、版本和未完成项。

### 需要保留的用户语义和状态

- “如果反派是师父会怎样”：讨论 / 备选想法，不直接改正式设定。
- “按这个方向重写第五章”：创建新草稿供比较。
- “采用这个版本，继续第六章”：更新正式作品进度并续写。
- 生成完成的草稿与已采用内容要清楚区分；候选结构变化不能污染后续正式记忆。
- 告警处理要区分“已安排”和“已解决”：加入下一章只是安排，实际写入正文并被采用后才算解决。这是目标产品行为，当前加入节拍后抑制告警的实现需要对照核查。
- 计划中的事件与已经发生的事件在结构视图中需要有清楚区别。
- Agent 的不确定判断展示为待核对，附相关原文或依据。
- 手动编辑正文后，需要检查并更新受影响的结构记录，防止正文与视图分离。

### 草案中的章节状态、采用与恢复约束

以下是已写入流程草案、仍待评审的产品约定，不代表对应功能已经实现。

- 章节主状态：未完成草稿 → 待检查 → 检查中 → 待采用 → 已采用。检查发现必须处理项时进入“需要修改”，调整正文或目标后重新检查。
- 手动编辑使原检查结果过时；保存后进入“待检查”。“检查并采用”表示用户已授权检查通过后的采用，有必须处理项时停下并保留结果。
- 仅纠正候选结构记录或复核判断时，也要更新候选结果并使相关检查过时；重新核对后再判断采用条件，避免采用正文与结构不一致的结果。
- 生成任务完成只表示交付了结果，不能自动把草稿变成正式章节。仅说“继续”且仍有待采用稿时，不能据此推定用户已采用该稿。
- 采用时正文、依赖的新设定和结构变化共同生效；失败不能让正式视图呈现部分采用。重复请求应得到同一个结果，基于过时作品版本的稿件须重新核对。
- “采用并继续”先完成前章采用，再生成下一章；续写失败后只恢复下一章任务，保留前章已经采用的结果。
- 正文已生成而结构声明或检查失败时，保留正文和已完成步骤，重试未完成部分。
- 最新已采用章的修订先作为候选稿；采用新版本后，依赖旧版本的下一章草稿需要重新核对。
- 故事处理状态区分已安排、已改期、已放弃、部分兑现和已兑现。改期或放弃不能显示为已兑现，部分兑现仍需跟踪剩余承诺。

### 完整体验中的补充分支

- 临时灵感：讨论或存为备选，再决定纳入哪里。
- 修改旧章：先展示受影响的后续内容，再确定修改范围。
- 暂停 / 失败 / 关闭页面：保留已完成工作，回来后能查看状态并继续。
- 批量生成：用户预先约定范围、方向和消耗上限，遇到需要决定的问题时暂停。
- 工作偏好：例如“关键转折先讨论”“日常续写直接执行”。
- 这些分支不自动等于第一版全部实施范围，仍需排优先级。

### 能力映射提出的开发顺序

以下是助手建议，尚未批准为实现计划：

1. 可靠的章节任务基础：复用现有生成、声明和检查，补齐写作内部工具执行与结果回传、步骤保存、草稿版本、检查关联、采用一致性与恢复。
2. 作者通过对话完成首章：接通新建作品、基本资料与规划、主 Agent 的对话任务选择与调度、任务 API、对话和结果界面。写作本身必需的工具执行在第一阶段完成。
3. 修改后持续创作：局部修订、手动编辑、结构记录纠错、重新检查、最新已采用章修改及下一章草稿失效处理。
4. 完整体验验收：安排与兑现的展示、作品待办、基础导出及连续 3～5 章真实创作验证。

建议第一项开发任务是把现有章循环变成可保存、可恢复、可按版本采用的业务能力，再让主 Agent 和网页接入同一入口。保存和恢复从第一阶段贯穿后续阶段，不推迟到最后补做。

## 8. 待办与建议顺序

### A. 先把用户流程变成可评审的产品约定

- [x] 将主流程细化为独立评审草案，写出用户输入、Agent 行为、交付物及后续动作。
- [x] 用户已确认逐章采用、关键变化在采用时打包确认，v1 首目标为 Stage 1；其余草案默认值按后续阶段具体确定。
- [x] 处理独立审查提出的两项流程缺口：结构记录纠错、生成中离开页面后的行为。
- [x] 按用户最新要求，由当前主代理完成修改后的文档复核；覆盖前次两项问题和两份文档的一致性，记录见第 11 节。
- [x] 写出讨论 / 备选、计划、草稿、已采用及告警处理状态的用户语义草案。
- [x] 写出“首次创作 → 修改 → 采用 → 续写 → 重新进入作品”的贯穿交互示例；这是文档演练，真实运行验收仍在 C 节待办中。
- [x] v1 范围与框架已确认：LangGraph JS 编排、直接调用模型接口、主代理独立实现和复核；当前源码使用 Claude SDK，Gemini chat 适配按最新要求推进，不再重复询问框架选型。
- [x] 初步映射作者操作、可复用模块、编排 / API / Web / 存储缺口及能力建设顺序，保存到独立能力映射文档。
- [ ] 根据既定用户流程完善 Stage 2 能力映射，形成可执行、可验收的文件级实施计划；本轮写章 API 的计划与实现已完成，见第 13 节。

### B. 接通最小写作流程

> **2026-09-10 最新进度**：第 2、4 条已完成；第 3 条的上下文、生成、声明、检查、采用和存储已接通，修订待做；第 5 条的版本与采用保护已完成，手动编辑后检查失效待做；第 6 条的写章及草稿 API 已完成，对话/结果界面待做；第 1、7、8、9 条仍待推进。

- [ ] 实现对话任务入口，让 Agent 能根据用户意图使用现有小说能力。
- [x] 补齐工具执行和结果回传循环，明确读取、提出修改和正式采用的边界。
- [ ] 完成产品级流程的剩余修订环节；上下文装配、章节生成、结构声明、检查、采用和存储已接通。
- [x] 保存任务进度和草稿，支持失败保留、必要步骤重试、等待采用和请求恢复。
- [ ] 补齐手动编辑后的检查失效与重新核对；章节版本、采用一致性、重复采用保护及前章修订引发后续稿失效已完成。
- [ ] 在网页提供对话、结果摘要、修改、采用和继续写作操作；服务端写章及草稿入口已完成。
- [ ] 提供保持正文、纠正候选结构记录或复核检查判断的入口，关联新结果与采用条件。
- [ ] 对照“已安排 / 已解决”语义衔接告警、节拍、正文和结构视图。
- [ ] 按最终确定的首版范围接入已采用正文的基础文本导出，保持导出范围及版本与界面一致。

### C. 验证真实体验和创作结果

- [ ] 第一版优先验收：新建 → 基本设定 → 生成一章 → 看摘要 / 结构 → 修改或采用 → 下一章。
- [ ] 用同一个故事连续写 3～5 章，检查人工修改是否影响后续正文和结构记录。
- [ ] 核对人物连贯性、情节因果、伏笔兑现以及结构摘要与正文的一致性；不能只看计数规则通过。
- [ ] 验证刷新返回、重复采用、过时稿件、手动编辑后检查失效，以及“正文成功但检查失败”“采用成功但续写失败”等恢复场景。
- [ ] 验证结构误读纠正后正文与视图一致，以及生成中关闭页面后连接同一任务、服务中断后保留成果的场景。
- [ ] 验证待采用稿与续写、重复写章请求，以及导出范围内包含未采用稿、导出期间发生新采用时的版本一致性。
- [x] 2026-09-10 功能提交 `1ee6bcf` 在开发目录及合入后的主目录通过验证：23 个测试文件、540 个测试，类型检查与前端构建通过；不等于真实创作流程验收。
- [ ] 之后完成连续 10 章真实模型与缓存验收，分别记录写作结果、规则结果和缓存指标。
- [ ] 再按真实使用需求安排旧作导入、复杂旧章修改、批量创作、更细的角色分工和更多导出能力。

## 9. 常用命令与接手注意

工作目录：C:/Users/Administrator/Desktop/novel-forge（Windows）；Mac 上是 /Users/others/Desktop/novel-forge。

Mac 上 GitHub 的 HTTPS(443) 直连被掐、SSH 正常：git 用 SSH 远端；`gh` 只认环境变量代理，调用要带 `HTTPS_PROXY=http://127.0.0.1:7897 HTTP_PROXY=http://127.0.0.1:7897`（Clash Verge 混合端口）。节点会抽风，遇 EOF 先用 `curl -s -x http://127.0.0.1:7897 https://api.github.com/zen` 复测。

    npm run typecheck
    npm test
    npm run web:build
    npm run serve
    npm run web
    npm run acceptance:m1

- serve 默认读取 data/demo，监听 127.0.0.1:5174；本轮按用户要求已在主目录启动《雨夜账册》测试作品的网页服务，详见第 14 节。
- Windows PowerShell 中使用 `npm.cmd` 执行上述脚本；主目录已按锁文件运行 `npm.cmd ci --no-audit --no-fund`，依赖已安装，无须为接续工作重新生成演示数据。
- acceptance:m1 会真实调用模型，需要有效配置，运行前明确本次实测范围和消耗。
- npm run seed 用于生成演示项目；当前已有 data/demo，普通查看 / 启动不需要重新生成数据。
- 若 Git 再次提示 dubious ownership，可使用仅当前命令生效的安全目录参数，本轮未改全局 Git 配置：

    git -c safe.directory=C:/Users/Administrator/Desktop/novel-forge status --short --branch

- 不要把源码中存在某个模块、模板演示可用、历史测试通过，直接表述为当前完整产品已验收。
- 用户最新明确指示优先；在已授权范围内继续工作，避免反复询问已经确认的对话式交互需求。

## 10. 2026-09-10 GitHub 发布与验证

- 用户指定目标：https://github.com/xxxwonking/novel-forge.git；已配置远程 origin，使用现有 master 分支。源码与文档已随提交 7528bd8aa904fea94552116bf4f6d1250adfec45 推送，随后核对远程 master 与本地 HEAD 一致、工作区干净；后续文档更新的提交以 Git 历史为准。
- 提交范围包括用户原有的 Web 工作区、本地 API、演示生成脚本、告警交互改动和测试，以及本次流程设计、能力映射、工作记忆和 README。
- README 补充首次克隆、安装、生成演示、构建、启动和常规检查命令，说明当前已实现能力与待接通流程。
- .gitignore 补充本地作品 data/、编辑器设置、npm 缓存和环境配置的忽略规则；演示生成脚本保留在仓库，已有本地数据保持不动。
- 实际依赖问题：npm 脚本起初找不到 tsc；直接检查还发现缺少 @rollup/rollup-win32-x64-msvc 与 Node.js 类型。运行 npm install --save-dev @types/node@^22 补齐依赖、Windows 执行入口及对应组件，并更新 package.json / package-lock.json。
- 验证环境：Windows PowerShell，Node.js v24.9.0。
- npm run typecheck：通过，覆盖服务端与 Web。
- npm test：16 个测试文件、435 个测试全部通过。
- npm run web:build：通过。首次在沙箱内因 esbuild 子进程 spawn EPERM 失败；经授权在沙箱外执行后成功构建。
- 本次发布未改动小说生成业务逻辑，也未运行真实模型验收。当时未完成的独立文档复核，现按用户要求改由当前主代理完成，见第 11 节。

## 11. 2026-09-10 当前主代理文档复核

复核方式：遵循用户“不使用独立 Agent”的要求，在当前代理中重新阅读两份文档，对照作者操作、状态转换、失败恢复、首版范围及现有源码接口检查。本次没有启动或调用子代理。

复核结论：文档一致性与用户流程覆盖检查通过。下列问题已在文档中补齐；实现仍需验证相应场景，产品默认值仍待用户评审。

| 检查项 | 结果与依据 |
| --- | --- |
| 正文正确、结构记录或检查误判 | 流程 §6.2、§6.3、§7.2、§8.3 已允许保留正文、纠正候选记录并复核，再决定是否可采用 |
| 生成中离开页面 | 流程 §6.1、§8.1、§8.3 已说明既定范围内继续、主动暂停、服务中断与返回同一任务的区别 |
| 待采用稿与续写 | 流程 §5 已补清逐章采用节奏下的前置条件，以及同一请求重试和明确另写一版的区别 |
| 基础导出 | 流程 §8.4、§10 及能力映射 §2 已补齐范围选择、未采用内容、空范围与导出期间版本变化的处理 |
| 工具循环的开发顺序 | 源码在章节写作中已传入工具定义；能力映射 §3.3、§4 明确第一阶段处理内部工具执行，第二阶段接通对话任务调度 |
| 能力、实现与验收的区别 | 两份文档仍标记为设计草案；代码中的 C5 失败保稿、按版本采用和完整工具循环缺口未被误记为已实现 |

本次只修改文档并核验编码、链接、差异与状态。435 个测试、类型检查和前端构建通过是第 10 节所记代码提交的实测结果，本次文档复核不重复运行，也不据此声称真实创作流程已通过验收。

## 12. 2026-09-10 Stage 1 落地记录（Mac 会话）

**本节是 Stage 1 的历史记录，最新接续位置见第 14 节。** 环境：Mac，仓库在 /Users/others/Desktop/novel-forge。完整设计文档在 **/Users/others/Desktop/agent-platform-design.md（未入仓库）**——Windows 会话当时找不到它；它的 §3.2/§8.3 是框架选型讨论的原始依据，§10-13 是约束层与上下文装配的完整推导。

### 决策（用户拍板，见第 3 节末条）

逐章采用；引入 LangGraph JS；不用 Codex/Gemini 与子代理；v1 首目标 Stage 1；推迟项见第 3 节。

### 实现内容

新增 `src/task/`：

| 文件 | 职责 |
| --- | --- |
| `types.ts` | `ChapterDraft`（状态机 writing→declaring→checking→needs_revision/ready→adopted，另有 discarded/stale/failed）、`DraftSession`（C4 整轮会话快照，供恢复到 C5 同会话第二轮）、`DraftProposal`、`AdoptResult` |
| `draft-store.ts` | `drafts/ch{n}/{draftId}.json` + `.txt`（正文纯文本）、`work-meta.json` 作品版本号（每次采用 +1） |
| `tool-exec.ts` | `executeToolUse`（六个写作工具：读侧取数、propose_* 进待确认区）+ `runToolLoop`（围绕原生 `ClaudeClient.call` 的 `while stop_reason==='tool_use'` 循环，步数上限 `rules.task.maxToolIterations`） |
| `steps.ts` | `writeChapterBody`（C4 + 工具循环）、`declareStructure`（C5 同会话第二轮，**只产出声明不入事件流**）、`checkChapter`（C6 + C7） |
| `graph.ts` | LangGraph `StateGraph`：step_write → step_declare → step_check，失败/被拒经条件边到 END；节点幂等跳过已完成步骤；`MemorySaver` 仅进程内 |
| `service.ts` | `ChapterTaskService.run / resume / listDrafts / getDraft`，按 stream 每步落草稿；resume 用 `draft.session` 重建 C5 会话、不重跑 C4 |
| `adopt.ts` | `adoptDraft`：ready 校验 → 提交声明 → 落正文 → 版本 +1 → 后续章 in-flight 草稿标 stale；已采用即幂等返回 |

扩展：`store/event-stream.ts` 加 `supersedeChapter`（修订已采用章时把旧 C5 committed 翻 rejected；`effective()` 已过滤，投影器不改）；`chapter/pipeline.ts` 的 `failed` 带回 `chapterText`（遗留路径不再丢正文，其余不动）；`server/state.ts` 挂 `DraftStore`、加 `commitDraftDeclaration / listDrafts / getDraft / discardDraft / adopt`；`server/api.ts` 加 `GET /api/chapter/drafts?n=`、`GET /api/chapter/draft?n=&id=`、`POST /api/chapter/adopt`、`POST /api/chapter/discard`；`rules.yaml` 新增 `task` 段（`maxToolIterations: 6`、`maxAutoRevisions: 1`），`rules/schema.ts`、`rules/load.ts` 对应契约与校验；依赖新增 `@langchain/langgraph`（1.4）。

### 修复的三处缺口与证明

| 缺口 | 修复 | 测试 |
| --- | --- | --- |
| 失败即丢稿 | C4 正文即落草稿；C5 失败保留正文与会话；resume 从声明步起、不重跑 C4 | `test/chapter-task.test.ts` |
| 采用不精确到版本 | 草稿在事件流之外，采用只生效选中稿；幂等；修订 supersede；版本与 staleness | `test/adopt.test.ts`、`test/server-drafts.test.ts` |
| 无工具执行循环 | `runToolLoop` 真正执行 tool_use 并回传，达上限即停，透传拒绝/错误 | `test/tool-exec.test.ts` |

验证：`npm run typecheck` 干净；`npm test` **467 通过**（435 基线 + 32 新增，含 `test/draft-store.test.ts`）。

### 实现期决策（源码注释里都有）

- 草稿在事件流之外，采用时才展开为 committed 事件；废弃稿不污染 append-only 日志。
- 跨重启恢复靠草稿这份领域产物，不靠 LangGraph checkpointer（未做自定义持久化 checkpointer）。
- 模型调用保持原生 `@anthropic-ai/sdk`；LangGraph 只做图编排；未引 LangChain / `@langchain/anthropic`。
- `runChapter` 遗留路径保持独立（缓存实测工装与 21 个测试依赖它把 proposed 写入 stream），未委托给 steps。
- `src/task` 不进 `test/rules.test.ts` 的「代码无数字」扫描（steps 含 API 输出规模常量，与 chapter/client 同类）；两个真阈值放 `rules.task`。
- LangGraph 节点名不能与状态通道同名，故节点叫 `step_write` 等。

### 明确延后（不是遗漏）

1. `buildChapterRunInput`（从 `ProjectSession` 忠实装配 L1/L2/L3 + volatile，把 `ten-chapters.ts` 内联的装配抽出来）+「地点/组织设定库」持久化 + 写作纪律落盘 → **真机跑章前必须**；因此还没有 `/api/chapter/write`，`service.run` 由调用方传 `runInput`。
2. 自动修订：`rules.task.maxAutoRevisions` 已就位，图未接线（需基于 findings 的修订 prompt）。
3. 前端结果页 / 采用按钮（Stage 1 只做引擎 + API，用测试验证）。
4. 真机模型跑章与 M1 缓存实测仍受官方 API key 门槛。
5. 「手动编辑后检查失效」「已安排/已解决」语义、导出：未开始。

### 接手命令

`npm test` 期望 467 通过；`npm run typecheck` 干净。Mac 上 gh 的代理用法见第 9 节。

## 13. 2026-09-10 Windows 接续：写章 API 已交付

**本节保留写章 API 交付时的记录，最新接续位置见第 14 节。** 用户要求根据 MEMORY 继续开发，并明确不使用独立 Agent。本轮由当前代理实现、测试和复核；没有调用子代理。此后 Gemini chat 已接入，不重复实现章节任务基础。

### 交付状态

- 功能提交：`1ee6bcf872ca841076ba8ae3e26bf4605cb7ff37`，`feat(chapter): 新增写章输入装配与草稿恢复接口`；共 20 个文件，新增 1486 行、删除 30 行。
- 基线为 PR #1 合并后的 `b6ca4ee`。开发分支 `stage1-chapter-write` 已快进合入 `master`，并推送到 `https://github.com/xxxwonking/novel-forge.git`；随后核对远端 `master` 与本地提交一致。
- 当前工作目录为 `C:/Users/Administrator/Desktop/novel-forge`，分支为 `master`。临时 worktree `C:/Users/Administrator/Desktop/novel-forge-worktrees/chapter-write` 及已合入分支 `stage1-chapter-write` 已删除；不要继续使用该临时路径。
- 写入本次记忆前工作区干净；本次仅更新 `MEMORY.md`，不改业务代码。后续文档提交及推送状态以 Git 历史为准。

### 保持的关键决策

- LangGraph JS 只做任务编排，不因换测试模型而引入 LangChain 模型抽象。现有实现使用原生 Claude SDK；按用户最新要求，下一步适配其代理站的 Gemini，暂不调用 Claude。
- 逐章采用，可衔接“采用并继续”；草稿及提议不自动进入正式事实，事件流仍是小说事实的唯一真源。
- C4 正文与会话先保存，C5 声明或检查失败时保留成果并恢复未完成步骤；来源变化先标记过期，再重新核对。
- 当前代理独立完成实现与复核，不启动子代理。已有 Git 提交、推送授权继续有效；现有 `data/demo` 保留，普通接续不运行 seed。

### 已完成

- `ProjectStore` 保存 `settings.json`（地点/组织）和 `discipline.json`（写作纪律），Session 提供对应读写。旧项目缺文件时默认空设定库与平台纪律，读取不自动写文件；旧 `save` 调用仍可工作，损坏 JSON 明确报错。
- 新增 `src/server/chapter-input.ts`：`buildChapterRunInput` 校验节拍与引用，按当前规则派生预算，装配 L1/L2/L3/volatile 和 C5 已知 ID。人物状态、剧情索引、前章正文及伏笔读取限定在目标章之前的正式记录；候选、否决及仅规划的伏笔不会作为已经埋设的事实进入输入。
- L3 按节拍顺序取人物和地点/组织。待收伏笔带完整意图及真实埋设上下文，原文锚点失效时停止准备；未到收束时机的暗线只给避免直接提及的提示。卷衔接由已有正式事件汇总，上一章正文保留原文。
- 读取工具接到真实项目资料：人物支持姓名/别名/ID，设定支持名称/ID，章节支持全文或头尾三分之一，未收伏笔可按权重读取意图。读取使用启动时快照，提议仍只进草稿。
- 新增 `src/server/chapter-writer.ts`：懒加载 Claude 客户端，复用 `ChapterTaskService` 运行/恢复。默认复用原稿，`newDraft` 显式另建；同一活动请求共用 Promise，冲突请求返回 409。
- `POST /api/chapter/write` 已接入，接受 `{ chapter, draftId?, newDraft?, maxOutputTokens? }`。`handleAsync` 是 HTTP 统一分发入口，原 `handle` 保留同步端点；HTTP 等待本次任务结果并返回不含内部会话的草稿。
- 新草稿保存可序列化的资料校验值与输出预算，恢复和采用前核对生成依据；生成期间资料变化则保留正文并标 stale。C5 失败后跨 Session 恢复不重跑 C4；重试调整的输出上限也会继续保存。
- 采用只允许有效的 ready 稿，并只提交选中稿生成的事件 ID；旧流程或异步诊断留下的 proposed 事件仍待确认。丢弃/过期/运行中状态不能凭旧 acceptable 标记被采用，已采用稿不能被改为已丢弃。草稿编号按最大已有序号递增，编号缺口不会覆盖旧稿，同时间戳版本按数字序号排序。

### 验证与复核

- Windows、Node.js；开发目录与合入后的主目录均按锁文件安装依赖，没有新增依赖。
- `npm test`：**23 个测试文件、540 个测试通过**（467 基线 + 73 新增）。
- `npm run typecheck`：通过；`npm run web:build`：通过。
- 上述检查在提交前及合入主目录后均运行通过；本次仅保存记忆，未重复运行代码测试。
- 当前代理按计划复核事实边界、持久化、恢复参数、重复请求、草稿编号、采用/丢弃状态及 HTTP 传输。发现的问题均先用测试复现，再修复。
- 真实本地 HTTP + 假模型验证：写章响应、读取草稿、非法参数、断开请求后继续完成；另覆盖生成 → 采用 → 下一章读取新正文及人物状态。
- **没有调用真实模型，没有声称创作质量或真实缓存验收通过。** 本轮验证仅使用临时项目，已有 `data/demo` 未重新生成、未修改。

### 实现边界与下一步

1. 进入 Stage 2：基于现有用户流程，先形成文件级计划，再接作品准备、对话式主 Agent 工具调度、草稿结果和采用/继续界面。直接复用本轮写章入口，不另造一套生成流程。
2. 当前接口要求资料准备齐全、节拍已确认。现有阅读演示的第 53 章节拍仍是 `proposed`，且旧库没有地点/组织文件；不会为了写章自动确认计划或编造设定。手动改项目文件后需重启 Session。
3. LangGraph JS 编排与直接调用模型接口的方向保持。`runChapter` 缓存验收工装仍独立；本轮没有迁移 LangChain 模型抽象。用户现在要求用代理站的 Gemini 测试，原有 Claude 实测与缓存验收暂缓。
4. 目前每次从正式记录重建 L2，保持原有分层布局与断点。生产 L2 冻结/增量策略、真实模型写章与 M1 缓存收益仍待验证。
5. 自动修订、正文编辑后的重新检查、提议的正式确认应用、旧章连带返修、导出仍未接通。`rules.task.maxAutoRevisions` 已存在不代表自动修订已实现。
6. 并发协调是单服务进程内的项目会话级；尚无跨进程锁或请求 ID 日志。`newDraft: true` 每次代表新意图，重试某稿应带它的 `draftId`。旧草稿缺来源校验值时只能依照已有版本信息保护。
7. 端点处理模型失败返回 200 + `status: failed`，不是请求成功就代表写章成功；C5 失败时正文可读。查询不会启动任务，服务重启后由用户请求恢复。

### 最新补充：使用代理站的 Gemini 测试

- 用户已提供 `C:/Users/Administrator/Desktop/新建文本文档.txt`，其中有 baseurl、apikey 和 Gemini 模型名列表；该文件留在仓库外，记忆不保存密钥或代理地址的具体值。用户明确指定 `/v1/chat/completions`。
- 只读探测确认服务自报 CLI Proxy API Server，`GET /v1/models` 认证成功。先选择返回列表中的 `gemini-3-flash` 做兼容验证，后续模型名可配置；这些是代理返回的模型标识，不据此推断官方版本或质量。
- 最小真实 chat 请求已返回 HTTP 200，JSON schema 要求的 `{ "ok": true }` 解析通过；这验证了连接与简单结构化输出，尚不等于完整写章流程验收。没有调用 Claude。
- 源码核对：`src/client/claude.ts` 固定模型名，使用 Anthropic 消息、工具和结构化输出协议；C4 还传入 thinking/effort 参数，分层上下文带缓存标记。接入时需核对这些能力，不能只替换凭证或地址就假定兼容。
- 按用户指定的 chat 协议新增薄客户端，适配消息、工具往返、结构化输出、流式响应及错误结果；保留现有 LangGraph、草稿保存、采用及事实隔离逻辑。Claude 特有的 thinking/effort/cache_control 不直接发送到 chat 接口。
- 建议先选一个模型完成单章“正文 → 结构声明 → 检查 → 采用 → 下一章读取”的真实验证，再扩展连续创作；这是开发配置，不要求增加产品侧模型选择或 BYOK 界面。
- 其他模型可验证工作流及各自的写作效果；Claude 专属缓存指标不能据此宣告通过。测试需分别记录实际模型、写作结果、规则结果和服务商返回的用量。
- 保存本节时已核对源码和代理连通性，模型适配尚未实现；后续先写计划与失败测试，再接入并实测。完整 Gemini 写章结果需另行记录。

### 接续待办顺序

- [x] 读取用户提供的 Gemini 代理配置，按指定 chat 接口验证连通性和最小 JSON 输出。
- [x] 实现 chat 客户端与章节服务接入，覆盖工具、JSON、流式、错误及跨 Session 恢复，已完成真实单章与恢复验证，见第 14 节；暂不使用 Claude。
- [ ] 先阅读现有用户流程与能力映射，形成 Stage 2 文件级实施计划和验收场景；Stage 2 尚未开始实现。
- [ ] 接入作品准备：新建作品、基本设定、人物、地点/组织、写作纪律及已确认的章节计划。
- [ ] 接入对话式主 Agent 的意图识别与工具调度，复用现有章节服务和 API。
- [ ] 接入草稿结果、检查结果、采用/继续及返回后恢复任务的界面；保持任务完成与正文采用的区别。
- [ ] 界面接通后验收“新建 → 准备 → 写一章 → 查看/采用 → 下一章”；再开展同一故事连续 3～5 章真实创作和后续 10 章缓存实测，分别记录产品流程、创作质量和缓存指标。

实现计划：`docs/superpowers/plans/2026-09-10-chapter-write-api.md`；接口说明：`docs/chapter-write-api.md`。常规检查仍为 `npm run typecheck`、`npm test`、`npm run web:build`。

## 14. 2026-09-10 Gemini chat 接入与真实单章验证

**历史交付记录，当前接续见第 16 节。** 用户授权使用自有代理站 Gemini，并指定 chat 接口。本轮由当前代理完成实现、真实测试和复核，没有启动子代理、没有调用 Claude，也没有改动已有 `data/demo`。

### 交付状态与当前网页

- 功能提交：`c7ecb1b2e5e65bc9a2ca70cf9192c7ded2c22581`，`feat(model): 新增 Gemini chat 写章接入与实测`，已快进合入 `master` 并推送到 `origin/master`。
- 主目录 `C:/Users/Administrator/Desktop/novel-forge` 中重新运行 574 项测试、类型检查和前端构建，全部通过。已合入的 `feat-gemini-chat` 分支和临时 worktree 均已清理。
- 网页服务已从主目录以后台进程启动，地址 `http://127.0.0.1:5174`，加载下方实测作品；启动时 PID 为 23044。该进程保留供用户查看，修改服务代码后需要重启。日志位于实测目录的 `web-server.stdout.log` / `web-server.stderr.log`。
- 实测作品、正文、报告、截图和主目录 `.env.local` 均保留；这些本地数据和凭证不进入 Git。本次记忆收尾提交以 Git 历史为准。

### 已完成的实现

- 新增最小 `ModelClient`、`ChatClient` 和 `createModelClient`；通过 `NOVEL_MODEL_PROVIDER=chat` 配合 `CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL` 选择代理模型。未设置 provider 的旧入口仍兼容 Claude，chat 失败不会自动回退。
- 复用现有 LangGraph、写章资料、工具执行、草稿持久化和按版本采用。C4 支持 SSE 及工具往返，C5 使用 JSON schema，不新增 LangChain 模型依赖。
- 原始 chat assistant 消息保存在内部草稿元数据，完整保留工具签名、推理字段和工具调用参数。模型/端点变化会阻止原会话恢复，密钥轮换不改变恢复目标标识。读取草稿 API 不输出内部会话。
- 处理 HTTP/连接错误、拒绝、截断及超时，错误文案清除密钥；SSE 在 `[DONE]` 结束，缺少有效结束原因时报错。拒绝/截断时先保留原始状态与已有正文，不解析未完成的工具参数。
- 新增 `npm run acceptance:chat`：每次在新目录创建测试作品，保存正文、报告和用量；ready 稿仅在该测试作品中采用，再验证第二章能装配并读取第一章，不实际生成第二章。
- 新增 `.env.example` 和 `docs/gemini-chat.md`，同步 README 与写章 API 说明。启动和实测会加载 `.env.local`，需要 Node.js ≥22.9.0，建议使用 24 LTS；本机验证版本为 v24.9.0。

### 实测经过与实际结果

- 模型：代理返回的 `gemini-3-flash`；协议：`/v1/chat/completions`。服务连通、鉴权、最小 JSON、工具往返及 SSE 长输出均通过。
- 新作品《雨夜账册》，人物沈砚和顾青。目标字数 2100–2650，实际生成 **2287 字**。
- 首次 C5 返回 `tool_calls: null`，原解析器误报“chat 工具调用格式无效”。最小请求确认 HTTP 200 且该字段为 null 后，先写失败测试，再修复兼容性。
- 从同一作品、同一 `ch1d1` 跨 Session 恢复，只调用 **1 次 C5**（`maxTokens=4000`、结构化输出），**正文保持不变**。恢复后 `status=ready`、`acceptable=true`；测试作品内采用成功，第二章输入装配及读取第一章正文成功。
- 检查保留 2 条 info（核对信息事件是否为新线索）和 2 条 warn（声明的 weight-3 事件只涉及一条情节线、加权事件密度 1.53 高于 0.55）。本轮没有调低规则，也没有为消除警告反复生成。
- 只验证了这一次单章流程与失败恢复，没有生成第二章、没有完成连续创作质量或 Claude 官方缓存验收。代理用量按原样保存，不将其 token 总数、推理及缓存字段擅自换算成官方口径。

### 本地产物与配置

- 作品目录：`C:/Users/Administrator/Desktop/novel-forge/data/chat-smoke-2026-09-10-4xJ2NV/`。
- 正文：`drafts/ch1/ch1d1.txt`；采用后的正文也已落到该作品正式章节目录。
- 首次报告：`report.md` / `report.json`（保留 C5 格式错误）；修复后的最终报告：`report-resume.md` / `report-resume.json`（包含正文未变化、仅恢复声明及采用/读取结果）。
- 真实连接信息由用户桌面配置文件读取，已保存到主项目被忽略的 `.env.local`，并在清理开发 worktree 前核对一致；密钥及具体代理地址不写入 Git 或 MEMORY。
- 查看测试作品：`npm.cmd run serve -- data/chat-smoke-2026-09-10-4xJ2NV`。阅读视图已有，Web 写章、草稿与采用操作界面仍待开发。

### 验证与自审

- `npm.cmd test -- --reporter=dot`：**27 个测试文件、574 项通过**（540 基线 + 34 项新增）。
- `npm.cmd run typecheck`：通过；`npm.cmd run web:build`：通过。
- 自动化测试覆盖 chat 消息与工具转换、持久化签名、结构化输出、SSE 字节分块/结束/中断、null 工具列表、截断/拒绝、超时、错误脱敏、配置选择、真实本地 HTTP 章节入口和 C5 恢复。
- 当前代理自审发现的 null 工具列表、SSE 完成标志及停止状态优先级问题均先用失败测试复现，再修复。正式事实及采用边界沿用既有实现。
- 用户补充要求启动 Web 测试后，使用 Chromium 145 + Playwright 实际点击首页、全部提示、四种结构视图和正文页；正文与保存稿一致，无浏览器脚本错误或失败的页面/API 响应。
- 浏览器发现并修复两处衔接问题：节拍预算未持久化时，体检接口现在按规则派生预算并返回章内检查，读取不改动作品；原文高亮元素现在正确绑定滚动引用，点击情节节点会滚到对应正文。前者经新增失败单测复现，后者经浏览器断言复现，修复后均复测通过。
- Web 最终报告及截图保存在同一测试作品的 `web-report.json`、`web-home.png`、`web-plotlines.png`、`web-reader.png`、`web-anchor.png`；首次异常记录保留在 `web-report-before.json` 和 `web-anchor-before.json`。网页只验证现有阅读/检查功能，未宣称尚未接入的写章/采用界面可用。
- 实施计划：`docs/superpowers/plans/2026-09-10-gemini-chat.md`；设计：`docs/superpowers/specs/2026-09-10-gemini-chat-design.md`。开发从 `e1c963b` 开始，已完成合入与推送；后续在主目录继续，不再使用已删除的临时 worktree 路径。

### 接续待办

- [x] Gemini chat 章节适配、真实单章生成、C5 失败恢复、测试作品内采用与下一章读取验证。
- [ ] 形成 Stage 2 文件级实施计划，复用已确认的用户流程、LangGraph 和章节服务。
- [ ] 接通作品准备及对话式主 Agent 的任务选择与工具调度。
- [ ] 接通草稿结果、检查项、采用/继续和返回恢复界面，明确区分任务完成与正文采用。
- [ ] 产品界面接通后验收“新建 → 准备 → 写一章 → 查看/采用 → 下一章”。
- [ ] 再进行同一故事连续 3～5 章的质量验证，重点核对 C5 事件权重、事件拆分、伏笔兑现及人物一致性；Claude 与 10 章官方缓存实测继续暂缓。

已有提交、合入和推送授权继续有效；后续按授权完成必要工作，不重新询问已经确认的模型、框架或独立代理要求。

## 15. 2026-09-11 Stage 2·切片 1：对话式主 Agent（Mac 会话）

**历史交付记录，当前接续见第 16 节。** 本轮由当前代理独立实现、测试、自审，未调用 Codex/Gemini、未 spawn 子代理（沿用项目锁定规则）。基线 master `4df4a58`；分支 `stage2-conversation-agent` → **PR #2**（https://github.com/xxxwonking/novel-forge/pull/2），提交 `f54fde7`（引擎/agent + 服务端 + rules + 测试）、`b2313e5`（web），本节随后提交。

Stage 2 =「作者通过对话完成首章」，切成三片、先做第 1 片（对话式主 Agent），切片 2/3 见文末。

### 做了什么
- 新增 `src/agent/`（6 模块）：`tools`（12 工具，固定顺序 + `EXPECTED_MAIN_AGENT_TOOL_ORDER`）、`tool-exec`（`executeMainTool` + `runAgentLoop` 手写 `while stop_reason==='tool_use'` 循环，复用 `client.call` 五坑处理，不引 SDK toolRunner）、`conversation-store`（`conversation.json`：turns + 备选 ideas）、`system-prompt`（§5 意图规则 + 两条护栏，纯函数）、`service`（装配→循环→落 turns→回复）、`types`（AgentEffect / ConversationTurn / …）。
- 服务端：`ProjectSession.converse()/conversationTurns()/listIdeas()` + 懒 `getModelClient()`（只读作品无模型也能开会话）；`POST`/`GET /api/conversation`（POST 进 handleAsync）。`rules.agent.maxConversationRounds`（schema/load/rules.yaml；`src/agent` 同 `src/task` 不进"代码无数字"扫描）。
- Web：`pages/Chat.tsx`（消息流 + effects 可点 chip：查看草稿/采用/采用并继续/跳原文 + 内联草稿查看）、`api.ts`（conversation + chapter 端点绑定）、`App.tsx`（/chat 路由 + 导航"对话"）、`styles.css`。

### 关键决策（源码注释里都有）
- **正式事实边界留在代码里（§12.0）**：Agent 选工具、代码校验并执行；写章→`session.writeChapter`（草稿/proposed），采用→`session.adopt`（按版本、幂等），计划类→`applyActionToBeat`/`appendEvents`（计划态）。**Agent 从不直接写正文或事件。**
- **两条护栏**：读类工具零副作用（结构性保证）；`adopt_chapter` 必须带确切 draftId、含糊"继续"不自动采用（prompt + adopt 抛错双保险）。
- 模型角色用 `judge`（haiku）：意图路由与短回复是判定型（§8.2）；真正创作在 `write_next_chapter` 触发的独立任务里仍是 opus。
- 历史只回放文本、不回放回合内工具往返；每回合起干净的工具循环（切片 1 取舍）。
- `write_next_chapter` 在对话回合内 await（与现 `/api/chapter/write` 同步语义一致）；ChapterWriter 与 MainAgentService 各自懒创建客户端（无状态配置载体，不共享实例无碍；测试注入 `writing.client` 时两者同一实例）。

### 验证
- typecheck（根+web）干净；`npm test` **602 通过**（574 基线 + 28 新增：agent-tools 3 / agent-tool-exec 12 / agent-service 7 / server-conversation 6）；`npm run web:build` 通过。
- **真实模型 live 对话未验证**：Gemini chat 代理配置在 Windows 机（`.env.local` / `新建文本文档.txt`），本 Mac 无 → `converse` 会 503。逻辑由 mock 客户端测试覆盖。

### 已知限制（非缺陷，切片内取舍）
- 对话回合内 await 写章：真实模型会阻塞该 HTTP 请求（流式进度留后续切片）。
- `plan_add_to_next_chapter` 传入不存在的情节线，会在写章装配期才报错（计划态可见可改）。
- readSource 每回合按 nextChapter 建一次：回合内若先采用再读新章会读不到（次回合正常）。

### 下一步（Stage 2 剩余两片）
- **切片 2**：作品准备（新建作品 + 对话建设定/人物/地点/写作纪律/首章节拍）。
- **切片 3**：完整结果页富 UI（摘要/关键变化/伏笔情节四象限 + 跳原文）、手动编辑后重新检查、"已安排/已解决"语义衔接。
- 真机验收：待官方 key（M1 缓存）或在 Windows 机用 Gemini 跑一轮 对话→写章→采用→下一章。

## 16. 2026-09-14 国内官方与代理模型兼容

**当前接续入口。** 用户明确回答“官方 API 和代理／聚合平台两种都需要支持”。本轮基于已拉取的 `aeff8b3`（PR #2 合并结果）开发；由当前代理独立实现、测试、自审，没有使用子代理。提交、合入和推送沿用已有授权。

### 实现与配置

- 保留两种接口：Claude Messages 与通用 Chat Completions。国内官方接口和代理共用 Chat 客户端，不引入 LangChain 模型抽象，不按域名或模型名猜测供应商能力，不自动换模型或回退 Claude。
- 新增 `src/client/chat-config.ts`，服务工厂与 `acceptance:chat` 工装读取同一套配置。必填仍为 `NOVEL_MODEL_PROVIDER=chat`、`CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL`。
- 可选 `CHAT_PRESET=generic|deepseek`。generic 保持旧 Gemini 行为；deepseek 默认 `json_object`、显式 `thinking.disabled`，可单独覆盖。
- 可配置三种 JSON 模式（json_schema/json_object/prompt）、思考开关、reasoning effort、每次最大输出预算、流式方式、流式 usage 扩展及超时。空的可选变量视为未配置，非法值在发请求前报错。
- JSON Object 与 prompt 模式会加入完整 C5 schema 和明确 JSON 提示；原有本地解析、引用核对和业务检查保留。资源不足／aborted 明确返回模型错误，不解析残缺工具参数。
- 支持服务根地址、任意 API 路径前缀（如 `/api/v3`、`/compatible-mode/v1`）和完整 `/chat/completions`。只有空路径自动补 `/v1`；旧 `/proxy` 若实际要求 `/proxy/v1/chat/completions`，应填 `/proxy/v1` 或完整 endpoint。
- DeepSeek thinking 使用 `thinking.type`，effort 使用 `reasoning_effort`，独立于 Claude 的调用参数。未实现其他厂商的 `enable_thinking` 等扩展自动翻译；其标准 Chat 功能可用，扩展能力需按文档核对。
- 同一次部署当前共用一组 Chat 地址、密钥、模型与能力，尚未提供 UI 模型选择、按角色选不同 Chat 模型、Responses 或 Gemini 原生 generateContent。

### 完整会话与兼容决策

- Chat 客户端提供不含凭证和明文端点的 `conversationKey`；`conversation.json` 增加内部 `modelHistory`，保存完整工具往返与最终 assistant（即使没有调用工具，也保留 reasoning_content）。Web GET/POST API 仍只返回可见文本、effects 和 ideas。
- 原始历史不存在、目标改变或可见记录数不匹配时，将可见旧对话转为用户上下文。不会伪造 reasoning_content，也不会把旧模型内部字段直接发给新模型。
- 错误、拒绝、截断、工具轮数到顶时，仅保存已完整执行的往返与说明性上下文；未执行或残缺的工具请求不在后续回合重放。回合内新记录的 ideas 不被旧状态覆盖。
- 可见 user/agent 对与内部历史一次原子写入。同一个 ProjectSession 的对话顺序执行，资料在排队回合实际开始时取快照；仍没有跨进程锁、自动历史压缩或同回合采用后资料源刷新。
- 默认 Chat 摘要算法保持兼容；模型、端点或显式思考配置变化会隔离草稿会话。密钥轮换、JSON 模式、预算与超时调整不改变目标，可修正 JSON 配置后只恢复 C5。
- `official=false` 沿用 Claude 官方缓存验收口径，不表示 DeepSeek 官方 API 被误认为代理。

### 验证与本地数据

- 最新基线为 **31 文件／602 测试**；实现后 **32 文件／650 测试全部通过**（新增 48 项），`npm.cmd run typecheck` 和 `npm.cmd run web:build` 通过，`git diff --check` 无问题。依赖及锁文件未改动。
- 先用 29 个失败用例复现配置／协议缺口，再实现；用 10 个失败用例复现思考历史丢失与回合交错，再修复。补充 DeepSeek 风格“对话 → 写章 → C5 → 采用 → 下一轮读取”、C5 失败跨 Session 恢复、JSON 本地拦截与 API 内部字段隔离测试。
- 本轮 HTTP 测试使用本地脚本化服务。**没有调用 DeepSeek 官方或其他真实模型，没有声称国内模型写作质量已验收。** 官方文档已核对：JSON Object、thinking 工具历史、当前模型 ID、停止原因与输出上限。
- 只读核对已有 Gemini 真实作品 `data/chat-smoke-2026-09-10-4xJ2NV/drafts/ch1/ch1d1.json` 的 **2 个原始会话目标**，与当前 `.env.local` 经新客户端计算的目标一致，未发网络请求、未修改正文。
- 主目录 `.env.local`、`data/demo`、Gemini 真实作品及原报告保留；本轮没有 seed、没有切换默认模型、没有输出或提交密钥。原网页进程是否正在使用新代码需启动／重启时核对，不能沿用历史 PID 直接终止。
- 功能提交 **`0a12c17`**（`feat(model): 新增国内官方与代理模型兼容配置`）已快进合入 `master` 并推送到 `origin/master`。合入后的主目录再次通过 650 项测试、类型检查和前端构建，确认 `.env.local`、`data/demo` 与既有 Gemini 正文仍保留。
- `feat-model-compatibility` 分支和 `C:/Users/Administrator/Desktop/novel-forge-worktrees/model-compatibility` 临时 worktree 已安全清理；后续从 `C:/Users/Administrator/Desktop/novel-forge` 接续。本次交接补记为随后单独的文档提交。

### 文档与下一步

- 配置入口：`docs/model-configuration.md`，有官方 API 和代理两套完整示例；`.env.example` 保留旧 Gemini 默认配置并列出可选项；`docs/gemini-chat.md` 保留真实验收记录。
- 设计：`docs/superpowers/specs/2026-09-14-model-compatibility-design.md`；计划：`docs/superpowers/plans/2026-09-14-model-compatibility.md`。
- [x] 国内官方／代理 Chat 兼容能力与 DeepSeek 预设；主 Agent 完整思考历史；本地协议和工作流验证。
- [ ] 使用用户提供的对应凭证、地址和模型 ID，分别进行目标国内官方／代理的真实单章验收；现有代理密钥不得用于官方域名。
- [ ] 继续 Stage 2·切片 2 的作品准备与切片 3 的完整结果页；先核对最新分支进度，避免重复已存在的对话页和动作工具。
- [ ] 界面完整后验证同一故事连续 3～5 章质量；Claude 与 10 章官方缓存验收继续暂缓。

## 17. 2026-09-14 项目检查与首版流程继续完成（进行中）

用户的持续目标是“先检查现有的这个项目是否存在问题，然后继续完成这个项目”。按小说项目 novel-forge 接续。不得启动独立 Agent。

### 当前开发位置

- 基线 `d95d4de`；检查时主目录与刚 fetch 的 `origin/master` 一致且干净。
- 分支 `feat-project-completion`，工作目录 `C:/Users/Administrator/Desktop/novel-forge-worktrees/project-completion`；此节记录首批检查与作品入口，未宣称主分支已合入。
- 完整计划：`docs/superpowers/plans/2026-09-14-project-completion.md`，包含事实边界检查、作品准备、结果与任务、修改纠错、导出和完整验收五组任务。
- 主目录 `.env.local`、既有 demo 和 Gemini 实测作品均未改动，也未重新 seed。开发目录仅安装了锁文件中的依赖。

### 已修复并验证

- 主 Agent 原来每回合固定资料快照：同回合先采用再查询，会说新章不存在、沿用旧人物状态、把已经收束的伏笔仍列为未收；改期后立即查询也显示旧时间。现每次读工具从当前正式资料构造快照，写章内部仍保持固定来源。
- 正式章节体检原来把 proposed 及 P4_outline 事件计入正文密度。现仅包含 committed/authored 的正文事实，规划不计入。
- 章节列表、对话草稿摘要与 Web 草稿详情统一使用 `countWords`（汉字+西文词，剔除标点空白），不再用字符串长度冒充字数。
- 新增 `test/server-consistency.test.ts`，12 项检查；先看到 10 项针对缺陷的失败，再实现修复，另外 2 项保证有效事件仍参与检查。

### 已完成作品入口

- `src/workspace/service.ts`：作品列表、稳定 ID、新建作品、创建请求去重、每本书独立 ProjectSession、旧作品识别、坏文件可见错误、路径边界。
- 新 API `GET /api/workspace`、`POST /api/works`；其他 API 通过每请求 `x-novel-project` 选择作品，无全局可被另一页面切换的活动作品。
- `npm run serve` 默认打开 `data` 下作品列表，空目录也能启动；传入具体旧作品目录仍直接打开原作品。不要求先 seed。
- 新建先保存作者想法和可见的题材/平台/目标字数；不自动生成或确认人物/章节。完整资料方案是下一项工作。
- Web 新增作品列表与创建表单，URL 的 `work` 参数使刷新、另开页面仍指向同一本作品。当前创建后进入已有对话页。
- `test/workspace.test.ts` 新增 21 项本地 HTTP 测试，包括空库、重开、旧项目、非法路径、非法参数、请求去重和两本书操作隔离。

### 最新验证和接续

- `npm.cmd test -- --reporter=dot`：**34 文件 / 683 项通过**。
- `npm.cmd run typecheck`、`npm.cmd run web:build`、`git diff --check` 通过。
- Playwright + Chromium 已实际走通：空列表 → 新建《云城来信》 → 打开对话 → 刷新恢复 → 返回作品列表；1440×1000、390×844 页面无横向溢出，脚本错误为空。
- 浏览器临时产物：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-workspace-browser-wC2hSn/`，含独立测试作品、desktop.png / mobile.png。没有调用真实模型。
- **继续做**：资料/计划候选方案与确认；完整结果页及任务进度；手动编辑/自然语言修订/结构纠错；采用多文件保存失败的一致性；基础导出；同一故事 3–5 章真实验收。
- 上述三类保存风险已在后续检查中复现并修复，见下方补记；其他资料引用和复合动作仍随后续功能继续复核。
- 整个持续目标尚未完成。已确认的暂缓范围、Gemini/Chat 测试授权、暂不调用 Claude 和既有 Git 提交/推送授权继续有效。

### 保存一致性补记（2026-09-14）

- 新增 `src/store/transaction.ts`：同步操作先暂存，再写 before/after 日志、原子替换文件并提交；未提交则回滚，读取前恢复遗留日志。恢复校验路径和外部改动，冲突时保留日志并报错。
- 采用的正文、正式声明、作品版本、后续稿过期标记与采用状态加入同一个事务，失败时同时恢复 Session 内存。草稿正文与元数据也成组保存。
- 已有坏的 `work-meta.json` 和可见对话结构明确报错，不再归零或清空；缺文件的新作品仍从空态开始。内部 `modelHistory` 无效时退回可见历史的兼容行为保留。
- `test/persistence-safety.test.ts` 先复现 12 项失败后通过；`test/file-transaction.test.ts` 9 项覆盖真正的中途 rename 失败、子进程在提交前/后退出、重开及重试、日志路径与恢复冲突。测试子进程不是独立 AI Agent。
- 最新完整测试为 **36 文件 / 705 项通过**。新事务仍以单服务进程为边界，不提供跨进程并发写锁；不以进程退出测试声称突然断电也已验收。
- 此阶段继续留在 `feat-project-completion`，作品资料与章节方案、结果页、修改纠错、任务控制、导出和真实连续创作验收仍未完成。下一步先接资料提案及确认服务。

### 资料准备、试写与结果页补记（2026-09-15）

- 当前仍在 `C:/Users/Administrator/Desktop/novel-forge-worktrees/project-completion`。已有提交 `c728781`（作品入口）、`c44b7e3`（保存一致性）；**以下功能及本次补记尚未提交、合入或推送**。主目录仍为 `d95d4de`，不要切走或清理正在开发的 worktree。
- 新增 `src/preparation/{types,schema,service}.ts`。资料候选以 `preparation/proposal-<UUID>.json` 保存，包含来源指纹、变更、预览、影响与检查；提出或讨论建议不修改正式资料。确认和作者明确指定复用服务；涉及已有正文时保留候选及受影响章节。
- 方案校验包括数据结构、ID、引用、节拍及派生预算。旧来源方案不能覆盖后续选择；确认只更新该方案修改的人物和章节，不顺带确认无关候选。
- Agent 新增 `get_preparation`、`propose_preparation`、`confirm_preparation`、`record_author_details`；对应 `/api/preparation` 查询、propose/author/confirm/reject 接口共用同一服务。主 Agent 输出上限调整为 8192，以容纳完整资料工具参数。
- `write_next_chapter` 支持 `proposalId`：用独立候选资料装配试写，尚不改变正式资料、正文或故事事件。草稿保留依赖，C5 失败跨重启继续沿用该方案；采用试写时在同一事务中确认依赖并采用正文及声明。已改变或丢弃的方案不能直接用于覆盖。
- Web 新增作品资料页、方案预览与首批章节结果页：查看正式资料与候选、编辑基本设定/偏好、确认、确认并写、试写；结果页提供版本、摘要、结构变化、检查、原文定位、正文、采用、采用并继续、恢复和丢弃。采用成功而续写失败分别展示。
- 手机固定侧栏改为顶部标题与折叠菜单，导航后关闭。1440px、390px、320px 浏览器检查通过，已查看手机截图；作品资料和结果页可占满可用宽度，无横向溢出。
- 新测试实际复现“伏笔 F01 已无有效埋设，资料页仍显示可开写”。就绪提示现在通过注入回调复用 `buildChapterRunInput`，展示真正写章校验的原因；底层读取错误继续报错，不伪装成资料缺项。
- 最新验证：`test/preparation.test.ts` **18 项通过**；完整 **37 文件 / 723 项通过**；`npm.cmd run typecheck`、`npm.cmd run web:build`、`git diff --check` 通过。
- 实际浏览器闭环：新建 → 对话提案 → 查看方案 → 试写 → 结果及原文定位 → 刷新不重复生成 → 采用并确认方案依赖 → 手机资料/结果页。使用脚本化模型，5 次本地模型替身调用，**无真实 API 调用**。产物：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-preparation-browser-6DyI5k/`，含截图与 `verification.json`。
- 临时浏览器脚本已移至上述产物目录的 `preparation-check.source.mjs`（保留原始相对导入，复跑时放回工作树根目录）。脚本已关闭本轮 Chromium 与 HTTP 服务，没有遗留运行句柄。
- 当前代理自审了资料确认、试写、版本与坏文件边界；补充两项先失败后通过的草稿读取测试：缺失正文不再按空文本恢复或采用，文件内章号/版本与路径不符时保留原文件并报错。最新完整验证为 **37 文件 / 725 项通过**，类型检查通过；页面构建和浏览器证据沿用同批未变更的前端。
- 资料准备这一批在本次提交中保存。下一步继续任务真实阶段、暂停/结束/恢复、手动编辑、自然语言局部修订、结构纠错与重检、最新正式章修订和下一章失效、至多一次自动修订、问题处理状态、固定正式版本 TXT 导出、3–5 章 Gemini Chat 实测及完整浏览器验收。
- C4 `proposals` 当前仍单独显示为建议，完整正式应用流程尚未实现。结果页和全流程不能视为已完成。此前的暂缓范围、密钥边界和禁止独立 Agent 的约束保持。

### 后台任务、暂停与返回恢复（2026-09-15）

- 资料准备阶段已提交为 `406c13f`。当前这批任务控制接在该提交后，开发位置、主目录与凭证约束保持不变；仍未合入或推送。
- 草稿新增独立 `execution`：真实阶段、running/pausing/ending/paused/ended/completed/failed 状态、启动/更新时间和模型已报告用量。只读任务视图以当前协调器活动句柄判断是否仍在运行；旧运行标记无活动执行时显示 interrupted，查询不会自动恢复。
- `POST /api/chapter/start` 先保存初始草稿再立即返回任务，`GET /api/tasks` 读取真实状态，`POST /api/chapter/control` 支持 pause/end。原 `/api/chapter/write` 继续提供等待完成的接口。创建 `requestId` 保留在草稿中，同一个“另写”请求完成后重试仍返回原版本。
- 主 Agent 的 `write_next_chapter` 改为后台启动，返回 `chapter_started`，对话不再等整章生成完。新增 `list_chapter_tasks`、`control_chapter_task`，后续对话可暂停/结束/恢复同一任务；原有 DeepSeek 完整历史与 C4/C5 会话隔离仍通过协议测试。
- 暂停/结束在当前模型请求返回后生效：保留返回的已完成内容，阻止后续模型请求；页面明确显示 pausing/ending，不能提前说已暂停/已结束。暂停可以恢复，结束后需要明确新任务。未采用正文不会因此成为正式内容。
- LangGraph 各节点完成后同步落盘，再允许下一节点；修复了流消费者调度滞后导致 C5 已开始而磁盘仍记录 C4 的时序问题。未捕获模型异常会记录失败步骤并保留已有正文。
- C4 达到输出上限时保存片段并标记未完成，不继续把半章送入 C5。当前页面对这种情况提供重新生成；接下来修订工作仍需补齐“保留片段继续完成”的操作。
- 用量区分已报告输入/输出、未返回用量的调用和正在等待的调用。真实进程退出后仍能识别未返回用量，不把它算成零消耗；旧草稿明确显示未记录用量。
- Web 全局任务卡、章节结果的真实状态与轮询已接入。刷新/离开只重连同一任务；网络观察失败显示上次状态并继续重连。慢请求结束后才安排下一次轮询。提供暂停、结束、继续和结果链接，手机布局通过。
- `test/task-control.test.ts` **12 项**，覆盖启动/去重、暂停/结束、跨 Session 恢复、错误与截断、对话中控制、真实子进程在 C5 请求中退出、用量缺口及完成后请求重试。测试子进程不是独立 AI Agent。
- 最新完整验证：**38 文件 / 737 项通过**，typecheck、web:build、diff --check 通过。浏览器实际走通：对话启动 → 结果页 → 写作中刷新 → 模拟观察断线并重连 → 暂停保存正文 → 刷新 → 仅恢复 C5 → 采用 → 另写 → 结束保留内容；390/320px 无溢出，脚本错误为空。
- 最新浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-task-browser-rUFTHL/`，含 `verification.json`、暂停/结束截图和 `task-check.source.mjs`（临时脚本保留原始相对导入，复跑时放回工作树根目录）。本轮全部使用脚本化模型，没有真实 API 调用。
- 下一阶段继续：手动编辑保存新版本、局部自然语言修订、结构纠错与重检、最新正式章修订和后续稿失效、至多一次自动修订及初稿保留、C4 建议的正式应用边界、完整问题状态、固定正式版本 TXT 导出、Gemini Chat 同一故事 3–5 章和用户流程 §10 全项审计。

### 正文编辑、结构纠错与检查采用（2026-09-15）

- 后台任务已提交为 `630ac90`；本批接在该提交后，由当前代理实现和复核。仍在原 worktree，主目录和远端尚未合入本阶段。
- 新增 `/api/chapter/edit`、`/correct`、`/check` 与对应 Session 方法。手动保存新版本，不调用模型；旧正文与检查保留，新声明/检查失效且不可直接采用。编辑和纠错均支持 `requestId` 重试去重，不同内容复用编号返回 409。
- `revisionToken` 对排序后的完整稿件内容计算摘要，重读文件不会因对象字段顺序改变失效；原稿实际变化才拒绝旧编辑。编辑器固定打开时的源凭据，不受轮询替换。
- 结构纠错支持六类记录的指定修改/新增/删除，验证领域字段、人物/伏笔引用、真实引文及 occurrence；重建锚点，不信任旧偏移。保留正文、未修改的记录及原新伏笔 ID；更新后重新执行必要检查。
- 作者正文使用当前完整内容进行 C5，不复用旧 C4 正文或伪造 assistant/thinking；原生生成仍保留完整 C4 响应。已有完整声明的代码重检不创建模型客户端。
- 检查/检查并采用明确区分，采用请求随本版本检查保存，失败/暂停/重开可恢复，新修订不继承源稿授权。检查有 block 时停在 `needs_revision`。采用失败追加 `review.adoptionError`，不覆盖采用入口已经保存的过期状态。
- `work-meta.json` 在采用事务中记录每章正式 draftId；旧数据仅在正文唯一对应采用稿时识别来源。修订最新正式章先产候选，采用后作废旧事实并标记后续所有未采用稿过期。页面区分当前正式与历史采用版本，旧稿退出全局当前任务区。
- Web 接入正文编辑、结构表单、来源链接、前后对比、检查和检查并采用；Agent 新增 `get_chapter_draft`、`correct_draft_structure`、`check_chapter_draft`，共用业务服务。
- 自审先复现并修复 C5 截断、缺少结构数组、记录缺字段和非完整停止状态被放行的问题；任务与遗留工装路径同步校验输出形状。另修复并发检查拒绝前错误登记采用意图、纠错请求重试多建版本。保留 parseC5 的宽松解析能力，不靠降低闸门使测试通过。
- 新增修改纠错测试 **23 项**；最新完整 **39 文件 / 762 项通过**，typecheck、web:build 通过。实际浏览器验证编辑→刷新不调用模型→检查读取新正文→纠正死亡误读→检查采用→后续人物仍存活→最新正式章短稿被拦截；390/320px 无溢出、无脚本错误，截图已查看。
- 最新浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-revision-browser-mtJM9I/`，含 `verification.json` 和 `revision-check.source.mjs`；本轮使用脚本化模型，没有真实 API 调用，浏览器和 HTTP 句柄已关闭。
- **尚未实现**自然语言正文改写、保留片段继续完成及自动修订；类型中的相关 kind 只是预留值。继续按 Chunk 4 补齐，然后完成 C4 建议正式应用、问题状态、固定正式版本 TXT 导出、3–5 章 Gemini Chat 与全流程审计。不要将本批提交当作整个持续目标已完成。

### 自然语言局部改写与保留片段续写（2026-09-15）

- 上一批已提交为 `37702ba`。本批接入 `POST /api/chapter/revise`、`ProjectSession.reviseDraft` 和对话工具 `revise_chapter_draft`，复用既有 ChapterWriter、活动任务协调及 LangGraph。新修订是候选，不继承原稿采用授权。
- 局部范围由准确原文和 occurrence 定位；原文重复时必须明确位置。`scope` 不可省略，只有显式 `null` 才允许整章改写。范围外正文由代码逐字保留；需要扩大范围时仅保存建议，原文不变、不调用 C5，任务显示等待作者决定。
- 模型输出截断或非法 JSON 时不应用局部替换，原文保持。冻结源正文、范围和要求随稿保存，重试不重新猜范围。相同 requestId 返回同一稿，对象字段顺序不影响请求指纹。
- `mode: continue` 只允许未完成片段，从末尾追加；再次截断时保存此前片段及新增内容，下一次继续从最新版本末尾衔接。普通任务重试仍使用原冻结请求。
- C5 保留模型完整真实响应，同时读取代码合成后的整章正文；没有伪造 assistant/thinking。C5 失败或正文保存后暂停，跨 Session 恢复只重做必要检查。内部 generation 数据不暴露给 API，详情新增 `canContinueBody`。
- Web 支持鼠标选段/粘贴准确原文、重复位置选择、明确整章修改、修改要求、范围前后对比和保留片段继续完成。范围建议不能直接检查采用；结束等待范围的任务后，刷新仍保持 ended。
- 当前代理复核精确范围、来源过期、同请求重试、最新正式章候选及对话采用后的后续读取。完整 **40 文件 / 776 项通过**；typecheck、web:build 通过。测试使用临时作品及脚本模型，无真实 API 调用。
- 最新浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-rewrite-browser-31RPUN/`，包含脚本源、截图及 `verification.json`。实际验证选段、丢失启动响应重试仅一次调用、暂停/刷新/C5 恢复、范围建议及结束后刷新、再次截断后续完并采用；共 6 次脚本模型调用，390/320px 无溢出、无脚本错误，截图已查看。
- 接下来仍需：至多一次自动修订（automatic / recheck 目前仍为预留类型）、过期下一章完整场景、C4 提议正式应用、问题已安排/改期/放弃/部分兑现/解决语义、固定版本 TXT 导出、Gemini Chat 同一故事 3–5 章、用户流程 §10 审计、合入与推送。

### 至多一次自动修订与过期下一章（2026-09-15）

- 局部改写已提交为 `20ffdc4`。本批沿用同一 LangGraph，在检查后按冻结额度至多自动修订一次；初稿正文、声明、检查和用量保留，通过 `automaticResultDraftId` 链接新稿。版本链接、次数及修订稿在同一文件事务中保存，失败回滚后可重试。
- 新写章的 `writeContext.autoRevisionLimit` 为 0 或 1；旧任务没有额度时不补授权，规则上限大于 1 仍只执行一次。仅对有本章目标支持的 `route_patch`、`resolution_missing`、`resolution_downgraded` 必须处理项尝试；其他 block、warn、作者编辑、纠错、局部修改与续写不自动扩大范围。
- 自动修订冻结初稿及真实 findings，不改规则或计划来放行；需要新的方向时只交范围建议，正文保持。修订失败不自动重试；C5 失败、暂停或重启后只恢复必要步骤。同一个活动任务可通过原 draftId 控制，检查明确指定的初稿不会偷偷换成后续稿。
- 资料页和主 Agent 在开写前说明次数及离开页面规则，结果页显示修订阶段、额度、初稿入口与前后对比；自动稿用量累计同任务调用。采用仍需用户明确指令。
- 自审发现 C5 原先只信任引文偏移，且缺失引文仅 warn。现在核对 quote 是否真实存在于当前正文，无依据引文为 `c5_anchor_unresolvable` block，要求纠正记录或重新核对，不能改写正文迎合错误记录。任务及遗留 pipeline 共用修复。
- 自动修订新增 16 项业务测试，覆盖额度、原稿保留、失败、停止、来源变化、旧版检查、范围建议、跨会话恢复和保存回滚。另验证完整场景：修改并采用第 3 章 → 第 4 章旧稿过期且不可采用 → 按新事实改写并重核 → 采用后查询读到新正文。旧协议单轮测试显式使用额度 0，不降低质量闸门。
- 最新完整验证：**41 文件 / 794 项通过**，typecheck、web:build 通过。浏览器完成初稿→自动修订→暂停→刷新→仅恢复 C5→对比→采用；另一任务修订后仍短则停下，刷新不追加调用。390/320px 无横向溢出，无脚本错误，关键截图已查看。
- 浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-automatic-browser-EAvLKu/`，包含脚本源、截图及 `verification.json`；8 次脚本模型调用，**没有真实 API 调用**，浏览器与 HTTP 服务已关闭。
- 继续完成 C4 写作提议的明确确认与应用、完整问题状态、固定版本 TXT 导出、Gemini Chat 同一故事 3–5 章真实验收、用户流程 §10 全项审计、README/MEMORY 更新及合入推送。`recheck` 仍为预留 kind，不能据类型名声称有额外产品流程。

### 写作建议随具体稿件采用（2026-09-15）

- 自动修订已提交为 `d26a512`。本批为采用接口加入 `selectedProposals` 和版本凭据；默认不选建议，人物资料修改与未来伏笔仅在作者明确选择后随该稿采用。结果页显示原值、新值、原因、不可选原因及选择收据，按钮和对话共用 Session。
- 人物字段使用明确白名单和完整结构校验，不允许借资料建议改身份编号、姓名或派生状态。未知/重名人物、非法称谓引用、不可变属性冲突、重复字段选择均拒绝，不做任意点路径赋值。
- 选择、试写依赖、资料、正文、C5 事实、正式版本与采用收据在同一文件事务保存；失败整组回滚。重复采用不重复应用，采用后不能改原次选择。检查并采用冻结选择，只检查不能暗含建议采用；最新正式章再次编辑不会重新携带已应用建议。
- 未来伏笔保存为 authored 的 `P4_outline`，投影为 `planned`，空锚点不假装已有正文。分配编号避开候选和历史占用，拒绝与已存在或本稿已埋设的同名伏笔重复。资料页与结构表显示尚未埋设，时间线不画虚假的埋点。**规划后来进入正文时的编号与状态衔接仍待下一批完成。**
- 选择后重新执行现有 C5 交叉检查、承诺检查和 `checkChapter`。这证明原有结构/机械闸门不会被旧 ready 状态绕过，不等于人物和语义一致性已全面验证；真实内容质量仍需 Gemini 与人工核对。
- 新增 `test/draft-proposals.test.ts` **26 项**，覆盖候选隔离、预览、字段与引用、版本过期、试写依赖、重试、保存回滚、检查采用和对话后续读取。采用 API 现在保留过期错误的 409 状态码，对应两个旧测试同步修正，未放宽采用条件。
- 最新完整检查 **42 文件 / 820 项通过**，typecheck、web:build、diff --check 通过。浏览器实际验证默认未选、差异预览、采用响应丢失后的刷新重试、一次保存及收据、未来规划展示，桌面/390/320px 无横向溢出、无脚本错误，关键截图已查看。
- 浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-proposals-browser-xeHXB8/`，含 `verification.json`、截图和 `proposals-check.source.mjs`。**0 次模型调用**；备份脚本 SHA256 与工作树临时脚本一致，临时脚本不入库。
- 接下来继续总计划：完整问题状态和规划生命周期、现有安排/改期/放弃入口的引用与重试校验、固定版本 TXT 导出、Gemini Chat 3–5 章真实验收、用户流程 §10 审计、README/MEMORY 及合入推送。阶段提交不是整个目标完成。

### 故事安排、处理进度与伏笔生命周期（2026-09-15）

- 建议采用已提交为 `ba42287`。本批新增共享 `PlanningService`、进度读模型、`GET /api/issues`、`POST /api/planning/action`、主 Agent 进度查询及 Web 进度卡片；已安排或改期退出告警后仍可从卡片继续管理。完整/部分回收目标可互改，页面改期输入新章号，放弃可记录原因。
- 安排只改未来已确认的章节，校验对象、告警对象、权重、生命周期及章号；拒绝用单项操作确认整份候选计划。事件、计划、预算与提示状态同事务保存，错误回滚，丢失响应重试不重复追加。放弃清除未来已确认章节的相关目标，保留过去正文。
- 处理状态从正式记录与计划重建。部分兑现继续跟踪；完全兑现须有可定位正式原文；情节/人物只说明本次安排完成。作者确认退场单独显示，并明确指出仍保留的未来出场安排；后来采用的新出场记录更新当前进度，保留退场历史。
- C5 支持 `planned_foreshadow_id` 或唯一精确标签关联原规划。采用前仍是规划，采用后沿用编号与原文；歧义、非法或重复规划/兑现使 C5 失败并保留正文。纠错后还校验整份声明，不能用逐条纠错绕过重复约束。
- 提前完成的埋设/完全兑现从后续本次装配与预算中扣除，上下文说明已完成，作者原计划保留；最新章修订撤销该事实时原待办自动恢复。部分兑现及缺少原文的完成记录不会被静默扣除。P4 不能覆盖真实埋设，后来正文不能抹掉作者改期；P4 的人物、出场、情节与关系均不进入正式事实。
- 当前代理自审另复现并修复关系更新仍保留旧原文锚点。旧 `planned` 装配测试原来通过追加 P4 覆盖正式埋设来造夹具，已改成真正只有规划的记录；保留拒绝未埋设伏笔的断言，没有回退规划/事实边界。
- 本批较 820 基线新增 **51 项测试**，最新完整 **44 文件 / 871 项通过**；typecheck、web:build、diff --check 通过。浏览器实际完成部分安排→改期→丢失响应重试→候选隔离→采用部分兑现→后续完整安排→放弃另一条→采用完整兑现→跳原文。桌面/390/320px 无溢出、无脚本错误，截图已查看。
- 最终浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-story-browser-ePt0l2/`，含脚本、截图和 `verification.json`；**4 次脚本模型调用，0 次真实调用**。脚本备份 SHA256 已核对，浏览器及临时 HTTP 服务已退出。子计划：`docs/superpowers/plans/2026-09-15-story-progress.md`。
- 接下来继续固定正式版本 TXT 导出，再使用已有 Gemini Chat 在独立作品完成 3–5 章真实验收，逐项审计用户流程 §10，更新 README/MEMORY、合入主目录并推送。当前阶段尚未合入或推送，整个目标仍进行中。

### 固定正式版本 TXT 导出（2026-09-15）

- 故事进度已提交为 `fdb45fd`。导出服务、API、Agent 工具和 Web 共用同一快照入口；全部/连续章号范围预览正式版本、字数、遗漏区间和未采用稿提示。空范围可调整，不生成空文件、不写章或采用。
- 清单 JSON 与 UTF-8 BOM 文本在作品 `exports/` 中成组保存。内容指纹编号让同一选择重试复用原快照；正式映射必须与正文一致，历史无映射正文使用内容指纹而不虚构稿号。损坏或缺失文件明确报错，原范围重试不静默重建已损坏快照。
- 下载只读原快照；随后采用旧章修订、新章或重开作品不会改变所选版本。Web 修改范围后明确提示仍对应旧预览；重新预览才取当前版本。Reader、导航和对话都有入口，导出不需要模型配置。
- 当前代理自审复现并修复预览请求迟到覆盖另一份已打开快照的问题。页面切换后旧请求失效，预览/下载失败保留已有结果；浏览器另验证丢失预览响应后同范围重试复用。
- 新增 29 项业务测试，最新完整 **45 文件 / 900 项通过**；typecheck、web:build、diff --check 通过。浏览器核对实际下载的字节、BOM 和 SHA256，覆盖预览→两次采用→旧下载→刷新→重新预览、对话、空范围、无效范围及键盘操作。桌面/390/320px 无溢出、无脚本错误，关键截图已查看。
- 浏览器证据：`C:/Users/ADMINI~1/AppData/Local/Temp/nf-export-browser-mO20DU/`，包含脚本、下载文件、截图和 `verification.json`；2 次脚本模型调用，0 次真实调用。脚本备份 SHA256 已核对，临时浏览器与 HTTP 服务已退出。子计划：`2026-09-15-fixed-text-export.md`。
- 剩余工作：已有 Gemini Chat 在独立作品连续创作 3–5 章，人工核对修改对后文、人物和伏笔的影响；完整浏览器流程和用户流程 §10 全项审计；README/MEMORY、合入、推送及运行 Web。不能在本次阶段提交后把持续目标标为完成。

### 真实首章发现的问题与本次保存点（2026-09-15）

- 固定版本导出已提交为 `3c2c855`。用户随后要求先保存记忆并提交当前代码；本批保存到此为止的进度，未将首版总目标标为完成。
- Gemini 第一章把姓名填入人物 ID，旧 C5 会过滤事件参与者和人物出场；未知状态字段也可能被接受。现在未知人物/情节线/地点、姓名替代编号、未支持的状态字段会使 C5 失败，保留正文，禁止采用；恢复只执行未完成的 C5。任务与遗留 pipeline 共用提示与检查，不猜测姓名对应 ID。
- 人物状态限定为 `condition/location/vital`，持有物变化记入完整的 `condition`；`location` 使用已确认地点 ID，修复合法 `S_OldArchive` 被投影为 null。`vital` 的生成、纠错和 Web 均支持 `alive/dead/missing/unknown`；历史额外状态字段只保留为记录。
- C5 明确提供可引用 ID，要求逐字复制一个连续原文片段，保留标点、不改写、不拼接。结构错误不能靠删除记录或放宽规则取得采用资格。新增 12 项回归，完整 **45 文件 / 912 项通过**，typecheck、web:build、diff 检查通过；当前代理已独立复核。
- 真实验收目录：`C:/Users/Administrator/Desktop/novel-forge/data/flow-acceptance-2026-09-15-WVJ88z`。作品 `library/work-1f54679c-3c58-4304-b2e8-cfce969e142e`，书名《雾港封签》。继续使用主目录 `.env.local` 的 Gemini Chat 代理，模型 `gemini-3-flash`，`json_schema`、thinking default、stream auto；不记录凭证、不向官方地址复用代理密钥。
- 已有 **10 次真实调用**，本次恢复核对未增加模型调用。已完成 Web 新建、候选方案、纯讨论不改变资料、明确确认方案并写首章、离开/返回查看同一任务。方案 `proposal-f517c6df-6778-4d30-b5fb-41889f860282` 已确认，正式进度仍为第 0 章。
- 第一章 `ch1d1` 为 `needs_revision`，正文 2955 字、预算 2300–2900。两条 C5 引文无法在原文定位，现有 block 正确阻止采用。人工另发现唯一钥匙被写成备用钥匙、柜门未写开锁就打开、结尾离开视角人物后仍描述库内；密度/超字数提示不应通过放宽规则消除。
- 下一步作者干预尚未发送：通过对话明确调整已有设定与第一章目标，再整章修订并保留原稿；封存箱只有这枚铜钥匙，顾青腰间其他钥匙对应库门/其他柜，补足开锁动作，改为沈砚保管唯一铜钥匙、顾青只拿核查清册，保留天亮共同核查封存柜的结局，删除越出沈砚感知范围的内容。当前已确认地点资料及第一章计划仍写由顾青保管，必须经产品入口调整，不能直接改存储冒充验收。
- 人物 `C_ShenYan`、`C_GuQing`，地点 `S_OldArchive`，情节线 `P_MainLine`。第一章采用后读取实际伏笔 ID，再安排第二章部分核实蓝蜡非当前标准封蜡、第三章匹配旧印钳解释缺口成因；幕后主使保持未知。第二、三章计划已确认，但 `resolves` 尚未安排。候选伏笔编号可能因修订变化，不能固定假设 F01。
- 证据在验收目录 `evidence/`：`calls.json`、`usage.json`、每次请求/响应、`flow-state.json`、`1-create` 到 `5-watch` 截图及结果。`discussion-isolation.json` 证明纯讨论没有资料或任务副作用。复核正文、正式状态和后续模型输入，不以模型口头回复作为完成证据。
- 临时验收服务已停止；当前无进行中的模型请求。工装已备份并核对 SHA256：`live-service.source.mjs`、`live-browser.source.mjs`、`resume-command.json`；脚本保留相对源码导入，继续时先复制回工作目录为 `.tmp-live-service.mjs`、`.tmp-live-browser.mjs`、`.tmp-live-command.json`，再启动。旧端口已失效，启动后读取新 `.tmp-live-location.json`。
- 恢复命令（在项目工作目录）：`node --env-file=C:\Users\Administrator\Desktop\novel-forge\.env.local --import tsx .tmp-live-service.mjs C:\Users\Administrator\Desktop\novel-forge\data\flow-acceptance-2026-09-15-WVJ88z`。务必保留末尾目录，避免另建作品。浏览器运行 `node --import tsx .tmp-live-browser.mjs`；对话入口 `/api/conversation`，任务入口 `/api/tasks`。不要重复 `create` 或既有对话。
- 既有数据校验：85 个基线文件中，`data/demo/alert-states.json`、`beats.json`、`events.jsonl` 的哈希与验收前不同，时间为 UTC 01:02–01:04；事件末尾有 `user_edit` 的伏笔改期记录，来源尚未核实。其余 82 个一致。没有恢复或覆盖这三份文件，防止抹掉用户操作；细节见 `evidence/checkpoint-files.json`，最终验收仍需核对，不能声称原数据全部未变。
- 后续待办：第一章修订/结构纠错与采用 → 第二、三章创作和逐章采用 → 人工核对钥匙保管人、人物与伏笔及后续上下文 → 完整浏览器流程和 §10 的 16 项审计 → 更新 README 和最终验收报告。DeepSeek 官方真实调用仍缺对应凭证，属于尚未验证范围。
- 本次代码提交 **`576bdb7 fix(c5): 修复结构引用和人物状态校验`**，此前十批功能提交一起快进合入 `C:/Users/Administrator/Desktop/novel-forge` 的 `master`，已推送 `origin/master` 并用 `git ls-remote` 核对。该代码提交后工作区干净；本条同步状态由后续文档提交保存。开发工作树 `C:/Users/Administrator/Desktop/novel-forge-worktrees/project-completion`、分支 `feat-project-completion` 继续保留；临时工装已备份并移出工作树，凭证和验收作品未入库。本次按用户要求交接，未启动新的真实生成或主目录 Web 服务。

### 第一章采用、第二章质量问题与规划工具修复（2026-09-15）

- 上述推送后的记忆提交为 `c5b3359`，主目录与远端 `master` 一致。随后继续在 `feat-project-completion` 工作树推进；本节所列指定章节规划修复、README/模型文档及新增 8 项测试**尚未提交或合入**。
- 同一《雾港封签》现有 31 次真实调用，其中调用 25 为代理连接失败，未执行业务动作；核对后通过新一轮请求恢复。当前没有进行中的模型调用，独立验收服务已在第二章保存后停止；旧 PID 34796 / 端口 58240 不再沿用。
- 第一章通过对话更新已确认的钥匙设定与计划，整章修订为 `ch1d2`，2628 字。沈砚保管唯一箱钥匙，顾青仅接清册，开锁动作和真实年号已修改；新 C5 人物引用有效，所有引文可定位。系统为 ready，仍有密度及事件权重建议，不代表所有文风和语义均无问题。
- 对话随后仅纠正伏笔的承诺范围及预期期限，形成 `ch1d3`：正文与 `ch1d2` 逐字相同，伏笔 F02 在第 3 章前解释蓝蜡材质与半月缺口物理成因，幕后主使不在这条承诺范围内。一次多带 `foreshadowId` 的纠错调用被拒绝，模型修正参数后成功。已通过 Web 查看原文、核对桌面/手机结果并采用 `ch1d3`，正式进度为第 1 章。证据 `6-say` 至 `10-click`、`correction-isolation.json`。
- 第二章 `ch2d1` 已生成，3014 字，系统 ready，无 block；尚未采用。正文开头正确沿用“铜钥匙在沈砚皮包中”。但人工发现中段提前拿出旧印钳并断言“旧库里的工具可以排除”，与要求第三章匹配旧库破损印钳的方向冲突；C5 同样记录了这条错误推进。下一步必须修订正文及声明，不能只凭 ready 采用。原文/声明见 `13-watch-result.json`。
- 原对话声称已把 F02 分别安排在第 2 章部分、第 3 章完整兑现，但实际只写入第 2 章 partial。第三章 `resolves` 仍为空。已定位主 Agent 只暴露“下一章”规划工具的缺口，先用业务用例复现再修复：提供 `plan_add_to_chapter` 的可选 `targetChapter`，省略时为下一章；保留旧工具名执行兼容。非法、过去或不存在目标不回退改写下一章。提示要求多章逐项保存并查询实际处理进度后回复。
- 新增 8 项回归，最新完整 **45 文件 / 920 项通过**，typecheck、web:build、diff 检查通过。指定章节工具的新代码尚未重启进行真实调用；子计划 `docs/superpowers/plans/2026-09-15-agent-plan-target.md`。
- README 已更新为从作品列表新建、资料确认、生成/修改/逐章采用和固定 TXT 导出的实际流程；统一模型文档修正主 Agent 输出预算为 8192 及当前页面入口。这批文档待最终验收后一起提交。
- 用户已确认 UTC 01:02–01:04（北京时间 09:02–09:04）的 demo 数据变化是自己在 Web 中调整产生的，保留三份文件；不再把这些已确认的用户操作当成不明损坏。
- 继续步骤：重启同一验收目录 → 通过对话补存第三章 full 并核对两个安排 → 明确修订第二章，移除提前揭晓或排除旧印钳的内容，仍保留封蜡比对及钥匙归属 → 检查/采用 → 第三章生成、检查/采用 → 导出及 §10 全项审计 → 最终文档、合入推送和运行 Web。原始初稿保留，不能通过直接修改 data、删除正确规则或伪造结构通过验收。

## 18. 2026-09-15 当前代码整体排查

用户本轮要求“整体排查一遍当前的代码”。在 `C:/Users/Administrator/Desktop/novel-forge-worktrees/project-completion`、`feat-project-completion` 上检查 `c5b3359` 与已有指定章节规划修复。全部实现和复核由当前代理完成；“检查项目并继续完成项目”的总目标当前 paused，不因本轮代码审查完成而恢复或标为完成。

### 修复与关键决策

- Chat／Claude 流中断、Chat aborted／资源不足时返回已收可见文本，C4 保存为未完成片段；续写中断保存旧前缀与新增片段，重开可继续。思考内容不混入正文，未闭合的改写 JSON 不应用替换，残缺工具参数不执行。
- C4 仅将 end_turn／stop_sequence 视为完整结束。工具轮数耗尽、pause_turn 或空停止原因不进入 C5，也不成为 ready 稿；Chat tool_calls 结束但没有工具内容时明确失败。
- 本地 HTTP 复现 Claude SDK 随 307 向另一端点转发 x-api-key、错误回显凭证；现在禁止自动重定向，遮蔽配置 key 与 Bearer token，限制错误长度。没有调用真实 Claude 或使用用户凭证测试。
- 本地服务增加回环 Host、同源 Origin 与 API POST JSON 内容类型检查，阻止外部网页简单请求写入。非法 JSON／URL 编码返回 400，超 4 MiB 返回 413，错误内容类型返回 415。实际 Vite 测试发现默认 Host 改写导致 403，已设置 `changeOrigin: false` 并验证保存成功。
- Windows 同一作品的大小写／短路径别名统一使用 `realpathSync.native` 作为 Session 缓存键，避免两份旧内存互相覆盖；同一真实目录共享状态及活动任务锁。仍不提供跨进程锁。
- Web 的迟到响应只更新仍在原 URL 的页面，已提交的复合操作继续完成；资料方案及阅读页按路由重建，切章时不显示旧正文。手机 Reader 改为单列，390／320px 同时检查 main 内部溢出并查看截图。
- 依赖锁定 Vite 6.4.3、Vitest 4.1.11、YAML 2.8.3；修复原审计中 4 个受影响包，未用强制 audit fix。前序指定章节规划修复一并保留，尚未进行真实 Gemini 复测。

### 验证与证据

- 本轮新增 28 项回归，之前规划修复新增 8 项；最新 **47 文件 / 948 项测试通过**。Node v24.9.0；typecheck、web:build 通过，`npm audit --json` 为 0 个已知漏洞。
- 8 个实际 Chromium 场景通过：迟到写章、迟到手动保存、方案深链接、阅读切章、确认并写、外部 Origin POST、实际 Vite 保存、手机阅读。未捕获页面脚本错误；最终浏览器工装 2 次本地模型替身调用，**本轮 0 次真实模型调用**。
- 浏览器证据：`C:/Users/Administrator/AppData/Local/Temp/nf-code-audit-browser-naL4k7/`，含 verification.json、browser.source.mjs 和截图；备份脚本与工作树脚本 SHA256 一致，临时浏览器、HTTP 服务和 Vite 均已关闭。
- 报告：`docs/reports/2026-09-15-code-audit.md`；检查计划：`docs/superpowers/plans/2026-09-15-code-audit.md`。README、模型配置和写章 API 已补充片段恢复、HTTP 约束及验证范围。
- 单进程事务、采用边界、任务去重／暂停恢复、自动修订、候选隔离、规划生命周期、固定导出和对话队列均复核，相关业务回归通过。未声明所有语义问题、强制结束进程前未写盘片段、跨进程并发或历史自动压缩已解决。

### Git、运行状态与后续

- 三笔代码提交 `cd17226`（指定章节规划）、`81f533e`（运行与 Web 修复）、`5381a9e`（依赖升级）已快进合入主目录 master 并推送；`git ls-remote` 核对远端为 `5381a9eeceaf69e95246b411542b4d0d5f2c8ebc`。本次报告、指南与记忆由随后的文档提交保存。用户作品、`.env.local` 和 `.tmp-*` 验收工装不纳入提交，开发 worktree 继续保留供后续真实验收。
- 主目录首次 `npm ci` 因旧 Web 的 esbuild 子进程占用文件而报 EPERM。已核对旧服务的 data/demo、空的下一章草稿和无活动网络连接，停止空闲服务后再次安装成功；未改锁文件规避。主目录再次通过 47 文件 / 948 项测试、typecheck、web:build，依赖审计 0 个已知漏洞。
- 新 Web 已以原 data/demo 和 5174 端口后台启动，当前核对 PID 为 12444（后续停止前必须重新核实身份）。`http://127.0.0.1:5174` 返回本次构建，作品列表可读，demo 仍为第 52 章，活动任务为 0，外部 Origin 读取被 403 拒绝。日志在 `nf-code-audit-browser-naL4k7/main-server.stdout.log` 和 stderr.log。真实验收服务保持停止，旧验收端口无效。
- 主目录 255 个作品与配置文件在合入、安装和重启前后的 SHA256 全部一致，无新增或删除；已确认的用户 demo 调整完整保留。
- 若用户之后恢复真实验收，继续第 17 节指定目录与《雾港封签》，不要另建或覆盖：现有 31 次真实调用；ch1d3 已采用，ch2d1 未采用；先补存第三章 F02 full，再修订第二章并完成第三章、导出及 §10 审计。系统 ready 不代替人工核对故事方向。（**已过时**：三章已采用，见第 19 节。）
- DeepSeek 官方真实验收仍需该平台对应凭证。已有 Gemini 代理凭证只用于原端点；Claude 真实调用继续暂缓。

## 19. 2026-09-16 进度核对与记忆同步

**当前接续入口。** 用户要求“检查项目进度”，随后要求“更新记忆然后提交”。本轮只做核对与文档同步，没有调用真实模型、没有改动验收作品、没有新增业务代码。核对期间发现另一并行会话已把 worktree 中暂存的修复提交为 `9bca531` 并快进到主目录 master，本节据实记录。

### 代码与仓库

- 最新代码提交 **`9bca531 fix(agent): 修复后台交接与写作要求传递`**（2026-09-15 16:25），17 文件，+292/−32；`feat-project-completion` 与主目录 `master` 均指向它。本记忆提交后一并推送到 `origin/master`，推送结果以 `git ls-remote` 为准。
- 该提交包含两项修复，计划见 `docs/superpowers/plans/2026-09-15-agent-task-handoff.md` 与 `2026-09-15-chapter-author-request.md`：
  - 后台任务受理后的对话交接：主 Agent 提交修订/写章/检查后不再重复轮询稿件耗尽轮数；在已提交任务的完整工具轮结束后保存整轮工具结果并返回真实任务入口。真实 Gemini 的 `16-say`、`23-say`、`25-say` 受理后 0 次多余主 Agent 调用。
  - 对话写作要求随章节任务保存：作者本轮要求随 `writeContext` 冻结进入 C4，恢复与重复请求使用同一要求；只讨论的内容不进任务。真实调用 55 证明修复前第三章缺少本轮请求。**修复后尚未追加真实 C4 调用验证。**
- 在 worktree 实测：`npm.cmd run typecheck` 通过，`vitest run` **48 文件 / 962 项通过**。
- worktree 中 `.tmp-live-browser.mjs`、`.tmp-live-command.json`、`.tmp-live-location.json`、`.tmp-live-service.mjs` 为未跟踪验收工装，继续不入库；`.tmp-live-location.json` 记录的验收服务 PID 36060 / 端口 51535 已不存在。主目录 Web 服务 PID 12444（data/demo，5174 端口）仍在运行，停止前需重新核实身份。

### 真实验收《雾港封签》实际进度

- 目录不变：`data/flow-acceptance-2026-09-15-WVJ88z/library/work-1f54679c-3c58-4304-b2e8-cfce969e142e`。`work-meta.json`：`workVersion=3`，正式稿 `1: ch1d3`、`2: ch2d4`、`3: ch3d4`。
- 三章字数 2628 / 3287 / 3830，合计 9745 字；中间 ch2d2、ch3d1、ch3d3 被闸门判为 needs_revision，后经修订通过，初稿全部保留。伏笔 F02 于第 3 章 `resolved`，F04 仍 open（预期第 5 章前）。
- 1–3 章固定版本 TXT 已导出：`exports/export-cab30c19…`，下载件 `evidence/35-export-chapters-1-3.txt`（33157 字节，SHA256 `f6b5c59b…`）。
- 累计 **62 次真实调用**，其中第 25 次为代理连接失败；当前无进行中调用。证据到 `37-inspect`，汇总见 `evidence/final-flow-verification.json`（含桌面/390/320px 截图、受保护文件哈希未变、离开后返回同一任务）。
- 系统剩余提示：三章均有 `c5_weight3_single_line` warn，第 1、3 章 `density_over` warn；均为建议，不通过放宽规则消除。

### 尚未完成

1. 作者要求传递修复（`9bca531`）的**真实模型复测**：`final-flow-verification.json` 中 `liveC4AfterFix` 为 not run。
2. 三章正文的人工故事核对（钥匙归属、旧印钳揭晓时机、越出视角等）；系统 ready 不代替人工判断。
3. 用户流程 §10 的 16 项逐条审计与最终验收报告；目前只有代码审计报告 `docs/reports/2026-09-15-code-audit.md`。
4. 暂缓项不变：DeepSeek 官方凭证、Claude 与 10 章缓存实测、旧作导入/批量生成等 v1 推迟范围。
5. “检查项目并继续完成项目”的总目标仍为 paused，不因本次记忆同步而恢复或标为完成。

## 20. 2026-09-16 界面重做、演示数据修复与差距盘点

**当前接续入口。** 用户依次要求：检查进度 → 更新记忆提交 → 界面太丑要引入组件库并要流式输出 → 章节页滚动体验差 → 统一其余页面并美化滚动条 → 盘点“作为小说 Agent 还差什么”并把进度与后续任务写进本文件。全部实现与复核由当前代理完成，未启动子代理、未调用 Claude；浏览器验证一律使用脚本化模型替身，**本轮 0 次真实模型调用**。

### 本轮代码提交（均已推送 `origin/master`）

| 提交 | 内容 |
| --- | --- |
| `8a631c4` | 引入 antd 6 重做界面；主 Agent 对话新增 SSE 流式输出 |
| `d657da2` | 重做正文页滚动与阅读版面 |
| `65f0553` | 统一首页/结构视图版面；全局滚动条样式；修复节拍表缺权重的 500 |
| `e88d961` | 演示人物各有自己的外貌与说话方式 |

基线为 `367eeaf`（上一轮记忆同步）。工作区干净，开发 worktree `feat-project-completion` 已快进到同一提交。

### 界面与交互（用户明确驱动）

- **引入 antd 6.6.4 + @ant-design/icons**，主题在 `web/src/theme.ts`（暗色金调，与既有 CSS 变量同源）。全站原生 `select/radio/checkbox/number/dialog` 清零；状态标签统一走 `web/src/components/Chip.tsx`（antd `Tag` 在 `exactOptionalPropertyTypes` 下不收 `color={undefined}`，收口一处）。枚举中文名统一 `web/src/labels.ts`。
- **对话流式输出**：`CallOptions.onTextDelta` → `ChatClient`/`ClaudeClient` 在有回调时强制流式 → `runAgentLoop` 每轮发 `round`、工具调用发 `tool` 事件 → `POST /api/conversation/stream` 以 SSE 逐条推送 `round/delta/tool/done/error`。断开连接不影响服务端保存回合；发出事件前失败仍返回带状态码的 JSON。Web 侧 `api.converseStream` 逐事件读取。
- **作品列表/新建**：书脊式卡片、衬线标题、antd 表单。
- **对话页**：三段式（标题／可滚动消息流／底部输入卡），逐字光标、工具进度胶囊（中文标签）、草稿抽屉、向上翻看时不被强制拉回底部。
- **正文页**：顶栏固定，阅读区与体检栏**各自滚动**；正文列在可用宽度内居中（实测左右各留白 92px）、衬线加宽行距；章节选择/上下章/阅读进度条进顶栏；换章回章首；手机单轴滚动、体检栏排在正文之后。
- **其余页面**：统一 `.panel` 纸面、统计条改指标卡、表格包 `table-panel` 可横向滚、图例统一、导出页与结构纠错表单重做版面。
- **滚动条**：全站细窄半透明滑块，悬停转金色，轨道透明，正文页更窄一档。

### 顺带修复的两个真问题

- **节拍表缺权重导致 `/api/health` 500**：`deriveWordBudget` 直接解构 `rules.resolveCost[r.weight]`，手改或损坏的 `beats.json` 会抛 `undefined is not iterable`。现在报「节拍表里的伏笔收束「F01」的权重无效：undefined（可选项：main、sub、detail）」，并补回归（`test/derive.test.ts`，测试数 968→969）。
- **演示人物共用模板**：`seed-demo.ts` 六个人物外貌/说话方式完全相同（用户报“点开详情显示的都是一个”）。已按角色身份各写一份；现有 `data/demo/characters.json` 就地更新（备份 `characters.json.bak-before-appearance-fix`，`data/` 不入库），其余字段与用户既有手工调整未动。**注意**：真实作品《雾港封签》的人物数据本来就各自独立，不受影响。

### 验证边界

- 49 文件 / 969 项测试、`npm.cmd run typecheck`（根 + web）、`npm run web:build`、`git diff --check` 全通过。
- 浏览器核对三批工装，桌面 1440 / 390 / 320px：作品列表与新建、对话流式（实测逐字增长且最终文本与 `done` 一致）、结果页与导出控件、正文页独立滚动与锚点定位、首页、四个结构视图、提示列表、滚动条计算样式。均无横向溢出、无脚本错误。
- 工装备份（含 SHA256 已核对，脚本保留相对导入，复跑时复制回工作树根目录为 `.tmp-*.mjs`）：
  - `C:/Users/Administrator/AppData/Local/Temp/nf-ui-browser-LwHudw/ui-browser.source.mjs`
  - `C:/Users/Administrator/AppData/Local/Temp/nf-reader-browser-BgkK5I/reader-browser.source.mjs`
  - `C:/Users/Administrator/AppData/Local/Temp/nf-pages-browser-pt4gFO/pages-browser.source.mjs`
- Playwright 经 npx 缓存调用：`C:/Users/Administrator/AppData/Local/npm-cache/_npx/e41f203b7505f1fb/node_modules/playwright`，Chromium 在 `.../ms-playwright/chromium-1208/chrome-win64/chrome.exe`。
- **本轮未做**：§10 全项审计、真实模型复测、三章正文人工核对。

### 产品差距盘点（用户提问“作为小说 Agent 还差什么”，当前代理核对代码后给出）

已核对事实：外貌与说话方式**确实进入模型上下文**（`src/context/select-l3.ts` 渲染进 L3）；`VoiceCheckSpec` / `VoiceCheckChannel = "code" | "model"` 在 `src/types/character.ts` 定义但**全项目无任何消费点**；`src/gate/` 只有 `code-channel.ts`、`cross-chapter.ts`、`route.ts`，**没有模型审查通道**；API 端点清单中**无导入、无删除作品、无全文检索**；`Beat` 有 `volume` 字段但无卷管理入口。

按优先级：

1. **手改资料**：资料准备页表单只有 5 个字段（书名/想法/核心冲突/起点/写作规则），人物、地点、情节线、节拍表在界面上不能手改 —— 而后端 `record_author_details` 的 schema 已经支持传完整 `characters/settings/plotLines/beats`。**只差表单，成本最低、收益最直接。**
2. **导入旧作**：v1 明确推迟，但没有导入就接不住有存量稿的作者。
3. **VoiceCheck 的 model 通道**：SpeechProfile 已存、已喂模型，只差检查环节；“这一章 X 说话不像 X”目前完全没查。
4. **语义一致性审查（原 M4 诊断通道）**：C6 只判可机械判定的项（引文定位、权重、密度、句长、标点），人物动机、伏笔是否真兑现、跨章设定矛盾都判不了。
5. **批量/连续创作**与**跨多章返修**：现在严格一次一章；改第 5 章只把后续稿标过期，不找受影响段落、不给修订建议。
6. **卷/部结构**：长篇组织必需，`volume` 字段已有但无入口。
7. **删除与恢复入口**（作品与草稿）、**备份/迁移**（资产就是 `data/` 下一堆 JSON）。
8. **导出格式**：只有固定版本 TXT，无 EPUB/DOCX/分卷/设定集导出。
9. **全文检索**：找“钥匙第一次出现是哪一章”目前只能问 Agent。
10. **成本账**：Claude 官方 10 章缓存实测缺官方 key、DeepSeek 官方接口缺凭证，长篇每千字成本没有实测数据；模型选择仍只有环境变量，无 UI 切换。

用户尚未指定先做哪一项；第 1 项是当前代理的建议起点。

### 下一轮接续待办

- [x] 用户确认先做第 1 项（手改资料表单）；本批已完成，见第 21 节。剩余 9 项仍待指定。
- [ ] 沿用第 19 节未完成的三项验收：作者要求传递修复后的真实 C4 复测、三章正文人工故事核对、用户流程 §10 的 16 项审计与最终验收报告。
- [ ] 若继续真实验收，仍用第 17 节指定目录与《雾港封签》，**不要另建或覆盖**；已有 62 次真实调用，三章均已采用并导出。
- [ ] DeepSeek 官方真实验收仍需该平台凭证；Claude 真实调用继续暂缓；Gemini 代理凭证只用于原端点。
- [ ] “检查项目并继续完成项目”的总目标仍为 paused，不因界面工作或本次记忆同步而恢复或标为完成。

## 21. 2026-09-16 资料手改表单（差距盘点第 1 项）

**当前接续入口。** 用户读完第 20 节后选定先做差距第 1 项：资料准备页的**手改表单**。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude，**本轮 0 次真实模型调用**。范围由用户当场拍板：**只做「改 + 增」，不做删除**。

### 结论先行：后端本来就支持，缺的只是界面

`/api/preparation/author` 的 `changes` 早已能收 `characters/settings/plotLines/beats`（第 20 节记的「只差表单」核实无误）。所以本批是**纯前端 + 契约测试，零后端业务改动**。

两条必须遵守的载荷规则（`PREPARATION_CHANGES_SCHEMA` 是 `additionalProperties: false`，数组按 `id`/`chapter` 整体 upsert）：

| 送错 | 服务端反应 |
| --- | --- |
| 把读回的人物卡原样回传（多带 `provenance`/`updatedAt`/`introducedAt`） | 「不允许字段 introducedAt」 |
| 从表单字段凭空拼人物（少带没露面的 `speech.sentenceLength` 等） | 「缺少 sentenceLength」 |

**接手勿改成「从表单字段拼对象」** —— 那会静默抹掉 `addressForms[].condition`、`appearance[].establishedAt/immutable` 这些没在界面上露面的子字段，连同它们对应的检查规则一起。正确做法是「以服务端对象为底稿展开覆盖」，再交给裁剪函数挑字段。

### 改动

- `web/src/api.ts`：**修正 `PreparationContent` 类型**。原 `characters[].speech` 只声明 4 个字段（`SpeechProfile` 实际 11 个）、`profile.appearance` 缺 `establishedAt`/`immutable`。类型不实正是上面第二类 400 的温床。
- 新增 `web/src/preparation-changes.ts`：出站形状 + 裁剪函数 `characterInput`/`settingInput`/`plotLineInput`/`beatInput` + `emptyCharacter`/`emptySetting`/`emptyPlotLine`/`emptyBeat`。**刻意不 import `api.ts`、不依赖 DOM**，根目录 vitest 直接引入做契约测试；`api.ts` 反向 re-export 同一份定义，避免两处走样。
- 新增 `web/src/components/PreparationEditors.tsx`：四个 antd Modal 编辑器。人物含说话方式全字段、外貌键值表、称谓表；节拍含事件/埋设/兑现行式列表。
- `web/src/pages/Preparation.tsx`：只读视图按段加编辑／新增入口。`Content` 新增可选 `onEdit`，**方案预览复用同一组件但不传 `onEdit`** —— 候选预览不能编辑。
- `web/src/styles.css`：编辑器两列栅格 + 行式列表，720px 以下塌成单列。

### 关键设计取舍

- **每份实体单独保存**，摘要写明改了谁（「作者修改人物「沈砚」」）。比一个大表单一次提交全部影响归属更清楚，`impacts` 指向也更准。
- **编号不可改**：编辑既有条目时编号框锁住。改编号等于新增一条并留下旧的。
- **沿用既有 impacts 闸门**：改了已出现人物的姓名/档案、或已采用章的计划，方案落为**候选**而不自动确认。这是既有保护，未绕过、未放宽。
- **新增空白底稿必须自身合法**：`sentenceLength.max` 必须 ≥1（给 40）、`event` 章必须有事件（`emptyBeat` 预置一行空白事件）、必须点名至少一个人物和一个地点（`emptyBeat` 默认点名主角与第一个地点）。
- 客户端守卫只挡明显错误（未点名人物/地点、正例台词为空），其余交给服务端 schema。

### 验证

- `npm run typecheck`（根 + web）、`npm test` **49 文件 / 976 项通过**（969 基线 + 7 条契约测试）、`npm run web:build`、`git diff --check` 全通过。
- 契约测试先写后跑，**首轮 3 项失败都是真发现**：`sentenceLength.max` 必须 ≥1、`event` 章必须有事件、改已采用章的计划必然走候选。均按规则修正测试与默认值，未降低闸门。
- Playwright + Chromium 实机 15 项全通过：空书 → 新增主角（含说话方式）→ 新增地点 → 新增情节线 → 新增第 1 章计划 → 取消点名时守卫拦截 → 重选 → 编辑人物语言并核对着重验证**未露面的子字段没被抹掉**（正例台词 2 条、句长上限、定位、性格标签都在）→ 刷新保留 → 补基本设定后提示「**第 1 章资料已就绪**」→ 方案记录留痕 → 390px 无横向溢出 → 无脚本错误。
- 证据：`C:/Users/Administrator/AppData/Local/Temp/nf-manual-edit/`（`drive.mjs`、`verification.json`、`preparation.png`、`editor-mobile.png`）。测试服务端口 5391 已停；**主目录 5174 的既有 Web 服务（PID 12444）未动**。
- 排障留痕：antd 给两字中文按钮自动插空格（「保 存」），脚本按 `.ant-btn-primary` 定位；antd Select 下拉渲染到 body 且旧下拉带 hidden 类，必须锁定「当前可见的那个」；弹窗有展开动画，动画期间点击会被吞。

### 一个真实的流程结论

**手改人物/地点/情节/节拍并不能单独让书「就绪」** —— `readiness` 还要求 `核心冲突` 与 `故事起点`，这两项在既有的「编辑基本设定与偏好」表单里。实机验证因此补上了这一步才走到「第 1 章资料已就绪」。也就是说差距第 1 项闭合后，「从零手搭到可以开写」这条路径才真正走通。

### 未做（明确记录，非遗漏）

- **删除**：需扩 `PREPARATION_CHANGES_SCHEMA` 与 `build()`，并加引用完整性校验 —— 被节拍表 `characters`/`locations`/`plotLine` 引用、被他人 `speech.addressForms[].target` 引用、被已采用正文引用的都不能删。用户已确认留作下一批。
- `resolves` 的伏笔编号仍是自由文本：视图只给「已规划」伏笔（`plannedForeshadows`），不含全部已埋设的 open 伏笔，做成下拉需扩 API。依赖服务端报错文案提示。
- `/api/preparation/author` 无 `requestId`：响应丢失后重试会多留一份同内容方案（`propose` 去重只在 `proposed` 状态生效）。与本批前行为一致。
- 计划文档：`docs/superpowers/plans/2026-09-16-preparation-manual-editing.md`。

### 下一轮接续

- [ ] 差距盘点还剩 9 项待用户指定（第 2 项导入旧作、第 3 项 VoiceCheck model 通道、第 4 项语义审查、第 5 项批量/跨章返修、第 6 项卷结构、第 7 项删除与备份、第 8 项导出格式、第 9 项全文检索、第 10 项成本账）。
- [ ] 第 19 节三项验收仍未做：作者要求传递修复后的真实 C4 复测、三章正文人工故事核对、用户流程 §10 的 16 项审计与最终验收报告。
- [ ] 若继续真实验收，仍用第 17 节指定目录与《雾港封签》，**不要另建或覆盖**；已有 62 次真实调用。
