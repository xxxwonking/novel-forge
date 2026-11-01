import { afterEach, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { GeminiClient } from "../src/client/gemini.js";
import { appendTurn, type CallOptions } from "../src/client/claude.js";
const servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
});
async function setup(respond: (body: any, req: any, res: any) => void) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    let text = "";
    for await (const b of req) text += b;
    const body = JSON.parse(text);
    requests.push(body);
    respond(body, req, res);
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    client: new GeminiClient({
      baseURL: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1beta`,
      apiKey: "secret-gemini",
      model: "gemini-test",
    }),
    requests,
  };
}
const options: CallOptions = {
  role: "judge",
  maxTokens: 40,
  messages: [{ role: "user", content: "你好" }],
};
it("原生工具及thoughtSignature原样回放，工具结果按名称关联，结构schema与用量正确", async () => {
  let calls = 0;
  const { client, requests } = await setup((body, req, res) => {
    expect(req.headers["x-goog-api-key"]).toBe("secret-gemini");
    expect(req.url).not.toContain("secret-gemini");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        candidates: [
          {
            content: {
              role: "model",
              parts:
                ++calls === 1
                  ? [
                      {
                        functionCall: { name: "get_overview", args: {} },
                        thoughtSignature: "private-signature",
                      },
                    ]
                  : [{ text: "完成" }],
            },
            finishReason: "STOP",
          },
        ],
        usageMetadata: {
          promptTokenCount: 12,
          candidatesTokenCount: 3,
          thoughtsTokenCount: 2,
          cachedContentTokenCount: 4,
        },
      }),
    );
  });
  const first = await client.call({
    ...options,
    tools: [
      {
        name: "get_overview",
        input_schema: { type: "object", properties: {} },
      },
    ],
  });
  expect(first.kind).toBe("ok");
  if (first.kind !== "ok") return;
  expect(first.message.stop_reason).toBe("tool_use");
  const tool = first.message.content.find((b) => b.type === "tool_use")!;
  const next = appendTurn(options.messages, first.message, [
    { type: "tool_result", tool_use_id: tool.id, content: "概览" },
  ]);
  const second = await client.call({
    ...options,
    messages: next,
    outputSchema: {
      type: "object",
      properties: { answer: { type: "string" } },
    },
  });
  expect(second.kind).toBe("ok");
  expect(requests[1].contents[1].parts[0].thoughtSignature).toBe(
    "private-signature",
  );
  expect(requests[1].contents[2].parts[0].functionResponse).toMatchObject({
    name: "get_overview",
    response: { result: "概览" },
  });
  expect(requests[1].generationConfig.responseJsonSchema).toBeTruthy();
  expect(first.message.usage).toMatchObject({
    input_tokens: 8,
    output_tokens: 5,
    cache_read_input_tokens: 4,
  });
});
it("SSE只展示可见文字，签名不泄露；截断不能执行残缺工具", async () => {
  const { client } = await setup((_b, _q, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "秘密思考", thought: true, thoughtSignature: "private" }] } }] })}\n\n`,
    );
    res.write(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "你好" }] } }] })}\n\n`,
    );
    res.end(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } })}\n\n`,
    );
  });
  let visible = "";
  const result = await client.call({
    ...options,
    onTextDelta: (t) => {
      visible += t;
    },
  });
  expect(result.kind).toBe("max_tokens");
  expect(visible).toBe("你好");
});
it("HTTP错误密钥脱敏，不跟随重定向，缺少完成原因明确失败", async () => {
  const { client } = await setup((_b, _q, res) => {
    res.statusCode = 401;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ error: { message: "secret-gemini invalid" } }));
  });
  const result = await client.call(options);
  expect(result.kind).toBe("error");
  expect(JSON.stringify(result)).not.toContain("secret-gemini");
  const broken = await setup((_b, _q, res) => {
    res.end(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text: "未完成" }] } }],
      }),
    );
  });
  expect((await broken.client.call(options)).kind).toBe("error");
});

it("重定向不发第二次请求，安全拒绝不伪造成功，断流保留已收到正文", async () => {
  let calls = 0;
  const moved = await setup((_b, _q, res) => {
    calls++;
    res.statusCode = 307;
    res.setHeader("location", "/other");
    res.end();
  });
  expect((await moved.client.call(options)).kind).toBe("error");
  expect(calls).toBe(1);
  const refused = await setup((_b, _q, res) =>
    res.end(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } })),
  );
  expect((await refused.client.call(options)).kind).toBe("refusal");
  const partial = await setup((_b, _q, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.end(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "已写片段" }] } }] })}\n\n`,
    );
  });
  const result = await partial.client.call({
    ...options,
    onTextDelta: () => {},
  });
  expect(result).toMatchObject({ kind: "error", partialText: "已写片段" });
});

it("原生SSE支持跨网络块分开的CRLF分隔符", async () => {
  const { client } = await setup((_b, _q, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(
      `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text: "完成" }] } }] })}\r`,
    );
    setTimeout(() => {
      res.write("\n\r");
      setTimeout(() => {
        res.write(
          `\ndata: ${JSON.stringify({ candidates: [{ content: { parts: [] }, finishReason: "STOP" }] })}\r`,
        );
        setTimeout(() => {
          res.write("\n\r");
          setTimeout(() => res.end("\n"), 5);
        }, 5);
      }, 5);
    }, 5);
  });
  expect((await client.call({ ...options, onTextDelta: () => {} })).kind).toBe(
    "ok",
  );
});
