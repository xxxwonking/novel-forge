import { describe, expect, it } from "vitest";
import { quoteCatalog } from "../src/chapter/quote-catalog.js";

describe("结构声明的原文编号", () => {
  const body = '“笔顺都对得上。”沈砚看着顾青，“不是伪造的。”\n他放下账册。';
  it("编号只还原成连续原文，不把对白两侧拼成新句子", () => {
    const catalog = quoteCatalog(body);
    expect(catalog.entries.length).toBeGreaterThan(0);
    for (const entry of catalog.entries) {
      expect(body).toContain(entry.text);
      expect(entry.text).toMatch(/[\p{L}\p{N}]/u);
    }
    const chosen = catalog.entries[0]!;
    const raw = { events: [{ quote: chosen.ref, summary: "核实签名" }] };
    expect(catalog.resolve(raw)).toEqual({ events: [{ quote: chosen.text, summary: "核实签名" }] });
    expect(raw.events[0]!.quote).toBe(chosen.ref);
  });
  it("错误编号不能变成事实；旧客户端的逐字引文保持兼容", () => {
    const catalog = quoteCatalog(body);
    expect(() => catalog.resolve({ character_states: [{ quote: "@quote:99999" }] })).toThrow(/引文编号/);
    expect(catalog.resolve({ events: [{ quote: "他放下账册" }] })).toEqual({ events: [{ quote: "他放下账册" }] });
  });
  it("结构化 schema 只允许选原文编号；同文生成的编号保持稳定", () => {
    const catalog = quoteCatalog(body);
    const schema = catalog.schema.properties as Record<string, {items: {properties: {quote: {enum: string[]}}}}>;
    expect(schema.events!.items.properties.quote.enum).toEqual(catalog.entries.map(e => e.ref));
    expect(quoteCatalog(body).entries).toEqual(catalog.entries);
    expect(catalog.instruction).toContain(catalog.entries[0]!.ref);
  });
});
