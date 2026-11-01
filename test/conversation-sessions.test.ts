import { afterEach, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConversationStore } from "../src/agent/conversation-store.js";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((r) => rmSync(r, { recursive: true, force: true })),
);
function setup() {
  const root = mkdtempSync(join(tmpdir(), "nf-conversations-"));
  roots.push(root);
  return { root, store: new ConversationStore(root) };
}
it("旧历史和备选想法不丢失，新会话具有独立模式和上下文", () => {
  const { root, store } = setup();
  writeFileSync(
    join(root, "conversation.json"),
    JSON.stringify({
      turns: [{ role: "user", text: "旧想法", at: "2026-11-01" }],
      ideas: [{ id: "idea1", text: "备选", at: "2026-11-01" }],
      mode: "planning",
    }),
  );
  const old = store.sessionId();
  const next = store.createSession("新方向");
  expect(store.load().turns).toEqual([]);
  expect(store.load().mode).toBe("normal");
  expect(store.listIdeas()).toHaveLength(1);
  store
    .forSession(next)
    .appendExchange(
      { role: "user", text: "新讨论", at: "now" },
      { role: "agent", text: "新回复", at: "now" },
    );
  store.selectSession(old);
  expect(store.load().mode).toBe("planning");
  expect(store.load().turns[0]?.text).toBe("旧想法");
  expect(store.listSessions()).toHaveLength(2);
  expect(
    new ConversationStore(root).forSession(next).load().turns,
  ).toHaveLength(2);
});
it("已开始的会话引用不随另一个标签切换而串话，改名不改变原文", () => {
  const { root, store } = setup();
  const old = store.forSession(store.sessionId());
  const next = store.createSession();
  old.appendExchange(
    { role: "user", text: "原会话", at: "now" },
    { role: "agent", text: "结果", at: "now" },
  );
  store.renameSession(next, "另一个方向");
  expect(store.load().turns).toHaveLength(0);
  expect(old.load().turns).toHaveLength(2);
  expect(
    JSON.parse(readFileSync(join(root, "conversation.json"), "utf8")).turns,
  ).toHaveLength(2);
  expect(() => store.selectSession("../other")).toThrow();
});
it("请求开始收据可跨重启读取，最终交换原子清除收据", () => {
  const { root, store } = setup();
  store.beginRequest("req-1", "看看计划");
  expect(new ConversationStore(root).load().pendingRequest?.id).toBe("req-1");
  store.appendExchange(
    { role: "user", text: "看看计划", at: "now", requestId: "req-1" },
    { role: "agent", text: "回复", at: "now", requestId: "req-1" },
  );
  expect(store.load().pendingRequest).toBeUndefined();
});

it("执行中的会话不能切换谋篇锁，避免另一标签页让界面与工具权限不一致", () => {
  const { store } = setup();
  store.beginRequest("r1", "讨论方向");
  expect(() => store.setMode("planning")).toThrow("处理");
  expect(store.mode()).toBe("normal");
});

it("坏的内部快照回退可见文本，坏请求收据明确报错而不是被新请求覆盖", () => {
  const { root, store } = setup();
  writeFileSync(
    join(root, "conversation.json"),
    JSON.stringify({
      turns: [],
      ideas: [],
      mode: "normal",
      modelHistory: { target: "broken", messages: "bad" },
    }),
  );
  expect(store.load().modelHistory).toBeUndefined();
  writeFileSync(
    join(root, "conversation.json"),
    JSON.stringify({
      turns: [],
      ideas: [],
      mode: "normal",
      pendingRequest: { id: "r1", text: 42, at: "now" },
    }),
  );
  expect(() => store.load()).toThrow("收据");
});
