import { afterEach, describe, expect, it } from "vitest";
import { request as httpRequest, type IncomingHttpHeaders, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "../src/server/http.js";
import { fakeClient } from "./writing-fixtures.js";

const roots: string[] = [];
const servers: Server[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function start() {
  const root = mkdtempSync(join(tmpdir(), "nf-http-boundary-")); roots.push(root);
  const staticDir = join(root, "web"); mkdirSync(staticDir);
  writeFileSync(join(staticDir, "index.html"), "<p>Novel Forge</p>");
  const model = fakeClient([]);
  const server = serve({ workspaceRoot: join(root, "library"), staticDir, port: 0, client: model.client });
  servers.push(server); await once(server, "listening");
  const port = (server.address() as AddressInfo).port;
  const origin = `http://127.0.0.1:${port}`;
  const request = (path: string, body?: string | Buffer, headers: Record<string, string> = {}): Promise<{ status: number; text: string; bytes: Buffer; headers: IncomingHttpHeaders }> => new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: "127.0.0.1", port, path, method: body === undefined ? "GET" : "POST", headers: {
      ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers,
    } }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => { chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)); });
      res.on("end", () => {
        const bytes = Buffer.concat(chunks);
        resolve({ status: res.statusCode!, text: bytes.toString("utf8"), bytes, headers: res.headers });
      });
      res.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
  return { origin, request, model };
}

const idea = JSON.stringify({ title: "边界测试", idea: "仅供本地验证的作品。", genre: "mystery", platform: "unpublished", targetWords: 120000 });

describe("本地 HTTP 请求边界", () => {
  it.each(["https://external.example", "null"])("外部页面 Origin=%s 不能通过简单请求创建作品", async (origin) => {
    const service = await start();
    expect((await service.request("/api/works", idea, { origin, "content-type": "text/plain" })).status).toBe(403);
    expect(JSON.parse((await service.request("/api/workspace")).text).projects).toEqual([]);
    expect(service.model.calls).toHaveLength(0);
  });

  it("外部 Origin 即使使用 JSON 也不能写入", async () => {
    const service = await start();
    expect((await service.request("/api/works", idea, { origin: "https://external.example" })).status).toBe(403);
    expect(JSON.parse((await service.request("/api/workspace")).text).projects).toEqual([]);
  });

  it("非本机 Host 不能绕过 Origin 校验读取作品或静态页面", async () => {
    const service = await start();
    expect((await service.request("/api/workspace", undefined, { host: "external.example" })).status).toBe(403);
    expect((await service.request("/", undefined, { host: "external.example" })).status).toBe(403);
  });

  it("允许本机页面、Vite 保留 Host 的同源代理，以及无 Origin 的 JSON 客户端", async () => {
    const service = await start();
    expect((await service.request("/api/works", idea, { origin: service.origin })).status).toBe(201);
    expect((await service.request("/api/works", idea, { host: "localhost:5173", origin: "http://localhost:5173" })).status).toBe(201);
    expect((await service.request("/api/works", idea)).status).toBe(201);
  });

  it("没有 Origin 也必须使用 JSON 内容类型提交写操作", async () => {
    const service = await start();
    expect((await service.request("/api/works", idea, { "content-type": "text/plain" })).status).toBe(415);
    expect(JSON.parse((await service.request("/api/workspace")).text).projects).toEqual([]);
  });

  it("非法 JSON 返回 400，并允许后续正常请求", async () => {
    const service = await start();
    expect((await service.request("/api/works", "{")).status).toBe(400);
    expect((await service.request("/api/works", idea)).status).toBe(201);
  });

  it.each(["content-length", "transfer-encoding"])("超限的 %s 请求返回 413，不中断后续服务", async (framing) => {
    const service = await start();
    const body = "x".repeat(4 * 1024 * 1024 + 1);
    expect((await service.request("/api/works", body, { [framing]: framing === "content-length" ? String(Buffer.byteLength(body)) : "chunked" })).status).toBe(413);
    expect(JSON.parse((await service.request("/api/workspace")).text).projects).toEqual([]);
  });

  it("非法静态 URL 编码作为输入错误返回 400", async () => {
    const service = await start();
    expect((await service.request("/%broken")).status).toBe(400);
    expect((await service.request("/")).text).toContain("Novel Forge");
  });

  it("作品备份以二进制附件下载，并能上传为另一份作品", async () => {
    const service = await start();
    const created = JSON.parse((await service.request("/api/works", idea)).text) as { id: string };

    const download = await service.request(`/api/works/backup?id=${encodeURIComponent(created.id)}`);
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("application/vnd.novel-forge.backup");
    expect(download.headers["content-disposition"]).toContain("attachment");
    expect(download.headers["x-content-sha256"]).toMatch(/^[0-9a-f]{64}$/u);
    expect(download.bytes.subarray(0, 2)).toEqual(Buffer.from([0x1f, 0x8b]));

    const imported = await service.request("/api/works/import?targetId=copy-book", download.bytes, {
      "content-type": "application/vnd.novel-forge.backup",
    });
    expect(imported.status).toBe(201);
    expect(JSON.parse(imported.text)).toMatchObject({ id: "copy-book", title: "边界测试" });
    expect(JSON.parse((await service.request("/api/workspace")).text).projects.map((work: { id: string }) => work.id).sort()).toEqual(["copy-book", created.id].sort());
  });

  it("导入接口拒绝错误媒体类型、损坏包和外部 Origin", async () => {
    const service = await start();
    const broken = Buffer.from("not a backup");
    expect((await service.request("/api/works/import", broken, { "content-type": "application/json" })).status).toBe(415);
    expect((await service.request("/api/works/import", broken, { "content-type": "application/vnd.novel-forge.backup" })).status).toBe(400);
    expect((await service.request("/api/works/import", broken, {
      "content-type": "application/vnd.novel-forge.backup",
      origin: "https://external.example",
    })).status).toBe(403);
    expect(JSON.parse((await service.request("/api/workspace")).text).projects).toEqual([]);
  });
});
