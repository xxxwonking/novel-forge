import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Button } from "./button.js";

describe("迁移按钮的表单与链接行为", () => {
  it("普通操作不隐式提交表单，显式提交按钮仍可提交", () => {
    const html = renderToStaticMarkup(createElement("form", {}, createElement(Button, {}, "取消"), createElement(Button, { type: "submit" }, "保存")));
    expect(html).toMatch(/type="button"[^>]*>取消/);
    expect(html).toMatch(/type="submit"[^>]*>保存/);
  });
  it("导航保留真实链接和浏览器原生行为", () => {
    const html = renderToStaticMarkup(createElement(Button, { asChild: true }, createElement("a", { href: "#/works" }, "全部作品")));
    expect(html).toMatch(/^<a /);
    expect(html).toContain('href="#/works"');
    expect(html).not.toContain('type="button"');
  });
});
