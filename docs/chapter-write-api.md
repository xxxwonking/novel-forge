# 写章 API

本接口把准备好的项目接到章节任务服务：写正文 → 声明结构 → 代码检查 → 保存草稿。生成结束后由作者决定是否采用。对话入口和 Web 草稿操作界面尚未接入。

## 准备项目

服务启动方式仍为 `npm run serve -- <项目目录>`，默认端口 5174。启动脚本会加载根目录的 `.env.local`，需要 Node.js 22.9.0 或以上版本。阅读 API 不需要模型配置，首次生成时才创建模型客户端。

使用 Gemini chat 代理时，设置 `NOVEL_MODEL_PROVIDER=chat`，并提供 `CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL`，详见 [Gemini chat 使用说明](gemini-chat.md)。未设置 provider 或显式设置 `claude` 时，沿用 `ANTHROPIC_API_KEY` / `ANTHROPIC_AUTH_TOKEN` 及可选的 `ANTHROPIC_BASE_URL`；chat 请求失败不会自动切换到 Claude。

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

实际返回还包含 `declaration`、`findings`、`proposals`、`error`、作品基础版本和时间字段，不返回内部模型会话或资料校验信息。必须检查草稿状态：`ready` 才可采用，`needs_revision` 需要处理检查结果，`failed` 带失败步骤及原因，`stale` 表示生成依据已经改变。模型拒绝或调用失败会作为已保存草稿返回，不自动采用或无限重试。

生成期间可通过 `GET /api/chapter/drafts?n=1` 查询草稿；详情使用 `GET /api/chapter/draft?n=1&id=ch1d1`。这些 GET 请求不会启动生成。

| 写章 HTTP 状态 | 含义 |
| --- | --- |
| 200 | 返回草稿，具体生成结果见 `status` 和 `error` |
| 400 | 参数、节拍或资料引用无效 |
| 404 | 缺少节拍或指定草稿不存在 |
| 409 | 跳章、并发冲突、资料过期、节拍未确认或埋设原文失效 |
| 503 | 尚未配置可用的模型客户端 |

## 恢复、另写与采用

恢复某稿：`{"chapter":1,"draftId":"ch1d1"}`。C4 已成功而 C5 失败时，恢复原会话执行 C5，保留原正文。已有完整检查结果的草稿直接返回；自动修订尚未接入。

chat 草稿保留原始 assistant 消息及工具签名。更换 chat 模型或端点后不能直接恢复旧会话，应恢复原配置或另写一版；同一端点和模型的密钥轮换不影响恢复。

普通重复请求复用本章最新的未丢弃草稿。同一会话内重叠的同一请求共享任务；冲突的写章请求返回 409。另写一版使用 `{"chapter":1,"newDraft":true}`。`newDraft` 每次代表一次新的写作意图，重试已经创建的新稿应使用它的 `draftId`。

HTTP 请求断开不会取消服务端任务。服务仍运行时会继续执行并保存结果；服务重启后，由用户再次提交写章请求恢复，查询页面本身不触发恢复。生成中的草稿暂不能丢弃，避免后续保存重新覆盖丢弃状态。

新草稿保存生成依据的校验值，恢复与采用前核对设定、人物、规则、节拍和历史正文。资料改变后旧稿需要重新核对，目前可显式另建草稿；不自动把旧正文当作新资料下的结果。生成期间发生资料变化也会保留正文并将草稿标为 `stale`。

采用使用既有接口：`POST /api/chapter/adopt`，请求为 `{"chapter":1,"draftId":"ch1d1"}`。只有当前仍有效的 `ready` 稿可采用，随后正式正文与声明参与后续写章。重复采用同一稿幂等。`propose_*` 工具产生的提议仍保存在草稿提议区，本接口不自动改人物设定或规划。

## 当前范围

并发协调限定在同一服务进程的项目会话内。自动修订、对话式作品创建、草稿结果页和多进程任务协调尚未实现。L2 目前每次根据正式事件重建，复用现有分层渲染与缓存断点；生产环境的 L2 增量快照策略和真实缓存收益仍需后续验证。

自动化测试覆盖完整生成/采用/续写、C5 失败后跨会话恢复、参数和资料变化、断开 HTTP 请求后的继续执行，使用假模型响应。它们不代表真实模型的写作质量、服务可用性或缓存命中率已经通过验收。
