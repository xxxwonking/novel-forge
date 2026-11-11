import { describe, expect, it } from "vitest";
import { chapterRoute, anchorFromQuery } from "../web/src/source-navigation.js";
import { resolveAnchor } from "../src/anchor/resolve.js";
import { loadRules } from "../src/rules/load.js";

describe("原文来源跳转", () => {
  it("保留特殊字符和重复引文位置，后端定位到第二处", () => {
    const quote = "证词 & # + ? 已收到。";
    const body = quote + "他又翻过了一页。" + quote;
    const point = { chapter: 3, quote, occurrence: 1, offsetHint: body.lastIndexOf(quote) };
    const route = chapterRoute(point.chapter, point.quote, point);
    const restored = anchorFromQuery(3, new URLSearchParams(route.split("?")[1]));
    expect(restored).toEqual(point);
    const resolution = resolveAnchor(restored!, () => body, loadRules().anchor);
    expect(resolution).toMatchObject({ status: "exact", offset: point.offsetHint });
  });
  it("兼容旧链接和普通章节入口，非法定位参数不传入 API", () => {
    expect(chapterRoute(2)).toBe("/chapter/2");
    expect(anchorFromQuery(2, new URLSearchParams("quote="))).toBeNull();
    expect(anchorFromQuery(2, new URLSearchParams("quote=旧引文"))).toEqual({ chapter: 2, quote: "旧引文", occurrence: 0, offsetHint: 0 });
    for (const value of ["-1", "Infinity", "NaN", "1.2", "1e3", "9007199254740992"]) {
      expect(anchorFromQuery(2, new URLSearchParams({ quote: "原文", occurrence: value, offsetHint: value }))).toMatchObject({ occurrence: 0, offsetHint: 0 });
    }
  });
});
