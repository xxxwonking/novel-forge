import { test, expect } from "@playwright/test";
import { chapterRoute } from "../../web/src/source-navigation.js";

test("同章重复引文的链接定位到指定那一处", async ({ page, request }) => {
  const headers = { "x-novel-project": "browser-fixture" };
  const data = await (await request.get("/api/chapter?n=1", { headers })).json();
  const quote = "发现纸上留着一枚红印。";
  const first = data.text.indexOf(quote);
  const second = data.text.indexOf(quote, first + quote.length);
  expect(second).toBeGreaterThan(first);
  const response = page.waitForResponse(r => r.url().includes("/api/anchor?"));
  await page.goto("/?work=browser-fixture#" + chapterRoute(1, quote, { offsetHint: second, occurrence: 1 }));
  expect(await (await response).json()).toMatchObject({ anchor: { occurrence: 1, offsetHint: second }, resolution: { offset: second } });
  await expect(page.locator("mark")).toHaveText(quote);
});
