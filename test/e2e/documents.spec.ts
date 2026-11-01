import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
import { docx, pdf } from "../document-fixtures.js";
test("中文DOCX正文和人物档案经过真实转换与预览，扫描PDF失败不导入", async ({
  page,
  request,
}) => {
  const work = await request.post("/api/works", {
    data: {
      title: "文档导入验收",
      idea: "仅用于回归",
      requestId: randomUUID(),
    },
  });
  expect(work.status()).toBe(201);
  const id = (await work.json()).id;
  await page.goto(`/?work=${id}#/preparation`);
  await page.getByRole("button", { name: "导入已有正文", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入正文与项目资料" });
  await dialog.locator("input[type=file][multiple]").setInputFiles([
    {
      name: "第一章.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docx("第一章 证人\n秦鹭推门进来，将证词放在桌上。"),
    },
    {
      name: "人物档案.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: docx("秦鹭：气象研究员。"),
    },
  ]);
  await dialog.getByRole("button", { name: "预览切分", exact: true }).click();
  await expect(dialog.getByRole("row", { name: /第 1 章 证人/ })).toBeVisible();
  await dialog.getByRole("button", { name: "导入 1 章", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const headers = { "x-novel-project": id };
  const prep = await (
    await request.get("/api/preparation", { headers })
  ).json();
  expect(prep.materials.map((m: { name: string }) => m.name)).toContain(
    "人物档案.docx",
  );
  expect(prep.nextChapter).toBe(2);
  await page.getByRole("button", { name: "导入已有正文", exact: true }).click();
  await dialog
    .locator("input[type=file][multiple]")
    .setInputFiles({
      name: "扫描.pdf",
      mimeType: "application/pdf",
      buffer: pdf(""),
    });
  await expect(dialog.getByRole("alert")).toContainText("OCR");
  const after = await (
    await request.get("/api/preparation", { headers })
  ).json();
  expect(after.nextChapter).toBe(2);
});
