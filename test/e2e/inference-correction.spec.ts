import { test, expect } from "@playwright/test";
test("旧稿结构纠正预览后再确认，手机可读并明确正文不变", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const declaration = {
    events: [
      {
        kind: "action",
        summary: "误读为归还钥匙",
        weight: 1,
        plotLine: "P01",
        participants: ["C01"],
        anchor: {
          chapter: 1,
          quote: "李长风收好钥匙。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
    foreshadowPlanted: [],
    foreshadowResolved: [],
    characterStates: [],
    characterPresence: [],
    relationsChanged: [],
  };
  await page.route("**/api/import/inference", (r) =>
    r.fulfill({
      json: {
        chapters: [
          {
            chapter: 1,
            words: 100,
            state: "confirmed",
            declaration: null,
            eventCount: 1,
            problems: [],
            warnings: [],
            at: null,
          },
        ],
        nextChapter: null,
        pending: [],
        blocked: null,
      },
    }),
  );
  await page.route("**/api/import/inference/correction?chapter=1", (r) =>
    r.fulfill({
      json: {
        chapter: 1,
        sourceToken: "source-version",
        declaration,
        candidates: [],
      },
    }),
  );
  const p = {
    id: "candidate",
    chapter: 1,
    sourceToken: "source-version",
    summary: "纠正钥匙去向",
    declaration,
    impact: { source: 1, changes: [{ text: "事件内容更正" }], chapters: [] },
    status: "proposed",
  };
  await page.route("**/api/import/inference/correction", (r) => {
    const body = r.request().postDataJSON();
    expect(body.sourceToken).toBe("source-version");
    return r.fulfill({ json: p });
  });
  let confirmed = false;
  await page.route("**/api/import/inference/correction/confirm", (r) => {
    confirmed = true;
    return r.fulfill({ json: { ...p, status: "confirmed" } });
  });
  await page.goto("/?work=browser-fixture#/inference");
  await page
    .getByRole("button", { name: "纠正第 1 章结构", exact: true })
    .click();
  await page.getByRole("combobox", { name: "记录类别", exact: true }).click();
  await page.getByRole("option", { name: "剧情事件", exact: true }).click();
  await page
    .getByRole("textbox", { name: "事件概述", exact: true })
    .fill("李长风收好钥匙");
  await page.getByRole("button", { name: "保存记录修订", exact: true }).click();
  expect(confirmed).toBe(false);
  const preview = page.getByRole("dialog", {
    name: "确认结构纠正",
    exact: true,
  });
  await expect(preview).toContainText("正文保持不变");
  await preview
    .getByRole("button", { name: "确认纠正结构", exact: true })
    .click();
  await expect(preview).toHaveCount(0);
  expect(confirmed).toBe(true);
});
