# Gemini chat 接入实施计划

> 执行方式：使用 executing-plans，由当前代理独立实现和复核；用户已明确禁止子代理，并在提供配置及选择 chat 接口后要求继续。

**目标：** 通过用户代理站的 `/v1/chat/completions` 运行现有章节任务，用 Gemini 做单章真实验证，暂不调用 Claude。

**架构：** 以最小 `ModelClient` 契约连接现有任务服务；chat 客户端负责消息转换、SSE 和响应分类。保留草稿快照与事实边界，通过开发环境配置选择模型。

**技术：** TypeScript、Node fetch/HTTP、Vitest、现有 LangGraph JS；不新增模型框架依赖。

设计依据：`docs/superpowers/specs/2026-09-10-gemini-chat-design.md`。基线 `e1c963b`，开发目录 `C:/Users/Administrator/Desktop/novel-forge-worktrees/gemini-chat`，分支 `feat-gemini-chat`；基线 540 项测试通过。

## Task 1：chat 客户端

文件：新增 `src/client/model.ts`、`chat.ts`、`chat-wire.ts`、`chat-stream.ts`、`test/chat-client.test.ts`。

- [ ] 先写本地 HTTP 测试：配置地址/模型、消息及工具转换、JSON schema、原始 assistant 元数据往返、截断/拒绝/错误、SSE 分块。
- [ ] 运行 `npm.cmd test -- --run test/chat-client.test.ts`，确认因缺少 chat 客户端失败。
- [ ] 实现契约 `interface ModelClient { readonly official: boolean; call(opts: CallOptions): Promise<CallResult> }`。
- [ ] 实现 chat 请求转换与 JSON/SSE 归一化；保留工具参数、签名及完整会话，清除错误中的密钥。
- [ ] 重跑客户端测试和 `npm.cmd run typecheck`。

## Task 2：配置与章节任务接入

文件：新增 `src/client/create.ts`、`test/model-config.test.ts`、`test/chat-chapter.test.ts`；修改 `src/server/chapter-writer.ts`、`src/task/service.ts`、`graph.ts`、`steps.ts`、`tool-exec.ts`。

- [ ] 先测试环境选择、缺配置/非法配置，以及通过 HTTP 假服务的完整章节任务与 C5 失败恢复；确认失败。
- [ ] 选择 `NOVEL_MODEL_PROVIDER=chat` 时要求 `CHAT_BASE_URL`、`CHAT_API_KEY`、`CHAT_MODEL`；其余旧配置仍使用既有 Claude 客户端，不在 chat 出错时回退。
- [ ] 仅将任务依赖类型改为 `ModelClient`，由写章入口懒加载对应客户端；保持旧假客户端注入和无配置阅读行为。
- [ ] 重跑新增集成测试、既有写章/草稿测试和类型检查，确认生成仍不自动采用。

## Task 3：本地配置与单章验收

文件：新增 `.env.example`、`src/harness/chat-smoke.ts`、`docs/gemini-chat.md`，修改 `package.json` 的启动/验收命令与 `README.md`。

- [ ] 提供无秘密的配置示例和使用说明；真实 `.env.local` 从用户本地文件读取生成，检查被 Git 忽略。
- [ ] 验收脚本明确只允许 chat provider，创建独立测试作品，运行现有写章入口并保存正文、状态、检查项和代理用量。
- [ ] 按当前规则运行一次真实单章验证；有问题时先区分适配错误与模型/规则问题，再决定必要的修复或有限重试。
- [ ] 检查通过可在该测试作品中验证采用与下一章资料装配；未通过则完整保存结果，不改变规则。

## Task 4：复核与交付

文件：`MEMORY.md`、本计划、相关说明。

- [ ] 当前代理复核协议、凭证处理、工具元数据、SSE、恢复、采用边界及本地数据路径。
- [ ] 运行 `npm.cmd test -- --reporter=dot`、`npm.cmd run typecheck`、`npm.cmd run web:build` 和 `git diff --check`。
- [ ] 更新 MEMORY，分别记录自动化验证与 Gemini 实测的实际结果、限制和下一步。
- [ ] 按已有授权提交、合入 `master`、在主目录核验并推送；保留测试产物供用户查看，安全清理开发 worktree。
