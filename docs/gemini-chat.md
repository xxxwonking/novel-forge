# 使用 Gemini chat 代理写章

章节服务支持通过 `/v1/chat/completions` 调用代理提供的 Gemini 文本模型，模型名使用代理返回的 ID。LangGraph、写作资料、草稿和采用流程复用现有实现。

## 本地配置

建议使用 Node.js 24 LTS，最低需要 22.9.0（启动脚本使用 `--env-file-if-exists`）。将根目录 `.env.example` 复制为 `.env.local`，填入自己的连接信息：

```dotenv
NOVEL_MODEL_PROVIDER=chat
CHAT_BASE_URL=https://proxy.example.com/v1
CHAT_API_KEY=your-api-key
CHAT_MODEL=gemini-3-flash
```

`CHAT_BASE_URL` 可使用服务根地址或以 `/v1` 结尾的地址。`.env.local` 已被 Git 忽略，`npm run serve` 和 `npm run acceptance:chat` 会加载它；进程已有同名环境变量时以进程环境为准。不要将真实配置写入 `.env.example`。

chat 配置缺失或请求失败会明确报错。未设置 `NOVEL_MODEL_PROVIDER` 的旧环境仍使用 Claude 客户端；进行本轮 Gemini 测试时应明确设置 `chat`。

## 单章实测

```sh
npm run acceptance:chat
```

命令会调用真实模型。每次在 `data/chat-smoke-日期-随机后缀/` 创建新的《雨夜账册》测试作品，通过写章 API 生成一章，并保存：

- `drafts/ch1/ch1d1.txt`：生成的正文。
- `report.md`：状态、字数与检查结果。
- `report.json`：检查详情和代理返回的用量。
- 项目资料和内部草稿会话，用于后续查看或恢复。

通过检查的 ready 稿会在这个测试作品内采用，再验证下一章能读取该正文；不会继续生成第二章。未通过检查或生成失败时保留结果。退出码 0 表示本次流程通过，2 表示正文需要修改，1 表示任务或运行失败。

可把输出父目录作为参数，例如 `npm run acceptance:chat -- C:/path/to/test-data`。该命令始终新建作品，不覆盖同级已有目录。用 `npm run serve -- <测试作品路径>` 可打开其中的阅读视图；写作结果界面仍待开发。

## 协议与恢复

- C4 支持工具往返和 SSE 长输出，C5 请求 JSON schema；所有声明仍经过原有解析和检查。
- 原始 assistant 消息连同代理的工具签名、reasoning 等内部字段随草稿保存，供工具后续轮次及 C5 恢复；读取草稿 API 不返回内部会话。
- 更换模型或端点后，已有 chat 会话不能直接恢复；使用原配置恢复该稿，或明确另建草稿。密钥轮换不改变会话目标标识。
- Claude 专用的 thinking、effort 和缓存标记不会发送到 chat 接口。代理的模型别名可能自行决定推理设置。
- 用量按代理返回记录；不同服务对总量和推理 token 的口径可能不同。此实测不替代 `acceptance:m1` 的 Claude 官方缓存验收。

现有阅读演示的下一章节拍及设定仍需准备；本脚本使用完整的独立测试资料。常规 `npm test` 仅使用假模型/本地 HTTP 服务。

## 2026-09-10 实测记录

使用用户代理提供的 `gemini-3-flash`，实际完成工具往返、SSE 正文生成、结构声明、规则检查、测试作品内采用和第二章读取正文。正文为 2287 字，目标范围 2100–2650 字。

首次 C5 响应使用 `tool_calls: null` 表示没有工具调用，触发了客户端格式错误；兼容修复后，从已保存的 `ch1d1` 恢复，仅重跑一次 C5，正文保持不变。恢复后草稿为 `ready`，采用与下一章资料装配通过。没有生成第二章，也没有调用 Claude。

本次检查保留了两条提示和两条警告：确认信息事件是否为新线索、事件权重偏高、加权事件密度偏高。现有规则允许该稿采用，未放宽检查规则。这次实测证明单章流程可运行，连续创作质量仍待验证。

本地作品位于 `data/chat-smoke-2026-09-10-4xJ2NV/`。`report.md` / `report.json` 保留首次失败记录，`report-resume.md` / `report-resume.json` 记录修复后的恢复验证，正文在 `drafts/ch1/ch1d1.txt`。这些产物和真实配置均被 Git 忽略。

随后在 Chromium 中验证首页、全部提示、四种结构视图、正文与体检，确认显示 2287 字，点击情节节点会滚动到高亮原文，未发现脚本错误或失败请求。相关报告和截图保存在同一作品目录，见 `web-report.json` 及 `web-*.png`。网页写章/采用入口仍待接入。
