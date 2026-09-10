# novel-forge

基于 TypeScript、Claude SDK 和 React 的小说创作 Agent 项目，主要参考 [OpenFic](https://github.com/syrizelink/OpenFic)，持续探索作者通过对话创作、通过结构视图监督长篇小说的体验。

当前代码包含章节生成与结构声明、规则检查、事件存储、告警计算，以及本地 Web 阅读工作区。Web 已有首页、伏笔时间线、情节线、人物弧线、关系图、正文定位和章节体检。对话式创建作品、写章、修订、按版本采用和任务恢复仍在设计与接入阶段。

## 首次运行

建议使用 Node.js 22 或以上版本及 npm。以下命令用于新克隆的目录：

```sh
git clone https://github.com/xxxwonking/novel-forge.git
cd novel-forge
npm ci
npm run seed
npm run web:build
npm run serve
```

打开 `http://127.0.0.1:5174`。演示包含模板生成的 52 章，用来观察结构视图和告警；运行演示不需要模型 API。

`npm run seed` 会写入 `data/demo`，已有演示或作品数据时应选用新的目录，例如 `npm run seed -- data/demo-new`，然后用 `npm run serve -- data/demo-new` 打开。作品数据保存在本地 `data/`，不纳入 Git。

## 开发与检查

开发时在两个终端分别运行 `npm run serve` 和 `npm run web`，再打开 `http://localhost:5173`。Vite 将 API 请求转发到本地服务的 5174 端口。

```sh
npm run typecheck
npm test
npm run web:build
```

本地服务当前仅监听 `127.0.0.1`，尚未提供用户登录。`npm run acceptance:m1` 是单独的真实模型验收流程，会调用模型；它不属于上面的演示与常规检查。

## 目录与设计记录

| 位置 | 内容 |
| --- | --- |
| `src/chapter/`、`src/context/`、`src/client/` | 章节流程、上下文装配和 Claude 接入 |
| `src/beat/`、`src/gate/`、`rules.yaml` | 章节规划约束与检查规则 |
| `src/store/`、`src/alerts/`、`src/anchor/`、`src/view/` | 小说状态、告警、正文定位和结构视图 |
| `src/server/`、`web/` | 本地 API 和 Web 工作区 |
| `src/harness/`、`test/` | 演示与验收脚本、自动化测试 |

后续方向见[首版用户流程草案](docs/superpowers/specs/2026-09-09-novel-forge-user-flow-design.md)、[用户流程与现有能力映射](docs/superpowers/specs/2026-09-09-novel-forge-user-flow-capability-map.md)和[工作记忆](MEMORY.md)。设计建议、源码实现和实际验收结果在记录中分别标注。
