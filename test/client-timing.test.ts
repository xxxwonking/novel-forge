/**
 * 调用时长的两个钟。
 *
 * 为什么记两个：真机上出现过一次「配置 300 秒、日志记 940 秒」，墙钟、单调钟、
 * 进程被冻结三种读法都算不平账。只记一个钟就永远说不清那 640 秒去哪了 ——
 * 两个一起记，分叉本身就是结论。
 */

import { describe, expect, it } from "vitest";
import { createServer } from "node:http";
import { describeTiming, startTiming } from "../src/client/claude.js";
import { ChatClient } from "../src/client/chat.js";

describe("两个钟的读数", () => {
  it("正常情况下两个钟一致", () => {
    const timing = startTiming()();
    expect(Math.abs(timing.wallMs - timing.monotonicMs)).toBeLessThan(100);
  });

  it("分叉小的时候只说总时长", () => {
    expect(describeTiming({ monotonicMs: 3_009, wallMs: 3_010 })).toBe("等了 3.0 秒");
  });

  it("分叉大的时候把两个钟都说出来，但不替读者断因", () => {
    // 2026-09-19 隔夜实测：Darwin 上的单调钟含睡眠（11.9 小时里机器睡了两个多小时，
    // 两个钟累计只差 7 秒），所以分叉不等于「机器睡了」—— 唤醒时的 NTP 校正也会造成
    // 分叉，实测见到的那一次正是。已知成因不止一种，文案就只报事实。
    const text = describeTiming({ monotonicMs: 300_000, wallMs: 940_959 });
    expect(text).toContain("941.0 秒");
    expect(text).toContain("两个钟差了");
    expect(text).toContain("300.0 秒");
    expect(text).not.toContain("机器没在运行");
  });

  it("墙钟被往回校时也算分叉，不会因为是负数就漏掉", () => {
    expect(describeTiming({ monotonicMs: 10_000, wallMs: 3_000 })).toContain("两个钟差了 7.0 秒");
  });
});

describe("流开始之后超时仍然生效", () => {
  it("代理一直滴字符也会被按时砍掉，并带回时长", async () => {
    // 这条是对「流式响应没有空闲超时」那个诊断的反证：超时是总预算，覆盖读流体。
    const server = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(": open\n\n");
      const t = setInterval(() => res.write(": ping\n\n"), 100);
      res.on("close", () => clearInterval(t));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    try {
      const client = new ChatClient({ baseURL: `http://127.0.0.1:${port}/v1`, apiKey: "k", model: "stub", stream: "always", timeoutMs: 600 });
      const result = await client.call({ role: "creative", maxTokens: 64, system: [{ type: "text", text: "x" }], messages: [{ role: "user", content: [{ type: "text", text: "y" }] }] });
      expect(result.kind).toBe("error");
      if (result.kind !== "error") return;
      expect(result.error.type).toBe("connection");
      expect(result.error.timing?.monotonicMs).toBeGreaterThanOrEqual(500);
      expect(result.error.message).toContain("等了");
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
