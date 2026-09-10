/**
 * 服务端入口。`npm run serve [项目目录] [端口]`
 *
 * 默认项目目录是 `./data/demo`（`npm run seed` 生成的验收样本）。
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "./http.js";

const DEFAULT_ROOT = "data/demo";
const DEFAULT_PORT = 5173 + 1;

const projectRoot = resolve(process.argv[2] ?? DEFAULT_ROOT);
const port = Number(process.argv[3] ?? DEFAULT_PORT);

if (!existsSync(projectRoot)) {
  process.stderr.write(`项目目录不存在：${projectRoot}\n先跑 npm run seed 生成验收样本。\n`);
  process.exit(1);
}

serve({ projectRoot, port, staticDir: resolve("web/dist") });
