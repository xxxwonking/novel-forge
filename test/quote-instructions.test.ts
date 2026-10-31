import { describe, expect, it } from "vitest";
import { buildC5Task } from "../src/chapter/pipeline.js";
import { buildInferenceTask } from "../src/import/infer.js";

describe("写章和旧稿的引文指令", () => {
  it("两条路径都要求先抄原文再写摘要，并给出拼接/改写的反例", () => {
    const context = { chapter: 1, knownCharacters: new Set(["C01"]), knownPlotLines: new Set(["P01"]),
      knownForeshadows: new Set<string>(), allocateForeshadowId: () => "F01" as const };
    const tasks = [buildC5Task(context), buildInferenceTask({ chapter: 1, chapterText: "", parseContextBase: context,
      title: "验收", openForeshadows: [], plannedForeshadows: [], synopses: [] })];
    for (const text of tasks) {
      expect(text).toContain("先在正文里找到");
      expect(text).toContain("再围绕它写 summary / intent");
      expect(text).toContain("不要拼接不同位置的句子");
      expect(text).toContain("他将青铜钥匙放回怀中");
      expect(text).toContain("交卷前");
    }
  });
});
