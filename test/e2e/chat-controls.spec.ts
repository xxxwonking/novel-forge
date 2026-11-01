import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { chatFixture } from "./chat-fixture.js";
test("新会话、历史、改名、复制与失败重试经过真实API且不会重复用户消息", async ({
  page,
  context,
}) => {
  const app = await chatFixture();
  try {
    await context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: app.url,
    });
    await page.goto(`${app.url}/?work=chat-book#/chat`);
    const input = page.getByRole("textbox", { name: "对话内容", exact: true });
    await input.fill("模拟故障");
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByText("测试中转暂时不可达", { exact: false }),
    ).toBeVisible();
    await page.getByRole("button", { name: "重新发送", exact: true }).click();
    await expect(
      page.getByText("模型已回复，计划仍由你确认。", { exact: true }),
    ).toBeVisible();
    expect(app.calls()).toBe(2);
    await expect(page.locator('.msg[data-role="user"]')).toHaveCount(1);
    await page
      .getByRole("button", { name: "复制消息", exact: true })
      .last()
      .click();
    await expect
      .poll(() => page.evaluate(() => navigator.clipboard.readText()))
      .toBe("模型已回复，计划仍由你确认。");
    await input.fill("未发送草稿");
    await page.getByRole("button", { name: "新对话", exact: true }).click();
    await expect(page.locator(".msg")).toHaveCount(0);
    await expect(input).toHaveValue("");
    await page.getByRole("button", { name: "历史对话", exact: true }).click();
    await page
      .getByRole("dialog", { name: "历史对话", exact: true })
      .getByRole("button", { name: /模拟故障/ })
      .click();
    await expect(input).toHaveValue("未发送草稿");
    await expect(page.locator('.msg[data-role="user"]')).toHaveCount(1);
    await page.getByRole("button", { name: "重命名对话", exact: true }).click();
    const dialog = page.getByRole("dialog", {
      name: "重命名对话",
      exact: true,
    });
    await dialog
      .getByRole("textbox", { name: "对话名称", exact: true })
      .fill("下一章方向");
    await dialog.getByRole("button", { name: "保存", exact: true }).click();
    await page.reload();
    await expect(page.getByText("下一章方向", { exact: true })).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.getByRole("radio", { name: "谋篇", exact: true }).click();
    await expect(
      page.getByRole("radio", { name: "谋篇", exact: true }),
    ).toBeChecked();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await app.close();
  }
});

test("旧版本失败消息可恢复到输入框，不直接重放无法确认的工具操作", async ({
  page,
}) => {
  const app = await chatFixture({ legacyFailure: true });
  try {
    await page.goto(`${app.url}/?work=chat-book#/chat`);
    await page.getByRole("button", { name: "编辑后重试", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "对话内容", exact: true }),
    ).toHaveValue("看看现在写到哪了");
    expect(app.calls()).toBe(0);
    await page.getByRole("button", { name: "发送", exact: true }).click();
    await expect(
      page.getByText("模型已回复，计划仍由你确认。", { exact: true }),
    ).toBeVisible();
  } finally {
    await app.close();
  }
});
