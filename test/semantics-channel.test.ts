/**
 * 语义审查（POV 越界 / 伏笔兑现）的判定解析。
 *
 * 这两项对应的是《雾港封签》验收里人工发现、而 C6 一处都没抓到的真问题：
 * 结尾越出视角人物的感知、以及「声明已收」但正文没真交代当初埋下的意图。
 *
 * 与 voice-model 同一条纪律：**模型说的每句话都要能在正文里找到原文**。
 * 找不到就丢掉并说出来 —— 让无法核对的判定进结论，作者只能靠放宽规则消掉它。
 */

import { describe, expect, it } from "vitest";
import { parseSemanticVerdict } from "../src/gate/semantics-channel.js";

const CHAPTER = [
  "沈砚把封存箱的盖子推回去，账册在手里翻了两遍。",
  "他没看见顾青什么时候走到门口。",
  "库房里还有半枚陌生的指纹，他记下了。",
].join("\n");

const POV = "C_ShenYan";
const RESOLUTIONS = [{ foreshadowId: "F02", label: "铜钥匙只有一枚" }];

const parse = (verdict: unknown, over: { povCharacterId?: string | null; resolutions?: typeof RESOLUTIONS } = {}) =>
  parseSemanticVerdict(verdict, {
    chapterText: CHAPTER,
    povCharacterId: over.povCharacterId === undefined ? POV : over.povCharacterId,
    resolutions: over.resolutions ?? RESOLUTIONS,
  });
const rules = (verdict: unknown, over = {}) => parse(verdict, over).map((f) => f.rule);
const issues = (list: readonly unknown[]) => ({ issues: list });

describe("语义审查的判定解析", () => {
  it("POV 越界：引文可定位时产出 warn 并带出原文", () => {
    const findings = parse(issues([{ kind: "pov", quote: "他没看见顾青什么时候走到门口。", reason: "这句交代了视角人物看不到的信息。" }]));
    expect(findings.map((f) => f.rule)).toEqual(["semantic_pov_breach"]);
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("他没看见顾青什么时候走到门口。");
  });

  it("伏笔兑现：引文可定位时产出 warn 并点名伏笔", () => {
    const findings = parse(issues([{ kind: "resolution", foreshadowId: "F02", quote: "库房里还有半枚陌生的指纹，他记下了。", reason: "只提到指纹，没有交代铜钥匙只有一枚这件事。" }]));
    expect(findings.map((f) => f.rule)).toEqual(["semantic_resolution_unfulfilled"]);
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("铜钥匙只有一枚");
  });

  it("引文在正文里找不到就丢掉，并说明丢了几条", () => {
    const findings = parse(issues([{ kind: "pov", quote: "这句正文里根本没有。", reason: "编的" }]));
    expect(findings.map((f) => f.rule)).not.toContain("semantic_pov_breach");
    const note = findings.find((f) => f.rule === "semantic_verdict_unverifiable");
    expect(note?.level).toBe("info");
    expect(note?.message).toContain("1");
  });

  it("本章没有声明视角人物时，POV 这一项不产出", () => {
    const verdict = issues([{ kind: "pov", quote: "他没看见顾青什么时候走到门口。", reason: "x" }]);
    expect(rules(verdict, { povCharacterId: null })).toEqual([]);
  });

  it("收束的伏笔不在本章声明里就不认（模型不能凭空指认）", () => {
    const verdict = issues([{ kind: "resolution", foreshadowId: "F99", quote: "库房里还有半枚陌生的指纹，他记下了。", reason: "x" }]);
    expect(rules(verdict)).toEqual([]);
  });

  it("未知的 kind 一律忽略", () => {
    expect(rules(issues([{ kind: "motivation", quote: "库房里还有半枚陌生的指纹，他记下了。", reason: "x" }]))).toEqual([]);
  });

  it("输出结构不对时说明判不了，而不是当作没有问题", () => {
    for (const bad of [null, {}, { issues: "nope" }, { issues: null }]) {
      const findings = parse(bad);
      expect(findings.map((f) => f.rule)).toEqual(["semantic_verdict_unusable"]);
      expect(findings[0]?.level).toBe("info");
    }
  });

  it("没有问题时不产出任何东西 —— 干净的稿子不该有 findings", () => {
    expect(parse(issues([]))).toEqual([]);
  });

  it("多项并存时逐条核对，一条不合格不影响其他条", () => {
    const findings = parse(issues([
      { kind: "pov", quote: "编的引文", reason: "甲" },
      { kind: "resolution", foreshadowId: "F02", quote: "库房里还有半枚陌生的指纹，他记下了。", reason: "乙" },
    ]));
    expect(findings.map((f) => f.rule)).toEqual(["semantic_verdict_unverifiable", "semantic_resolution_unfulfilled"]);
  });
});
