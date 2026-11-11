import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type KeyboardEvent, type SVGProps } from "react";
import { AnchorDot, type AnchorDotProps } from "./AnchorDot.js";

const props: AnchorDotProps = {
  point: { chapter: 5, anchor: { chapter: 5, quote: "他打开了第二封信。", offsetHint: 120, occurrence: 1 }, resolution: { status: "exact", offset: 120, length: 9 } },
  x: 12, y: 12, r: 4, fill: "currentColor", title: "第二封信", onJump: () => {},
};
describe("结构视图原文入口", () => {
  it("鼠标和键盘都保留来源定位，具有按钮名称", () => {
    const jump = vi.fn();
    const element = AnchorDot({ ...props, onJump: jump });
    const handlers = element.props as SVGProps<SVGCircleElement>;
    handlers.onClick?.({} as React.MouseEvent<SVGCircleElement>);
    for (const key of ["Enter", " "]) {
      const preventDefault = vi.fn();
      handlers.onKeyDown?.({ key, preventDefault } as unknown as KeyboardEvent<SVGCircleElement>);
      expect(preventDefault).toHaveBeenCalled();
    }
    expect(jump).toHaveBeenCalledTimes(3);
    expect(jump).toHaveBeenLastCalledWith(5, props.point.anchor.quote, props.point.anchor);
    const html = renderToStaticMarkup(createElement(AnchorDot, props));
    expect(html).toContain('role="button"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('aria-label="第二封信"');
  });
  it("出处失效时不给出可操作按钮", () => {
    const element = AnchorDot({ ...props, point: { ...props.point, resolution: { status: "stale", reason: "quote_not_found" } } });
    const handlers = element.props as SVGProps<SVGCircleElement>;
    expect(handlers.onClick).toBeUndefined();
    expect(handlers.onKeyDown).toBeUndefined();
    expect(handlers.tabIndex).toBeUndefined();
  });
});
