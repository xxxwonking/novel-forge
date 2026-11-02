import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test("浏览器备份下载往返保持正文和结构，固定TXT与Word导出可用", async ({
  page,
  request,
}) => {
  await page.goto("/#/works");
  const backupDownload = page.waitForEvent("download");
  await page
    .locator(".book-slot")
    .filter({ has: page.locator('a[href*="work=browser-fixture"]') })
    .getByRole("button", { name: "备份《浏览器回归样本》", exact: true })
    .click();
  const backup = await backupDownload;
  const path = await backup.path();
  expect(path).not.toBeNull();
  const bytes = await readFile(path!);
  await page.getByRole("button", { name: "导入备份", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入作品备份" });
  await dialog
    .locator("input[type=file]")
    .setInputFiles({
      name: backup.suggestedFilename(),
      mimeType: "application/vnd.novel-forge.backup",
      buffer: bytes,
    });
  const id = `roundtrip-${randomUUID()}`;
  await dialog.getByPlaceholder("例如 rain-city-copy").fill(id);
  await dialog.getByRole("button", { name: "校验并导入", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const original = { "x-novel-project": "browser-fixture" },
    copy = { "x-novel-project": id };
  const sourceChapter = await (
    await request.get("/api/chapter?n=1", { headers: original })
  ).json();
  const copyChapter = await (
    await request.get("/api/chapter?n=1", { headers: copy })
  ).json();
  expect(copyChapter).toEqual(sourceChapter);
  const sourceBoard = await (
    await request.get("/api/plot-board", { headers: original })
  ).json();
  expect(
    await (await request.get("/api/plot-board", { headers: copy })).json(),
  ).toEqual(sourceBoard);
  await page.goto(`/?work=${id}#/export`);
  await page.getByRole("button", { name: "预览导出", exact: true }).click();
  const txtEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 TXT", exact: true }).click();
  const txt = await txtEvent;
  expect(await readFile((await txt.path())!, "utf8")).toContain(
    "李长风翻开第1页账本",
  );
  const wordEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载 Word", exact: true }).click();
  const word = await wordEvent;
  expect((await readFile((await word.path())!)).subarray(0, 2).toString()).toBe(
    "PK",
  );
  // 重复导入拒绝覆盖，已恢复正文仍完整。
  const duplicate = await request.post(`/api/works/import?targetId=${id}`, {
    headers: { "content-type": "application/vnd.novel-forge.backup" },
    data: bytes,
  });
  expect(duplicate.status()).toBe(409);
  expect(
    await (await request.get("/api/chapter?n=1", { headers: copy })).json(),
  ).toEqual(copyChapter);
});
