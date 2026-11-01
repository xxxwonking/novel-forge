import { test, expect } from "@playwright/test";
test("手机全文识别显示实际进度、原文出处，选择后只生成候选", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  let done = false;
  const view = () => ({
    fingerprint: "version",
    completed: done ? 1 : 0,
    total: 1,
    done,
    stale: false,
    characters: done
      ? [
          {
            name: "秦鹭",
            aliases: [],
            roles: ["归来的证人"],
            evidence: [{ source: "chapter:1", quote: "秦鹭推门进来。" }],
          },
        ]
      : [],
    conflicts: [],
    next: done ? null : { title: "第1章", offset: 0 },
  });
  await page.route("**/api/preparation/full-text", (r) => {
    if (r.request().method() === "POST") {
      expect(r.request().postDataJSON()).toEqual({
        cursor: 0,
        fingerprint: "version",
      });
      done = true;
    }
    return r.fulfill({ json: view() });
  });
  await page.route("**/api/preparation/full-text/propose", (r) => {
    expect(r.request().postDataJSON()).toEqual({
      fingerprint: "version",
      names: ["秦鹭"],
    });
    return r.fulfill({ json: { id: "new-candidate" } });
  });
  await page.goto("/?work=browser-fixture#/preparation");
  await page
    .getByRole("button", { name: "阅读全文识别人物", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "已读取 1 / 1" }),
  ).toBeVisible();
  await page.locator("summary").filter({ hasText: "秦鹭" }).click();
  await expect(page.getByText("秦鹭推门进来。", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "补建秦鹭" }).check();
  await page
    .getByRole("button", { name: "保存所选人物为候选", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "待确认方案" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
  ).toBe(false);
});
