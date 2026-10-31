import { describe, expect, it } from "vitest";
import { insertionPoints, resolveInsertion, validateInsertionPoints } from "../src/task/expansion-scope.js";

describe("冻结的扩写位置", () => {
  it("重复段落与 CRLF 仍按精确位置区分", () => {
    const body = "开场。\r\n\r\n相同段落。\r\n\r\n相同段落。";
    const points = insertionPoints(body);
    expect(resolveInsertion("@insert:3\r\n新增行动。", points)).toEqual({ offset: body.lastIndexOf("相同段落"), boundary: "相同段落。", addition: "新增行动。" });
    expect(() => validateInsertionPoints(body, points)).not.toThrow();
  });
  it("原稿变更或目录被改动就拒绝复用", () => {
    const body = "原稿。\n\n结尾。";
    const points = insertionPoints(body);
    expect(() => validateInsertionPoints("原稿已修改。\n\n结尾。", points)).toThrow(/原稿/);
    expect(() => validateInsertionPoints(body, [{ ...points[0]!, offset: 1 }, points[1]!])).toThrow(/原稿/);
  });
  it("同一次输出不能混入第二个插入位置", () => {
    expect(() => resolveInsertion("@insert:1\n新增行动。\n@insert:2\n另一段。", insertionPoints("开头。\n\n结尾。"))).toThrow(/一个/);
  });
});
