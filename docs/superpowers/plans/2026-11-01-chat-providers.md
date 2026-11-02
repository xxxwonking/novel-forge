# 对话体验与多供应商实施计划

**Goal:** 提供独立对话、失败手动重发、复制与历史管理；页面配置OpenAI兼容、Anthropic和Gemini原生，保留环境变量入口。

**Architecture:** 主代理独立执行，不派生代理。基于PR #41当前交付建立独立工作树，不改master或自动合并。会话沿用作品内原子文件，旧conversation.json无损兼容；请求ID与明确失败状态保护工具副作用。供应商保存在工作区隐藏文件，仅服务端读取密钥，不进入作品备份。每个任务固定客户端，不在执行中切换供应商，仍经统一积分闸门和计量。

**Tech Stack:** Node24、TypeScript、React/shadcn/Radix、Lucide、现有Anthropic SDK与fetch；Vitest、Playwright。

## Chunk 1：对话状态与重发

- [x] 在test/conversation-sessions.test.ts先验证旧历史兼容、新建/切换/重命名、谋篇隔离、备选想法保留、并发会话与请求去重。
- [x] 扩展src/agent/types.ts、conversation-store.ts、service.ts和tool-exec.ts：会话作用域、请求收据、失败/截断状态、仅安全回合可重试。执行过写工具的失败不得整轮重放。
- [x] src/server/state.ts、api.ts接入会话端点；完整会话和签名只在服务端保存。
- [x] 运行相关Vitest，确认失败再实现、通过后继续。

## Chunk 2：供应商与协议

- [x] test/provider-settings.test.ts、gemini-client.test.ts先覆盖凭证不回显、空密钥保留、默认切换、新任务生效、调用计量、地址/重定向/错误脱敏。
- [x] src/client/providers.ts持久化与验证；复用ChatClient/ClaudeClient，新增gemini.ts支持原生文本、工具及签名回放、结构化声明、流式/拒绝/截断/用量。
- [x] Workspace/HTTP接入全局配置端点和显式连接测试；原环境不覆盖，恢复环境配置可见。
- [x] 现有ProjectSession/ChapterWriter获取新配置时保持当前任务客户端固定，估价使用实际选择模型。

## Chunk 3：页面、验收与交付

- [x] Chat.tsx及ChatMessages.tsx添加新对话、会话历史、重命名、消息复制、失败提示与手动重试；桌面紧凑工具栏，手机折叠历史，输入草稿切换保护。
- [x] 新增Providers.tsx及路由/导航：三协议多配置、模型/地址/密钥/高级能力、默认选择、连接测试、保留密钥状态，沿用shadcn设计。
- [x] test/e2e/chat-controls.spec.ts及providers.spec.ts覆盖实际API、剪贴板、刷新、失败重发不重复执行、窄屏/焦点/无障碍；禁用真实模型，所有数据隔离。
- [x] 自审、完整测试/类型/构建与浏览器、文档完成。真实中转仅做只读测试，原小说不变；真机依用户决定另行验收。

交付更新同一PR #41；提交推送和最终远端head状态以该PR实时Checks核验。结果见 `docs/reports/2026-11-01-chat-providers.md`。

验证命令：`npm test -- test/conversation-sessions.test.ts test/provider-settings.test.ts test/gemini-client.test.ts`，`npm run typecheck`，`npm test`，`npm run web:build`，`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e`。只对具体失败定位修复，最终记录真实通过数与未验证的供应商。
