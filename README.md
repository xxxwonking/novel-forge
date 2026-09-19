# novel-forge

基于 TypeScript、LangGraph JS 和 React 的小说创作 Agent 项目，主要参考 [OpenFic](https://github.com/syrizelink/OpenFic)，持续探索作者通过对话创作、通过结构视图监督长篇小说的体验。

从作品列表新建一本书，在对话中准备人物、设定和章节计划，再生成、修改并逐章采用正文。Web 可以查看稿件历史、结构变化、原文依据和任务进度，支持暂停、恢复、结构纠错、后续安排及已采用正文的 TXT 导出。

模型支持 Claude Messages，以及 DeepSeek 等国内官方 API 和代理／聚合平台提供的 Chat 兼容接口。LangGraph JS 管理章节任务；已采用正文与事件记录维护正式故事进度。方案和未采用稿单独保存，生成结束不会自动推进正式章节。

## 首次运行

建议使用 Node.js 24 LTS 及 npm；启动脚本最低需要 Node.js 22.9.0。以下命令用于新克隆的目录：

```sh
git clone https://github.com/xxxwonking/novel-forge.git
cd novel-forge
npm ci
npm run web:build
npm run serve
```

打开 `http://127.0.0.1:5174`，进入作品列表。默认工作区是 `data/`，首次运行可直接新建作品；书名不作为磁盘目录名。对话与生成前，按[统一模型配置](docs/model-configuration.md)将连接信息写入被 Git 忽略的 `.env.local`，修改配置后重启服务。新建、阅读已有作品和导出无需调用模型。

可以用 `npm run serve -- data/my-library 5174` 指定工作区和端口；传入已有作品目录时直接打开该作品。作品数据保存在本地目录，不纳入 Git；作品列表可下载和导入 `.nforge` 备份。

如需查看无需模型的结构演示，可运行 `npm run seed -- data/demo-new`。它包含模板生成的 52 章，用来观察结构视图和告警。请选择尚不存在的目录，避免覆盖已有演示数据；重新打开作品列表即可看到该作品。

## 备份与迁移

作品卡片和回收站条目都提供“备份”，因此作品无需先从 `.trash/` 恢复就能迁移。`.nforge` 包含设定、人物、情节、事件流、正文、草稿、任务与未来版本新增的普通项目文件；不会携带 `.env*` 凭据、未完成的文件事务日志或临时文件。包内每个文件都有长度和 SHA-256，导入前会先校验版本、路径与内容完整性。

在作品列表选择“导入备份”，可留空目标 ID 以沿用原 ID，也可填一个新 ID 做副本。已有同名作品时导入会拒绝，不会覆盖；所有文件先写入隐藏暂存目录，并在 `ProjectStore` 能完整读取后一次改名公开，所以坏包或中途失败不会留下半本作品。作品仍有章节任务或正在连写时不能备份，请先等待任务停稳。

## 一次创作流程

1. 新建作品，填写想法和暂定书名，确认题材、平台与目标字数。
2. 在对话中讨论开篇，查看资料页中的候选方案。明确确认方案后再写章，也可以明确要求基于候选方案试写。
3. 写章任务在后台进行，结果页展示版本、摘要、人物与伏笔变化、检查项及原文。离开页面后服务会在既定范围内继续；返回只恢复查看，暂停需主动操作。
4. 用对话提出修改、选段改写或手动编辑；正文正确而结构误读时，只纠正记录。修改保存为新版本，检查通过且没有必须处理项后才能采用。
5. 选择“采用”或“采用并继续”。后续章节使用正式版本；当前章未采用时不能越过它写下一章。最新已采用章的修订也先成为候选，采用后相关后续草稿需重新核对。
6. 将尚未兑现的伏笔安排到后续章节，区分已安排、部分兑现和已兑现。导出页可预览全部或连续范围内的正式版本，再下载固定版本集合的 UTF-8 TXT。

正文生成后检查失败时，已完成正文仍保留，可以从未完成步骤恢复。生成连接中断、输出截断或工具轮数耗尽时，已收到的文字作为未完成片段保存，可选择“保留片段继续完成”；片段不能直接采用。新写章默认至多自动修订一次，超过本次范围或仍有必须处理项时等待作者决定。首版暂不支持跨多章正式返修、批量生成、旧作导入或富格式导出。

## 开发与检查

开发时在两个终端分别运行 `npm run serve` 和 `npm run web`，再打开 `http://localhost:5173`。Vite 将 API 请求转发到本地服务的 5174 端口，并保留浏览器 Host（`changeOrigin: false`），使请求通过后端的同源检查。

Windows 更新依赖前先结束正在运行的服务，避免编译进程占用 `esbuild.exe` 导致 `npm ci` 失败；安装和构建完成后，使用原作品目录重新启动服务。

```sh
npm run typecheck
npm test
npm run web:build
```

本地服务当前仅监听 `127.0.0.1`，尚未提供用户登录。访问 Host 须为回环地址；携带 Origin 的请求须与 Host 同源。普通 API POST 须使用 `application/json`，请求体上限 4 MiB；作品导入使用 `application/vnd.novel-forge.backup` 二进制请求体并有独立上限。`npm run acceptance:m1` 是单独的真实模型验收流程，会调用模型；它不属于上面的演示与常规检查。

最近的整体排查结果见 [2026-09-15 代码审查报告](docs/reports/2026-09-15-code-audit.md)：948 项自动测试、8 个浏览器场景及依赖审计；真实连续创作验收的剩余范围单独记录。

## 服务端写章

`POST /api/chapter/write` 从设定、人物、正式事件、前章正文和已确认节拍装配输入，创建或恢复章节任务。C5 失败会保留正文；使用同一 `draftId` 可以恢复剩余步骤。普通重复请求复用已有草稿，`newDraft: true` 表示另写一版。对话工具和 Web 按钮复用业务入口，采用针对明确的稿件版本。

地点/组织库保存于 `settings.json`，写作纪律保存于 `discipline.json`。旧项目缺文件时使用空设定库和默认纪律，读取不会自动改动项目。写章需要有效模型配置和完整的引用资料；阅读演示无需模型配置。现有演示的下一章节拍仍是候选计划，不能直接作为已确认的写章输入。

请求格式、资料准备、错误码和恢复行为见[写章 API 使用说明](docs/chapter-write-api.md)。自动化测试使用假模型与临时项目，包含真实本地 HTTP 测试。

官方 API、代理／聚合平台、JSON 输出与思考模式的配置见[统一模型配置](docs/model-configuration.md)，之前的 Gemini 真实单章结果见[Gemini chat 使用说明](docs/gemini-chat.md)。将连接信息放入被忽略的 `.env.local`，设置 `NOVEL_MODEL_PROVIDER=chat`，再运行 `npm run acceptance:chat`；每次创建独立测试作品并保存正文、检查结果和用量。DeepSeek 已通过本地协议与工作流测试，官方真实 API 尚待实测。单章测试与长期创作质量、Claude 缓存验收分别记录。

## 目录与设计记录

| 位置 | 内容 |
| --- | --- |
| `src/chapter/`、`src/context/`、`src/client/` | 章节流程、上下文装配和模型接入 |
| `src/task/` | LangGraph 章节任务、工具执行、草稿与采用 |
| `src/workspace/`、`src/preparation/` | 作品列表、资料方案、确认和试写依赖 |
| `src/planning/`、`src/export/` | 故事安排、处理进度与固定版本 TXT 导出 |
| `src/beat/`、`src/gate/`、`rules.yaml` | 章节规划约束与检查规则 |
| `src/store/`、`src/alerts/`、`src/anchor/`、`src/view/` | 小说状态、告警、正文定位和结构视图 |
| `src/server/`、`web/` | 本地 API 和 Web 工作区 |
| `src/harness/`、`test/` | 演示与验收脚本、自动化测试 |

后续方向见[首版用户流程草案](docs/superpowers/specs/2026-09-09-novel-forge-user-flow-design.md)、[用户流程与现有能力映射](docs/superpowers/specs/2026-09-09-novel-forge-user-flow-capability-map.md)和[工作记忆](MEMORY.md)。设计建议、源码实现和实际验收结果在记录中分别标注。
