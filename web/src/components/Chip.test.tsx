import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Chip } from "./Chip.js";

describe("状态标签迁移", () => {
  it.each([
    [undefined, "neutral"], ["gold", "warning"], ["orange", "warning"],
    ["volcano", "danger"], ["processing", "info"], ["cyan", "info"],
  ] as const)("保留 %s 的业务状态并使用语义标签 %s", (color, tone) => {
    const html = renderToStaticMarkup(createElement(Chip, { color }, "需要作者核对"));
    expect(html).toContain(`data-tone="${tone}"`);
    expect(html).toContain('data-slot="badge"');
    expect(html).toContain("需要作者核对");
    expect(html).not.toContain("ant-tag");
  });
  it("透传提示所需的 DOM 属性，并保留业务 className", () => {
    const html = renderToStaticMarkup(createElement(Chip, { className: "tag-weight", "aria-describedby": "status-help", title: "原文已变动" }, "无法定位"));
    expect(html).toContain('aria-describedby="status-help"');
    expect(html).toContain('title="原文已变动"');
    expect(html).toContain("tag-weight");
  });
});
