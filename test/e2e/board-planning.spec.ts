import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { test, expect } from "@playwright/test";
test("白板新增未来计划先保存候选，取消不落正式节点，确认后刷新可见", async ({
  page,
  request,
}) => {
  const id = `board-plan-${randomUUID()}`;
  const backup = await request.get("/api/works/backup?id=browser-fixture");
  const restored = await request.post(`/api/works/import?targetId=${id}`, {
    headers: { "content-type": "application/vnd.novel-forge.backup" },
    data: await backup.body(),
  });
  expect(restored.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/?work=${id}#/plotboard`);
  await page
    .getByRole("button", { name: "新增未来章计划", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑章计划", exact: true }).click();
  const editor = page.getByRole("dialog", {
    name: "新增第 3 章计划",
    exact: true,
  });
  await expect(editor).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withRules(["heading-order", "aria-dialog-name"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await editor.getByRole("button", { name: "取消", exact: true }).click();
  await expect(editor).toHaveCount(0);
  const before = await (
    await page.request.get("/api/plot-board", {
      headers: { "x-novel-project": id },
    })
  ).json();
  expect(
    before.nodes.some((n: { status: string }) => n.status === "planned"),
  ).toBe(false);
  await page
    .getByRole("button", { name: "新增未来章计划", exact: true })
    .click();
  await page.getByRole("button", { name: "编辑章计划", exact: true }).click();
  await editor
    .getByLabel("核心事件", { exact: true })
    .fill("李长风前往档案室核对红印");
  await editor
    .getByLabel("阶段反馈（本章给读者的实际兑现）", { exact: true })
    .fill("核实印章属于守夜人");
  await editor.getByLabel("章末钩子", { exact: true }).fill("守夜人出现在门外");
  await editor
    .getByPlaceholder("一句话说清发生了什么", { exact: true })
    .fill("李长风完成红印查证");
  await editor.getByRole("button", { name: "保存", exact: true }).click();
  const preview = page.getByRole("dialog", {
    name: "确认白板规划",
    exact: true,
  });
  await expect(preview).toContainText("李长风前往档案室核对红印");
  await preview.getByRole("button", { name: "确认规划", exact: true }).click();
  await page.reload();
  const after = await (
    await page.request.get("/api/plot-board", {
      headers: { "x-novel-project": id },
    })
  ).json();
  expect(
    after.nodes.filter((n: { status: string }) => n.status === "planned"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "情节目录", exact: true }).click();
  await page
    .getByRole("searchbox", { name: "查找剧情或章号" })
    .fill("李长风完成红印查证");
  await page
    .getByRole("button", { name: /第 3 章 · 李长风完成红印查证/ })
    .click();
  const details = page.getByRole("dialog", { name: "节点详情", exact: true });
  await expect(
    details.getByRole("button", { name: "编辑本章计划", exact: true }),
  ).toBeVisible();
  await details
    .getByRole("button", { name: "编辑本章计划", exact: true })
    .click();
  const edit = page.getByRole("dialog", {
    name: "编辑第 3 章计划",
    exact: true,
  });
  await expect(edit).toBeVisible();
  await edit.getByRole("button", { name: "取消", exact: true }).click();
  await page
    .getByRole("button", { name: "编辑选中章计划", exact: true })
    .click();
  const revised = page.getByRole("dialog", {
    name: "编辑第 3 章计划",
    exact: true,
  });
  await revised
    .getByLabel("核心事件", { exact: true })
    .fill("李长风继续核查红印与原始记录");
  await revised.getByRole("button", { name: "保存", exact: true }).click();
  const reloaded = page.waitForResponse(
    (r) =>
      new URL(r.url()).pathname === "/api/plot-board" && r.status() === 200,
  );
  await page
    .getByRole("dialog", { name: "确认白板规划", exact: true })
    .getByRole("button", { name: "确认规划", exact: true })
    .click();
  await reloaded;
  await expect(
    page.getByRole("button", { name: "新增未来章计划", exact: true }),
  ).toBeFocused();
});
