import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

for (const theme of ["浅色", "深色"])
  test(`${theme}关系粒子只强调选中人物的正文关系，支持暂停与减少动态，手机仍可定位原文`, async ({
    page,
  }) => {
    await page.route("**/api/views", async (route) => {
      const response = await route.fetch();
      const data = await response.json();
      const point = {
        chapter: 1,
        anchor: { quote: "李长风翻开第1页账本" },
        resolution: { status: "exact" },
      };
      data.relations = {
        nodes: [
          { id: "C01", name: "李长风", tier: "protagonist", degree: 2 },
          { id: "C02", name: "守夜人", tier: "major", degree: 1 },
          { id: "C03", name: "待登场人物", tier: "minor", degree: 1 },
        ],
        edges: [
          {
            from: "C01",
            to: "C02",
            kind: "ally",
            note: "交接账本",
            changedAt: 1,
            historyCount: 1,
            history: [],
            declared: false,
            point,
          },
          {
            from: "C01",
            to: "C03",
            kind: "kin",
            note: "档案设定",
            changedAt: 0,
            historyCount: 1,
            history: [],
            declared: true,
            point: null,
          },
        ],
      };
      await route.fulfill({ response, json: data });
    });
    await page.goto("/?work=browser-fixture#/relations");
    await page.getByRole("combobox", { name: "主题设置", exact: true }).click();
    await page.getByRole("option", { name: theme, exact: true }).click();
    await expect(page.locator(".relation-particle")).toHaveCount(0);
    const person = page.getByRole("button", {
      name: "聚焦人物：李长风",
      exact: true,
    });
    await person.focus();
    await page.keyboard.press("Enter");
    await expect(person).toHaveAttribute("aria-pressed", "true");
    const particle = page.locator(".relation-particle");
    await expect(particle).toHaveCount(1);
    await expect(particle).toHaveCSS("animation-play-state", "running");
    const start = await particle.evaluate(
      (el) => getComputedStyle(el).transform,
    );
    await expect
      .poll(() => particle.evaluate((el) => getComputedStyle(el).transform))
      .not.toBe(start);
    await page
      .getByRole("button", { name: "暂停连线动效", exact: true })
      .click();
    await expect(particle).toHaveCSS("animation-play-state", "paused");
    await page
      .getByRole("button", { name: "开启连线动效", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(particle).toHaveCSS("display", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(particle).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    expect(
      (await page.locator(".relation-hit").first().boundingBox())!.height,
    ).toBeGreaterThanOrEqual(44);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", {
        name: "查看原文：李长风与守夜人",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /查看原文.*待登场/ }),
    ).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page
      .getByRole("button", { name: "查看原文：李长风与守夜人", exact: true })
      .click();
    await expect(page).toHaveURL(/#\/chapter\/1/);
    await expect(page.locator("mark")).toContainText("李长风翻开第1页账本");
  });
