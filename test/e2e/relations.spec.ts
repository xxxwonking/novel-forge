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
    await person.click();
    await expect(person).toHaveAttribute("aria-pressed", "true");
    await person.click();
    await expect(person).toHaveAttribute("aria-pressed", "false");
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
    const canvas = page.getByRole("group", { name: "人物关系图", exact: true });
    const initialView = await canvas.getAttribute("viewBox");
    await page.getByRole("button", { name: "放大关系图", exact: true }).click();
    await expect(canvas).not.toHaveAttribute("viewBox", initialView!);
    await page.getByRole("button", { name: "适配关系图", exact: true }).click();
    const hit = person.locator(".relation-hit");
    const original = (await hit.boundingBox())!;
    await page.mouse.move(
      original.x + original.width / 2,
      original.y + original.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      original.x + original.width / 2 + 70,
      original.y + original.height / 2 + 30,
      { steps: 8 },
    );
    await page.mouse.up();
    const dragged = (await hit.boundingBox())!;
    expect(dragged.x - original.x).toBeGreaterThan(55);
    await expect(page).toHaveURL(/relations/);
    await page.getByRole("button", { name: "适配关系图", exact: true }).click();
    await page
      .getByRole("button", { name: "开启连线动效", exact: true })
      .click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(particle).toHaveCSS("display", "none");
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect(particle).toBeVisible();
    const panView = await canvas.getAttribute("viewBox");
    const area = (await canvas.boundingBox())!;
    await page.mouse.move(area.x + 12, area.y + 15);
    await page.mouse.down();
    await page.mouse.move(area.x + 65, area.y + 40, { steps: 5 });
    await page.mouse.up();
    await expect(canvas).not.toHaveAttribute("viewBox", panView!);
    await page.getByRole("button", { name: "适配关系图", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await canvas.scrollIntoViewIfNeeded();
    const mobileArea = (await canvas.boundingBox())!;
    const touchView = await canvas.getAttribute("viewBox");
    const cdp = await page.context().newCDPSession(page);
    const cy = mobileArea.y + mobileArea.height / 2,
      cx = mobileArea.x + mobileArea.width / 2;
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: cx - 40, y: cy, id: 1 },
        { x: cx + 40, y: cy, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: cx - 70, y: cy, id: 1 },
        { x: cx + 70, y: cy, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(canvas).not.toHaveAttribute("viewBox", touchView!);
    await cdp.detach();
    await page.getByRole("button", { name: "适配关系图", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await page.locator(".relation-hit").first().boundingBox())!.height,
      )
      .toBeGreaterThanOrEqual(44);
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
