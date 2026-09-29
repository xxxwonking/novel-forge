/**
 * 导入预览里「逐字相同的章」折成区间。
 *
 * 重导一本完本会撞出上百条「第 N 章本次跳过」，把真正要作者拿主意的那几条
 * （锁住的、要覆盖的）埋在底下 —— 不需要动作的信息不配占一百行。
 */

import { describe, expect, it } from "vitest";
import { ranges } from "./ImportChapters.js";
import { ErrorBoundary } from "./ErrorBoundary.js";

describe("章号折成区间", () => {
  it("整本连号只出一段", () => {
    expect(ranges(Array.from({ length: 100 }, (_, i) => i + 1))).toBe("1–100");
  });

  it("断开的地方分段，单独一章不写成区间", () => {
    expect(ranges([1, 2, 3, 5, 8, 9])).toBe("1–3、5、8–9");
  });

  it("乱序也按章号排好 —— 调用方是 filter 出来的，顺序不该由它保证", () => {
    expect(ranges([9, 1, 3, 2])).toBe("1–3、9");
  });

  it("只有一章就是那一章", () => {
    expect(ranges([7])).toBe("7");
  });
});

describe("渲染出错时的兜底", () => {
  it("抓到错误后转入错误态，而不是把整棵树交还给 React 卸掉", () => {
    // 白屏的成因就是这一步缺席：一处 TypeError 让 React 卸载整个应用，
    // 作者连导航栏都看不见。这里只钉住契约，面板本身在浏览器里验。
    expect(ErrorBoundary.getDerivedStateFromError(new Error("读不到 materials"))).toEqual({
      error: new Error("读不到 materials"),
    });
  });
});
