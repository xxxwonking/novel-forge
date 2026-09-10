import { afterEach, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runChatSmoke } from "../src/harness/chat-smoke.js";
import { fakeClient, modelText } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("真实验收工装在新目录保存失败报告，保留同级已有作品", async () => {
  const parent = mkdtempSync(join(tmpdir(), "nf-smoke-test-"));
  roots.push(parent);
  mkdirSync(join(parent, "demo"));
  writeFileSync(join(parent, "demo", "keep.txt"), "existing work");
  const model = fakeClient([{ kind: "error", error: { type: "connection", status: null, retryable: true, message: "offline" } }]);
  const result = await runChatSmoke(parent, model.client, "test-model");
  expect(result.root).not.toBe(join(parent, "demo"));
  expect(readFileSync(join(parent, "demo", "keep.txt"), "utf8")).toBe("existing work");
  expect(result.report.status).toBe("failed");
  expect(existsSync(join(result.root, "report.json"))).toBe(true);
  expect(model.calls).toHaveLength(1);
});

it("验收工装在 C5 失败后保留正文及错误，报告不声称已采用", async () => {
  const parent = mkdtempSync(join(tmpdir(), "nf-smoke-test-"));
  roots.push(parent);
  const prose = "沈砚从旧账库的夹墙中取出账页，顾青守在门边。";
  const model = fakeClient([modelText(prose), { kind: "error", error: { type: "status", status: 503, retryable: true, message: "temporary" } }]);
  const result = await runChatSmoke(parent, model.client, "test-model");
  expect(result.report.status).toBe("failed");
  expect(result.report.adopted).toBe(false);
  expect(result.report.error?.step).toBe("C5");
  expect(readFileSync(join(result.root, "drafts", "ch1", "ch1d1.txt"), "utf8")).toBe(prose);
  expect(result.report.words).toBeGreaterThan(0);
});
