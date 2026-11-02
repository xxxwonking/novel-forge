import { afterEach, expect, it } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProviderStore } from "../src/client/providers.js";
import { createServer } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { Workspace } from "../src/workspace/service.js";
import { ProjectStore } from "../src/store/persist.js";
import { writingSnapshot } from "./writing-fixtures.js";
import { readCreditEntries } from "../src/credits/ledger.js";
import { parseBackupPackage } from "../src/workspace/backup.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function setup() {
  const root = mkdtempSync(join(tmpdir(), "nf-provider-"));
  roots.push(root);
  return {
    root,
    store: new ProviderStore(root, {
      NOVEL_MODEL_PROVIDER: "chat",
      CHAT_BASE_URL: "http://localhost:1234/v1",
      CHAT_API_KEY: "environment-secret",
      CHAT_MODEL: "old-model",
    }),
  };
}
it("多配置持久化、默认切换，所有公开结果不回显密钥，空密钥编辑保留", () => {
  const { root, store } = setup();
  const profile = store.upsert({
    name: "中转A",
    protocol: "chat",
    baseURL: "https://example.com/v1",
    apiKey: "test-secret",
    model: "new-model",
  });
  store.select(profile.id);
  expect(store.view().activeId).toBe(profile.id);
  expect(store.modelName("judge")).toBe("new-model");
  store.upsert({ ...profile, name: "中转B", apiKey: "" });
  expect(store.createClient().conversationKey).toBeTruthy();
  expect(JSON.stringify(store.view())).not.toMatch(
    /test-secret|environment-secret/,
  );
  expect(readFileSync(join(root, ".model-providers.json"), "utf8")).toContain(
    "test-secret",
  );
  if (process.platform !== "win32")
    expect(statSync(join(root, ".model-providers.json")).mode & 0o777).toBe(
      0o600,
    );
  expect(new ProviderStore(root).view().activeId).toBe(profile.id);
  expect(() => store.remove(profile.id)).toThrow();
  store.select("environment");
  store.remove(profile.id);
  expect(store.modelName("creative")).toBe("old-model");
});
it("地址与能力选项严格校验，未保存或配置错误不回退到旧供应商", () => {
  const { store } = setup();
  for (const baseURL of [
    "file:///etc/passwd",
    "https://user:secret@example.com",
    "https://example.com?key=secret",
  ])
    expect(() =>
      store.upsert({
        name: "bad",
        protocol: "chat",
        baseURL,
        apiKey: "key",
        model: "m",
      }),
    ).toThrow();
  expect(() => store.select("missing")).toThrow();
  expect(() =>
    store.upsert({
      name: "bad",
      protocol: "chat",
      baseURL: "https://example.com",
      apiKey: "",
      model: "m",
    }),
  ).toThrow();
  expect(() =>
    store.upsert({
      name: "bad",
      protocol: "chat",
      baseURL: "https://example.com",
      apiKey: "key",
      model: "m",
      timeoutMs: -1,
    }),
  ).toThrow();
});

it("切换默认不改变已开始调用，新调用及账本使用新模型；作品备份不包含供应商密钥", async () => {
  const { root } = setup();
  const book = join(root, "book");
  new ProjectStore(book).save(writingSnapshot());
  let release = () => {};
  let arrived = () => {};
  const started = new Promise<void>((r) => {
    arrived = r;
  });
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    if (body.model === "model-a") {
      arrived();
      await new Promise<void>((r) => {
        release = r;
      });
    }
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        choices: [
          {
            message: { role: "assistant", content: body.model },
            finish_reason: "stop",
          },
        ],
        model: body.model,
        usage: { prompt_tokens: 2, completion_tokens: 1 },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  try {
    const workspace = new Workspace(root),
      store = workspace.providers;
    const a = store.upsert({
      name: "A",
      protocol: "chat",
      baseURL: `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`,
      model: "model-a",
      apiKey: "secret-a",
    });
    const b = store.upsert({
      name: "B",
      protocol: "chat",
      baseURL: a.baseURL,
      model: "model-b",
      apiKey: "secret-b",
    });
    store.select(a.id);
    const session = workspace.project("book");
    const options = {
      role: "judge" as const,
      maxTokens: 16,
      messages: [{ role: "user" as const, content: "只读测试" }],
    };
    const pending = session.getModelClient().call(options);
    await started;
    store.select(b.id);
    release();
    const first = await pending,
      next = await session.getModelClient().call(options);
    expect(first.kind !== "error" && first.message.model).toBe("model-a");
    expect(next.kind !== "error" && next.message.model).toBe("model-b");
    expect(readCreditEntries(book).map((e) => e.model)).toEqual([
      "model-a",
      "model-b",
    ]);
    writeFileSync(
      join(book, ".model-providers.json"),
      readFileSync(join(root, ".model-providers.json")),
    );
    const backup = parseBackupPackage(workspace.backup({ id: "book" }).bytes);
    expect(backup.files.map((f) => f.path)).not.toContain(
      ".model-providers.json",
    );
    expect(
      backup.files.some(
        (f) => f.bytes.includes("secret-a") || f.bytes.includes("secret-b"),
      ),
    ).toBe(false);
    expect(store.view().activeId).toBe(b.id);
  } finally {
    release();
    upstream.closeAllConnections();
    await new Promise<void>((r) => upstream.close(() => r()));
  }
});

it("环境配置可复制成可编辑供应商，密钥仅在服务端复制且原环境不变", () => {
  const { store } = setup();
  const copy = store.copyEnvironment();
  expect(copy.hasApiKey).toBe(true);
  expect(copy.model).toBe("old-model");
  expect(store.view().activeId).toBe("environment");
  expect(store.view().environment.baseURL).toBe("http://localhost:1234/v1");
  expect(JSON.stringify(store.view())).not.toContain("environment-secret");
});
