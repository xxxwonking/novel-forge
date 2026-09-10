/**
 * HTTP 传输层。Node 内置 `http`，不引 Express —— 十几个端点用不上路由框架，
 * 而少一个依赖就少一处需要跟着升级的东西（§8.3 抽象做薄）。
 *
 * ⚠ **无鉴权，绑 127.0.0.1。** 这些端点能读写用户的全部创作资产（正文、
 * 人物设定、伏笔），一旦监听 0.0.0.0 就是把整本书对局域网公开。要对外提供
 * 服务必须先加登录。
 *
 * 静态资源：优先服务 `web/dist`（生产构建）。没有构建产物时只提供 API，
 * 开发期由 Vite 的 dev server 代理过来（见 web/vite.config.ts）。
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { ProjectSession } from "./state.js";
import { handleAsync, type ApiRequest } from "./api.js";
import type { ChapterWriterOptions } from "./chapter-writer.js";

const LOCALHOST = "127.0.0.1";

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface ServeOptions extends ChapterWriterOptions {
  readonly projectRoot: string;
  readonly port: number;
  /** 静态资源目录。不存在则只提供 API。 */
  readonly staticDir?: string;
}

export function serve(options: ServeOptions): ReturnType<typeof createServer> {
  const session = new ProjectSession(options.projectRoot, undefined, options);
  const staticDir = options.staticDir !== undefined ? resolve(options.staticDir) : undefined;

  const server = createServer((req, res) => {
    void route(session, staticDir, req, res).catch((e: unknown) => {
      send(res, 500, { error: (e as Error).message });
    });
  });

  server.listen(options.port, LOCALHOST, () => {
    const where = `http://${LOCALHOST}:${options.port}`;
    process.stdout.write(`novel-forge 已启动：${where}\n项目：${options.projectRoot}\n`);
    if (staticDir === undefined || !existsSync(staticDir)) {
      process.stdout.write("（未找到前端构建产物，当前只提供 /api）\n");
    }
  });

  return server;
}

async function route(
  session: ProjectSession,
  staticDir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${LOCALHOST}`);

  if (url.pathname.startsWith("/api/")) {
    const apiRequest: ApiRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body: req.method === "POST" ? await readJson(req) : undefined,
    };
    const result = await handleAsync(session, apiRequest);
    send(res, result.status, result.body);
    return;
  }

  if (staticDir !== undefined) {
    serveStatic(staticDir, url.pathname, res);
    return;
  }
  send(res, 404, { error: "没有前端构建产物；用 npm run web 起开发服务器" });
}

/**
 * 静态文件。路径穿越防护是必须的 —— 这个进程能读用户主目录下的一切，
 * 而 `GET /../../.ssh/id_rsa` 是最基本的探测。
 */
function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  const rel = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/u, "");
  let file = resolve(join(root, rel));

  if (!file.startsWith(root)) {
    send(res, 403, { error: "路径越界" });
    return;
  }
  if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
  // SPA 回退：前端路由的深链接（/views/foreshadow）要落到 index.html。
  if (!existsSync(file)) file = join(root, "index.html");
  if (!existsSync(file)) {
    send(res, 404, { error: "未找到" });
    return;
  }

  res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
}

/** 请求体上限：正文可能几万字，但节拍表与动作请求都很小。 */
const MAX_BODY = 4 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY) throw new Error("请求体过大");
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`请求体不是合法 JSON：${(e as Error).message}`);
  }
}
