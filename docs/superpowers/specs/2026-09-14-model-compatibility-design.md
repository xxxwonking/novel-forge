# 国内模型与代理 Chat 接入设计

日期：2026-09-14。用户明确要求同时支持国内模型官方 API 与代理／聚合接口；当前代理独立实现和复核。基线为 `aeff8b3`，602 项测试通过。

## 目标与取舍

复用 `ModelClient` 与现有 Chat Completions 适配，保持 LangGraph JS 编排。将连接地址、模型 ID 和协议能力分别配置；保留旧 Gemini 环境配置的行为。官方或代理都由用户明确填写地址和对应密钥，不按模型名或域名猜测能力。

只换模型名不能处理 JSON 与思考字段差异；为每家厂商添加 SDK 会扩大依赖和会话格式。本轮采用一个 Chat 客户端配显式能力选项，并提供 DeepSeek 预设。保留 Claude Messages 入口；本轮不新增 Responses、Gemini 原生协议、模型选择 UI 或多模型路由。

## 配置

`NOVEL_MODEL_PROVIDER=chat` 继续表示 Chat Completions 协议。必填 `CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL`。增加：

| 变量 | 值与默认 |
| --- | --- |
| `CHAT_PRESET` | `generic`（默认）或 `deepseek`，仅提供能力默认值 |
| `CHAT_JSON_MODE` | `json_schema` / `json_object` / `prompt`；generic 默认 schema，deepseek 默认 object |
| `CHAT_THINKING` | `default` / `enabled` / `disabled`；generic 默认不传，deepseek 默认 disabled |
| `CHAT_REASONING_EFFORT` | `default` / `low` / `high` / `max`；默认不传，明确指定时要求 thinking=enabled |
| `CHAT_MAX_OUTPUT_TOKENS` | 可选正整数，限制每次请求的输出预算；未指定沿用调用方预算 |
| `CHAT_STREAM` | `auto` / `always` / `never`；默认 auto，按实际输出预算决定 |
| `CHAT_STREAM_INCLUDE_USAGE` | `true` / `false`，默认 true；false 时省略 stream_options |
| `CHAT_TIMEOUT_MS` | 正整数，默认 300000，校验定时器范围 |

DeepSeek 预设默认显式关闭思考，以便先测试工具与写章流程。可开启思考并设置 effort；其字段使用 DeepSeek 的 `thinking.type` 和 `reasoning_effort`，不宣称所有国内厂商扩展协议相同。Chat 不隐式照搬 Claude 的 CallOptions.thinking/effort。只有选中的接口接收请求，不探测其他域名或自动换模型。

地址规则：服务根地址保留自动补 `/v1/chat/completions`；任意非空路径（如 `/compatible-mode/v1`、`/api/v3`）追加 `/chat/completions`；完整 endpoint 直接使用。拒绝 URL 中的凭证、查询与片段。官方示例可写完整 `https://api.deepseek.com/chat/completions`。

## JSON 与错误处理

C5 保留 `outputSchema` 与现有本地解析、原文引用和业务校验。json_schema 沿用原请求；json_object 发送 `response_format: {type: 'json_object'}`，并在 system 中加入 JSON 输出要求和完整 schema；prompt 只加入同样的提示，不发送 response_format。结构化约束不能代替本地业务验证。

流式与非流式共用停止原因分类。`insufficient_system_resource`、`aborted` 返回明确错误，不解析其中可能未完成的工具参数；截断和拒绝沿用原状态。没有静默重试、协议降级或 Claude 回退。密钥在错误中脱敏。

## 思考会话的持久化

章节草稿已有完整 chat assistant 快照，继续保留。目标摘要保留旧默认算法，显式改变思考配置时增加配置标记，避免把不兼容的旧草稿历史传回接口。JSON 模式、预算、超时和密钥轮换不改变会话目标。

主 Agent 的 `conversation.json` 增加可选内部 modelHistory：目标摘要、对应的可见 turn 数和完整 MessageParam 历史。Chat 客户端通过可选 `conversationKey` 声明需要完整回放；没有此能力的客户端保留文本历史行为。

- 完整保存工具往返和最终 assistant（包括没有调用工具的思考回复），跨 Session 回放原样字段。
- 老对话没有原始字段、目标改变或历史版本不匹配时，将可见文本打包为一条用户上下文记录；不伪造 reasoning_content，也不把其他模型的内部消息传到新接口。
- 截断、拒绝、错误和达到工具上限的未执行请求不作为原始 assistant 回放；保留已完成的工具结果与说明性的用户上下文，避免下次再次执行旧工具。
- 一次完成的 user/agent 对及内部历史一起保存，并保留回合内新记录的 ideas；同一个 ConversationStore 的 send 按顺序执行，防止回合交错覆盖。
- 内部历史不进入 GET/POST 对话 API；UI 仍只看到文本和 effects。不会将推理内容展示到产品界面。

本轮仍无跨进程锁、上下文自动压缩或成本分流。完整历史会增加输入量，达到上下文上限时接口明确失败。

## 验证与实测范围

用本地 HTTP 服务器验证官方风格和代理风格的真实序列化请求、JSON、流式、错误、工具与跨 Session 恢复；集成验证主 Agent、C4、C5、采用和后续读取。覆盖旧 Gemini 默认配置。

当前没有 DeepSeek 官方凭证，不能声称官方真实推理或写作质量已验收，也不会将代理密钥发往官方地址。配置文档提供两种接入示例和可复用的实测命令。真实数据与 `.env.local` 保留，不运行 seed。

参考：2026-09-14 已核对 [Chat API](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Mode](https://api-docs.deepseek.com/guides/json_mode)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。文档当前模型包含 `deepseek-flash` 与 `deepseek-v4-pro`，代码不硬编码模型白名单或旧版 token 限制。
