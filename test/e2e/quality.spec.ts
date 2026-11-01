import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const route = (name: string) => `/?work=browser-fixture#/${name}`;

test("手机选中节点立即显示详情，关闭归还焦点并保留画布", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route("plotboard"));
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
  const node = page.getByRole("group", { name: /资料节点 1/ });
  await expect(node).toBeVisible();
  const before = await node.boundingBox();
  await node.focus();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Enter");
  const details = page.getByRole("dialog", { name: "节点详情", exact: true });
  await expect(details).toBeVisible();
  await expect(details).toBeInViewport();
  await expect.poll(async () => { const box = await details.boundingBox(); return box ? box.y + box.height : Infinity; }).toBeLessThanOrEqual(844.5);
  await expect(details.getByText("李长风发现账本，决定追查旧案。", { exact: true })).toBeVisible();
  await expect(details.getByRole("button", { name: "打开原文" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(details).toHaveCount(0);
  await expect(node).toBeFocused();
  const after = await node.boundingBox();
  expect(after?.x).toBeCloseTo(before!.x, 0);
  expect(after?.y).toBeCloseTo(before!.y, 0);
});

test("桌面保留详情栏，跨断点切换不残留遮罩或丢失选中", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(route("plotboard"));
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
  const node = page.getByRole("group", { name: /资料节点 1/ });
  await node.click();
  await expect(page.getByRole("complementary", { name: "剧情节点详情" })).toBeInViewport();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("dialog", { name: "节点详情" })).toBeInViewport();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "剧情节点详情" })).toHaveCount(0);
  await page.getByRole("button", { name: "收起全部", exact: true }).click();
  await expect(page.getByRole("button", { name: "展开情节线" })).toBeVisible();
});

test("白板颜色随公共token变化，手机点选同样能打开详情", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route("plotboard"));
  await page.getByRole("button", { name: "展开全部", exact: true }).click();
  await page.addStyleTag({ content: ":root { --background: rgb(12, 18, 24); }" });
  await expect(page.getByRole("region", { name: "剧情白板" })).toHaveCSS("background-color", "rgb(12, 18, 24)");
  await page.getByRole("group", { name: /资料节点 1/ }).click();
  const details = page.getByRole("dialog", { name: "节点详情" });
  await expect(details).toBeInViewport();
  await expect(details).toHaveCSS("background-color", "rgb(12, 18, 24)");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("手机从分组详情展开后返回画布，不把焦点留在已删除的折叠卡片", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route("plotboard"));
  await page.getByRole("group", { name: /4 个节点/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "展开查看事件", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("group", { name: /资料节点 1/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "剧情画布", exact: true })).toBeFocused();
});

for (const section of ["preparation", "chapter/1"]) {
  test(`${section}没有重复无名地标或跳级标题`, async ({ page }) => {
    await page.goto(route(section));
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    const result = await new AxeBuilder({ page }).withRules(["landmark-unique", "heading-order"]).analyze();
    expect(result.violations).toEqual([]);
  });
}

test("人物弹窗的标题层级正确，手机保存按钮可见且关闭恢复焦点", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(route("preparation"));
  const edit = page.getByRole("button", { name: "编辑「李长风」", exact: true });
  await edit.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: "保存", exact: true })).toBeInViewport();
  const result = await new AxeBuilder({ page }).withRules(["heading-order"]).analyze();
  expect(result.violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(edit).toBeFocused();
});
