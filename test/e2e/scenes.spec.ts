import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";

test("手机分场配置校验先于确认，试写请求携带作者选定额度", async ({ page, request }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const created = await request.post("/api/works", { data: { title: "分场表单验收", idea: "合成测试", requestId: randomUUID() } });
  expect(created.status()).toBe(201);
  const id = (await created.json()).id;
  const headers = { "x-novel-project": id };
  const prep = await (await request.get("/api/preparation", { headers })).json();
  const proposed = await request.post("/api/preparation/propose", { headers, data: { summary: "分场表单候选", baseFingerprint: prep.fingerprint, changes: { plotLines: [{ id: "P_Test", label: "调查", weight: "main" }] } } });
  expect(proposed.ok()).toBe(true);
  await page.goto(`/?work=${id}#/preparation`);
  await page.getByRole("button", { name: /待确认 分场表单候选/ }).click();
  const calls = page.getByRole("spinbutton", { name: "每章最多模型调用次数", exact: true });
  await calls.fill("");
  await page.getByRole("button", { name: "确认并写第 1 章", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("请填写1–100次");
  const unchanged = await (await request.get("/api/preparation", { headers })).json();
  expect(unchanged.proposals[0].status).toBe("proposed");
  await calls.fill("12");
  await page.getByRole("spinbutton", { name: "每章积分停止线", exact: true }).fill("30");
  // 仅核对浏览器请求；不模拟AI成功，也不允许调用真实模型。
  await page.route("**/api/chapter/start", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"合成测试禁止调用模型"}' }));
  const sent = page.waitForRequest(r => r.url().endsWith("/api/chapter/start"));
  await page.getByRole("button", { name: "按方案先试写", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({ chapter: 1, sceneWriting: { maxCalls: 12, maxCredits: 30 } });
  await expect(page.getByRole("alert")).toContainText("合成测试禁止调用模型");
});

test("未知费用恢复必须明确确认，保留原额度与场景进度", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/tasks", route => route.fulfill({ json: [{
    chapter: 3, draftId: "ch3d1", status: "failed", stage: "writing", draftStatus: "failed", words: 100,
    startedAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-01T00:00:00Z", isHistory: false,
    usageRecorded: true, autoRevisionLimit: 1, autoRevisionsUsed: 0, automaticResultDraftId: null, detail: "连接中断，片段已保留",
    usage: { calls: 3, inputTokens: 200, outputTokens: 100, unmeasuredCalls: 1, credits: 0.1 },
    sceneWriting: { maxCalls: 16, maxCredits: 50, completed: 1, total: 3, unknownUsageNeedsConfirmation: true },
  }] }));
  await page.goto("/?work=browser-fixture#/preparation");
  const card = page.getByRole("region", { name: "第 3 章任务", exact: true });
  await expect(card).toContainText("已保存 1/3 场");
  await card.getByRole("button", { name: "重试当前任务", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "核对未知费用后继续？", exact: true });
  await expect(dialog).toBeInViewport();
  await expect(dialog).toContainText("已用次数和原积分停止线仍保留");
  await page.route("**/api/chapter/start", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"只验证恢复请求"}' }));
  const sent = page.waitForRequest(r => r.url().endsWith("/api/chapter/start"));
  await dialog.getByRole("button", { name: "已核对，继续剩余任务", exact: true }).click();
  expect((await sent).postDataJSON()).toMatchObject({ chapter: 3, draftId: "ch3d1", acknowledgeUnknownUsage: true });
});
