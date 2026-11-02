import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chatFixture } from "./chat-fixture.js";
const body = "雨落下来。\n\n他没有回答。\n\n雨落下来。\n门外的脚步停了。";
test("默认输入框可直接讨论当前章，选段问AI和清除选段后整章讨论继续可用", async ({ page }) => {
  const app = await chatFixture({ chapterBody: body, reply: "可以收紧这一章的停顿。" });
  try {
    await page.goto(`${app.url}/?work=chat-book#/chapter/175`);
    const input = page.getByRole("textbox", { name: "段落要求", exact: true });
    await expect(input).toBeVisible();
    expect(app.calls()).toBe(0);
    await input.fill("帮我看看这一章的节奏");
    const request = page.waitForRequest(req => req.url().endsWith("/api/passage/assist"));
    await page.getByRole("button", { name: "发送段落要求", exact: true }).click();
    const payload = (await request).postDataJSON();
    expect(payload.chapter).toBe(175); expect(payload.quote).toBeUndefined(); expect(payload.start).toBeUndefined();
    await expect(page.getByText("可以收紧这一章的停顿。", { exact: true })).toBeVisible();
    await select(page, 2);
    await page.getByRole("button", { name: "询问所选段落", exact: true }).click();
    await expect(page.getByRole("region", { name: "已选原文" })).toContainText("雨落下来。");
    await page.getByRole("button", { name: "清除选段", exact: true }).click();
    await expect(input).toBeVisible();
    await expect(page.getByText("当前第 175 章", { exact: false })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await input.scrollIntoViewIfNeeded();
    await expect(input).toBeInViewport();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally { await app.close(); }
});
async function select(page: import("@playwright/test").Page, first: number, last = first) {
  await page.locator("article.prose").evaluate((el, indices) => {
    const paragraphs = el.querySelectorAll("p[data-source-start]");
    const range = document.createRange();
    range.setStart(paragraphs[indices[0]!]!, 0);
    range.setEnd(paragraphs[indices[1]!]!, paragraphs[indices[1]!]!.childNodes.length);
    const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));
  }, [first, last]);
}

test("无计划章选跨段原文，片段和上下文经真实API交给只读AI；检查说明清楚", async ({ page, context }) => {
  const app = await chatFixture({ chapterBody: body, reply: "可以让停下的脚步回应沉默，使情绪落在动作上。" });
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: app.url });
    await page.goto(`${app.url}/?work=chat-book#/chapter/175`);
    await expect(page.getByRole("tab", { name: "段落助手", exact: true })).toHaveAttribute("aria-selected", "true");
    await select(page, 2, 3);
    await page.getByRole("button", { name: "询问所选段落", exact: true }).click();
    await expect(page.getByRole("region", { name: "已选原文" })).toContainText("雨落下来。");
    const input = page.getByRole("textbox", { name: "段落要求", exact: true });
    await input.fill("这两句显得平淡，怎样更有张力？");
    const request = page.waitForRequest(req => req.url().endsWith("/api/passage/assist"));
    await page.getByRole("button", { name: "发送段落要求", exact: true }).click();
    expect((await request).postDataJSON()).toMatchObject({ chapter: 175, start: body.lastIndexOf("雨落下来。"), quote: "雨落下来。\n门外的脚步停了。" });
    await expect(page.getByText("可以让停下的脚步回应沉默，使情绪落在动作上。", { exact: true })).toBeVisible();
    expect(app.calls()).toBe(1);
    await page.getByRole("button", { name: "复制段落建议" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain("停下的脚步");
    await page.getByRole("tab", { name: "章节检查", exact: true }).click();
    await expect(page.getByText("这一章尚未建立章节计划", { exact: false })).toBeVisible();
    await page.getByRole("tab", { name: "段落助手", exact: true }).click();
    await expect(page.getByText("可以让停下的脚步回应沉默，使情绪落在动作上。", { exact: true })).toBeVisible();
    const response = await page.request.get(`${app.url}/api/chapter?n=175`, { headers: { "x-novel-project": "chat-book" } });
    expect((await response.json()).text).toBe(body);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.setViewportSize({ width: 390, height: 844 });
    await select(page, 0);
    await page.getByRole("button", { name: "润色所选段落", exact: true }).click();
    await expect(input).toBeInViewport();
    await expect(input).toHaveValue(/润色/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await app.close(); }
});

test("草稿选段支持失败重试、保留原稿，通用助手仍可打开", async ({ page }) => {
  const app = await chatFixture({ draftBody: body });
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${app.url}/?work=chat-book#/draft/3/ch3d1`);
    await page.locator("article.draft-prose").scrollIntoViewIfNeeded();
    await page.locator("article.draft-prose p").nth(2).evaluate(el => {
      const range = document.createRange(); range.selectNodeContents(el);
      const selection = getSelection()!; selection.removeAllRanges(); selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "询问所选段落", exact: true }).click();
    await page.getByRole("textbox", { name: "段落要求", exact: true }).fill("模拟故障");
    await page.getByRole("button", { name: "发送段落要求", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("测试中转暂时不可达");
    await expect(page.getByRole("textbox", { name: "段落要求", exact: true })).toHaveValue("模拟故障");
    await page.getByRole("button", { name: "发送段落要求", exact: true }).click();
    await expect(page.getByText("模型已回复，计划仍由你确认。", { exact: true })).toBeVisible();
    expect(app.calls()).toBe(2);
    const response = await page.request.get(`${app.url}/api/chapter/draft?n=3&id=ch3d1`, { headers: { "x-novel-project": "chat-book" } });
    expect((await response.json()).body).toBe(body);
    await page.getByRole("button", { name: "打开 AI 助手", exact: true }).click();
    await expect(page.getByRole("complementary", { name: "AI 助手", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await app.close(); }
});

test("鼠标选段后可用键盘调整，检查请求失败不冒充缺少计划", async ({ page }) => {
  const app = await chatFixture();
  try {
    await page.route("**/api/health?*", route => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "检查服务暂时不可用" }) }));
    await page.goto(`${app.url}/?work=chat-book#/chapter/2`);
    await page.getByRole("tab", { name: "章节检查", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("检查暂时无法读取");
    await expect(page.getByText("这一章尚未建立章节计划", { exact: false })).toHaveCount(0);
    await page.getByRole("tab", { name: "段落助手", exact: true }).click();
    const points = await page.locator("article.prose p").first().evaluate(element => {
      const text = element.querySelector("span")!.firstChild!;
      const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
      const rect = range.getBoundingClientRect();
      return { x: rect.left, end: rect.right, y: rect.top + rect.height / 2 };
    });
    await page.mouse.move(points.x, points.y); await page.mouse.down();
    await page.mouse.move(points.end, points.y, { steps: 8 }); await page.mouse.up();
    await expect(page.getByRole("toolbar", { name: "所选段落操作" })).toBeVisible();
    const before = await page.evaluate(() => getSelection()!.toString());
    await page.keyboard.press("Shift+ArrowRight");
    const after = await page.evaluate(() => getSelection()!.toString());
    expect(after).not.toBe(before);
    await page.getByRole("button", { name: "询问所选段落", exact: true }).click();
    await expect(page.locator(".passage-quote blockquote")).toHaveText(after);
    await expect(page.getByRole("textbox", { name: "段落要求", exact: true })).toBeFocused();
  } finally { await app.close(); }
});
