import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const work = (path: string) => `/?work=browser-fixture#/${path}`;

async function choose(page: import("@playwright/test").Page, label: string) {
  await page.getByRole("combobox", { name: "主题设置", exact: true }).click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

test("主题可持久化、跨标签同步，系统模式响应设备变化", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto(work("chat"));
  await expect(page.locator("html")).toHaveClass("dark");
  await choose(page, "浅色");
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.reload();
  await expect(
    page.getByRole("combobox", { name: "主题设置", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const other = await context.newPage();
  await other.goto("/#/works");
  await expect(other.locator("html")).not.toHaveClass("dark");
  await choose(page, "深色");
  await expect(other.locator("html")).toHaveClass("dark");
  await choose(page, "跟随系统");
  await expect(page.locator("html")).not.toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass("dark");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(page.locator("html")).not.toHaveClass("dark");
  await choose(page, "深色");
  await expect(page.locator("html")).toHaveClass("dark");
  await other.close();
});

for (const theme of ["浅色", "深色"]) {
  test(`${theme}主题正文、白板、资料弹窗清楚可读，手机入口可操作`, async ({
    page,
  }) => {
    await page.goto(work("chapter/1"));
    await choose(page, theme);
    await expect(page.locator("article.prose")).toBeVisible();
    const prose = await page
      .locator("article.prose")
      .evaluate((el) => getComputedStyle(el).color);
    expect(prose).toBe(
      theme === "浅色" ? "rgb(24, 24, 27)" : "rgb(250, 250, 250)",
    );
    await page.goto(work("plotboard"));
    await page.getByRole("button", { name: "展开全部", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "剧情白板", exact: true }),
    ).toHaveCSS(
      "background-color",
      theme === "浅色" ? "rgb(250, 250, 250)" : "rgb(9, 9, 11)",
    );
    await expect(page.locator(".react-flow")).toHaveClass(
      new RegExp(theme === "浅色" ? "light" : "dark"),
    );
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(work("preparation"));
    const trigger = page.getByRole("combobox", {
      name: "主题设置",
      exact: true,
    });
    await expect(trigger).toBeInViewport();
    expect((await trigger.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page
      .getByRole("button", { name: "编辑「李长风」", exact: true })
      .click();
    await expect(
      page
        .getByRole("dialog")
        .getByRole("button", { name: "保存", exact: true }),
    ).toBeInViewport();
    const result = await new AxeBuilder({ page }).analyze();
    expect(result.violations).toEqual([]);
  });
}
