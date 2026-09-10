# 通过 chat 接口接入 Gemini 写作模型

## 目标与已确认范围

用户提供现有代理站配置，指定 Gemini 和 `/v1/chat/completions`，并要求继续实施；暂不调用 Claude。先完成模型适配与单章真实写作验证，沿用 LangGraph JS、逐章采用和当前代理独立复核的决定。Stage 2 界面另行推进。

已核对代理的模型列表，并使用 `gemini-3-flash` 完成最小 JSON schema 请求。该名称是代理返回的模型标识；先用于兼容验证，之后可通过开发配置更换。

## 接入选择

可选路径是直接适配 chat 协议、使用代理的其他兼容协议，或引入统一模型框架。用户已指定 chat 接口，项目已决定不引入 LangChain 模型抽象，因此使用一个薄 chat 客户端。任务图、资料装配及正式事实存储复用现有实现。

## 客户端与消息

- 增加最小 `ModelClient` 契约：`call(CallOptions): Promise<CallResult>` 与 `official` 标记。原 Claude 客户端自然满足契约；章节调用方只依赖该契约。
- `ChatClient` 使用 Node 原生 fetch 调用配置的 chat endpoint；模型、地址及密钥通过环境配置提供，不回退调用 Claude。
- 保持当前内部消息和草稿快照格式；出站时转换 system、user、assistant、tool 消息与工具 JSON schema。Claude 的 thinking、effort 和缓存控制参数不直接发往 chat。
- 将代理返回的完整 assistant 消息作为不透明元数据随内容块保存，供工具下一轮及 C5 跨 Session 恢复。保留 Gemini 可能需要的工具签名与 reasoning 字段；该信息仍位于 API 隐藏的内部会话中。
- 不透明会话元数据关联模型与端点标识；配置变更时拒绝将旧会话直接发送给不同目标，保留已有正文。端点标识使用摘要，不保存密钥。
- C5 使用 `response_format.json_schema`；响应仍通过现有 C5 解析、引用交叉检查和代码闸门，模型给出 JSON 不等于章节可采用。

## 响应与失败

- 支持普通 JSON 响应及长输出所需的 SSE，正确合并中文文本、工具参数及用量。截断映射到 `max_tokens`，拒绝与网络/HTTP/协议错误保留独立结果。
- 不对生成请求自动重试；任务服务负责保稿和恢复。错误文案清除本次配置密钥后再进入草稿或 HTTP 响应。
- 代理用量按实际返回记录，`official` 为 false，不能作为 Claude 官方缓存验收依据。

## 配置与验证

- `NOVEL_MODEL_PROVIDER=chat`、`CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL` 选择代理；未选择 chat 的旧启动方式保持兼容。
- `.env.example` 仅放占位值；真实配置在被忽略的 `.env.local`，由 Node 启动参数加载。用户原始配置文件保留在仓库之外。
- 本地 HTTP 测试验证真实请求格式、工具元数据往返、JSON schema、SSE、超时/错误及 C5 保稿恢复；正常测试不调用外部模型。
- 单独的 chat 验收脚本创建一个新测试作品，通过现有写章 API 生成草稿，保存正文、检查结果和用量。保留现有 `data/demo`；检查未通过时保留失败结果，不降低规则以换取通过。

## 验收

1. 选用 chat 配置后，写章、工具调用和 C5 均请求配置的 Gemini 模型。
2. C5 失败后正文留存，跨 Session 恢复只重试声明；工具及 assistant 元数据仍在。
3. 草稿生成不自动改变正式正文或事件；仅检查通过的 ready 稿可由既有采用入口生效。
4. 原有测试、类型检查和前端构建通过；真实单章结果单独记录，区分流程成功、写作质量与缓存指标。
