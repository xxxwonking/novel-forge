import { test, expect } from "@playwright/test";
import { chatFixture } from "./chat-fixture.js";
import AxeBuilder from "@axe-core/playwright";
test("供应商页面可编辑保留密钥、测试连接、切换默认并支持三种协议", async ({
  page,
}) => {
  const app = await chatFixture();
  try {
    await page.goto(`${app.url}/?work=chat-book#/providers`);
    await expect(
      page.getByRole("heading", { name: "AI 供应商", exact: true }),
    ).toBeVisible();
    const row = page.getByRole("region", { name: "测试供应商", exact: true });
    await row.getByRole("button", { name: "测试连接", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("已收到模型回复");
    await row.getByRole("button", { name: "编辑", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "编辑供应商", exact: true });
    await expect(edit.getByLabel("API 密钥", { exact: true })).toHaveValue("");
    await edit.getByLabel("配置名称", { exact: true }).fill("已编辑供应商");
    await edit.getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "已编辑供应商", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "添加供应商", exact: true }).click();
    const add = page.getByRole("dialog", { name: "添加供应商", exact: true });
    await add.getByRole("combobox", { name: "接口协议", exact: true }).click();
    await expect(
      page.getByRole("option", { name: "Anthropic Messages", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("option", { name: "Gemini 原生", exact: true })
      .click();
    await expect(add.getByLabel("API 地址", { exact: true })).toHaveValue(
      "https://generativelanguage.googleapis.com/v1beta",
    );
    await add.getByLabel("配置名称", { exact: true }).fill("Gemini测试");
    await add.getByLabel("模型 ID", { exact: true }).fill("gemini-test");
    await add
      .getByLabel("API 密钥", { exact: true })
      .fill("private-gemini-key");
    await add.getByRole("button", { name: "保存", exact: true }).click();
    const added = page.getByRole("region", { name: "Gemini测试", exact: true });
    await added.getByRole("button", { name: "设为默认", exact: true }).click();
    await expect(added).toContainText("当前默认");
    const raw = await page.request.get(`${app.url}/api/providers`);
    expect(await raw.text()).not.toMatch(/private-gemini-key|only-test-secret/);
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Gemini测试", exact: true }),
    ).toContainText("当前默认");
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await app.close();
  }
});
