# novel-forge 工作记忆

更新时间：2026-09-19（Asia/Shanghai；PR #13 / #14 已合入 master；差距第 7 项**删除、恢复、资料删除、备份/迁移全部完成**；队列头转为第 8 项导出格式；**接手先读第 28 节的「当前进展快照」**；“继续完成项目”总目标保持暂停）

记录范围：本文件汇总项目调研、产品决策与开发进展。**接手先读第 28 节**（当前分支、队列、持续授权与工作节奏），再按队列项读对应批次记录；删除与恢复见第 38 节，资料条目删除见第 39 节。Gemini 真实验收《雾港封签》三章（ch1d3 / ch2d4 / ch3d4，共 9745 字）已逐章采用并完成 1–3 章固定版本 TXT 导出，累计 62 次真实调用。尚未完成：修复后的真实 C4 复测、三章正文人工核对、用户流程 §10 全项审计与最终验收报告。沿用 LangGraph、当前代理独立实施与复核；不擅自恢复暂停的总目标或调用 Claude。

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
- **真实模型 live 对话**当时未验证，逻辑由 mock 客户端测试覆盖。（订正：Mac 自 9-12 起也有 `.env.local`，`npm run serve` 可直接真机跑；9-17 用户纠正过"Mac 没配置"的误记。）

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
3. **~~VoiceCheck 的 model 通道~~ 已完成（第 23、24 节：code 与 model 两个通道都通）**：核对发现 8 项检查原先一项都没实现，连 6 项 code 也是死的。
4. **~~语义一致性审查（原 M4 诊断通道）~~ 已完成**：视角越界与伏笔兑现见第 25 节，人物动机与设定矛盾见第 27 节。四类判定都锚在已确认的结构化基准上。
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

## 22. 2026-09-16 让 AI 起草资料，作者只审

**当前接续入口。** 第 21 节的手改表单交付后，用户当场校正方向：**手动填人物性格是错的前提**。本批按用户选定的「AI 先生成，作者只审」重做。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 用户的校正（方向性，别再退回）

> 手动修改时不太对的，不能手动修改，需要 AI 确定人物性格等等。因为作者他可能没有看过这本小说，他也不清楚具体人物性格。

**这个产品里的作者更像导演** —— 他按需跳读关键正文，不是逐字通读的人。让人类填「疑问句占比 0.35」「台词句长 12–20 字」是错的前提：那是 AI 的机械参数。第 21 节的表单把「作者是数据录入员」当默认前提，跟项目既有约定（模型产出先进 proposed、用户接受才 committed）拧着。

### 核对后的关键事实：AI 定人物性格的能力**早已存在**

`propose_preparation` 的工具描述明确要求「人物 profile 和 speech 必须完整」（`src/agent/tools.ts`），系统提示也写了「准备作品：用 propose_preparation 保存你的建议方案，明确展示具体人物」。资料页那个「到对话整理方案 →」链接走的就是它。

所以缺口是两件事，**不是「AI 不会定」**：① 资料页没有直接入口，作者得自己去对话里组织一句话；② 编辑器把机械参数暴露给人类。

### 实现

- `src/agent/tools.ts`：新增 `PREPARATION_DRAFT_TOOLS`（读类 + `propose_preparation`）与 `EXPECTED_PREPARATION_DRAFT_TOOL_ORDER`。**起草无人盯着，拿到 `confirm_preparation` / `write_next_chapter` / `adopt_chapter` 就是越权** —— 从工具层面杜绝，不靠提示词祈祷。
- `src/server/state.ts`：`ProjectSession.draftPreparation({ brief, focus, apply })`。复用 `buildMainAgentSystem` + `runAgentLoop`，**不写对话历史**（按钮不是作者打的字，写进 turns 就是伪造）；schema 不合规时校验错误作为 tool_result 回喂，模型自己改到过 —— 所以不需要新写解析逻辑。
- `apply: false` 是表单试填：包装 `proposePreparation` 为「捕获不保存」，只校验形状不跑业务校验（否则一个还没埋设的伏笔引用会让整个试填报废）。
- `src/agent/tool-exec.ts`：`AgentActionOutcome.effect` 改为可选 —— 「这次没有状态变化」是诚实的状态，硬塞一个不相干的 effect 会在 UI 上画出并不存在的操作记录。
- `src/server/chapter-input.ts`：`ChapterWriteError` 状态加 **502**（模型这轮没交出可用东西，不是作者输入问题、也不是服务没配好）。
- `POST /api/preparation/draft`（走 `handleAsync`）。
- 前端：资料页「让 AI 起草资料」「让 AI 起草人物」；人物编辑器**字段分层** —— 默认只留人答得出的（姓名/别名/权重/定位/性格标签/想要什么/害怕什么/背景/语域/情绪表达/口头禅/禁用词/正例台词），把 `sentenceLength`、`syntaxBias`、`signatureLexicon`、`counterExemplars`、`addressForms`、`appearance` 收进折叠的「高级 · AI 的机械参数」（**折叠不等于删除，仍可改**）；新增人物弹窗可「让 AI 起草这位人物」；候选预览的「外貌与说话方式」**默认展开**（审阅面不该再让人点一次）。
- `fill()` **保留作者已填的姓名与编号** —— 那是他告诉 AI「起草谁」的凭据，也是他唯一确定知道的信息，不能被 AI 的推断反过来改掉。

### 验证

- 新增 `test/preparation-draft.test.ts` **6 项**：受限工具集、apply=true 只落候选且对话回合不增、apply=false 一个文件都不落、schema 不合规回喂后可重试、零方案/零草稿时明确报错。**982 项测试全过**（976 基线 + 6），typecheck（根+web）、web:build、`git diff --check` 通过。
- Playwright + Chromium 实机 **16 项全过**：空书 → 起草 → 候选（性格与说话方式默认展开）→ 确认 → 资料落库且正文仍 0 章 → 编辑器载入 AI 推断 → 机械参数默认折叠仍可展开 → 手工补漏时试填并保留作者填的姓名 → 试填不落盘 → 390px 无溢出、无脚本错误。**0 次真实模型调用。**
- 工装与截图：`AppData/Local/Temp/nf-draft-browser-*/`（`browser.source.mjs`、`verification.json`、3 张截图）。
- 排障留痕（下一轮省时间）：antd 给**两个汉字**的按钮自动插空格（「取 消」），`getByRole(name:'取消')` 匹配不到，按 `.ant-btn-primary` / footer 首个按钮定位；antd Select 下拉渲染到 body 且旧下拉带 hidden 类，必须锁定「当前可见的那个」；弹窗有展开动画，动画期间点击会被吞；弹窗会关会开，locator 要当场取不能缓存。

### ⚠️ 事故：我覆盖了 `data/demo`（必须记住）

**我为了查证 `seed-demo.ts` 是否也共用模板，不带参数跑了 `npx tsx src/harness/seed-demo.ts`** —— 它的默认输出目录就是 `data/demo`，于是把用户的 demo 重新生成了。**`data/` 不入库，无 git 可恢复。**

- **丢失**：第 17 节记录的用户于 09-15 09:02 亲手改的 `alert-states.json`、`beats.json`、`events.jsonl`（含一条 `user_edit` 伏笔改期），以及 `characters.json` / `discipline.json` / `settings.json` 上的手改。
- **未丢**：`chapters/` 52 章正文（逐字节与种子输出一致，实际从未改变）、`conversation.json`、`exports/`，以及真实验收作品 `data/flow-acceptance-2026-09-15-WVJ88z`。
- **恢复判断**：全盘只有一个卷影副本（2026-09-12 16:24），比用户的 09-15 修改更早、也早于第 20 节的人物修复，恢复是净亏 —— 已决定不恢复。
- **结论**：`data/demo` 现在与一份全新种子输出逐字节相同、自洽可加载。**任何 `seed-demo.ts` 的调用都必须显式带输出目录**，且要先确认目标不是用户的库。

**顺带纠正一条错误记忆**：第 20 节说「seed-demo.ts 六个人物外貌/说话方式完全相同」——**已经不成立**，该文件早已逐人独立。真正陈旧的是 `data/demo/characters.json`（更早版本种子生成，第 20 节只就地补了外貌与说话方式）。它随这次重新生成一并修正：`wants`/`fears`/`background`/`traits` 从**各 1 种**变为各 6 种。

### 未做 / 下一轮

- [ ] 已确认资料的人物卡网格里，「外貌与说话方式」**仍保持折叠**（那是常驻浏览，预览才是审阅面）。用户若要两边一致，一并展开。
- [ ] 差距盘点余 9 项待用户指定（导入旧作、VoiceCheck model 通道、语义审查、批量/跨章返修、卷结构、删除与备份、导出格式、全文检索、成本账）。
- [ ] 第 19 节三项验收仍未做：作者要求传递修复后的真实 C4 复测、三章正文人工故事核对、用户流程 §10 的 16 项审计。
- [ ] `data/demo` 的告警演示场景（F07/F11/P03/C05/F03 那几条埋好的结构债）随重新生成回到了种子定义的状态，用户先前在界面上处理过的痕迹已不在。

## 23. 2026-09-16 人物声音一致性检查（code 通道）

**当前接续入口。** 用户从差距盘点里选了第 3 项（VoiceCheck），并确认**先做 code 通道**、model 通道与第 4 项语义审查留作下一批。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 核对结论：比记忆里记的更彻底

第 20 节写的是「`VoiceCheckSpec` / `VoiceCheckChannel` 全项目无消费点」——**实际是 8 项检查一项都没实现，连 6 项 code 通道也是死的**。`src/gate/` 原有的是字数、密度、疲劳词、感叹号、零容忍、复读，**没有一项是人物声音**；`code-channel.ts` 的注释还写着「人物声音一致性…归 Haiku」。也就是说：规则写好了、`SpeechProfile` 已存且已渲染进 L3、检查没写。

### 实现

- **`src/text/speaker.ts`（先决条件）**：把引号里的台词绑到人身上。没有它，句长区间、口头禅、专属词串味全都无从谈起。判据全部来自**中文里本来就有的结构**——段落边界、句读、`沈砚说：「…」`/`「…」沈砚道` 的言说动词，不使用「前后 N 字」这类窗口数字（`src/text` 受「代码无数字」扫描约束）。
  - **不确定就返回 null，绝不猜**：错归属会凭空造出消不掉的假警告，作者消掉它的唯一办法是放宽规则（§10.10 同一逻辑）。代词（他/她）刻意不解析。
  - 连续对话的携带规则：只有「上一段唯一 + 本段以引号开头」才沿用，且**携带只在本段确有台词时保留** —— 一段没有台词的叙述是对话的断点，跨过它继续沿用会把前面的人物粘到很远的后面。
- **`src/gate/voice-channel.ts`**：五项检查，rule 名与 `VOICE_CHECKS` 字段一一对应 —— `voice_forbidden_lexicon`(**block**)、`voice_sentence_length`(中位句长)、`voice_verbal_tic_missing`、`voice_signature_leak`(串味只报别人的)、`voice_syntax_bias`。
- **归不上属的台词不静默丢弃**：出 info 说明「本章 N 句无法确认说话人，未参与检查」；禁用词落在无归属台词里则单独出 warn（`voice_forbidden_unattributed`），**不按 block 算在某人头上**。
- `rules.yaml` 新增 `voice:` 段（`speechVerbs`、`sentenceLengthTolerance`、`verbalTicMinLines`、`syntaxBiasTolerance`、`questionMarkers`），schema/load 同步。代码里没有数字。
- 接线：`ChapterGateInput` 与 `ChapterRunInput.gate` 增加 `characters`（缺省即跳过，同「gate 缺省跳过整个闸门」的语义）；`buildChapterRunInput` 填的是**与 L3 装配同一批节拍点名人物**，避免「模型没被告知这个人物，却被按他的声音表打分」。遗留 pipeline 与任务路径共用 `checkChapter`，两条链路同时生效。

### 三个有意的取舍（都写进注释了，别当成遗漏）

1. **`addressForms` 从 `code` 改判 `model`**（`src/types/character.ts`）。注册表原标 code，但「该人物提到目标时用的称呼必须在此表内」是语义判断 —— 第三句里提到某人名字未必是当面称呼，机械判会大量误报。
2. **`syntaxBias` 只判疑问句**。问号加句尾「吗/呢」是可靠判据；祈使与省略句在中文里没有可靠形态标记，硬判会把陈述句算进去，那两项归 model 通道。`questionMarkers` 进 rules，不写死在代码里。
3. **句长用中位数不用均值**：一句爆发台词不该把整个角色判成话痨。

### 验证

- **1003 项测试通过**（982 基线 + 21：speaker 10、voice-channel 9、rules 扫描新增 2 个文件路径）。typecheck（根+web）、web:build、`git diff --check` 通过。
- **浏览器端到端 9/9**：脚本化模型真跑「写章 → 声明 → 检查」，声音问题从 C6 链路里长出来（`[block] voice_forbidden_lexicon`「沈砚」说了「没问题」、`[warn] voice_signature_leak`「凭据」跑进顾青嘴里），草稿判 `needs_revision`、`acceptable=false`，**自动修订没有接管**（`autoRevisionsUsed=0`、`automaticResultDraftId=null`），模型只被调用 2 次（C4+C5）没有偷偷重写。390px 无溢出、无脚本错误。**0 次真实调用。**
- 证据：`AppData/Local/Temp/nf-voice-browser-*/`（`voice.source.mjs`、`verification.json`、桌面/手机截图）。
- **过程记录**：`speaker.ts` 是先写实现后补测试的（偏离了项目「先写失败测试」的纪律），结果测试**抓出 3 处真设计错误** —— 邻接判断太松（把"名字出现在同段"当成邻接）、连续对话的携带会跨叙述段粘住、问句只认问号漏掉「你数过吗。」。下一轮仍应先写测试。

### 未做 / 下一轮

- [ ] **model 通道**（`register` / `emotionalExpression` / `addressForms`）。要动 `checkChapter` 的**同步链**（`checkDraft` / `adopt` 都是同步的，`adopt` 的复核还在 `this.transact(() => …)` 同步事务内）与 LangGraph 检查节点；`persist` 已支持 async 节点，但采用路径只能用「沿用草稿已存的声音结论」，新增资料建议若改了禁用词会来不及重判 —— 这条边界必须先想清楚再动。
- [ ] **差距第 4 项：更广的语义审查**（伏笔是否真兑现、人物动机、跨章设定矛盾、POV 越界）—— 与 model 通道同批更划算，机制共用。
- [ ] 其余差距项不变：导入旧作、批量/跨章返修、卷结构、删除与备份、导出格式、全文检索、成本账。
- [ ] 第 19 节三项验收仍未做（C4 复测、三章人工核对、§10 审计）。
- [ ] 本批未动 `data/demo`、未动《雾港封签》验收目录。

## 24. 2026-09-16 声音一致性的 model 通道

**当前接续入口。** 用户说「开始填坑」，指的是第 23 节末尾记下的那个坑：model 通道要动同步链。本批把它接通，`VOICE_CHECKS` 的 8 项**两个通道齐了**。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 同步链的坑，解法与边界

上一批担心的是 `checkChapter` / `checkDraft` / `adopt` 全是同步的、`adopt` 还在事务里。摸清后比预想的小：

- **`checkDraft` 不用改** —— 它只负责启动后台任务，真正的检查在 LangGraph 里跑，本来就是异步的。
- **图本来就具备条件** —— `ChapterGraphDeps` 已有 `client`，`persist` 支持 async 节点。
- **真正的边界只剩 `adopt` 一处**：它在同步事务里重跑 `checkChapter`，那里**只跑 code 通道**，model 通道沿用草稿上已存的结论。边界是：采用时选中的资料建议若改了某个角色的 `register`，那条语域结论仍是旧的 —— **warn 级，不是 block**。不假装完整。

### 接线时踩的坑（值得记）

`gate(next)` 辅助函数在 `s.outcome !== null` 时返回 END。我一开始写 `check → gate("step_voice")`，看着对 —— 但 **`check` 每次都会设 outcome**，于是边直接 END，`shouldRevise` 被整个跳过，**自动修订彻底失效**（`automatic-revision.test.ts` 九项红）。改成按 `shouldRevise` 分支：

```
step_check → shouldRevise ? step_revise : step_voice
step_voice → END
```

这个顺序本身也更对：正文马上要被自动重写时判声音是白花钱，而且修订后的正文本来就要重判。

### 实现

- `src/gate/voice-model.ts`（新增）：提示词、`VOICE_VERDICT_SCHEMA`、纯函数 `parseVoiceVerdict`。
- `src/task/steps.ts`：`checkVoiceWithModel` —— 调用 + 降级。
- `src/task/graph.ts`：新增 `step_voice` 异步节点；state 加 `voiceForBody`（正文指纹）与 `voiceFindings`。
- `src/task/types.ts` + `service.ts`：`ChapterDraft.voiceCheck` 落盘，恢复/重入同一份正文时**不再重复调用模型**（那是一笔真钱）。

### 三条性质

1. **降级，绝不失败。** 这是整条检查链上唯一会发网络请求的一步，判的却是三项建议。模型没配（`service.ts:148` 那层包装会抛）、调用失败、被拒、超长、输出不是合法 JSON —— 一律出 info「这一项没查成」，其余结论照常成立。
2. **引文必须能在正文里找到。** 找不到就丢掉那条判定并说明丢弃了几条（`voice_verdict_unverifiable`）。这是 C5 交叉校验同一条原则：让无法核对的判定进结论，作者只能靠放宽规则消掉它。
3. **建议性，不改变可否采用。** 三项都是 warn/info，`canAccept` 只看 block —— 所以自动修订的触发条件完全不受影响。

判定按**正文指纹**缓存：暂停恢复、重入同一稿都不再花钱；正文一改（含自动修订）指纹变了，自然重判。

### 验证

- 先写失败测试（上一批的教训生效）：`test/voice-model.test.ts` **7 项**，覆盖引文核对、丢弃计数、未知人物/字段忽略、输出不合格式出 info。
- **1011 项测试通过**（1003 基线 + 8）。typecheck（根+web）、web:build、`git diff --check` 通过。
- **浏览器端到端 10/10**，两轮对照：① 模型判语域不符且引文可定位 → 结果页出现 `voice_register` warn 并带出原文，判定不改变可否采用；② 模型给一条正文里没有的引文 → 该条被丢弃、出 info 说明「模型给出 1 条判定…已丢弃」。调用序列 `C4,C5,voice`。390px 无溢出、无脚本错误。**0 次真实调用。**
- 证据：`AppData/Local/Temp/nf-voice-model-browser-*/`。工装踩的两个坑：`/api/tasks` 里留着上一轮已完成的任务，必须按本轮 `draftId` 认；字数不足会触发 `route_patch`（可修订），把链路带进自动修订，样本正文要补到预算内。

### 未做 / 下一轮

- [ ] **差距第 4 项：更广的语义审查**（伏笔是否真兑现、人物动机、跨章设定矛盾、POV 越界）。机制（异步节点 + 结构化输出 + 引文核对）本批已建好，可以直接复用；判据完全不同、噪声风险更高，值得单开一批。
- [ ] 其余差距项不变：导入旧作、批量/跨章返修、卷结构、删除与备份、导出格式、全文检索、成本账。
- [ ] 第 19 节三项验收仍未做（C4 复测、三章人工核对、§10 审计）。
- [ ] 本批未动 `data/demo`、未动《雾港封签》验收目录。

## 25. 2026-09-16 语义审查（POV 越界 / 伏笔兑现）与 model 通道开关

**当前接续入口。** 差距第 4 项的前两项落地，并因用户拍板补上了 model 通道的成本开关。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 做了什么

C6 此前只判机械项。《雾港封签》真实验收里人工发现的越出视角、伏笔提前揭晓等语义问题一处都抓不到。本批把审查扩到语义，**只做能用同一套判据覆盖的两项**（用户确认）：

- **POV 越界**：正文写了视角人物看不到/听不到/想不到的东西。视角人物来自 C5 的 `characterPresence` 里 `role: "pov"` 那位 —— 代码侧已有 `c5_pov_count` 保证恰有一个，**这里判的是正文有没有守住它**，两者互补。
- **伏笔兑现**：本章声明「已收」的伏笔，正文是否真交代了当初埋下的意图。要 `intent` 当基准，为此 `parseContextBase.foreshadows` 补了这一个字段（`runInput` 不持久化，改动安全）。

沿用上一批立下的整套纪律：纯解析函数、引文必须真实存在于正文、降级为 info、按正文指纹缓存。等级一律 **warn** —— 这是模型判断而非机械事实，做成 block 等于让第二个模型的意见否决作者的采用权。

### 关键转折：model 通道的成本开关（用户拍板）

接上语义通道后**全量测试红了 42 项**（10 个文件）：`C5_JSON` 夹具每次都声明收束 F01，于是每个走完整写章流程的用例末尾都多出一次模型调用，而它们在断言精确的调用次数。这不是 bug —— **真实章节只要声明收束伏笔就会多这一次调用，每章检查的模型调用从 1 次变 2 次**。

两条路摆给用户：迁移这 42 个测试（约 40 处），或给 model 通道加 rules 开关。**用户选了开关**：

```yaml
review:
  voice: true       # 语域 / 情绪表达 / 称呼表
  semantics: true   # 视角越界 / 伏笔兑现
```

默认开；关掉只影响这两项语义判定，代码通道（字数、密度、词表、复读、声音的机械项）照常跑。好处不只是省迁移量 —— **每章两次额外调用是实打实的成本**，而「长篇每千字成本」正是差距第 10 项在盯的事，这是个真实的产品旋钮。

迁移因此从 40 处降到 10 处：测试注入 `NO_MODEL_REVIEW`（`test/writing-fixtures.ts` 导出）。另加 `test/model-review-switch.test.ts` **3 项**直接钉住开关**真的省下了调用**，而不只是少出一条 finding。

### 实现

- `src/gate/semantics-channel.ts`（新增）：提示词、`SEMANTIC_VERDICT_SCHEMA`、纯函数 `parseSemanticVerdict`。
- `src/task/steps.ts`：`checkSemanticsWithModel`（调用 + 降级）；`src/task/graph.ts` 的 `step_semantics` 节点，排在 `step_voice` 之后。
- `ChapterDraft.semanticCheck` 落盘，与 `voiceCheck` 同样按正文指纹缓存。
- 两项前置条件缺一就跳过、不花这次调用：没有正文 / 没有声明 / 既没有视角人物也没有声明收束的伏笔。

### 验证

- 先写测试：`test/semantics-channel.test.ts` **9 项**。
- **1024 项测试通过**（1011 基线 + 13）。typecheck（根+web）、web:build、`git diff --check` 通过。
- **浏览器端到端 9 项全过**（视角越界那一路）：越界句被指认且引文可定位 → 结果页出现 `semantic_pov_breach` warn 与原文；假引文 → 丢弃并出 info；调用序列 `C4,C5,voice,semantics`；建议性判定不改变可否采用；390px 无溢出、无脚本错误。**0 次真实调用。**
- 证据：`AppData/Local/Temp/nf-semantics-browser-*/`。**伏笔兑现那一路只做了单测**（工装没搭伏笔埋设数据），它复用同一个 `parseSemanticVerdict`。
- 迁移中踩到的两处（值得记）：`server-write` 的断开用例走真实 HTTP 服务、用默认规则，model 通道是开的，调用数确实要 +1；`task-control` 的子进程用默认规则而父进程用 `SINGLE_PASS_RULES`，**指纹里含 rules**，两边不一致会被判成"作品资料发生变化"。

### 未做 / 下一轮

- [ ] **差距第 4 项的另两项**：人物动机（判据最模糊）、跨章设定矛盾（要吃人物状态、情节线、前章正文，输入面大得多）。
- [x] 开关已做成按作品的界面入口（第 26 节）。
- [ ] 其余差距项不变：导入旧作、批量/跨章返修、卷结构、删除与备份、导出格式、全文检索、成本账。
- [ ] 第 19 节三项验收仍未做（C4 复测、三章人工核对、§10 审计）。
- [ ] 本批未动 `data/demo`、未动《雾港封签》验收目录。

## 26. 2026-09-17 模型审查开关的界面入口（按作品）

**当前接续入口。** 清掉第 25 节自己留的尾巴：`review` 开关只在 `rules.yaml` 里，作者在界面上关不掉。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 动手前发现的坑（决定了实现方式）

`chapterInputFingerprint`（`src/server/chapter-input.ts`）的来源指纹里**含整个 `session.rules`**。开关如果走 rules 那条路，**作者一改开关，所有未采用草稿就会被判成「作品资料发生变化」而作废** —— 第 24 节在 `task-control` 子进程那里刚踩过同一个坑。

用户拍板：**按作品存独立设置**，不进 rules。

### 实现

- `<root>/review.json`：**刻意不进 `ProjectSnapshot`**。指纹是按快照字段算的，结构上隔开比"记得别加进去"这种约定可靠。文件不存在时回落 `rules.review` 全局默认；**只读浏览不写文件**。
- `ProjectSession.reviewSettings` / `setReviewSettings`：每次从磁盘读，不进会话缓存 —— 另一个页面改了开关，下一章检查就该按新值走。
- `ChapterRunInput.gate.review` 承载它，`graph.ts` 的两个节点改读 `gate.review` 而不是 `gate.rules.review`。
- `GET/POST /api/review-settings`；`web/src/components/ReviewSettings.tsx` 接在资料页「写作规则与偏好」之后。**方案预览里不显示** —— 它是这本书的设置，不属于某一份候选资料。
- 文案说清三件事：每章各多一次模型调用、关掉只是不再出这类提示、代码检查照常。

### 验证

- 先写测试：`test/review-settings.test.ts` **8 项**，其中最要紧的一条是**改开关不改变来源指纹**。
- **1032 项测试通过**（1024 基线 + 8）。typecheck（根+web）、web:build、`git diff --check` 通过。
- **浏览器 11 项全过**（两本书的真实链路）：默认都开 → 写章确认 `C4,C5,voice,semantics` → 在界面上关掉两项 → 再写一章只剩 `C4,C5` → **之前那份草稿仍是 ready、正文没变**（这正是不进指纹的意义）→ 另一本书不受影响、也不多出 `review.json` → 390px 无溢出、无脚本错误。**0 次真实调用。**
- 证据：`AppData/Local/Temp/nf-review-toggle-*/`。

### 未做 / 下一轮

- [ ] 差距第 4 项剩两项：人物动机、跨章设定矛盾（判据模糊、输入面大）。
- [ ] 其余差距项：导入旧作、批量/跨章返修、卷结构、删除与备份、导出格式、全文检索、成本账。
- [ ] 第 19 节三项验收仍未做（C4 复测、三章人工核对、§10 审计）。
- [ ] 本批未动 `data/demo`、未动《雾港封签》验收目录。

## 27. 2026-09-17 语义审查补齐：人物动机与设定矛盾

**当前接续入口。** 用户说「排着做吧」——按差距清单顺序往下，这一批补齐第 4 项剩下的两项。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 怎么收住"判据最模糊"的两项

盘点时把这两项标成最难，办法是**锚在已有的结构化基准**上，不做开放式评论：

| 项 | 基准（都是作者已确认的硬数据） |
| --- | --- |
| 人物动机 `semantic_motivation_break` | `profile.forbiddenBehaviors`（"绝不主动求人"这类写死的约束）+ wants/fears |
| 设定矛盾 `semantic_setting_contradiction` | 地点/组织的 `facts`、`worldRules`、`abilityLimits`、`immutable: true` 的外貌属性 |

**刻意不收主观描述**：风格关键词、性格标签不进 canon —— 拿它们当矛盾判据只会产生无法辩驳也无法修的提示。测试里钉住了这条（`冷硬` 不进、可变的"左肩旧伤未愈"不进）。

《雾港封签》那句「唯一钥匙被写成备用钥匙」正是 facts 类，有基准、可指认、能引文。

### 改动很小 —— 机制上一批已备齐

在既有 `kind` 枚举上加两类（`pov|resolution` → 再加 `motivation|contradiction`），解析、引文核对、丢弃计数、降级、缓存、开关全部复用，没有新机制。

一处类型修正：`gate.characters` 声明成 `VoiceCharacter`（只有 speech），但 `buildChapterRunInput` 传的**本来就是完整人物卡**。新增 `ReviewCharacter` 把类型说全，动机判定才拿得到 `profile`。另新增 `gate.canon`，由 `canonFacts()` 从已确认资料装配。

### 验证

- 先写测试：`test/semantics-motivation.test.ts` **8 项**，含两项装配测试（canon 确实从作品设定长出来、profile 确实到得了检查层）。
- **1040 项测试通过**（1032 基线 + 8）。typecheck（根+web）、web:build、`git diff --check` 通过。
- 未做浏览器端到端：这批没有新的 UI 与新链路，走的是第 25 节已验过的 `step_semantics` 那条路；四类判定并存已由单测覆盖。

### 未做 / 下一轮

- [ ] 第 19 节三项验收仍未做（C4 复测、三章人工核对、§10 审计）。
- [ ] 本批未动 `data/demo`、未动《雾港封签》验收目录。

## 28. 接手指南：当前队列、持续授权与工作节奏
**这一节是给接手者的操作说明，不是某一批的记录。每批做完更新它。**
### 用户的持续授权：「排着做吧」

用户 2026-09-17 明确说**按差距清单顺序依次做下去**。这是一条**持续授权** ——
接手时不必再问「做哪一项」，直接从队列头开始。只有两种情况需要问用户：
① 方案里有会改变产品语义的取舍（如第 25 节的成本开关、第 26 节的开关存放位置）；
② 某项的范围明显超出一批能做扎实的量（如第 25 节把四个子项砍成两个）。

### 队列（差距盘点的 10 项，见第 20 节原文）

| # | 项 | 状态 |
| --- | --- | --- |
| 1 | 手改资料 | ✅ 第 21 节；后被用户校正为「AI 起草、作者只审」，见第 22 节 |
| 2 | 导入旧作 | ✅ 正文入库第 29 节；逐章反推结构第 31 节；多文件（每章一个文件）第 44 节 |
| — | 首页新建作品改版（用户另提，不在差距清单内） | ✅ 第 32 节（PR #9） |
| — | 谋篇模式（用户另提，不在差距清单内） | ✅ 第 30 节（Mac 会话，2026-09-17） |
| 3 | VoiceCheck | ✅ code 通道第 23 节、model 通道第 24 节 |
| 4 | 语义一致性审查 | ✅ 视角+伏笔第 25 节、动机+矛盾第 27 节 |
| 5 | 批量/连续创作 与 跨多章返修 | ✅ 连续创作第 33 节（PR #10）；跨多章返修第 34 节（PR #11） |
| 6 | 卷/部结构 | ✅ 第 36 节（卷纲顶替远距离梗概，PR #11） |
| 7 | 删除与恢复入口、备份/迁移 | ✅ 作品删除 + 草稿恢复（§38，PR #13）、资料条目删除（§39，PR #14）、`.nforge` 备份/原子导入（§40） |
| 8 | 导出格式（原先只有固定版本 TXT） | ✅ 第 41 节（富格式正文、分卷与设定集，PR #16） |
| 9 | 全文检索 | ✅ 第 42 节（正文 + 结构，片段直接当锚点） |
| 10 | 成本账 | ✅ 第 43 节（积分记账：计量在客户端层，四档计价；**口径已纠正**：平台用作者的 key、按积分抵扣，不是等凭证） |

### 第 2 项下半场「逐章反推结构」的起手点（已按此做完，见第 31 节；留作决策出处）

正文已经能进来了，缺的是**从旧正文反推出结构事实**。核对过的可复用点：

- **抽取**：`src/chapter/c5-schema.ts` 的 `parseC5` + `C5_OUTPUT_SCHEMA` 本来就是
  「从正文得出结构」，且已有完整的丢弃/报错纪律（未知人物 ID、重复声明、
  引文定位）。反推要的是同一件事，方向从"写完后声明"变成"读旧稿反推"。
  注意 `ParseContext.allocateForeshadowId` 与 `knownCharacters` 都要由导入侧提供。
- **落点**：`ImportService` 已经把正文放进 `chapters/`，反推可以逐章读
  `session.chapterText(n)`，不必再碰文件。
- **难点没变，而且现在更具体**：① 上下文装不下整本书，必须分批，且**人物表要
  跨章累积**（第 3 章新出场的人得进第 4 章的 `knownCharacters`）；② 伏笔的
  "埋设→兑现"跨章关系最难 —— `foreshadow_resolved` 要引用前面某章分配出的
  `F` 编号，所以反推必须**顺序进行、不能并行分片**。
- **既有闸门必须复用**：反推产出的是模型声明，按项目既有约定应先进 proposed，
  由作者确认才 committed。不要因为"这是作者自己的旧稿"就直接 authored ——
  正文是作者的，但**对正文的结构判断是模型的**。


### 当前进展快照（2026-09-19）

**分支与 PR**
- `master` = `7814793`（PR #13 / #14 均已合入：作品删除/恢复、草稿撤销丢弃、资料条目删除；合并审查补了 `pausing` / `ending` 期间禁止归档的竞态闸门）。
- **当前分支 `master`**；两条特性分支的远端分支已随合并删除。
- 本轮 `gh pr merge` 经 HTTPS 代理恢复可用；SSH 固定 IP 记录不再作为唯一合并路径。
- 远端已 prune 掉合完的分支；留着的 `stage1-*` / `stage2-*` 是历史线，不删。
- 工程状态：两批合并态 **1182 测试过**（1 skipped），typecheck（根+web）、web:build、`git diff --check` 通过。

**栈式 PR 的教训（仍有效）**：base 指向另一条特性分支的 PR，在基分支随上一条合入被删时会被 GitHub **直接关闭**（不是自动改基），且关闭后无法重开、无法改 base。所以 PR #7 → #9、PR #8 → #10。**要么不栈，要么合之前先手动把下一条的 base 改到 master。**

**跨会话已定的决策（勿再讨论，出处见对应节）**
- 不用 Codex/Gemini 做开发协作、不 spawn 子代理，主代理独立实施并自审（§3）。这与「用 Gemini chat 作产品写章模型」是两码事。
- 编排层用 LangGraph JS，模型调用保持原生 SDK，不引 LangChain；事件流是小说事实唯一真源（§3、§12）。
- 创作节奏 = 逐章采用；模型产出先 proposed，作者确认才 committed。**方案、草稿都在正式资料/事件流之外，确认/采用时才展开**（§12、§16、§30）。
- 所有数值约束派生自 `rules.yaml`，代码里没有数字，靠 `test/rules.test.ts` 扫描守住。**扫描现覆盖十个目录**，并有**具名登记**机制：登记过的常量声明内部数字不算回退，按声明名登记（新阈值仍会被挡住），每条必须写理由（§35）。
- 作者是导演不是录入员：资料由 AI 起草、作者只审，手改是纠正入口不是主路径（§22）。
- 谋篇模式：只读锁由工具集 + 执行器兜底两道代码保证，不靠提示词；模式存后端；方案的确认留在资料页，对话里不确认（§30）。
- 界面已定为 antd 6 + `styles.css` 骨架（§20）；Mac 旧线的手写材质系统不再回来。
- **连写里的自动采用是「逐章采用」的唯一例外**（§33）：只在作者显式授权章号范围、且该章检查通过并**无关键变化**时发生。关键变化 = 人物生死 / 关系变化 / 主线伏笔埋设 / 写作中提出的人物设定建议。连写串行不并行。
- **旧稿反推结构顺序进行、产物只进 proposed**（§31）：引文必须逐字在正文里是唯一硬闸门。
- **想法可以留空**（§32）：空想法建空白作品并直接进谋篇模式。
- **跨章返修：代码判硬矛盾、模型找段落，不靠情节线扩散**（§34）。未处理的硬矛盾只挡连写不挡单章手写；产物是建议不是改稿。
- **读坏的清单不能拖垮应用，但闸门要失败关闭**（§35）：`revise.view()` 读坏返回空清单加原因（overview 与每页照常起得来）；`assertNoConflicts()` **不走 view()**，读坏时抛 409 —— 读不出来就报 0 等于静默放行连写。恢复走「改名留档」而非删除。
- **删除一律是改名留档，没有不可逆动作**（§38）：作品删除把目录整体移进 `.trash/<定长时间戳>-<原 ID>/`，内容逐字节不改，恢复就是移回来；不给「彻底删除」按钮，界面把归档名说给作者。草稿的丢弃本就是软的，`discardedFrom` 让它回得去，恢复后仍要过一遍新鲜度（判据单点 `ChapterWriter.markStaleIfChanged`）。
- **卷的边界只有一份真相：`Beat.volume`**（§36）。`volumes.json` 只存卷名与卷纲，不存章号；范围由 `volumeRanges()` 推出。卷纲**顶替**远距离逐章梗概（不是叠加），且只顶替写完的卷、写了纲的卷、整卷落在远距离区的卷。

**待办（按序）**

1. **差距清单十项全部完成**（第 10 项见 §43，口径已纠正为「作者的 key + 积分抵扣」）。**下一批做什么需要先跟用户对齐**，不再有现成队列可排。记账这一批留下的直接后续：余额拦截（要先定事前预估与失败退费规则）、充值入口、`pricing.yaml` 价格核对。
2. 剩下的都是下面这些欠账，不是差距清单上的项。
3. **调用耗时可能比 940 秒更要紧**（§37）：真机实测**一次 64-token 的平凡调用经这个中转要 21.5 秒**，写章那种大请求离 300 秒预算并不遥远。要处理得先有数据（给写章调用记一批 `timing` 看分布），别凭感觉调超时。
4. **940 秒悬案仍未结**（§37）：睡眠假设已被隔夜实测推翻，三种读法全排除。定位手段已落地（`ClientError.timing` 带两个钟），等复现。
5. **L2 仍没有硬预算与裁剪**（§36 末）：卷纲把增长压平了，但作者不写卷纲时还是线性涨。要不要加 `L2_TOKEN_BUDGET` + 裁剪是独立一批，卷纲是它的前置。
6. **两处真机 live 未跑**：连写本身（§33）与跨章返修的定位通道（§34），两者都只在脚本化替身上跑通。**Mac 有 `.env.local`**（chat provider + gemini-3-flash），别再写成只有 Windows 有。
7. 第 19 节三项验收仍未做：修复后的真实 C4 复测、三章正文人工核对、用户流程 §10 的 16 项审计。
8. 对外暴露前加登录（服务端无鉴权，只绑 127.0.0.1）。
9. M1 缓存命中率实测仍卡官方直连 key。

**环境提醒（Mac 侧）**
- GitHub 走 Clash fake-ip：git 推拉用 SSH 直连 IP 且必须显式 `-i ~/.ssh/id_ed25519_github_openclaw -o IdentitiesOnly=yes`（Host 规则对 IP 不生效）；`gh` 必须带 `HTTPS_PROXY=http://127.0.0.1:7897`。详见本机记忆 `github-gh-proxy-env`。
- **`npm audit` 在本机默认源（npmmirror）上不可用**，只会回 `NOT_IMPLEMENTED`，要显式 `--registry=https://registry.npmjs.org` 才有结论（§35）。

### 这几批固定下来的工作节奏（照做即可）

1. **先写失败测试再实现**。第 23 节偏离过一次（先实现后补测试），结果测试抓出三处
   真设计错误；此后每批都先写测试，收益明显。
2. **浏览器端到端用脚本化模型替身**，进程内 `serve({ client })` 注入，**0 次真实调用**。
   工装备份到 `AppData/Local/Temp/nf-*/`，临时脚本不入库。
   没有新 UI／新链路的批次可以不做（第 27 节就没做，并在记忆里写明了理由）。
3. **全量四件套**：`npm run typecheck`（根+web）、`npm test`、`npm run web:build`、
   `git diff --check`。
4. **不碰**：`data/demo`（第 22 节误 reseed 过一次，教训见该节）、
   `data/flow-acceptance-2026-09-15-WVJ88z`（《雾港封签》验收目录）、`.env.local`。
   **任何 `seed-demo.ts` 调用都必须显式带输出目录。**
5. **收尾**：功能提交 + 记忆提交分两笔，推送后用 `git ls-remote` 核对。
   提交信息写清「为什么这么设计」，不只是「做了什么」。
6. **四件套要一起跑**：新写的测试用过不合法的 `provenance` 字面量，`vitest` 全绿而
   `tsc` 报错（§35）。测试通过 ≠ 类型通过。
7. **改判定逻辑时做变异测试**：把刚加的规则注掉，确认对应测试确实变红。这几批
   抓住过「兑现优先于埋设」「卷纲顶替」「跨区不顶替」三条（§35、§36）；§38 用它
   查出「归档名冲突」那条规则一开始没有测试，**冻住时钟就能把「不可能撞上」的
   竞态写成确定性用例**。
8. **性能先看被循环调到的 getter**：`session.currentChapter` 是 `Math.max(...keys())`，
   藏在 getter 里被逐条调用，分桶改完仍有 4 倍超线性就是它（§35）。
9. **既有注释与文档可能是错的，别当事实用**：§13.4 那句「200 章压到 ~1000 tok」
   描述的不是分桶的效果；`build-l2` 注释写「卷纲优先」而代码是叠加（§36）。
   动手前实测一次比读注释可靠。


## 29. 2026-09-17 导入旧作·第一批：正文入库

**当前接续入口。** 按用户「排着做吧」的持续授权，队列头是差距第 2 项。由当前代理独立实现、测试、自审，未启动子代理、未调用 Claude。

### 动手前问了用户两件事（按第 28 节的两种例外）

完整链路 = 正文入库 + 逐章反推结构 + 累积跨章伏笔，**明显超出一批能做扎实的量**（同第 25 节把四个子项砍成两个）。用户拍板：

- **本批只做正文入库**，逐章 C5 式反推留下一批。
- **输入方式 = 浏览器选文件 + 粘贴框**（不给服务端读任意本机路径的权限）。

### 为什么"只入正文"本身就是一条走得通的路

正文一进库，第 22 节的「让 AI 起草资料」立刻能从正文反推人物与设定 —— **起草能力早已存在，缺的一直是把旧稿放进来的入口**（与第 22 节"AI 定人物性格的能力早已存在"是同一种发现）。所以入库让「有存量稿的作者」这条路走通了，尽管伏笔时间线仍是空的。

**这是诚实状态而非缺陷**：没有声明就没有事实，系统不假装知道这本书的结构。界面回执因此明写「人物、伏笔和情节线还没有，接着用「让 AI 起草资料」从正文推断出来」。

### 切分：`src/import/split.ts`（纯函数，无 I/O）

| 判断 | 理由 |
| --- | --- |
| **章号取自标记本身，绝不按出现顺序重编** | 悄悄重编会让"接着第 38 章写"写错地方，这种错要到几万字后才看得出来 |
| **只认命中的第一种标记层级**（章>回>节>Chapter） | 章内又有「第N节」的书，两种都认会被切成一堆残片。**不能改成"取匹配最多的那种"** —— 那正好会选中节 |
| **标记行靠分隔符认，不靠长度** | 章号后必须是行尾/空白/分隔标点。顺带挡住「第一章节」这类词 |
| 缺号、乱序、楔子 → 提示不阻断；重号、空章、无标记 → 阻断 | 分批导入是合法用法，不能一刀切 |

**浏览器端到端跑出来的真发现**：最初用"标记行长度 ≤50"当主规则，挡不住「第三章的事他一直记得……」这类正文开头（才 38 字）。改成**分隔符为主、长度兜底**后才对。单测已钉住。

### 入库：`src/import/service.ts`

覆盖分三档 —— `data/` 不入库、无 git 可恢复（第 22 节的事故），覆盖不能是默认行为：

- **逐字相同** → 跳过算已导入，响应丢失后重试不会变成"冲突"（不需要 requestId）。
- **内容不同、无结构记录** → 必须作者显式勾选覆盖。
- **已有结构事件或已采用稿** → 一律拒绝，**勾了也不行**。那些章的锚点指向现有正文，换掉正文等于让事件流指向不存在的原文；要改走稿件修订。

`ProjectSession.putChapters` 一次事务写完多章：有阻断项时一章都不落，不留半本书（混批用例专门钉住：第 1 章被锁 + 第 9 章全新 → 第 9 章也不能写进去）。

**第二个浏览器端到端跑出来的真发现**：切分器只看得见"这一份文件里的缺号"，看不见「文件里只有第 7 章，而书里现有 1–3 章」——那会留下 4–6 三个空洞，作者要到导出时才发现跳号。已在服务层补 `holes()` 提示，并补单测（含"切分器看不见这件事"的对照断言）。

### 界面

- `web/src/components/ImportChapters.tsx`：文件**在浏览器里读**，服务端因此不必被授权读任意路径。中文 TXT 常是 GBK —— UTF-8 严格解码失败即回落 GBK，否则作者拿到一整页乱码还看不出原因。
- 提交前按字节数拦超限（3.5MB）：一本完本长篇正好卡在 4MB 请求体上限附近，让服务端回一句"请求体过大"等于没告诉作者该怎么办。
- 入口在资料页「当前创作依据」那一排，排在「让 AI 起草资料」之后 —— 起草是主路径，导入是有存量稿时的前置步骤。
- 预览与导入**发两次同样的文本，服务端不暂存**：省一次往返要引入有生命周期的服务端草稿，而本机重复提交是免费的。

### 验证

- 先写测试：`test/import-chapters.test.ts` **14 项**。**1054 项测试通过**（1040 基线 +14）。typecheck（根+web）、web:build、`git diff --check` 通过。
- **浏览器端到端 23 项全过**：空书 → 切分预览 → 导入 3 章 → 概览/正文/视图核对（**确认 0 条结构事件**）→ 同一份稿子重导判为"内容未变" → 改过的稿子默认不可导入、勾选后才可 → 覆盖如实报告 → **GBK 文件真实解码**（工装用 `TextDecoder` 反建映射表现造 GBK 字节）→ 只导第 7 章时说清 4–6 章仍是空的 → 390px 无溢出、无脚本错误。**0 次真实调用。**
- 证据：`AppData/Local/Temp/nf-import-browser-bpTjg6/`（`import-browser.source.mjs`、`verification.json`、`import-mobile.png`）。
- **排障留痕（省下一轮时间）**：**antd 6 把 `.ant-modal-content` 改成了 `.ant-modal-container`** —— 旧工装的选择器会静默失配，按 `.ant-modal` 作用域定位最稳。另外 Playwright 的 `getByRole(name)` 是子串匹配，「预览切分」会同时命中「先预览切分」，要 `exact: true`；`.prep-notice` 是常驻元素，`waitFor(visible)` 会读到上一次的旧文案，必须轮询等它**变化**。

### 未做 / 下一轮

- [ ] **差距第 2 项下半场：逐章反推结构**（起手点见第 28 节，已按本批结论写具体）。
- [ ] 楔子/序章（第一个标记之前的内容）只提示不导入，作者要它得单独粘贴为一章。
- [ ] 一章一文件的**目录导入**没做（本批只收单份文本）。
- [ ] 第 19 节三项验收仍未做（C4 复测、三章人工核对、§10 审计）。
- [ ] 本批未动 `data/demo`、未动《雾港封签》验收目录。

## 30. 2026-09-17 谋篇模式：作者可切入的只读讨论态（Mac 会话）

**当前接续入口之一。** 分支 `planning-mode-on-master`，基线 master `c65a314`。独立实现自审、先写失败测试（沿第 28 节节奏）。实施计划 `docs/superpowers/plans/2026-09-17-planning-mode.md`。

### 起因与一段弯路
用户提出借鉴开源编码工具的 plan 模式：新手不知道写什么，要先和 AI 规划再定方案；熟手中途冒出灵感也要先讨论再定。Mac 会话 9-14 曾在旧分支 `stage2-chat-dock` 上做过一版（自带 `proposals.json` 方案层 + 手写 CSS 界面，PR #4），**但 master 同期被 Windows 会话推进了 42 个提交**（antd 6 重做界面、`PreparationService` 方案层等），两边 33 个文件冲突。用户拍板**以 master 为准重做**：方案层复用 master 现成的 `PreparationService`（有编号方案、版本指纹、代码算的 impacts、资料页确认流程 —— 比旧版靠模型自述 impact 更可信），只补它缺的三样。PR #3 / #4 两条旧线**作废**，不再合。

### 补了什么（只补 master 缺的）
- **作者能切进去的只读模式**：`ConversationState.mode`（`normal | planning`，存 `conversation.json`，旧文件缺省 normal）；`PLANNING_MODE_TOOLS` = 读类 + `record_alternative_idea` + `propose_preparation`（`confirm_preparation` / `record_author_details` / 写章 / 采用 / `plan_*` 都不在）；`executeMainTool(block, ctx, mode)` 按 mode 兜底第二道；`MODE_PROFILE`：planning 用 creative 角色、`rules.agent.maxPlanningRounds: 12`。
- **新手冷启动的带法**：`MainAgentContextInfo.readinessMissing`（来自 `PreparationView.readiness.missing`），缺项非空 → 提示走「一句话冲动 → 主角 → 冲突 → 起点 → 人物场景情节线 → 首章计划」，不追问核心冲突；由 `planningScopeOf` 判定，不让模型选。
- **中途灵感先读再提**：缺项为空 → 提示要求先 `get_preparation` / `list_open_foreshadows` / `get_chapter_text` 再提，判断与既成事实是否相容；impacts 由系统算、资料页拦，模型不必自述。
- 端点：`POST /api/conversation/mode`；`GET /api/conversation` 与 `ConversationReply` 带 `mode`。
- Web：`Chat.tsx` 栏头 antd `Segmented`「对话 / 谋篇」（先落库成功再改本地态，失败停原模式）；谋篇态栏头下缘与输入框换 `--calm` 青灰、状态行换文案、起手句换一套；`preparation_proposed` 卡片的「查看方案」链接直接复用。常规提示加一条「想不清楚就建议切谋篇，Agent 自己切不了」。

### 决策
- **模式存后端**：它决定这一轮能不能写入，必须与工具集是同一份真相；刷新不能把锁打开。
- **方案的确认/丢弃留在资料页**，对话里不确认 —— 采纳是作者的动作。
- **计划态动作（伏笔改期/废弃、章节安排）不进方案**，退出谋篇再做。
- chat provider 单模型时 creative / judge 无区别，角色分流只在 Claude provider 生效（已知取舍）。

### 验证
- 先写 `test/agent-planning-mode.test.ts` **15 项**：工具集与允许名单、兜底、提示分支、服务按模式换角色/工具集/轮数、模式持久化、谋篇回合出方案但正式资料一字不动、模型直接确认被挡。**1068 测试过**（1053 基线 + 15）。typecheck（根+web）、web:build、`git diff --check` 通过。
- 浏览器端到端（进程内 `serve({ client })` 脚本化客户端，**0 次真实调用**，工装 `~/.claude/jobs/*/tmp/nf-plan-browser/harness.mts`）：空作品 → Segmented 切谋篇（`data-mode="planning"`、栏头变「谋篇」、服务端 `mode` 落盘）→ 起手句发送 → 模型读资料、出方案、回复 → 资料页出现待确认方案 → 确认后 C01/C02/S01/P01 与第 1 章计划落成 committed，readiness 归空。调用日志核对：谋篇回合 role=creative、12 个工具；切回后 judge、24 个工具。无 console 报错。
- 排障留痕：chrome-devtools MCP 对 antd `Segmented` 的 radio 节点 `click` 会超时（元素被判不可交互），用 `evaluate_script` 点 `.ant-segmented-item` 即可；工作区 API 的 `requestId` 必须是 UUID 形态。

### 未做 / 下一轮
- [ ] 推送本分支并开 PR（base master）；关掉作废的 PR #3 / #4。
- [ ] 差距第 2 项下半场「逐章反推结构」仍是队列头（起手点见第 28 节）。
- [x] 谋篇模式的真机 live（9-17 在 Mac 用 gemini-3-flash 跑过：空白作品第一轮见 §32）。

## 31. 2026-09-17 逐章反推结构：从旧稿正文补出待确认的结构声明（Mac 会话）

**当前接续入口。** 分支 `import-structure-inference`，基线 master `93d4a83`（PR #5 合入后）。独立实现自审、先写失败测试（沿第 28 节节奏）。实施计划 `docs/superpowers/plans/2026-09-17-import-inference.md`。差距第 2 项至此做完。

### 做了什么
- `src/import/infer.ts`：一次模型调用 + `parseC5`。**解析侧一字不改**，换掉的只有任务说明（只依据本章、不造 ID、只能兑现列出的编号、引文逐字复制）与上下文来源（已确认资料 + 待兑现伏笔清单 + 最近 10 章前情）。C5 的 ID 约束抽成 `pipeline.idConstraints` 两处共用。档位照抄 C5（creative / medium / 4k）。
- `src/import/inference.ts`：`InferenceService` —— 前置条件、跨章累积、按章确认/丢弃、进度视图。`src/import/inference-store.ts`：`import-inference.json` 只记运行结果（outcome / problems / warnings / at），**事实在事件流**。
- `ProjectSession.replaceInference` / `decideInference`；端点 `POST /api/import/infer`（handleAsync）、`GET /api/import/inference`、`POST /api/import/inference/{confirm,reject}`。
- 新 origin **`import_inference`**；`supersedeChapter` 一并作废它。
- Web：`pages/Inference.tsx`（`/inference`，按章进度表 + 连续反推/停下 + 逐章确认/重跑/跳过 + 确认全部），入口在资料页「当前创作依据」一排；导入回执改为指向这条路径。

### 决策（勿再讨论）
- **顺序进行、不并行分片**：第 N 章兑现的编号是前面章分配的。服务端拒绝跳章反推，也拒绝先确认后面的章。
- **产物 proposed 不 authored**：正文是作者的，对正文的结构判断是模型的。投影不吃 proposed，确认前伏笔时间线仍是空的。
- **不复用 `buildChapterRunInput`**：它要求已采用节拍表，旧稿没有；伪造一份会让闸门报一堆与旧稿无关的问题。
- **引文不在正文里是唯一硬闸门**；一章一视角等写作纪律对旧稿只报 warn —— 旧稿的写法已成事实。
- **未登记人物 → 整章记 problem、一条不落**，作者回资料页补人物再重跑。没有任何人物档案时直接拦在入口，不空跑模型。
- **重跑先作废上一轮 proposed**；作废的伏笔编号不回收（同一编号指两条伏笔会让归因失真），重跑拿到的是下一个号。
- **连续反推由浏览器逐章驱动**，服务端不养长任务：每章一落盘，关页面只是停下。
- 跨章伏笔清单 = 已确认的（走投影）+ 本轮 proposed 的（现扫事件流），两处都要，否则第 2 章之后认不出前面埋的。

### 验证
- 先写 `test/import-inference.test.ts` **18 项**：proposed 不进投影、确认后进投影且跨进程可读、丢弃不留事实不挡后章、后章能兑现前章未确认伏笔、F 编号跨章递增、跳章拒绝、先确认后章拒绝、引文复述记 problem 不落事件、未登记人物记 problem 补人物后重跑通过、非 JSON 记 failed、模型报错记 failed、重跑作废旧 proposed、无正文 404、已有正式结构 409、无人物档案 409 且 0 次调用、端点校验与视图、未配置模型 503（凭证置空，不出网）、章节修订采用后旧反推事实一并作废。**1086 测试过**（1068 + 18）。四件套干净。
- 浏览器端到端（进程内 `serve({ client })` 脚本化替身，按「第几章第几次」应答，**0 次真实调用**，工装 `~/.claude/jobs/nf-infer-browser/harness.mts` + `calls.json`）：三章旧稿 → 连续反推 → 第 1 章待确认、第 2 章因复述引文停下（连续反推正确停住）→ 展开看第 1 章记录 → 重跑第 2 章通过 → 反推第 3 章兑现 F01（提示词里带了 F01 与 intent）→ 先确认第 3 章被拒 → 确认全部 9 条 → 伏笔时间线出现 F01「已兑现」→ 390px 无溢出、无 console 报错。4 次模型调用。
- **测试抓出的两个真错**：① 我最初断言重跑后编号仍是 F01，实现给 F02 —— 想清楚后是实现对（编号不回收），改断言并写明理由；② 我最初的「未配置模型 503」测试没置空凭证，会真的打到网络，违反 0 次真实调用 —— 按 `conversation-stream.test.ts` 的做法 `vi.stubEnv` 置空。
- **浏览器验证抓出的真界面问题**：一轮跑完后「确认全部」顶到了「连续反推」原来的位置，chrome-devtools 的点击工具在 DOM 稳定后补发的一次点击直接把第 1 章确认了。真人顺手再点一下同样会中招。改成按钮槽位固定（跑时原位换「停下」，确认全部常驻、无待确认时禁用）。
- 排障留痕：chrome-devtools 点击 antd 按钮后若页面重排，宁可用 `evaluate_script` 在 DOM 里点，并在脚本里等 DOM 稳定再取状态；工装里让替身按请求内容路由（正则匹配「# 第 N 章正文」），别按调用序号排应答 —— 浏览器里任何一次无关调用都会把序号打乱。

### 未做 / 下一轮
- [ ] 推送并开 PR #6（base master）；合入后删远端分支。
- [x] 反推的**真机 live**（gemini-3-flash，三章 ~100 字旧稿，`npm run serve` 指向临时工作区）：三章全过、无 problem，**每条引文都逐字定位成功**（offsetHint 无 -1）；第 3 章正确兑现第 2 章反推出的 F02「密库旧图」，没硬套第 1 章的钥匙伏笔（它给的 intent 是"别让血刀客看见"，开库不算兑现，判断合理）。质量观察：**人物状态变更偏多**（"破庙里的火堆快灭了"也记成主角状态），warn 级不挡确认，观察期再定要不要在提示词里收紧。
- [ ] 反推出的人物状态/关系变化目前与 C5 同一套，没有为旧稿加「人物首次登场」的推断 —— 人物档案仍靠「让 AI 起草资料」先补。
- [ ] 差距第 5 项是新的队列头（见第 28 节待办）。

## 32. 2026-09-17 首页新建作品：想法可留空直入谋篇，表单首屏可完成（Mac 会话）

用户在首页提了两点：「我也不知道我想讲一个什么故事怎么办」；对话区要滚一下才能输入、输完再滚才能创建。分支 `works-first-screen`（栈在 PR #6 之上），**PR #7**。先写失败测试，四件套过，浏览器验证 0 次真实调用。

### 做了什么
- **想法改为选填**（`parseNewWork` 放开校验）。空想法建空白作品，建好后落到 `#/chat?mode=planning`；`Chat` 收 `initialMode`，历史载入后若与后端不同则**先落库再改本地态**（模式存后端是谋篇的锁，§30 决定不变）。筹备缺项非空 → 谋篇提示词自然走「从零筹备」分支，提示词没动。
- **表单首屏可完成**：默认只剩想法框 + 创建按钮；书名/题材/平台/字数折进「更多设置」（antd `Collapse`，`forceRender` 保证折叠时字段仍在表单里）；标语移进左列与表单并排；表单 `position: sticky`（移动端还原 static，移动端本来就是表单在前）。
- 按钮文案随想法有无切换：「先聊聊再定」/「创建作品」，下方一行说清建好后去哪。

### 决策
- `{}`、只有书名、想法留空都成了合法输入，`workspace.test.ts` 的非法参数清单相应缩短。这是产品语义改变，用户已拍板（方案 Y）。
- 不做"跳过创建直接聊"：作品目录是对话的落点，没有作品就没有 `conversation.json`。空白作品 + 谋篇模式已经是最短路径。

### 验证
- `workspace.test.ts` 新增「想法留空也能建作品，谋篇缺项非空」；1066 测试过（1068 − 3 条改为合法的非法用例 + 1）。
- 浏览器（进程内 `serve`，替身一调用即抛错，证明 0 次调用）：1366×768 下创建按钮底边 490px、不滚动可完成；空想法 → 落谋篇，服务端 `mode=planning`，起手句「我还没想好写什么…」；有想法 + 更多设置里填书名 → 常规对话、书名生效；390px 无溢出、表单在最上、按钮 445px；无 console 报错。

### 未做
- [x] 真机 live（gemini-3-flash）：空想法建作品 → 自动进谋篇 → 发起手句「一个人半夜被敲门声吵醒」→ 第一轮**没有追问核心冲突**，顺着画面给了三个「主角是谁 + 门外是什么」的方向让作者挑，与 §30 冷启动带法一致。

## 33. 2026-09-18 连续创作：排后面 K 章 + 授权连写到第 M 章（Mac 会话）

**当前接续入口。** 分支 `continuous-run`（栈在 PR #7 之上），基线 `ff40fcd`。用户按建议拍板：第 5 项先做连续创作，跨多章返修单独一批。先写失败测试，四件套过。计划 `docs/superpowers/plans/2026-09-17-continuous-run.md`。

### 关键发现（动手前核对出来的）
**连写的真正瓶颈是节拍表**，不是循环。写任何一章都要求该章有已确认的章计划，而章计划只有「让 AI 起草」排下一章或作者手填两个来源 —— 不配排章，连写到第二章就停。所以这一批是「排章 + 连写」两件事。

### 做了什么
- `src/run/service.ts`：`ContinuousRunService`（`view/start/stop/acknowledge` + `keyChanges` + 后台逐章循环）。状态落 `continuous-run.json`。
- `draftPreparation` 增加 `focus: "chapters"` + `count`：一次起草 K 份章计划落成**一份**方案；起点是**最后一章已确认计划之后**，不覆盖已排好的。提示词要求章号连续、只引用已确认 ID、不要「继续铺垫」这类空话、兑现别堆在最后一章。
- 端点 `GET /api/run`、`POST /api/run/{start,stop,acknowledge}`；`/api/preparation/draft` 收 `count`。
- `rules.task.maxBatchChapters`（=10），排章与连写共用。
- Web：结果页「采用并连写到…」弹窗（作者显式给章号，写明什么情况会停）、任务面板 `RunCard`（进度/已自动采用哪些章/停下原因 + 链到那一章）、资料页「让 AI 排后面几章」。

### 决策（勿再讨论）
- **自动采用只在「检查通过 + 无关键变化」时发生**，是逐章采用的唯一例外，且要作者先给出范围。关键变化 = 人物生死、关系变化、主线伏笔埋设、写作中提出的人物/设定建议；普通事件与状态变化不算（逐条点会让作者关掉整个功能）。
- **串行不并行**：第 N 章上下文要有第 N-1 章正文。
- **停下在章与章之间生效**；重启后文件仍说 running → 报 interrupted。

### 验证
- `test/continuous-run.test.ts` **12 项**：两章自动采用推进、人物死亡停下且不采用、检查没过停下、缺节拍停下、模型失败停下、作者中途停下（当前章跑完、下一章不开）、停下原因跨进程可读、重启报中断、范围与并发校验、排 K 章方案含 K 份计划、排章数量受同一上限约束。**1096 测试过**（1084 基线 + 12）。四件套干净。
- 浏览器端到端（脚本化替身按请求形状应答，**0 次真实调用**，工装 `~/.claude/jobs/nf-run-browser/harness.mts`）：排 3 章 → 确认（第 4-6 章 committed 且派生预算）→ 第 3 章结果页「采用并连写到第 6 章」→ 第 4 章因人物死亡停下、`RunCard` 显示原因并链到该章 → 结果页高亮 vital 变化 → 手动采用并再次授权 → 第 5、6 章自动采用 → 作品写到第 6 章。
- **真机（gemini-3-flash）排章验证通过**：方案含第 4-6 章，F01 第 4 章部分兑现、第 6 章完整兑现，第 5 章埋新主线，V2 findings 为空 —— 章计划质量可用。
- **真机连写未跑**（用户当时打断，不必再补跑就说明状态）。

### 实现期修掉的两处
- `requestId` 只许 `[A-Za-z0-9_-]`，连写用 ISO 时间戳做编号会被格式校验挡下（表现为每章都 blocked）。
- 草稿上区分不了 refused 与 failed（`service.ts` 把两者都映射成 `failed`），停下原因合成一个 `failed`，细节放 detail。

### 发现但未修的真问题（下一批候选）
**流式响应没有空闲超时**：`chat.ts` 用 `AbortSignal.timeout(timeoutMs)` 只约束建连，响应体开始流式返回后若服务端挂住，客户端会一直等。真机排章的收尾那次调用挂了 **940 秒**才报错（证据 `~/.claude/jobs/nf-run-browser/live-chapters-draft.log`）。对连写危害更大：一章挂住，整个连写看起来就是没反应。修法：给流式读取加空闲超时，超时按 incomplete 处理。


## 34. 2026-09-18 跨多章返修：改早章后定位受影响段落并给修订建议（Mac 会话）

**当前接续入口。** 差距第 5 项**下半场**，队列头做完了。分支 `cross-chapter-revision`（base `master`，**不栈** —— 第 28 节的栈式 PR 教训），基线 `7df8960`，**PR #11**（https://github.com/xxxwonking/novel-forge/pull/11，open）。计划 `docs/superpowers/plans/2026-09-18-cross-chapter-revision.md`。

### 动手前核对出来的关键事实

盘点里写的是「改第 5 章只把后续稿标过期」，实际比这更硬：`draft-revisions.ts` 的 `source()` **直接挡死早章返修**，报错文案就是「更早章节需先分析后续影响，不能直接返修」。所以这一批不是只加一份报告，而是**先做那份分析、再用它解锁早章**。

### 做了什么

- `src/revise/impact.ts`（纯函数）：`diffDeclarations` 按**对象编号**配对两份声明（不按位置 —— 重写一章会把条目全部重排，按位置比会得出「全都变了」）；`impactedChapters` 分 conflict / review 两级。
- `src/revise/locate.ts`（纯函数）：模型通道的提示、schema、解析。纪律照搬 `gate/semantics-channel.ts`。
- `src/revise/store.ts`：`revision-impact.json`，按受影响章合并的记录 + `latest`。
- `src/revise/service.ts`：`view / preview / record / locate / resolve / assertNoConflicts`。
- 接线：`state.ts` 采用早章时落清单、连写闸门；`draft-revisions.ts` 放开早章；`api.ts` 四端点 + overview 计数；`event-stream.ts` 提取 `declarationOf`（原在 `import/inference.ts` 私有）。
- Web：新页 `Revision.tsx`（`/revision`，有待办才出现在导航）、`Drafts.tsx` 采用前预览。

### 决策（勿再讨论）

- **代码判硬矛盾，模型找段落。** 四条 conflict 规则：悬空兑现、生死状态变了人还在后章有戏份、状态链断（后章的 `from` 接在被改掉的值上）、关系链断。模型通道**一次只查一章、由作者点**，不在服务端起长任务。
- **不靠情节线扩散。** 同一条主线上的章动辄几十个，全圈进来等于没圈。代码只圈有编号可查的关联，外加**紧接的下一章**（相邻关系，不是阈值）。圈不到的由作者点查任意后续章，`latest` 是那条线索。
- **未处理的硬矛盾只挡连写，不挡单章手写**（用户 2026-09-18 拍板）。连写会在错的基准上一口气堆好几章；单章手写作者本来就盯着结果页。
- **产物是建议不是改稿**，落笔仍走那一章的结果页。
- **一个受影响章一条记录**，多次修订合并；合并态指纹一变，此前标的「已处理」自动失效 —— 不靠谁记得去清标记。
- **正文改了而结构没变也算一次修订**（这是写测试时发现的语义缺口）：重写一场戏而不改声明是常事，后面引用那场戏细节的段落照样会失效。
- **没有引入新阈值**，`rules.yaml` 未动。定位的 `maxTokens` 与 `steps.ts` 同类，是管线常量。

### 验证

- `test/revision-impact.test.ts` **17 项**（先写失败测试再实现）：四类硬矛盾各一、不因同情节线圈住远章、无差异即无影响、引文核对与丢弃、输出不成形不编造、落清单与最新章不落、预览不落盘、销账后同章再改重新亮起、硬矛盾挡连写、早章解锁可返修、代码圈不到的章可手动点查、正文改动让下一章复核。**1113 测试过**（基线 1096 + 17）。四件套干净。
- 浏览器端到端（脚本化替身，**0 次真实调用**，工装 `~/.claude/jobs/nf-revise-browser/harness.mts`）：结果页「采用这一稿会牵连后面 2 章」→ 采用 → 导航亮起「跨章返修 2」→ 清单列出第 3 章悬空兑现 → 定位出引文＋改法 → `POST /api/run/start` 被 409 挡下并点名第 3 章 → 「去改这一章」跳到该章正式版本 → 销账后 conflicts 归 0、连写放行到下一道前置（缺节拍）。
- ⚠ **订正（2026-09-18 复查）**：§34 曾记「手动点查的章号输入框默认空值、按钮恒灰」为已修。复查复现不出：实测该控件 `value=2`、`aria-valuemin=2`、未禁用，点击后工作正常（当时看到的 `valuemax="0"` 是无障碍树的渲染产物，DOM 上并无该属性）。**这条作废，没有修过什么。**

### 观察项（不急，攒够再说）

- review 级目前只按结构关联圈，真机上会不会太少还没数据。宁少勿多是有意的（§25 同款理由：消不掉的假警报会让作者关掉整个检查器）。
- 作者按建议改完那一章并重新采用后，清单**不自动销账**，要手点「已改完」。自动判定需要「这一处是否已改」的判据，现在没有。

## 35. 2026-09-18 整体排查与三项修复（Mac 会话）

报告：`docs/reports/2026-09-18-code-audit.md`（对标 §18 的 `2026-09-15-code-audit.md`）。分支仍是 `cross-chapter-revision`，随 **PR #11** 一起走 —— 第 1 项修的本来就是这条分支自己引入的回归，合入前就该修掉。**1141 测试过**（基线 1113 + 28），typecheck / web:build / 依赖审计干净，浏览器实测 0 次真实调用。

### 排查发现（前三项已修，第四项未动代码）

1. **上一批引入的回归（P1）**：`revision-impact.json` 读坏会让 `/api/overview` 抛 → overview 是应用层拉的 → **整个作品的每个页面一起失效**，且 `save()` 先 `load()`，读坏后也写不回去，界面无自救路径。
2. **长篇下的二次增长（P2）**：`buildStoryProgress` 在 2000 章 / 600 万字时 1720ms（它是 `/api/alerts` 与 `/api/issues` 的唯一大头；`/api/overview` 不调它，所以不是每页都付）。
3. **规则与代码分歧（P2）**：`DUE_SOON_WINDOW = 5` 与 `rules.crossChapter.foreshadowDueSoon: 3` 是同一概念两个值 —— **模型在 L2 索引里看到的「临近」比 gate 判的早两章**；`c5-crosscheck.ts` 把「300-400 字」写死在打给模型的提示里，而 gate 读的是 rules。
4. **队列头「流式空闲超时」的诊断不成立**：`chat.ts` 有 300 秒**总预算**且实测会按时中止（自建心跳 SSE，3009ms 放弃并带回 partialText）。但真机那次 940 秒**在墙钟 / 单调时钟 / 进程被冻结三种读法下都算不平**（`pmset -g log` 显示当时机器在反复睡眠，按日志反推调用发出于机器睡眠期间 —— 不可能）。**未动代码**，下一步是先给调用加墙钟+单调双时间戳复跑真机再决定改什么。

### 修复要点

- `view()` 容错只包住**读文件**这一步；`assertNoConflicts()` 不走 `view()`，读坏时**失败关闭**（否则读不出来 → 报 0 → 静默放行连写）。恢复用 `POST /api/revision/rebuild`：坏文件**改名留档**再起空清单，只在确实读不动时才允许，界面把留档名说给作者。
- `buildStoryProgress` 三管齐下：按编号一次性分桶 + `session.currentChapter` 只取一次（它是 `Math.max(...keys())`，被 `verified()` 逐条调到）+ 与 `derived` 同构地缓存。2000 章 **1720ms → 9ms**，从二次变成线性。
- `DUE_SOON_WINDOW` 删除，改由调用方传 `rules.crossChapter.foreshadowDueSoon`（`L2BuildInput.dueSoonWindow`）。**行为变化：L2 里标 `due_soon` 的伏笔少 2 章**，从此与 gate/告警同源。
- 扫描从七个目录扩到十个（`+ context / metrics / types`），并加**具名登记**机制：登记过的常量声明内部数字不算回退，按声明名登记所以新阈值仍会被挡住，每条必须写理由（另有测试守着理由非空）。
- 逐条定性（归属见报告第七节）：只有 `DUE_SOON_WINDOW` 进了 rules.yaml；§13 的上下文**布局**预算、上游 API 事实、格式/验收契约一律留原地登记 —— 把它们塞进 rules.yaml 会把这个文件从「故事约束」稀释成「什么都放」。

### 教训

- **审计报告写完不等于查完**：`DUE_SOON_WINDOW` 这类分歧只有把「同一概念在几处各有一个值」当成独立维度去比，才会浮出来；目录扫描边界是它藏身处。
- **`Math.max(...arr)` 藏在 getter 里最贵**：分桶改完还剩 4 倍超线性，就是它。改性能时先看被循环调到的 getter。
- **测试通过 ≠ 类型通过**：新写的测试用了不合法的 `provenance` 字面量，vitest 全绿而 `tsc` 报错 —— 四件套要一起跑。

## 36. 2026-09-18 卷/部结构：卷纲顶替远距离梗概（差距第 6 项）

提交 `27d12e6`，随 PR #11 一起合入。1155 测试过（基线 1142 + 13），四件套干净，浏览器实测 0 次真实调用。

### 动手前查出来的真问题（这一项不是「补个入口」）

`Beat.volume` 早就有，缺的不是界面：

- **三档粒度不压缩内容。** `build-l2.ts` 的 `condense()` 只取每章梗概的**第一句**再用 `；` 拼起来 —— 梗概本来就是一句话时，15 章一桶等于原样保留 15 句，只少了几个换行。所以三档减的是**行数不是字数**，L2 随章数线性涨且没有上限（实测每章约 7 tok）。L1 有 `L1_TOKEN_BUDGET`、L3 有五级裁剪，**L2 两样都没有**：`assemble.ts` 算 `l2Tokens` 只为缓存度量，从不检查。而 L2 是最大的可缓存前缀，它涨则每章缓存创建成本跟着涨。
- **卷纲本该止血，但它是死的。** 注释写「远距离：卷纲优先，其次每 15 章一桶」，代码里两者是**叠加**的 —— 加了卷纲 L2 反而更大（400 章：2975 → 3130 tok），正好与用意相反。而且生产路径 `chapter-input.ts` 写死 `volumeSummaries: []`，根本轮不到它。

### 决策（勿再讨论）

- **卷的边界只有一份真相：`Beat.volume`。** `volumes.json` 只存卷名与卷纲，**不存章号**；范围由 `src/beat/volumes.ts` 的 `volumeRanges()` 推出。存两份必然分歧，而节拍表本来就是按章排的。界面上「覆盖章节」是只读的，改卷界去改那几章的计划。
- **两个不顶替的条件**：① 卷没写完不顶替（那一段会缺掉最近发生的事）；② 一卷横跨远/中两区不顶替（否则同一卷出现两次且粒度不同）。各有测试并做了变异验证。
- **卷纲只写已经发生的事**：给还没写到的卷写纲会被服务端退回 —— 那是把规划当成已发生的剧情喂进 L2。空纲可以先占卷名。
- **AI 起草、作者确认**（用户拍板①）：走已有的 `propose_preparation`，不另起工具。**卷界由作者显式划分**（用户拍板②）；此前是模型排章时顺手填，提示词写的「沿用最近一章的卷号，没有就填 1」，实际效果是永远停在卷 1。
- `volumeBoundary()` 优先用卷纲；没写纲时**兜底仍在**（拼逐章梗概），不是把功能撤掉。

### 实测

每 30 章一条卷纲，单句梗概：200 章 1498→461、400 章 2975→447、1000 章 7412→627、2000 章 15093→1014 tok。文档里那句「压到 ~1000 tok」现在是真的，且在 2000 章仍成立 —— 原注释描述的不是分桶的效果，已一并订正。

### 待办／观察项

- **L2 仍没有硬预算与裁剪。** 卷纲把增长压平了，但作者不写卷纲时还是线性涨。要不要给 L2 加 `L2_TOKEN_BUDGET` + 裁剪是独立一批，且卷纲是它的前置。
- 卷纲目前要作者主动去资料页写。「写完一卷自动提示补卷纲」还没做。

## 37. 2026-09-18 调用时长记两个钟（940 秒悬案的定位手段，非修复）

分支 `call-timing`。**这一节记的是「还没查清」的状态**，别当成修复读。

### 先把被证伪的诊断钉死

§33 末记的「流式响应没有空闲超时」**按字面不成立**。`chat.ts` 把 `AbortSignal.timeout(timeoutMs)`（默认 300000，`CHAT_TIMEOUT_MS` 可配）挂在 `fetch` 上，那是**总预算**，覆盖到响应头也覆盖读流体。自建只发心跳不结束的 SSE 服务器实测：配置 3000ms → 3010ms 中止并带回 `partialText`。现已固化为 `test/client-timing.test.ts` 的一条测试。

### 940 秒仍然算不平账

`~/.claude/jobs/nf-run-browser/live-chapters-draft.log` 记 `call#4 error 940959ms`，日志落盘 08:25:20，反推该调用发出于 08:09:39 —— 而 `pmset -g log` 显示 07:58:47→08:13:04 机器在睡（857 秒），进程不可能在那一刻发起请求。把睡眠段按「单调钟冻结」重新配平也对不上（无论取 857 秒那段还是 08:13:49→08:21:43 的 474 秒段，算出的墙钟都不是 940959ms）。**墙钟、单调钟、进程被冻结三种读法全部不自洽。**

所以这一批不改超时 —— 照着一个算不平的账去改，改对了是运气。

### 做了什么

- `ClientError` 加 `timing: { monotonicMs, wallMs }`，`ChatClient` 与 `ClaudeClient` 的**每条**返回路径都带上（含成功路径，经 `onUsage`）。`startTiming()` 在 `claude.ts`，两个客户端共用。
- `describeTiming()` 把时长写进**连接类**错误的文案（状态码错误是秒回的，写时长只是噪音）。分叉超过 2 秒时单独说出来：「等了 941.0 秒，其中约 641.0 秒机器没在运行；超时按运行中的 300.0 秒计」—— 只说「等了 941 秒」会让人去改超时，说清分叉才指得到真正发生的事。
- 真机验证一次（gemini-3-flash，单次 64-token 小请求）：两个钟一致（21555 / 21554 ms）。**顺带一个数据点：一次平凡调用经这个中转要 21.5 秒**，写章那种大请求离 300 秒预算并不遥远。

### 钟差实验的结论（2026-09-19，睡眠假设已被推翻）

记录器挂了一整夜（`~/.claude/jobs/nf-clock/drift.log`），**结论是否定的**：

```
=== 起于 2026/9/18 20:54:22 ===
2026/9/19 08:48:55 这一拍：墙钟走了 -6.1s，单调钟走了 1.0s，差 -7.1s ｜ 累计：墙钟 42873s，单调 42880s
```

11.9 小时里这台机器睡了很多次（仅 06:30–08:48 一段就有 1044+930+943+736+1024+958+914+751+980 = 8280 秒），而**两个钟累计只差 7 秒**。所以 **Darwin 上 `performance.now()` / libuv 的单调钟含睡眠**（用的是 `mach_continuous_time` 而非 `mach_absolute_time`）。

- **「机器睡着导致超时晚触发」这条假设死了。** 睡眠不会让单调钟落后，`AbortSignal.timeout(300000)` 的截止点按墙钟也是 300 秒后。
- 整夜唯一一次分叉是**墙钟倒退 6.1 秒** —— 唤醒时的 NTP 校正。这是这台机器上分叉的真实成因，与睡眠无关。
- 由此订正了 `describeTiming` 的文案：原先写「其中 N 秒机器没在运行」是**替读者断因**，而已知成因不止一种。现在只报事实：「计时的两个钟差了 N 秒（超时按 M 秒计），这台机器的系统时间在这期间被调整过」，并把分叉取绝对值 —— 实测见到的那次是负方向，原写法会漏掉。

**仍待解释的是 940 秒本身。** 三种读法全部排除之后，剩下的可能性（事件循环在睡眠期间冻结导致定时器延迟触发）按 pmset 的时间点配平**同样对不上**：无论假设它在 08:13:04、08:21:43 还是 08:22:00 唤醒时触发，反推的起点都落在机器睡着的时段里。

### 下一步

根因仍未定，但定位手段已经落地：下次复现时 `ClientError.timing` 会同时给出两个钟。在那之前不改超时。

值得单独关注的是真机实测的另一个数字：**一次 64-token 的平凡调用经这个中转要 21.5 秒**。写章那种大请求离 300 秒预算并不遥远，这可能比 940 秒更值得先处理。

## 38. 2026-09-19 删除与恢复入口：作品改名留档、草稿撤销丢弃（差距第 7 项前半）

分支 `work-deletion-restore`（base master，不栈）。差距第 7 项含四件事，按 §28 的规矩**动手前先跟作者切了范围**：本批只做**作品删除 + 草稿删除/恢复**，资料条目删除（§21 末欠着）与备份/迁移各留一批。**1174 测试过**（基线 1160 + 14），四件套干净，浏览器端到端 0 次真实调用。

### 起手时核对出的两条事实（盘点里没写）

- **草稿删除早就有了** —— `/api/chapter/discard` 是软丢弃，历史仍可查。所以草稿这一侧缺的不是「删」而是**「回得去」**：`discardDraft` 直接把原状态覆盖成 `discarded`，没留下丢弃前是什么。
- **点号开头的目录天然不是作品** —— `validId` 要求首字符是字母或数字，`create()` 的 `.creating-` 暂存前缀已经在吃这个不变量。所以回收站放 `.trash/` 就够，`list()` 与 `projectPath()` 一行没改，也不可能被 `x-novel-project` 指到。

### 决策（跨会话，勿再讨论）

- **删除 = 改名留档，没有真删除。** 作品目录整体移进 `.trash/<定长时间戳>-<原 ID>/`，内容一字不改；恢复就是改名移回来。沿用 §35 `revision/rebuild` 的口径。两个理由：作品是攒了几十万字的资产，误删不可逆；归档目录本身就是一本完整的作品，拷出去即可用 —— 这也给差距第 7 项后半的「备份/迁移」留好了落点。
- **不给「彻底删除」按钮**（作者本轮拍板）。这套设计里因此没有任何不可逆动作；界面把归档目录名说给作者，要清理由作者在磁盘上自己做。
- **归档名用定长时间戳前缀**（`20260919T102804123Z-work-x`），不另写元数据文件：ID 自身可含 `-` 与 `.`，定长前缀才解析无歧义；不写文件则归档与被删那一刻**逐字节相同**。
- **恢复不等于可采用。** 丢弃期间作品可能已经往前走，所以 `restoreDraft` 最后要过一遍新鲜度，依据变过的落 `stale`。为此把 `assertFresh` 里的判据抽成 `ChapterWriter.markStaleIfChanged`，与「另写一版」「采用」同源 —— 判据只此一处。

### 三道前置闸门，各自防的是具体的坏结果

| 闸门 | 不设会怎样 |
| --- | --- |
| 章节任务仍在 `running` / `pausing` / `ending`，或正在连写 → 409 | 任务继续写向一个已经改名的目录 |
| `--project` 打开的作品 → 400 | 它的路径由启动参数定（`projectPath` 对它直接返回 `openedRoot`，不查存在性），删掉后服务指空 |
| 删除后驱逐 `sessions` 缓存 | 同 ID 再建一本会读到上一本的状态 |

恢复侧另有两条：原 ID 已被新作品占用 → 409（归档不动）；归档名撞车 → 409（否则 `renameSync` 会把上一份归档静默盖掉）。

### 验证

- 14 个新测试；**六条新规则逐条做过变异测试**（注掉即变红）：会话驱逐、运行中拒删、恢复过新鲜度、记下丢弃前状态、重复丢弃不覆盖 `discardedFrom`、归档名冲突。
- 合并审查补了一条竞态回归：暂停／结束只是请求，当前模型调用返回前仍会落盘；`pausing` / `ending` 现在与 `running` 一样阻止归档。
- 归档名冲突那条起初测不到（要求同一毫秒内删同一本书）。用 `vi.useFakeTimers` 冻住时钟，删 → 同 ID 再建 → 再删，就成了确定性用例 —— **「不可能撞上」不是不写测试的理由，冻时钟就能撞**。
- 浏览器（脚本化替身，进程内 `serve({ client })`，0 次真实调用）跑通：首页删除 → 回收站出现并带归档路径 → 恢复回列表；草稿页丢弃 → 「恢复这份草稿」→ 状态回到待采用。390px 无横向溢出、无 console 错误。工装备份在 `$TMPDIR/nf-trash-browser-VRtexS/trash-browser.source.mts`，临时脚本未入库。

### 界面

书卡右上角一个安静的删除图标（**常驻 0.35 透明度而非 hover 才现** —— 触屏上没有 hover，藏起来等于没有入口），Popconfirm 说清「会移入回收站，随时可以恢复，磁盘上的文件一字不改」。列表下方折叠的「回收站 N」，每条给书名、删除时间、`data/.trash/<归档名>` 与「恢复」。草稿页在 `discarded` 时出「恢复这份草稿」，恢复后若落 stale 会在提示里说明要重新核对。

### 一处顺手收紧

`create()` 的入参解析在服务层（`parseNewWork`），我最初把删除的解析写进了 `workspace-api.ts`，使那个文件从纯路由变成半个解析器。已统一：`remove`/`restore` 与 `create` 一样收 `unknown` 并在服务层解析（共用 `parseRef`），路由回到纯路由。同时把三处重复的「读不出来就降级成 error 条目」收敛成 `summarize()`。

## 39. 2026-09-19 资料条目删除：给只会 upsert 的改动模型补上删除方向（差距第 7 项第三件事）

分支 `preparation-entity-removal`（base master，不栈）。**1168 测试过**（基线 1160 + 8），四件套干净，浏览器端到端 0 次真实调用。

> §38 来自先合入的 PR #13；PR #14 随后在它之上完成合并态验证并合入，两批代码测试总数为 1182。

### 动手前核对出的事实

§21 末把这件事记成「扩 schema 与 build()，加引用完整性校验」，核对后它比那句话更根本：**`changes` 的每个数组都是按 ID/章号的 upsert**（`upsert(before, patch, key)`），少送一条只是「不动它」—— 整个资料层**没有任何路径能删掉一条**。所以这不是加一个按钮，是给改动模型补一个方向。

### 决策（跨会话，勿再讨论）

- **删除显式写进 `removals`，不靠「少送就等于删」。** 后者会让每一次局部提交都变成一次隐式的批量删除。一份方案可以同时改和删（删人物的同时把引用它的节拍改掉），「又改又删同一条」则是 400。
- **闸门分两类**（本批核心判断，用户拍板）：

  | 类别 | 谁 | 处理 |
  | --- | --- | --- |
  | 结构引用 | 节拍表点名（出场人物 / 地点 / 事件挂的情节线）、他人称谓 `target`、已确认事件 | `fail()` 硬拒 —— 留下去节拍表会指向不存在的 ID |
  | 正文提及 | 已采用正文里出现过这个名字 | 落 `impacts` —— 散文里出现名字不是结构引用；impacts 本来就挡确认，作者改完正文自动消失 |

  §21 原话是「被已采用正文引用的**都不能删**」，本轮把它软化成 impact：硬拒在这里是死路，作者只能改名绕过；而 impact 是一条能走完的路。
- **已写出正文的章节计划不能删** —— 那是这一章的依据。
- **删卷卡片只去掉卷名与卷纲，不动 `Beat.volume`** —— 沿用 §36「卷的边界只有一份真相」。
- 删除对**作者与 AI 同一条通道**（共用 `PREPARATION_CHANGES_SCHEMA`），因此方案预览里**必须显式列出将删除的条目**：预览是删除之后的资料，少了一条和从来没有过长得一模一样，不说出来作者就看不见 AI 方案里夹带的删除。

### 验证

- 8 个新测试；**十一条闸门逐条变异测试**（注掉即变红）。其中「地点的正文提及」一开始没被测到 —— 需要一个只被正文提到、不被任何节拍表引用的地点，用 `CH2` 里现成的「青云门」补上了。
- 浏览器（脚本化替身，进程内 `serve({ client })`，0 次真实调用）跑通三条路径：删没人引用的「药婆」→ 立即生效；删主角「李长风」→ 弹窗里显示「还是第 2、3 章计划里的出场人物」且条目不动；删「守夜人」（只在第 1 章正文出现）→ 落候选，预览页顶部列出「这份方案会删掉 1 条资料」，已确认资料原样保留。
- 工装备份在 `$TMPDIR/nf-removal-browser-kaw59u/removal-browser.source.mts`，临时脚本未入库。

### 两处顺手修正

- `web/src/preparation-changes.ts` 的文件头写着「这里没有删除语义」—— 现在有了，改成「不传某个 ID 只是不动它，删除要显式写进 `removals`」。**这正是 §28「既有注释可能是错的」那条的反面：注释写对了，但代码变了就得跟着改。**
- 删除成功后提示仍是「作者设定已更新」，读起来像没删掉；改成按 `removals` 判断说「已删除」。

## 40. 2026-09-19 作品备份/迁移：归档与活动作品共用 `.nforge`（差距第 7 项收尾）

分支 `codex/work-backup-migration`（base `master`）。实现计划：`docs/superpowers/plans/2026-09-19-work-backup-migration.md`。差距第 7 项到这里四件事全部完成，下一项是第 8 项导出格式。

### 包格式与安全边界

- `.nforge` 是 gzip 压缩的版本化 JSON 清单；每个普通文件记录 POSIX 相对路径、原始长度、SHA-256 与 base64 字节。未知的未来文件也会带走，不靠当前 schema 反序列化后重写，因此迁移不会丢新版字段或扩展产物。
- `.env` / `.env.*`、`.pending-write.json` 与事务 `.tmp` 不入包；源目录遇到符号链接或特殊文件直接拒绝，不跟随也不静默漏掉。
- 导入先完整解压和校验：格式/版本、作品 ID、路径穿越、Windows 路径与 ADS、大小写重复路径、base64、长度和哈希全部过关后才允许写盘。解压后清单、文件数和 HTTP 压缩体各有独立硬上限，抵挡 gzip bomb 与超大恶意清单。

### 原子迁移语义

- 活动作品 `{ id }` 与回收站 `{ archive }` 只在“定位源目录”这一步不同，后面共用同一个 `createBackupPackage`。归档不用先恢复；包内 `sourceId` 是原作品 ID。
- 导入默认沿用 `sourceId`，也可指定新 ID。目标已占用一律 409，绝不覆盖。全部文件先写 `.importing-*`，由 `ProjectStore.load()` 与作品摘要读取验证后，最后一次 `renameSync` 才公开；任何失败都在 `finally` 清掉暂存目录。
- `running` / `pausing` / `ending` 的章节任务以及连写状态都会挡住备份。这里沿用 §38 合并审查修过的竞态口径：暂停/结束只是请求，模型调用返回前仍可能落盘，所以不能提前打包。

### 接口与界面

- `GET /api/works/backup?id=...` 或 `?archive=...` 返回 `application/vnd.novel-forge.backup`、附件文件名和整个包的 SHA-256；`POST /api/works/import?targetId=...` 接受二进制包。这两条仍先过 Host/Origin 本机同源边界，不走普通 JSON 解析器。
- 作品卡片与回收站都有备份按钮；作品列表顶部可选 `.nforge` 文件导入并填写可选的新 ID。服务端冲突/坏包错误留在导入弹窗中展示，成功后刷新列表。

### 验证

- 新增 `test/workspace-backup.test.ts` 27 项，覆盖普通/未知/二进制文件往返、凭据与临时文件排除、第三方包保留路径拒绝、路径穿越、大小写重复、版本、gzip/JSON、base64/长度/哈希篡改、符号链接、活动作品与归档、默认/显式 ID、碰撞不覆盖、坏作品不留半成品，以及 `running/pausing/ending` 期间拒绝备份。
- HTTP 边界新增 2 个端到端用例：真实下载二进制再上传为另一作品；错误媒体类型、损坏包与外部 Origin 均被拒绝。
- 全量验证：65 个测试文件，**1211 passed / 1 skipped**；`npm run typecheck` 与 `npm run web:build` 通过，构建只有既有的 Vite 500 kB chunk 警告。

## 41. 2026-09-19 富格式导出：正文、分卷与设定集共用固定快照（差距第 8 项）

分支 `codex/rich-export-formats`（base `master`）。实现计划：`docs/superpowers/plans/2026-09-19-rich-export-formats.md`。

### 一份快照，多种产物

- 正文预览一次生成 TXT、EPUB 3 和 DOCX；设定集预览一次生成结构化 JSON 与可读 DOCX。所有产物连同文件名、媒体类型、字节数和 SHA-256 写入同一份 v2 清单，二进制以 base64 保存，下载只读已固定文件，不从当前作品重建。
- v1 TXT 清单继续可读；读取任何 v2 预览时会校验整组产物，缺失、长度变化或哈希不符一律 409，不能拿当前内容冒充旧快照。
- EPUB/DOCX 的 ZIP 条目使用固定时间和稳定顺序，重复输入得到相同字节。EPUB 的 `mimetype` 是首项且不压缩；DOCX 使用 Letter 纸张、标题页、章节分页、中文字体和首行缩进。

### 范围与设定集口径

- 正文支持全部、连续章号和按卷。按卷只认 `Beat.volume`，没有对应节拍表的卷拒绝导出，不从卷名卡片猜边界；范围里的缺章与未采用稿仍只做提示，不自动补写或采用。
- 设定集只取已确认的 `source.meta`：作品设定、写作配置与纪律、人物、地点/组织、情节线、卷卡、节拍表；不带草稿、候选方案、任务状态、凭据或运行时派生人物状态。JSON 额外保存由节拍表推导的 `volumeRanges`，Word 把同一边界写进“分卷”章节。
- 导出标识由内容清单决定，`createdAt` 不参与身份；同一选择和内容重试复用旧快照。选择条件改变后，页面会标出旧预览并禁用下载，直到重新预览。

### HTTP 与界面

- `GET /api/export/download?id=...&format=...` 在当前作品边界内返回已保存字节，带准确的 `Content-Type`、`Content-Length`、RFC 5987 文件名和 `X-Content-SHA256`；旧 `/api/export/file` TXT 接口保留。
- 导出页现在可切正文/设定集、全部/连续范围/按卷，并按快照列出 TXT、EPUB、Word 或 JSON 下载。对话工具继续只准备正文预览，支持卷号；设定集由页面直接准备。

### 验证

- 渲染测试覆盖 TXT BOM、EPUB 容器与转义、DOCX OOXML/样式/分页、确定性字节；服务与 HTTP 测试覆盖卷选择、v1 兼容、快照复用、二进制损坏、作品隔离和真实下载响应。
- 用真实产品导出的中文正文 DOCX（3 页）和设定集 DOCX（17 页）逐页渲染检查，字体、分页、边距、层级、截断和重叠均正常；导出页完成桌面与 390px 移动视口操作检查，浏览器控制台无错误。
- 全量验证：66 个测试文件，**1225 passed / 1 skipped**；`npm run typecheck` 与 `npm run web:build` 通过，`npm audit` 为 0 漏洞，构建只有既有的 Vite 500 kB chunk 警告。

## 42. 2026-09-20 全文检索：正文与结构一起搜，片段直接当锚点（差距第 9 项）

分支 `full-text-search`（base master `d1cac6b`，不栈）。**1234 测试过**（基线 1225 + 9），四件套干净，浏览器端到端 0 次真实调用。

### 三条判断

- **不建索引。** 正文在 `ProjectStore.load()` 时整本进内存（`chapterNumbers()` + `chapterText(n)` 就能遍历），结构数据同理 —— 一次查询是纯内存线性扫描。建索引要多维护一份会过期的副本，而这里没有它要解决的问题。2000 章 / 600 万字有测试守着上界。
- **片段就是锚点。** 结果里的 `quote` 是正文的**逐字子串**，直接交给 `/api/anchor` 即可定位，「跳到原文」复用 Reader 既有的高亮通道，不新造一条。**所以片段里不能掺省略号之类的装饰，那属于界面。** 有一条测试逐条验证片段能被锚点解析回来且落在它自己那一处 —— 这是整条链路唯一会静默坏掉的地方。
- **不做模糊与近义。** 西文不分大小写，其余逐字。假命中会让作者不再信这个框，与元层穿帮检测选「宁漏不误报」同源。

### 范围与呈现（用户拍板：正文 + 结构）

结构视图本来就是这个产品的主界面，只搜正文会漏掉「哪条伏笔提到钥匙」。搜人物、地点组织、情节线、卷、章节计划，以及**已确认**的事件与伏笔 —— 待确认的候选不进结果，它们还不是故事事实。

两条呈现规则各有理由：**片段之间不重叠**（起初按起点去重，被测试打脸 —— 同一句里两处命中的起点可能因回看窗口够不到句首而不同，那样会把同一行抄两遍，改成「落在已展示片段里的命中不再另起一条」）；**一个实体只给一行**，报第一个命中的字段，否则「城」会让青州城刷出三条。

### 一条边界被澄清（值得记）

试过把 `src/search` 纳入 `test/rules.test.ts` 的「代码里没有数字」扫描，它立刻拦下 `throw new ChapterWriteError(400, …)` 的状态码。查下来：**被扫的十个目录里没有任何一个抛 `ChapterWriteError`** —— 那条边界其实是「纯领域计算 vs 服务层」，export / preparation / run / task / workspace 全都在扫描外。检索是服务层，按既有边界留在外面，没有自立新规矩。下次想扩扫描范围的人先看这条。

### 验证

- 9 个测试，**八条规则逐条变异测试**（注掉即变红）：片段向前/向后切句读、片段不重叠、每章片段上限、章数上限与 `truncated`、空查询拒绝、只搜已确认事件、实体只取首个命中字段。最后一条起初没被测到（我挑的「李长风」本来就只命中一个字段），换成「城」才真正钉住。
- 浏览器（脚本化替身，0 次真实调用）：检索词进地址栏（可分享、可后退）、正文 3 条片段、结构分「章节计划 / 已确认事件」两组、**点片段跳到第 1 章并恰好高亮那一句**、390px 无横向溢出、无 console 错误。工装备份在 `$TMPDIR/nf-search-browser-zZZyuk/search-browser.source.mts`。

## 43. 2026-09-21 积分记账：计量提到客户端层，每一次调用都进账（差距第 10 项）

分支 `credit-accounting`（base master `d1cac6b`，与 `full-text-search` 并行、代码不重叠但都改 §28）。**1242 测试过**（基线 1225 + 8 + 检索的 9），四件套干净，浏览器端到端 0 次真实调用。

### 口径纠正（用户澄清，勿再写成「受凭证限制」）

第 10 项一直记成「缺官方 key / DeepSeek 凭证」。用户澄清：**平台用他自己的 key 跑，向使用者按积分抵扣**。所以它不是等凭证，是把用量换算成积分记下来 —— 与最早那条已定决策「不做 BYOK、用户只看积分消耗」是一致的，只是这几批一直没人把它接上。

### 核对出的事实

- **计量原先只覆盖写章。** `task/service.ts` 的 `drive()` 包了一层记 `TaskUsage`，但对话（agent）、逐章反推、跨章返修定位、遗留 pipeline 全不计量 —— 它们同样花钱。
- **`TaskUsage.inputTokens` 把三档合并了**（input + cache_read + cache_creation），三档价格差一个量级，合并后折不出真实成本。这是不能沿用它的硬理由。
- 没有账户体系（无鉴权、只绑 127.0.0.1），余额只能落在工作区级。

### 决策（跨会话）

- **计量点 = `ProjectSession.getModelClient()`**，全流程唯一的客户端出口，在那里包 `metered()`；写章器不再自己 `createModelClient()`，改为向会话要。**以后新增任何调用点都自动进账**，不会再出现「某条路径没人记」。每个调用点带 `purpose`（chapter / conversation / inference / revision）。
- **四档分开计价**；端点没报的档记 `null`（不知道），不记 `0`（报了但为零）。chat 端点只报 prompt/completion，缓存两档就是 null。
- **账本 `credits.jsonl` 跟着作品目录走**，append-only、汇总可重建（与 `events.jsonl` 同形）；备份出去的作品自带自己的消耗。余额是全局的，工作区把各作品（含回收站里的）汇总减出来。
- **价格表里没有的模型照记用量、不折积分**（`priced: false`），比拍一个价格诚实；用量页有「未计价调用」提示。读入时也守这条不变量（手改账目不能让余额多扣）。
- **`pricing.yaml` 与 `rules.yaml` 分开**：前者是经营参数（上游单价、积分率、赠送额度），后者是故事约束。⚠ **表里的价格是占位值，上线前必须按官网核对。**
- 用户拍板：**按实际 token 成本折算**（不做固定档位）；**本批不做余额拦截**（涉及事前预估与失败退费，独立一批）。
- **与 `TaskUsage` 的重复是有意的**：那份是任务进度（含在途 pending/unmeasured，随草稿恢复），这份是账。合并会让任务面板依赖账本。
- 失败调用（抛出与 `kind:"error"`）不进账 —— 没拿到用量就不知道花了多少，「发生过一次没量到的调用」由 `TaskUsage.unmeasuredCalls` 记着。

### 两条实现期教训

- **改客户端获取方式时差点断了自动修订。** 把写章器改成惰性向会话要客户端后，`needsModel === false` 那条路径（自动修订）原先靠构造期注入的客户端，改完就 `failed`。修法：注入的客户端在会话构造时就包上计量再传给写章器，惰性只用于「未注入」的生产路径。
- **「试填一个文件都不落」的测试要放行账本。** 试填真的调用了模型、真的花了钱，不记才是错的；测试改成排除 `credits.jsonl` 并反向断言 `credits().calls > 0`。
- 变异测试抓到一条假绿：「失败不计费」变异后 meter 自己抛 TypeError，被测试的 `.catch` 吞掉，账本照样为空。断言改成「对话正常返回 + 账本为空」才真正钉住 —— **`.catch(() => undefined)` 会把被测代码自己的崩溃也吞掉，变异测试前先看一眼 catch。**

### 验证

8 个测试，五条规则逐条变异测试。浏览器：用量页三档余额、按用途分组、四档 token、未计价提示；首页右上角剩余积分、作品卡「已用 N 积分」；无横向溢出、无 console 错误。工装备份在 `$TMPDIR/nf-credits-browser-*/credits-browser.source.mts`。

### 明确未做

- 余额不足的拦截、充值入口、按作者的账户（现在余额是工作区级的）。
- 价格核对。

## 44. 2026-09-21 多文件导入：每章一个文件（真机撞出来的缺口）

分支 `import-multi-file`（base `credit-accounting`）。**1247 测试过**，四件套干净。

### 缺口是真机撞出来的

作者拿自己的旧稿来导入：`~/Downloads/失踪档案/` 一个目录、105 个 `.txt`（100 章正文 `N-标题.txt` + 角色档案/大纲/简介/审查规则/审查报告 5 个资料文件）。导入入口只收**单个文件或一段粘贴文本** —— 一本一百章的书要先手动拼一次才进得来。**这类缺口写多少单测都撞不出来，只有真机能。**

先验证过切分本身没问题：把 100 章按章号拼好喂给 `splitChapters`，切出 100 章、无缺号、无 problems。所以缺的只是「一次收一批文件」。

### 决策

- **拼接在服务端做**，前端只负责读文件（编码回落逻辑已有）并原样提交 `files: [{name, text}]`。理由：什么算「章节标记」只能有一份定义，放前端就成了两份。
- **按文件名里的章号排序，不按字典序** —— 后者把 10、100 排到 2 前面。`12-灰痕.txt`、`第十二章.txt`、`012.txt` 都认（复用 `MARKERS` 与 `parseChapterNumber`）；认不出的排最后。章号最终仍取自正文标记，排序只影响预览先后与「不是递增顺序」那条提示。
- **两类内容不并进去**：整个文件没有标记行（资料文件）、以及文件在标记行之前的文字（文件自带的标题行）。直接拼接的话两者都会**悄悄粘到前一章末尾**，是几万字后才发现的错。都单独列出、不导入。
- `text` 与 `files` **二选一**，给两个或都不给都是 400。前端只选一个文件时仍走整本文本那条路，粘贴框里看得见内容。
- 大小上限改成按**实际提交的载荷**算（`JSON.stringify(source())`），不再只量 text。

### 第二次撞墙：目录文件

多文件接上之后，同样那批文件**仍然导不进去**，报「第 1 章出现了两次（「第一章 雨中的旧录音」与「第001章 雨中的旧录音」）」。原因是 `目录及简介.txt` 里有一份一百行的目录，每一行都满足章节标记的规则 —— 它没被当成资料文件跳过，而是被当成一本**每章都没有正文的书**拼了进去。

判据：**有多条标记却一条正文都没有**。只有一条标记又没正文的不算目录，那是切坏了的章节文件，仍按问题报出来。

**教训：「看起来像一本书」的东西不止书。** 第一版只问「有没有标记行」，而目录、书评、甚至审查报告都可能满员命中标记行。凡是靠正则认结构的地方，都要再问一句「它有内容吗」。

### 验证

7 个新测试，六条规则逐条变异测试。**真机端到端两轮**：第一轮 105 个文件走浏览器导入（落盘 1–100 章无缺号、标记行已剥离）；修掉目录问题后复验，切出 100 章 / 297165 字 / 无阻断，4 个资料文件与 1 个目录文件各自列出不导入。
