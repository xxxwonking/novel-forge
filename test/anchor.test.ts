/**
 * 锚点重定位（§6.3）。
 *
 * 这批测试的主线是一句话：**quote 是主键，offsetHint 只是提示。**
 * 所以"在前面插入内容"必须仍能定位，而"改写了那一段"必须降级为 stale
 * 而不是抛错 —— 后者是作者的正常行为。
 */

import { describe, expect, it } from "vitest";
import { anchorContext, resolveAnchor, resolveAnchors, textSourceOf } from "../src/anchor/resolve.js";
import { loadRules } from "../src/rules/load.js";
import type { TextAnchor } from "../src/types/primitives.js";

const rules = loadRules().anchor;

const CH1 = "破庙的门板早烂了，风从缺口里灌进来。李长风把断剑横在膝上，指腹沿着剑脊摸过去。裂纹比昨日又长了半分。";

function anchorOf(quote: string, offsetHint: number, occurrence = 0): TextAnchor {
  return { chapter: 1, quote, offsetHint, occurrence };
}

function sourceOf(text: string, chapter = 1): (c: number) => string | undefined {
  return textSourceOf(new Map([[chapter, text]]));
}

describe("resolveAnchor 命中", () => {
  it("offsetHint 准确时判 exact，返回真实 offset 与长度", () => {
    const quote = "李长风把断剑横在膝上";
    const at = CH1.indexOf(quote);
    const r = resolveAnchor(anchorOf(quote, at), sourceOf(CH1), rules);
    expect(r).toEqual({ status: "exact", offset: at, length: quote.length });
  });

  it("offsetHint 完全错但在容忍范围内 —— 仍判 exact", () => {
    // shiftTolerance 给得宽是刻意的：exact 与 shifted 对用户是同一件事，
    // 区分只为让 UI 提示"位置有变动"。
    const quote = "裂纹比昨日又长了半分";
    const r = resolveAnchor(anchorOf(quote, 0), sourceOf(CH1), rules);
    expect(r.status).toBe("exact");
  });

  it("前面插入大段内容后判 shifted，并报出位移量", () => {
    const quote = "裂纹比昨日又长了半分";
    const at = CH1.indexOf(quote);
    const padding = "补".repeat(rules.shiftTolerance + 50);
    const r = resolveAnchor(anchorOf(quote, at), sourceOf(padding + CH1), rules);

    expect(r.status).toBe("shifted");
    if (r.status !== "shifted") return;
    expect(r.offset).toBe(at + padding.length);
    expect(r.shiftedBy).toBe(padding.length);
  });

  it("整章前置内容后 offset 仍指向正文里真实的位置", () => {
    const quote = "断剑";
    const text = `新写的开头。${CH1}`;
    const r = resolveAnchor(anchorOf(quote, CH1.indexOf(quote)), sourceOf(text), rules);
    expect(r.status).not.toBe("stale");
    if (r.status === "stale") return;
    expect(text.slice(r.offset, r.offset + r.length)).toBe(quote);
  });
});

describe("resolveAnchor 降级", () => {
  it("章不存在 → chapter_missing", () => {
    const r = resolveAnchor(anchorOf("断剑", 0), () => undefined, rules);
    expect(r).toEqual({ status: "stale", reason: "chapter_missing" });
  });

  it("quote 被改写 → quote_not_found（不抛错）", () => {
    const r = resolveAnchor(anchorOf("这句话已经被作者删了", 100), sourceOf(CH1), rules);
    expect(r).toEqual({ status: "stale", reason: "quote_not_found" });
  });

  it("空 quote → stale，不返回 offset 0 的假命中", () => {
    // 空串的 indexOf 恒返回 0，不特判会让每个空锚点都"命中章首"。
    expect(resolveAnchor(anchorOf("", 0), sourceOf(CH1), rules)).toEqual({
      status: "stale",
      reason: "quote_not_found",
    });
  });
});

describe("occurrence：同 quote 多次命中", () => {
  const text = "他握紧了断剑。风停了。他又握紧了断剑。";
  const first = text.indexOf("握紧了断剑");
  const second = text.indexOf("握紧了断剑", first + 1);

  it("按 occurrence 取第 N 次", () => {
    const r0 = resolveAnchor(anchorOf("握紧了断剑", first, 0), sourceOf(text), rules);
    const r1 = resolveAnchor(anchorOf("握紧了断剑", second, 1), sourceOf(text), rules);
    expect(r0.status === "stale" ? -1 : r0.offset).toBe(first);
    expect(r1.status === "stale" ? -1 : r1.offset).toBe(second);
  });

  it("命中次数变少时退化为「离 offsetHint 最近的一处」而不是 stale", () => {
    // 作者删掉了前面那处重复 —— 原本 occurrence=1 的锚点该落到现在的第 0 处。
    // 硬认序号会把一次无害的编辑变成 stale。
    const trimmed = "风停了。他又握紧了断剑。";
    const r = resolveAnchor(anchorOf("握紧了断剑", second, 1), sourceOf(trimmed), rules);
    expect(r.status).not.toBe("stale");
    if (r.status === "stale") return;
    expect(trimmed.slice(r.offset, r.offset + r.length)).toBe("握紧了断剑");
  });

  it("退化时挑最近的那处，不是第一处", () => {
    const many = `${"填".repeat(400)}目标${"填".repeat(400)}目标`;
    const far = many.lastIndexOf("目标");
    const r = resolveAnchor(anchorOf("目标", far, 9), sourceOf(many), rules);
    expect(r.status === "stale" ? -1 : r.offset).toBe(far);
  });
});

describe("resolveAnchors 批量", () => {
  it("按章分组，逐项返回解析结果", () => {
    const items = [
      { a: anchorOf("断剑", 20) },
      { a: { chapter: 2, quote: "不存在", offsetHint: 0, occurrence: 0 } as TextAnchor },
    ];
    const out = resolveAnchors(items, (x) => x.a, sourceOf(CH1), rules);

    expect(out).toHaveLength(2);
    expect(out[0]?.resolution.status).toBe("exact");
    expect(out[1]?.resolution).toEqual({ status: "stale", reason: "chapter_missing" });
  });

  it("同一章的正文只取一次", () => {
    let calls = 0;
    const source = (c: number): string | undefined => {
      calls += 1;
      return c === 1 ? CH1 : undefined;
    };
    const items = Array.from({ length: 5 }, () => ({ a: anchorOf("断剑", 20) }));
    resolveAnchors(items, (x) => x.a, source, rules);
    expect(calls).toBe(1);
  });
});

describe("anchorContext", () => {
  it("给出前后文与命中段", () => {
    const quote = "李长风把断剑横在膝上";
    const at = CH1.indexOf(quote);
    const r = resolveAnchor(anchorOf(quote, at), sourceOf(CH1), rules);
    const ctx = anchorContext(CH1, r, 6);

    expect(ctx?.hit).toBe(quote);
    expect(ctx?.before).toBe(CH1.slice(at - 6, at));
    expect(ctx?.after).toBe(CH1.slice(at + quote.length, at + quote.length + 6));
  });

  it("章首命中时 before 为空而不是越界", () => {
    const r = resolveAnchor(anchorOf("破庙", 0), sourceOf(CH1), rules);
    expect(anchorContext(CH1, r, 20)?.before).toBe("");
  });

  it("stale 时返回 null（前端渲染降级态）", () => {
    expect(anchorContext(CH1, { status: "stale", reason: "quote_not_found" }, 10)).toBeNull();
  });
});
