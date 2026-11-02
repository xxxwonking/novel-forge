import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../../src/server/http.js";
import { ProjectStore } from "../../src/store/persist.js";
import { ProviderStore } from "../../src/client/providers.js";
import { writingSnapshot } from "../writing-fixtures.js";
import { ConversationStore } from "../../src/agent/conversation-store.js";
export async function chatFixture(options: { legacyFailure?: boolean; holdResponse?: boolean; reply?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "nf-chat-browser-"));
  new ProjectStore(join(root, "chat-book")).save(writingSnapshot());
  if (options.legacyFailure)
    new ConversationStore(join(root, "chat-book")).appendExchange(
      { role: "user", text: "看看现在写到哪了", at: new Date().toISOString() },
      {
        role: "agent",
        text: "（模型调用失败：fetch failed）",
        at: new Date().toISOString(),
      },
    );
  let release = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  if (!options.holdResponse) release();
  let calls = 0,
    failed = false;
  const upstream = createServer(async (req, res) => {
    let raw = "";
    for await (const b of req) raw += b;
    const body = JSON.parse(raw);
    calls++;
    const text = JSON.stringify(body.messages ?? body.contents ?? body);
    res.setHeader("content-type", "application/json");
    if (text.includes("模拟故障") && !failed) {
      failed = true;
      res.statusCode = 503;
      res.end(JSON.stringify({ error: { message: "测试中转暂时不可达" } }));
      return;
    }
    await gate;
    res.end(
      JSON.stringify({
        id: `reply-${calls}`,
        model: "test-model",
        choices: [
          {
            message: {
              role: "assistant",
              content: options.reply ?? "模型已回复，计划仍由你确认。",
            },
            finish_reason: "stop",
          },
        ],
        usage: { prompt_tokens: 8, completion_tokens: 5 },
      }),
    );
  });
  upstream.listen(0, "127.0.0.1");
  await once(upstream, "listening");
  const endpoint = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/v1`;
  const store = new ProviderStore(root);
  const profile = store.upsert({
    name: "测试供应商",
    protocol: "chat",
    baseURL: endpoint,
    apiKey: "only-test-secret",
    model: "test-model",
  });
  store.select(profile.id);
  const app = serve({
    workspaceRoot: root,
    port: 0,
    staticDir: resolve("web/dist"),
  });
  await once(app, "listening");
  const url = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;
  return {
    url,
    endpoint,
    profile,
    calls: () => calls,
    release,
    close: async () => {
      for (const s of [app, upstream]) {
        s.closeAllConnections();
        await new Promise<void>((r) => s.close(() => r()));
      }
      rmSync(root, { recursive: true, force: true });
    },
  };
}
