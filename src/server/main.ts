/**
 * 服务端入口。`npm run serve [目录] [端口]`
 *
 * 目录可以是单个作品（含 setting.json，如 `data/demo`）或一个工作区
 * （其下各子目录为一部作品）。不存在则按空工作区创建。
 */

import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { serve } from "./http.js";

const DEFAULT_ROOT = "data/demo";
const DEFAULT_PORT = 5173 + 1;

const projectRoot = resolve(process.argv[2] ?? DEFAULT_ROOT);
const port = Number(process.argv[3] ?? DEFAULT_PORT);

mkdirSync(projectRoot, { recursive: true });

serve({ projectRoot, port, staticDir: resolve("web/dist") });
