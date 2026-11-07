import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chatFixture } from "./chat-fixture.js";

test("无计划旧稿可看实际基础规则命中，缺失项目单独说明，手机可读且正文不变", async ({ page }) => {
  const body = "他瞳孔骤缩。".repeat(12);
  const app = await chatFixture({ chapterBody: body });
  try {
    await page.goto(`${app.url}/?work=chat-book#/chapter/175`);
    await page.getByRole("tab", { name: "章节检查", exact: true }).click();
    await expect(page.getByRole("heading", { name: "基础正文检查", exact: true })).toBeVisible();
    await expect(page.getByText("「瞳孔骤缩」出现 12 次", { exact: false })).toBeVisible();
    await expect(page.getByText("尚未建立章节计划", { exact: false })).toBeVisible();
    await expect(page.getByText("字（只计汉字与西文词）", { exact: true })).toBeVisible();
    await expect(page.getByText("加权事件密度 / 千字", { exact: true })).toHaveCount(0);
    expect(app.calls()).toBe(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("heading", { name: "基础正文检查", exact: true }).scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const response = await page.request.get(`${app.url}/api/chapter?n=175`, { headers: { "x-novel-project": "chat-book" } });
    expect((await response.json()).text).toBe(body);
  } finally { await app.close(); }
});

test("有计划仍检查预算，体检失败可重试恢复", async ({ page }) => {
  const app = await chatFixture();
  let fail = true;
  try {
    await page.route("**/api/health?*", route => fail ? route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "测试体检服务中断" }) }) : route.continue());
    await page.goto(`${app.url}/?work=chat-book#/chapter/2`);
    await page.getByRole("tab", { name: "章节检查", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("测试体检服务中断");
    fail = false;
    await page.getByRole("button", { name: "重试检查", exact: true }).click();
    await expect(page.getByRole("heading", { name: "基础正文检查", exact: true })).toBeVisible();
    await expect(page.getByText("低于预算下限", { exact: false })).toBeVisible();
    await expect(page.getByText("加权事件密度 / 千字", { exact: true })).toBeVisible();
    expect(app.calls()).toBe(0);
  } finally { await app.close(); }
});
