# 写章 API

本接口把作品资料接到章节任务服务：写正文 → 声明结构 → 代码检查 → 保存草稿。对话和 Web 结果页共用这些业务入口，生成结束后由作者决定是否采用。

## 准备项目

`npm run serve` 默认打开 `data` 下的作品列表，也可用 `npm run serve -- <项目目录>` 打开已有作品，默认端口 5174。启动脚本加载根目录的 `.env.local`，需要 Node.js 22.9.0 或以上版本。多作品请求通过 `x-novel-project` 指定作品 ID，服务端没有全局活动作品。阅读、手动保存、结构纠错及已有声明的纯代码检查不需要模型配置。

使用 Gemini chat 代理时，设置 `NOVEL_MODEL_PROVIDER=chat`，并提供 `CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL`，详见 [Gemini chat 使用说明](gemini-chat.md)。未设置 provider 或显式设置 `claude` 时，沿用 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 及可选的 `ANTHROPIC_BASE_URL`；chat 请求失败不会自动切换到 Claude。

DeepSeek 等国内官方或代理 Chat 接口参见 [模型配置](model-configuration.md)。代理凭证只用于其对应端点。

写章前需要完整的作品设定、人物卡、情节线定义与本章节拍。节拍的 `provenance` 必须是 `authored` 或 `committed`；预算会按当前规则重新派生，允许原文件的 `budget` 为 `null`。第二章起必须有上一章的正式正文。人物、场景、情节线和待收伏笔的引用必须存在；待收伏笔需要真实埋设记录及能定位的原文锚点。

地点/组织库使用 `settings.json`，示例：

```json
[
  {
    "id": "S01",
    "name": "旧书楼",
    "kind": "location",
    "description": "保存地方卷宗的书楼。",
    "facts": ["夜间闭门。"]
  }
]
```

`kind` 支持 `location` 和 `organization`。写作纪律使用 `discipline.json`：

```json
{
  "version": "author-d1",
  "rules": ["采用第三人称有限视角。", "对话避免重复解释已知信息。"]
}
```

旧项目缺这两个文件时，读取分别返回空库和平台默认纪律，不自动写文件。通过 `ProjectStore.save` 创建项目会保存默认值，也可使用 `writeSettings` / `writeDiscipline` 或 Session 对应的 `put*` 方法更新。手动编辑 JSON 后需重启服务重新加载。

`data/demo` 是阅读与告警样本，第 53 章节拍仍为 `proposed`，旧样本也未包含地点/组织库。写章前需补齐并确认资料，不要为此覆盖已有作品或重新运行默认 `seed`。

## 请求与返回

```http
POST /api/chapter/write
Content-Type: application/json

{"chapter": 1}
```

| 字段 | 含义 |
| --- | --- |
| `chapter` | 必填正整数章号；支持下一章或最新已采用章的候选版本 |
| `draftId` | 可选，如 `ch1d1`；恢复或读取指定草稿 |
| `newDraft` | 可选布尔值；`true` 另建版本，不能同时传 `draftId` |
| `maxOutputTokens` | 可选正整数；调整 C4 输出上限，随草稿保存并在恢复时沿用 |
| `requestId` | 可选稳定请求编号；网络重试沿用原编号，返回同一份已保存任务 |
| `proposalId` | 可选资料方案 ID；试写使用候选资料，采用时一起确认依赖 |

HTTP 会等待本次任务结束，成功处理请求后返回草稿对象，例如：

```json
{
  "chapter": 1,
  "draftId": "ch1d1",
  "status": "ready",
  "body": "正文……",
  "acceptable": true
}
```

实际返回还包含 `declaration`、`findings`、`proposals`、`proposalOptions`、可选的 `proposalAdoption`、`error`、`execution`、`revisionToken`、`isCurrentAdopted`、作品基础版本和时间字段，不返回内部模型会话或资料指纹。必须检查草稿状态：`pending_check` 等待作者启动检查，`ready` 才可采用，`needs_revision` 需要处理检查结果，`failed` 带失败步骤及原因，`stale` 表示生成依据已经改变。模型拒绝或调用失败会作为已保存草稿返回，不自动采用或无限重试。

生成期间可通过 `GET /api/chapter/drafts?n=1` 查询草稿；详情使用 `GET /api/chapter/draft?n=1&id=ch1d1`。这些 GET 请求不会启动生成。

Web 和主 Agent 使用 `POST /api/chapter/start`，参数相同，保存初始草稿后立即返回。`GET /api/tasks` 查询真实活动状态与已报告用量；`POST /api/chapter/control` 接收 `chapter`、`draftId` 和 `action: "pause" | "end"`。暂停或结束在当前模型请求返回并保存后生效；没有活动执行的旧运行记录显示 `interrupted`。刷新、查询和打开结果页不会恢复或重启模型任务。

| 写章 HTTP 状态 | 含义 |
| --- | --- |
| 200 | 返回草稿，具体生成结果见 `status` 和 `error` |
| 400 | 参数、节拍或资料引用无效 |
| 404 | 缺少节拍或指定草稿不存在 |
| 409 | 跳章、并发冲突、资料过期、节拍未确认或埋设原文失效 |
| 503 | 尚未配置可用的模型客户端 |

## 恢复、另写与采用

恢复某稿：`{"chapter":1,"draftId":"ch1d1"}`。C4 已成功而 C5 失败时，恢复原会话执行 C5，保留原正文。已有完整检查结果的草稿直接返回；初稿已经产生自动修订版时，写章/恢复请求返回同任务的后续版本。

chat 草稿保留原始 assistant 消息及工具签名。更换 chat 模型或端点后不能直接恢复旧会话，应恢复原配置或另写一版；同一端点和模型的密钥轮换不影响恢复。

普通重复请求复用本章最新的未丢弃草稿。同一会话内重叠的同一请求共享任务；冲突的写章请求返回 409。另写一版使用 `{"chapter":1,"newDraft":true,"requestId":"new-unique-request"}`；重试沿用原 `requestId` 或使用已返回的 `draftId`。

HTTP 请求断开不会取消服务端任务。服务仍运行时会继续执行并保存结果；服务重启后，由用户再次提交写章请求恢复，查询页面本身不触发恢复。生成中的草稿暂不能丢弃，避免后续保存重新覆盖丢弃状态。

新草稿保存生成依据的校验值，恢复与采用前核对设定、人物、规则、节拍和历史正文。资料改变后旧稿需要重新核对，目前可显式另建草稿；不自动把旧正文当作新资料下的结果。生成期间发生资料变化也会保留正文并将草稿标为 `stale`。

采用使用既有接口：`POST /api/chapter/adopt`，请求为 `{"chapter":1,"draftId":"ch1d1"}`。只有当前仍有效的 `ready` 稿可采用，随后正式正文与声明参与后续写章。重复采用同一稿幂等；过期或并发冲突返回 409。省略建议选择时仅采用正文与声明。

## 写作建议随稿采用

`proposalOptions` 返回 C4 建议的原值、新值、原因、是否可选及不可选原因。作者明确选择后，可以随该版本一并确认：

```json
{
  "chapter": 1,
  "draftId": "ch1d1",
  "revisionToken": "从当前草稿详情原样取得的64位凭据",
  "selectedProposals": [0, 2]
}
```

`selectedProposals` 是从 0 开始、不重复的本稿建议索引；只要携带该字段，就必须同时携带 `revisionToken`。默认不选，空数组表示本次不接受建议。旧凭据、来源变化、采用后改变原次选择返回 409，非法索引或不支持的资料修改返回 400。

人物建议仅支持受控的 `profile` / `speech` 字段，复杂值使用 JSON；身份编号、姓名、派生状态、未知人物、非法引用及不可变属性冲突不能直接覆盖。未来伏笔保存为已确认规划，尚未埋设，不混入正文事实。建议不得重复已有伏笔或本稿已经声明的埋设。

所选建议、试写依赖、正文、C5 事实、正式版本与 `proposalAdoption` 收据在同一事务保存。收据包含源凭据、所选索引、具体前后值及时间；重复请求复用原结果，不重复应用。已采用结果显示当时的选择；最新章再次编辑时，仅未选建议继续留在新稿。

选择后复用现有结构与机械检查，有必须处理项则整次采用失败。这不替代真实正文的语义核对。

## 编辑、纠错与检查

三类请求均必须携带从草稿详情取得的 `chapter`、`draftId` 和 `revisionToken`。源正文、结构、检查或状态变化后，旧 token 失效并返回 409。编辑和纠错只支持当前未采用章或最新正式章，不能从历史采用版本覆盖新的正式版本。

| 接口 | 其他参数 | 结果 |
| --- | --- | --- |
| `POST /api/chapter/edit` | `body`、可选 `summary` / `requestId` | 保存新版本，清空声明和检查，进入 `pending_check`；不调用模型 |
| `POST /api/chapter/correct` | `changes`、`summary`、可选 `requestId` | 正文保持，只修改指定结构记录，重建锚点，保存待检查新版本 |
| `POST /api/chapter/check` | 必填 `adoptOnSuccess: boolean`，可选 `selectedProposals` | 启动该版本后台检查；成功且明确要求采用才继续采用及应用所选建议 |

编辑和纠错重试沿用同一 `requestId`；相同请求返回同一版本，不同内容复用编号返回 409。检查拒绝并发冲突时不会改写目标稿或登记采用意图。

纠错的 `changes` 使用领域字段名，示例：

```json
{
  "chapter": 1,
  "draftId": "ch1d1",
  "revisionToken": "从草稿详情原样取得的64位凭据",
  "requestId": "correct-unique-request",
  "summary": "正文只是昏倒，保留正文纠正死亡误读",
  "changes": [{
    "section": "characterStates",
    "index": 0,
    "value": {
      "characterId": "C02",
      "field": "condition",
      "from": null,
      "to": "昏倒，呼吸平稳",
      "quote": "血刀客突然昏倒在门前"
    }
  }]
}
```

`section` 支持 `events`、`foreshadowPlanted`、`foreshadowResolved`、`relationsChanged`、`characterStates`、`characterPresence`。`index` 以源版本数组为准，等于长度时新增，`value: null` 删除。可选 `occurrence` 指定重复引文的出现序号（从 0 开始）；不存在的引文、非法引用和会被解析器静默删改的内容会被拒绝。

编辑后的 C5 使用作者当前完整正文，不回放旧 C4 正文或伪造模型思考历史。结构纠错后的声明完整时只执行代码重检。C5 必须完整结束并满足六类结构数组及字段形状；达到输出上限、残缺 JSON 或字段缺失会保留正文并标记 C5 失败。原生生成路径仍保留 C4 的完整响应供同会话 C5 使用。

`adoptOnSuccess` 与 `selectedProposals` 随本次检查保存，失败、暂停和重开后仍保留；新修订不继承源稿的采用请求。`adoptOnSuccess: false` 不接受非空建议选择，避免只检查时隐含修改资料。有必须处理项时停在 `needs_revision`。检查通过而采用失败时保留结果和 `review.adoptionError`，包括采用前依据改变产生的 `stale` 状态。

最新正式章修订采用后，正文、声明和正式版本映射在同一事务中更新；后续各类未采用稿标记过期。旧版本及原检查继续保留，`isCurrentAdopted` 区分当前正式版本与历史采用版本。`revision` 记录来源、修改说明和是否重新绑定最新资料；结果页提供前后对比。

对话工具 `get_chapter_draft`、`correct_draft_structure`、`check_chapter_draft` 复用相同服务，模型工具不能绕过版本、检查或采用边界。

## 局部改写与片段续写

`POST /api/chapter/revise` 和对话工具 `revise_chapter_draft` 共用修订服务，保存新候选并启动既有后台任务，完成 C5/C6 后等待采用。

```json
{
  "chapter": 3,
  "draftId": "ch3d1",
  "revisionToken": "从源稿详情取得的凭据",
  "requestId": "rewrite-unique-operation",
  "mode": "rewrite",
  "instruction": "增加一轮试探，保留结尾的决定",
  "scope": { "quote": "李长风立刻答应了血刀客的条件。", "occurrence": 0 }
}
```

`scope` 必须显式提供；准确原文出现多次时必须指定从 0 开始的 occurrence。只有明确整章修改时传 `scope: null`。范围外正文由代码逐字保留，模型只返回范围内替换内容。源版本变化返回 409；相同 requestId 的同一请求返回原修订，改变要求复用编号返回 409。

需要扩大范围时，`revision.scopeAdvice` 返回建议、原文保持不变，任务状态为 `awaiting_input`；不能直接检查采用。作者可重新选择范围生成新修订，或结束该任务。非法 JSON 或截断的替换内容不会应用，可以重试同一修改。

续写使用 `mode: "continue"` 和 `scope: null`，只允许尚未完成的正文（详情 `canContinueBody` 为 true），已有片段固定作为前缀，模型只生成新增文字。再次截断会保存所有新增片段并标 C4 未完成，不调用 C5；再从最新版本发起续写。普通任务恢复仍重放原冻结请求，不自动改变为续写。

内部 `generation` 冻结源正文、范围和要求，不在详情中暴露。C5 保留模型真实完整响应，并同时读取代码合成的整章正文；C5 失败后恢复只做必要步骤。新修订不继承源稿采用授权。结果页支持选段、填写要求、查看局部前后差异和保留片段继续完成。

## 当前范围

当前已接入作品列表、资料方案、试写、结果页、后台任务、手动编辑、结构纠错、自然语言局部改写、保留片段继续完成、至多一次自动修订和 C4 建议随稿采用。完整问题状态、未来规划与正文埋设衔接及基础导出继续开发。并发协调限定在同一服务进程的项目会话内。L2 目前每次根据正式事件重建；生产环境的增量快照与真实缓存收益仍需后续验证。

自动化测试覆盖完整生成/采用/续写、C5 失败后跨会话恢复、参数和资料变化、断开 HTTP 请求后的继续执行，使用假模型响应。它们不代表真实模型的写作质量、服务可用性或缓存命中率已经通过验收。

## 至多一次自动修订

新写章开始时冻结规则允许的自动修订额度，首版上限为 1。`GET /api/preparation` 的 `taskPolicy.autoRevisionLimit` 展示新任务范围；草稿和任务查询返回 `autoRevisionsUsed`，初稿通过 `automaticResultDraftId` 链接后续稿。规则额度为 0 或旧任务没有保存额度时，不追加自动修订。

检查包含 `route_patch`、`resolution_missing`、`resolution_downgraded` 且没有其他 block 时，图可创建一份自动修订稿，重新执行正文、声明和检查。初稿正文及检查保留；自动稿的 `revision.kind` 为 `automatic`，任务阶段为 `revising`。修订仍未通过、模型失败或需要扩大范围时停止，不无限重试，不自动采用。

暂停/结束原任务 ID 会作用于当前自动稿。刷新只查询；C5 失败或正文保存后暂停，继续时只做剩余步骤。自动稿累计同任务用量，初稿保留第一轮记录。`POST /api/chapter/check` 针对明确选择的版本，不跟随自动链接换稿；作者编辑、纠错、局部改写和片段续写不触发额外自动改写。

结构引文必须出现在当前正文。`c5_anchor_unresolvable` 是必须处理项，应纠正引用或重新核对；不能因旧 offset 有效就放行，也不能通过改写正文来迎合不存在的引文。
