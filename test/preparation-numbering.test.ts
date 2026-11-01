import { describe, expect, it } from "vitest";
import { nextPlanChapter, nextVolumeNumber } from "../web/src/preparation-numbering.js";

describe("资料页新增编号", () => {
  it("手工新增计划跨过所有已排未来章，不覆盖已有计划", () => {
    expect(nextPlanChapter(176, [{ chapter: 176 }, { chapter: 178 }])).toBe(179);
    expect(nextPlanChapter(176, [])).toBe(176);
  });
  it("已有卷卡即使还没有章计划，也不能被新增覆盖", () => {
    expect(nextVolumeNumber([{ volume: 1 }, { volume: 2 }], [])).toBe(3);
    expect(nextVolumeNumber([{ volume: 1 }], [{ volume: 4 }])).toBe(5);
    expect(nextVolumeNumber([], [])).toBe(1);
  });
});
