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
import { dirname, extname, join, normalize, resolve } from "node:path";
import { conversationStream, handleAsync, type ApiRequest } from "./api.js";
import type { ProjectSession } from "./state.js";
import type { ConversationStreamEvent } from "../agent/types.js";
import type { ChapterWriterOptions } from "./chapter-writer.js";
import { ChapterWriteError } from "./chapter-input.js";
import { Workspace } from "../workspace/service.js";
import { workspaceApi } from "./workspace-api.js";

const LOCALHOST = "127.0.0.1";
const BACKUP_MIME = "application/vnd.novel-forge.backup";

class HttpRequestError extends Error {
  constructor(readonly status: 400 | 403 | 413 | 415, message: string) { super(message); }
}

const MIME: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};

export interface ServeOptions extends ChapterWriterOptions {
  readonly projectRoot?: string;
  readonly workspaceRoot?: string;
  readonly port: number;
  /** 静态资源目录。不存在则只提供 API。 */
  readonly staticDir?: string;
}

export function serve(options: ServeOptions): ReturnType<typeof createServer> {
  const workspaceRoot = options.workspaceRoot ?? (options.projectRoot === undefined ? resolve("data") : dirname(resolve(options.projectRoot)));
  const workspace = new Workspace(workspaceRoot, options);
  const staticDir = options.staticDir !== undefined ? resolve(options.staticDir) : undefined;

  const server = createServer((req, res) => {
    void route(workspace, staticDir, req, res).catch((e: unknown) => {
      send(res, e instanceof ChapterWriteError || e instanceof HttpRequestError ? e.status : 500, { error: (e as Error).message });
    });
  });

  server.listen(options.port, LOCALHOST, () => {
    const address = server.address();
    const port = address !== null && typeof address !== "string" ? address.port : options.port;
    process.stdout.write(`novel-forge 已启动：http://${LOCALHOST}:${port}\n工作区：${workspaceRoot}\n`);
    if (staticDir === undefined || !existsSync(staticDir)) {
      process.stdout.write("（未找到前端构建产物，当前只提供 /api）\n");
    }
  });

  return server;
}

async function route(
  workspace: Workspace,
  staticDir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  assertLocalRequest(req);
  const url = new URL(req.url ?? "/", `http://${LOCALHOST}`);

  if (url.pathname.startsWith("/api/")) {
    if (req.method === "GET" && url.pathname === "/api/works/backup") {
      const artifact = workspace.backup({
        ...(url.searchParams.get("id") === null ? {} : { id: url.searchParams.get("id") }),
        ...(url.searchParams.get("archive") === null ? {} : { archive: url.searchParams.get("archive") }),
      });
      sendBackup(res, artifact);
      return;
    }
    if (req.method === "POST" && url.pathname === "/api/works/import") {
      const contentType = req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType !== BACKUP_MIME && contentType !== "application/octet-stream") {
        throw new HttpRequestError(415, `导入作品需要 ${BACKUP_MIME} 请求体`);
      }
      const bytes = await readBody(req, MAX_BACKUP_BODY);
      const targetId = url.searchParams.get("targetId") ?? undefined;
      send(res, 201, workspace.importBackup(bytes, { targetId }));
      return;
    }
    if (req.method === "GET" && url.pathname === "/api/export/download") {
      const session = selectedSession(workspace, req);
      const artifact = session.exports.artifact(url.searchParams.get("id"), url.searchParams.get("format"));
      sendExport(res, artifact);
      return;
    }
    if (req.method === "POST" && req.headers["content-type"]?.split(";", 1)[0]?.trim().toLowerCase() !== "application/json") {
      throw new HttpRequestError(415, "写操作需要 application/json 请求体");
    }
    const apiRequest: ApiRequest = {
      method: req.method ?? "GET",
      path: url.pathname,
      query: url.searchParams,
      body: req.method === "POST" ? await readJson(req) : undefined,
    };
    const global = workspaceApi(workspace, apiRequest);
    if (global !== null) { send(res, global.status, global.body); return; }
    const session = selectedSession(workspace, req);
    if (req.method === "POST" && url.pathname === "/api/conversation/stream") {
      await streamConversation(session, apiRequest.body, res);
      return;
    }
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

function selectedSession(workspace: Workspace, req: IncomingMessage): ProjectSession {
  const header = req.headers["x-novel-project"];
  if (Array.isArray(header)) throw new ChapterWriteError(400, "每个请求只能选择一本作品");
  let projectId: string | undefined;
  try { projectId = header === undefined ? undefined : decodeURIComponent(header); }
  catch { throw new ChapterWriteError(400, "作品 ID 无效"); }
  return workspace.project(projectId);
}

/** 绑定回环地址仍会收到浏览器跨站请求；同时限制 Host 与 Origin。 */
function assertLocalRequest(req: IncomingMessage): void {
  const host = req.headers.host;
  if (host === undefined || !/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/iu.test(host)) {
    throw new HttpRequestError(403, "仅允许通过本机地址访问");
  }
  let origin: string;
  try { origin = new URL(`http://${host}`).origin; }
  catch { throw new HttpRequestError(403, "本机地址无效"); }
  // Vite 代理显式保留浏览器的 Host，开发和生产页面均按实际同源地址校验。
  if (req.headers.origin !== undefined && req.headers.origin !== origin) {
    throw new HttpRequestError(403, "不允许其他网站访问本机作品接口");
  }
}

/**
 * 静态文件。路径穿越防护是必须的 —— 这个进程能读用户主目录下的一切，
 * 而 `GET /../../.ssh/id_rsa` 是最基本的探测。
 */
function serveStatic(root: string, pathname: string, res: ServerResponse): void {
  let decoded: string;
  try { decoded = decodeURIComponent(pathname); }
  catch { throw new HttpRequestError(400, "路径编码无效"); }
  const rel = normalize(decoded).replace(/^(\.\.[/\\])+/u, "");
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

function sendBackup(res: ServerResponse, artifact: ReturnType<Workspace["backup"]>): void {
  res.writeHead(200, {
    "content-type": BACKUP_MIME,
    "content-length": artifact.bytes.length,
    "content-disposition": `attachment; filename="novel-forge-backup.nforge"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
    "x-content-sha256": artifact.sha256,
  });
  res.end(artifact.bytes);
}

function sendExport(res: ServerResponse, artifact: ReturnType<ProjectSession["exports"]["artifact"]>): void {
  const extension = artifact.filename.split(".").at(-1) ?? "bin";
  res.writeHead(200, {
    "content-type": artifact.mime,
    "content-length": artifact.bytes.length,
    "content-disposition": `attachment; filename="novel-forge-export.${extension}"; filename*=UTF-8''${encodeURIComponent(artifact.filename)}`,
    "x-content-sha256": artifact.sha256,
  });
  res.end(artifact.bytes);
}

/**
 * 对话的 SSE 通道：每个事件一行 `data:` JSON。头部在第一个事件时才写，
 * 这样开始前的失败（缺 text、未配置模型）仍能返回带状态码的 JSON。
 * 浏览器中途断开时服务端继续完成并保存回合，只是不再写入已关闭的响应。
 */
async function streamConversation(session: ProjectSession, body: unknown, res: ServerResponse): Promise<void> {
  let headersSent = false;
  const emit = (event: ConversationStreamEvent): void => {
    if (res.destroyed || res.writableEnded) return;
    if (!headersSent) {
      headersSent = true;
      res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" });
    }
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };
  const failed = await conversationStream(session, body, emit);
  if (failed !== null) { send(res, failed.status, failed.body); return; }
  if (!res.destroyed && !res.writableEnded) res.end();
}

/** 请求体上限：正文可能几万字，但节拍表与动作请求都很小。 */
const MAX_BODY = 4 * 1024 * 1024;
/** 压缩包上传上限；解压后的独立上限由 workspace/backup.ts 负责。 */
const MAX_BACKUP_BODY = 64 * 1024 * 1024;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const text = (await readBody(req, MAX_BODY)).toString("utf8");
  if (text.trim() === "") return undefined;
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new HttpRequestError(400, `请求体不是合法 JSON：${(e as Error).message}`);
  }
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > limit) throw new HttpRequestError(413, "请求体过大");
    chunks.push(buf);
  }
  return Buffer.concat(chunks);
}
