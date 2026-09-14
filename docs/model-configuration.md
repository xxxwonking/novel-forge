# 模型配置：官方 API 与代理／聚合平台

国内模型官方 API 和代理／聚合平台共用 Chat Completions 客户端。模型 ID 不限于 Gemini，选择账户实际可用、支持文本及工具调用的模型即可。写章和主 Agent 当前共用同一组连接信息、模型与能力配置。

## 支持的接口格式

| 接口格式 | 配置与范围 |
| --- | --- |
| OpenAI 兼容 Chat Completions（`/chat/completions`） | `NOVEL_MODEL_PROVIDER=chat`；适用于 DeepSeek 官方及提供此协议的国内厂商／代理 |
| Anthropic Messages | `NOVEL_MODEL_PROVIDER=claude`；保留现有 Claude 客户端 |
| Responses、Gemini 原生 `generateContent`、本地模型权重文件 | 当前未实现；本地推理服务如提供兼容 Chat API，可使用 chat 接入 |

DeepSeek 的官方格式已有专门预设。通义千问、Kimi、GLM、豆包等，需使用各平台的 **Chat 兼容地址与具体模型 ID**，确认该模型支持 tools、所选 JSON 格式和输出长度。接口兼容不代表所有模型的工具／思考能力相同，也不代表已逐一完成真实测试。LangGraph 继续负责流程编排，没有新增 LangChain 模型抽象。

## DeepSeek 官方配置

在项目根目录被 Git 忽略的 `.env.local` 中设置：

```dotenv
NOVEL_MODEL_PROVIDER=chat
CHAT_PRESET=deepseek
CHAT_BASE_URL=https://api.deepseek.com/chat/completions
CHAT_API_KEY=replace-with-your-deepseek-official-key
CHAT_MODEL=deepseek-flash
```

截至 2026-09-14，官方文档列出的模型包括 `deepseek-flash` 和 `deepseek-v4-pro`；请以账户与当前文档实际可用的 ID 为准。代码不限制模型名称，也不套用旧版本的 token 上限。

此预设使用 `json_object`，并显式关闭思考模式，便于先跑通对话和写章。需要思考时增加：

```dotenv
CHAT_THINKING=enabled
CHAT_REASONING_EFFORT=low
```

`CHAT_REASONING_EFFORT` 可选 low/high/max，未设置时沿用服务商默认值。开启思考会消耗输出预算，需结合模型上限设置 `CHAT_MAX_OUTPUT_TOKENS` 和超时。

## 代理／聚合平台配置

填该平台提供的 Chat 地址、平台密钥和模型 ID；模型 ID 可能带厂商前缀或是部署 ID：

```dotenv
NOVEL_MODEL_PROVIDER=chat
CHAT_PRESET=deepseek
CHAT_BASE_URL=https://proxy.example.com/v1
CHAT_API_KEY=replace-with-your-proxy-key
CHAT_MODEL=replace-with-the-platform-model-id
```

上述预设适用于代理透传 DeepSeek 格式的情况。若代理提供标准化 Chat 格式，使用 `CHAT_PRESET=generic` 并按其文档覆盖能力；例如仅支持 JSON Object 且不接受 thinking 扩展：

```dotenv
CHAT_PRESET=generic
CHAT_JSON_MODE=json_object
CHAT_THINKING=default
```

`default` 表示不发送思考开关，由接口决定；`disabled` 会显式发送 DeepSeek 格式的关闭开关。`enabled/disabled` 使用 `thinking: { type: ... }`，不自动翻译为其他厂商的 `enable_thinking` 等扩展字段。不要给不支持此字段的平台启用它。

预设从不改写地址、挑选模型、借用其他平台密钥或在失败后切换服务。当前部署一次选用一套配置；更换配置后重启服务。

## 地址与能力选项

| `CHAT_BASE_URL` 写法 | 实际请求路径 |
| --- | --- |
| `https://host.example` | `/v1/chat/completions` |
| `https://host.example/v1` | `/v1/chat/completions` |
| `https://host.example/compatible-mode/v1` | `/compatible-mode/v1/chat/completions` |
| `https://host.example/api/v3/` | `/api/v3/chat/completions` |
| `https://host.example/custom/chat/completions` | 原路径直接使用 |

路径前缀后不会再自动插入 `/v1`。若某代理要求 `/proxy/v1/chat/completions`，请填 `/proxy/v1` 或完整 endpoint。地址不能包含用户名、密码、查询参数或片段；密钥仅在 Authorization 请求头发送。

| 变量 | 可用值与默认行为 |
| --- | --- |
| `CHAT_PRESET` | `generic`（默认）／`deepseek`；只影响 JSON 与思考默认值 |
| `CHAT_JSON_MODE` | `json_schema`／`json_object`／`prompt`；generic 默认 schema，deepseek 默认 object |
| `CHAT_THINKING` | `default`／`enabled`／`disabled`；generic 默认 default，deepseek 默认 disabled |
| `CHAT_REASONING_EFFORT` | `default`／`low`／`high`／`max`；默认不传，指定强度需 thinking=enabled |
| `CHAT_MAX_OUTPUT_TOKENS` | 可选正整数；每次取调用预算与此上限的较小值。未设置不额外限额；C4 默认 16000，C5 默认 4000，主 Agent 默认 2048 |
| `CHAT_STREAM` | `auto`／`always`／`never`；默认 auto，实际输出预算大于 8192 时请求 SSE |
| `CHAT_STREAM_INCLUDE_USAGE` | `true`／`false`，默认 true；false 时省略 stream_options，适用于不接受该扩展的代理 |
| `CHAT_TIMEOUT_MS` | 1–2147483647 范围内的整数，默认 300000 毫秒 |

显式变量优先于预设；空的可选变量视为未设置。无效值在发送请求前报错，不会自动回退。`CHAT_THINKING` 与 `CHAT_REASONING_EFFORT` 独立于原有 Claude 调用参数，避免 C4/C5 的 Claude 设置被误传到其他模型。

`json_schema` 请求结构化 schema；`json_object` 请求 JSON 对象并在提示中提供完整 schema；`prompt` 仅通过提示约束 JSON，不发送 response_format。三种方式均保留本地声明解析、原文引用和业务检查。prompt 适用于不接受 response_format 的兼容接口，格式稳定性依赖模型本身。

## 运行与恢复

建议 Node.js 24 LTS，最低 22.9.0。服务与实测命令都会加载 `.env.local`，已有同名进程环境变量优先。已有 Gemini 配置不必增加任何变量。

```sh
npm run web:build
npm run serve -- data/your-project
```

打开 `http://127.0.0.1:5174/chat` 进行对话。写章仍需已准备的设定、人物、地点与确认节拍。真实单章测试可运行：

```sh
npm run acceptance:chat
```

此命令会产生真实 API 用量，并在独立 `data/chat-smoke-日期-随机后缀/` 作品中执行“正文 → 声明 → 检查 → 测试作品内采用 → 下一章读取”。不会覆盖已有作品或继续生成第二章，正文、结果与用量会保存。退出码 0 为流程通过，2 为需修改，1 为失败。

主 Agent 保存完整 Chat 消息，包含工具结果、最终 assistant 的 reasoning_content 和工具签名；内部字段不返回 Web API。旧对话或切换模型时，可见文字会作为上下文接续，旧模型的内部字段不发往新目标。完整回放会增加上下文用量，目前没有自动压缩或跨进程锁。

章节草稿恢复要求模型、端点和思考配置一致；更改这些配置后应恢复原配置或另写一版。密钥轮换、JSON 模式、输出限额和超时调整不改变会话目标，因此可在修正 JSON 能力配置后恢复已有正文的 C5。错误、拒绝、截断和资源不足均保留明确状态，客户端不自动重试或切换模型。

## 验证范围

本轮通过本地 HTTP 协议和完整工作流测试，覆盖 DeepSeek 风格的 JSON Object／思考模式、代理地址前缀、SSE、工具回放、跨 Session 恢复和旧 Gemini 默认请求。**尚未使用 DeepSeek 官方凭证完成真实 API 实测**，也未验证所有国内厂商。此前 Gemini 代理的真实单章结果见 [Gemini chat 记录](gemini-chat.md)。

Chat 用量按服务商返回原样记录。代码里的 `official=false` 表示不符合 Claude 官方缓存验收口径，即使使用 DeepSeek 官方 API 也保持该值；不能用它判断国内厂商接入是否官方。

参考：[DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Mode](https://api-docs.deepseek.com/guides/json_mode)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。
