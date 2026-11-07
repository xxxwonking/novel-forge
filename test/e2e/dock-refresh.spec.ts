import { test, expect } from "@playwright/test";
import { chatFixture } from "./chat-fixture.js";

test("侧栏工具改期伏笔后，同页表格立即更新，无需切换路由", async ({ page }) => {
  const app = await chatFixture({ toolCall: { name: "plan_reschedule_foreshadow", arguments: { foreshadowId: "F01", expectedBy: 12 } } });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/?work=chat-book#/foreshadow`);
    const row = page.getByRole("row").filter({ hasText: "F01" });
    await expect(row.getByRole("cell").nth(3)).toHaveText("3");
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByRole("textbox", { name: "对话内容", exact: true }).fill("把 F01 改到第12章兑现");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("模型已回复，计划仍由你确认。", { exact: true })).toBeVisible();
    await expect(row.getByRole("cell").nth(3)).toHaveText("12");
    await expect(page).toHaveURL(/#\/foreshadow$/);
    expect(app.calls()).toBe(2);
  } finally { await app.close(); }
});

test("正文在全局刷新后重取，未发送的段落输入仍保留", async ({ page }) => {
  const app = await chatFixture({ chapterBody: "原来的正文。" });
  let changed = false;
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.route("**/api/chapter?n=175", async route => {
      const response = await route.fetch(); const json = await response.json();
      await route.fulfill({ response, json: { ...json, text: changed ? "更新后的正文。" : json.text } });
    });
    await page.goto(`${app.url}/?work=chat-book#/chapter/175`);
    await expect(page.locator("article.prose")).toContainText("原来的正文。");
    const passage = page.getByRole("textbox", { name: "段落要求", exact: true });
    await passage.fill("保留这条未发送的修改要求");
    changed = true;
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByRole("textbox", { name: "对话内容", exact: true }).fill("更新后检查作品");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator("article.prose")).toContainText("更新后的正文。");
    await expect(passage).toHaveValue("保留这条未发送的修改要求");
    expect(app.calls()).toBe(1);
  } finally { await app.close(); }
});

test("侧栏记录备选后资料页即时展示，编辑中的内容不被重置", async ({ page }) => {
  const app = await chatFixture({ toolCall: { name: "record_alternative_idea", arguments: { text: "让守夜人成为下一幕的视角人物" } } });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/?work=chat-book#/preparation`);
    await page.getByRole("button", { name: "编辑基本设定与偏好", exact: true }).click();
    const title = page.getByRole("textbox", { name: "暂定书名", exact: true });
    await title.fill("尚未保存的书名");
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByRole("textbox", { name: "对话内容", exact: true }).fill("记为备选：让守夜人成为下一幕的视角人物");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.locator(".prep-section li").filter({ hasText: "让守夜人成为下一幕的视角人物" })).toBeVisible();
    await expect(title).toHaveValue("尚未保存的书名");
    expect(app.calls()).toBe(2);
  } finally { await app.close(); }
});

test("刷新保留编辑源版本，不能用旧表单覆盖并发修改的资料", async ({ page }) => {
  const app = await chatFixture();
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/?work=chat-book#/preparation`);
    await page.getByRole("button", { name: "编辑基本设定与偏好", exact: true }).click();
    await page.getByRole("textbox", { name: "暂定书名", exact: true }).fill("作者仍在编辑的书名");
    const headers = { "x-novel-project": "chat-book" };
    const before = await (await page.request.get(`${app.url}/api/preparation`, { headers })).json();
    const changed = await page.request.post(`${app.url}/api/preparation/author`, { headers, data: {
      summary: "并发修改写作偏好", baseFingerprint: before.fingerprint, changes: { writingRules: ["保留并发新增的写作偏好"] },
    } });
    expect(changed.ok()).toBe(true);
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await page.getByRole("textbox", { name: "对话内容", exact: true }).fill("读取更新后的资料");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(page.getByText("模型已回复，计划仍由你确认。", { exact: true })).toBeVisible();
    const response = page.waitForResponse(r => r.url().endsWith("/api/preparation/author") && r.request().method() === "POST");
    await page.getByRole("button", { name: "保存作者设定", exact: true }).click();
    expect((await response).status()).toBe(409);
    const after = await (await page.request.get(`${app.url}/api/preparation`, { headers })).json();
    expect(after.confirmed.discipline.rules).toEqual(["保留并发新增的写作偏好"]);
    await expect(page.getByRole("textbox", { name: "暂定书名", exact: true })).toHaveValue("作者仍在编辑的书名");
  } finally { await app.close(); }
});
