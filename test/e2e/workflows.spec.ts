import { randomUUID } from "node:crypto";
import { test, expect, type APIRequestContext } from "@playwright/test";

async function createWork(request: APIRequestContext) {
  const result = await request.post("/api/works", { data: { title: "导入回归作品", idea: "仅用于浏览器回归。", requestId: randomUUID() } });
  expect(result.status()).toBe(201);
  return (await result.json()).id as string;
}

test("完整导入预览区分正文与资料，模型失败后原稿保留并可确认作者候选", async ({ page, request }) => {
  const id = await createWork(request);
  await page.goto(`/?work=${id}#/preparation`);
  await page.getByRole("button", { name: "导入已有正文", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导入正文与项目资料" });
  await dialog.locator('input[type="file"][multiple]').setInputFiles([
    { name: "第一章.md", mimeType: "text/markdown", buffer: Buffer.from("# 第一章 查账\n李长风翻开账本，发现红印。") },
    { name: "大纲.md", mimeType: "text/markdown", buffer: Buffer.from("第一章 查账\n李长风追查账本。\n第5000章 归还\n李长风归还账本。") },
    { name: "人物.json", mimeType: "application/json", buffer: Buffer.from('{"李长风":"查账的人"}') },
  ]);
  await dialog.getByRole("button", { name: "预览切分", exact: true }).click();
  await expect(dialog.getByRole("row", { name: /第 1 章 查账/ })).toBeVisible();
  await expect(dialog.getByRole("row", { name: /第 5000 章/ })).toHaveCount(0);
  await dialog.getByRole("button", { name: "导入 1 章", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("status")).toContainText("自动整理未完成");
  const headers = { "x-novel-project": id };
  const loaded = await request.get("/api/preparation", { headers });
  const state = await loaded.json();
  expect(state.materials).toHaveLength(2);
  expect(state.nextChapter).toBe(2);
  expect(state.proposals).toHaveLength(0);
  // 候选由确定性的作者输入创建；模型通道在整个服务中被禁用。
  const proposal = await request.post("/api/preparation/propose", { headers, data: { summary: "浏览器作者方案", baseFingerprint: state.fingerprint, changes: { plotLines: [{ id: "P_Case", label: "查账线", weight: "main" }] } } });
  expect(proposal.ok()).toBe(true);
  await page.reload();
  await page.getByRole("button", { name: /待确认 浏览器作者方案/ }).click();
  await page.getByRole("button", { name: "只确认方案", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("方案已确认");
  await page.reload();
  const confirmed = await (await request.get("/api/preparation", { headers })).json();
  expect(confirmed.confirmed.plotLines).toContainEqual({ id: "P_Case", label: "查账线", weight: "main" });
  expect(confirmed.nextChapter).toBe(2);
});

test("检索跳回原文并高亮，手机章末按钮可完整访问", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?work=browser-fixture#/search");
  await page.getByRole("textbox", { name: "全文检索", exact: true }).fill("红印");
  await page.getByRole("button", { name: "检索", exact: true }).click();
  await page.locator("a.search-snippet").first().click();
  await expect(page.locator("mark")).toContainText("红印");
  const next = page.getByRole("button", { name: "继续读第 2 章 →", exact: true });
  await next.scrollIntoViewIfNeeded();
  await expect(next).toBeInViewport();
  const bounds = await next.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(844);
  await next.click();
  await expect(page.getByRole("heading", { name: "第 2 章", exact: true })).toBeVisible();
});

test("白板网络失败有恢复入口", async ({ page }) => {
  await page.route("**/api/plot-board", route => route.fulfill({ status: 503, contentType: "application/json", body: '{"error":"验收模拟暂时不可用"}' }));
  await page.goto("/?work=browser-fixture#/plotboard");
  await expect(page.getByRole("heading", { name: "剧情白板暂时无法读取" })).toBeVisible();
  await page.unroute("**/api/plot-board");
  await page.getByRole("button", { name: "重新加载", exact: true }).click();
  await expect(page.getByRole("heading", { name: "剧情白板", exact: true })).toBeVisible();
});
