/**
 * 服务端入口。`npm run serve [作品目录或工作区目录] [端口]`
 *
 * 默认从 ./data 打开作品列表，允许空目录；传入旧作品目录仍直接打开该作品。
 */

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { serve } from "./http.js";

const DEFAULT_ROOT = "data";
const DEFAULT_PORT = 5173 + 1;

const root = resolve(process.argv[2] ?? DEFAULT_ROOT);
const port = Number(process.argv[3] ?? DEFAULT_PORT);

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write("端口必须是 0 到 65535 之间的整数。\n");
  process.exit(1);
}

const isProject = existsSync(join(root, "setting.json"));
serve({
  workspaceRoot: isProject ? dirname(root) : root,
  ...(isProject ? { projectRoot: root } : {}),
  port, staticDir: resolve("web/dist"),
});
