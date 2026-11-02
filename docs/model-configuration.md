# 模型配置：官方 API 与代理／聚合平台

国内模型官方 API 和代理／聚合平台可使用 Chat Completions，另支持 Anthropic Messages 与 Gemini 原生。模型 ID 不限于 Gemini，选择账户实际可用、支持文本及工具调用的模型即可。写章和主 Agent 共用当前默认供应商，Anthropic 可单独填写审查模型。

## 页面配置（推荐）

作品库或作品导航进入“AI 供应商”。添加配置，填写协议、API地址、模型ID和密钥；保存后设为默认。可保留多个配置、显式测试连接、编辑与删除；当前默认需先切换后删除。环境配置可复制为可编辑副本，密钥仅在服务端复制，原环境不变。编辑已有配置时密钥输入框留空即保留原值。

配置保存在工作区 `.model-providers.json`，不进入作品目录或Git；POSIX文件权限0600。公开API只返回是否保存密钥，不回显密钥。备份/导入也明确排除此凭证文件。当前仍是回环地址的单用户服务，不将这套本机配置当作多租户密钥管理。

页面切换/修改默认配置对新请求生效，已提交的调用、对话回合和章节任务持有原客户端，不会中途换模型。恢复旧任务仍需模型与目标一致；配置失败不会回退其他供应商。连接测试发出一条最多32输出tokens的文本请求，经当前作品的积分闸门计量；它不证明工具、结构化输出或长篇质量全部可用。未选择作品时仍可保存配置，测试连接需先选作品。

Chat高级选项可分别选择JSON约束、流式和用量统计、DeepSeek思考扩展、超时与输出限额。Gemini/Anthropic原生保留各自协议，不套用Chat扩展。SDK和现有业务抽象复用，没有新增供应商SDK依赖。

## 支持的接口格式

| 接口格式 | 配置与范围 |
| --- | --- |
| OpenAI 兼容 Chat Completions（`/chat/completions`） | `NOVEL_MODEL_PROVIDER=chat`；适用于 DeepSeek 官方及提供此协议的国内厂商／代理 |
| Anthropic Messages | `NOVEL_MODEL_PROVIDER=claude`；保留现有 Claude 客户端 |
| Gemini原生 `generateContent` / `streamGenerateContent` | 页面选择“Gemini 原生”，或 `NOVEL_MODEL_PROVIDER=gemini` |
| Responses、本地模型权重文件 | 当前未实现；本地推理服务如提供兼容 Chat API，可使用 chat 接入 |

DeepSeek 的官方格式已有专门预设。通义千问、Kimi、GLM、豆包等，需使用各平台的 **Chat 兼容地址与具体模型 ID**，确认该模型支持 tools、所选 JSON 格式和输出长度。接口兼容不代表所有模型的工具／思考能力相同，也不代表已逐一完成真实测试。LangGraph 继续负责流程编排，没有新增 LangChain 模型抽象。

## Gemini原生与Anthropic自定义模型

Gemini原生环境入口：

```dotenv
NOVEL_MODEL_PROVIDER=gemini
GEMINI_BASE_URL=https://generativelanguage.googleapis.com/v1beta
GEMINI_API_KEY=replace-with-your-api-key
GEMINI_MODEL=replace-with-an-available-gemini-model-id
```

模型ID不包含 `models/` 前缀，API地址是版本前缀。客户端使用 `x-goog-api-key` 请求头，不把密钥放进URL；支持文本SSE、函数调用/结果、JSON Schema、用量、拒绝与截断。原始parts及thoughtSignature仅在匹配目标的内部历史中回放，页面不展示思考/签名。请求失败不自动重试或切换协议。实现依据：[GenerateContent参考](https://ai.google.dev/api/generate-content)、[签名回放规则](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)。当前未接入Vertex、OAuth或Interactions。

Anthropic页面可填写创作及审查两个模型；审查留空时复用创作模型。环境变量模式可设置 `ANTHROPIC_MODEL` 和可选的 `ANTHROPIC_JUDGE_MODEL`；不填自定义模型则保留项目原角色分工。页面配置使用零SDK自动重试，所有调用仍记录已返回用量；旧环境入口保持原SDK策略。

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

预设从不改写地址、挑选模型、借用其他平台密钥或在失败后切换服务。环境变量更换需重启；页面配置无需重启，对新请求生效。

Chat 与 Claude 客户端均不自动跟随 HTTP 重定向，以免把凭证转发给其他端点。代理返回 3xx 时，应按平台文档直接配置最终 API 地址。Claude 错误信息会遮蔽配置中的 API key 和 Bearer token，再返回任务或页面。

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
| `CHAT_MAX_OUTPUT_TOKENS` | 可选正整数；每次取调用预算与此上限的较小值。未设置不额外限额；C4 默认 16000，C5 默认 4000，主 Agent 默认 8192 |
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

打开 `http://127.0.0.1:5174`，选择作品后进入“对话”。写章仍需已准备的设定、人物、地点与确认节拍。真实单章测试可运行：

```sh
npm run acceptance:chat
```

此命令会产生真实 API 用量，并在独立 `data/chat-smoke-日期-随机后缀/` 作品中执行“正文 → 声明 → 检查 → 测试作品内采用 → 下一章读取”。不会覆盖已有作品或继续生成第二章，正文、结果与用量会保存。退出码 0 为流程通过，2 为需修改，1 为失败。

主 Agent按会话保存完整模型消息，包含工具结果、Chat reasoning_content 和原生工具签名；内部字段不返回 Web API。新对话隔离模型上下文，作品资料、正式正文与全书备选想法仍保留。旧对话或切换模型时，可见文字会作为上下文接续，旧模型的内部字段不发往新目标。完整回放会增加上下文用量，目前没有自动压缩或跨进程锁。

新页面发送稳定requestId，同一请求重发优先返回已保存收据。模型失败或截断明确标记；只有未尝试写工具的最后一条失败可以直接手动重试，不重复保存用户消息。已经执行/尝试写工具的回合保留effect并要求先核对；断线、服务中断后执行结果未知的收据也阻止重复执行，可同步历史或核对任务后新开对话。旧版无收据失败只提供编辑恢复入口，不推断它从未执行过工具。

章节草稿恢复要求模型、端点和思考配置一致；更改这些配置后应恢复原配置或另写一版。密钥轮换、JSON 模式、输出限额和超时调整不改变会话目标，因此可在修正 JSON 能力配置后恢复已有正文的 C5。错误、拒绝、截断和资源不足均保留明确状态；Chat 客户端不自动重试，两种客户端均不自动切换模型。

Chat／Claude 正文流中断时，已收到的可见文本会保留为未完成片段；Chat 的 aborted／资源不足也保留已有正文。片段须继续完成后才能进入结构核对，思考内容和未闭合工具参数不会作为正文或可执行工具。原生 Claude SDK 的重试策略与 Chat 客户端不同；任务层不会在失败后另建无限重试循环。

## 验证范围

本轮通过本地 HTTP 协议和完整工作流测试，覆盖 DeepSeek 风格的 JSON Object／思考模式、代理地址前缀、SSE、工具回放、跨 Session 恢复和旧 Gemini 默认请求。**尚未使用 DeepSeek 官方凭证完成真实 API 实测**，也未验证所有国内厂商。此前 Gemini 代理的真实单章结果见 [Gemini chat 记录](gemini-chat.md)。

Chat 用量按服务商返回原样记录。代码里的 `official=false` 表示不符合 Claude 官方缓存验收口径，即使使用 DeepSeek 官方 API 也保持该值；不能用它判断国内厂商接入是否官方。

参考：[DeepSeek Chat API](https://api-docs.deepseek.com/api/create-chat-completion)、[JSON Mode](https://api-docs.deepseek.com/guides/json_mode)、[Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode)。
