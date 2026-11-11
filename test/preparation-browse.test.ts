import { describe, expect, it } from "vitest";
import { filterCharacters } from "../web/src/preparation-browse.js";
import { characters } from "./fixtures.js";

describe("人物档案查找", () => {
  it("姓名、别名和身份可组合查找，结果保持原档案引用", () => {
    const before = JSON.stringify(characters);
    const found = filterCharacters(characters, " 断剑少年  主角 ", "all");
    expect(found).toHaveLength(1);
    expect(found[0]).toBe(characters[0]);
    expect(filterCharacters(characters, "李长风", "protagonist")).toEqual(found);
    expect(filterCharacters(characters, "李长风", "minor")).toEqual([]);
    expect(JSON.stringify(characters)).toBe(before);
  });
  it("支持大小写和全角规范化，空条件恢复全部", () => {
    const record = { ...characters[0]!, aliases: ["ＬＩ Ｘ"] };
    expect(filterCharacters([record], "li x", "all")).toEqual([record]);
    expect(filterCharacters(characters, " \t ", "all")).toEqual(characters);
    expect(filterCharacters(characters, "不存在的人", "all")).toEqual([]);
  });
});
