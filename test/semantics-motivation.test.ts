/**
 * 语义审查的第二批判据：人物动机与设定矛盾。
 *
 * 这两项在差距盘点里被标成"判据最模糊"。收住它们的办法是**锚在已有的结构化基准**上，
 * 不做开放式评论：
 *   - 动机 → 作者明确写下的 `forbiddenBehaviors`（"绝不主动求人"）与 wants/fears；
 *   - 矛盾 → 地点/组织的 `facts`、世界规则、能力限制、`immutable` 的外貌属性。
 *
 * 《雾港封签》验收里那句「唯一钥匙被写成备用钥匙」正是后者 —— 有基准、可指认、能引文。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSemanticVerdict } from "../src/gate/semantics-channel.js";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { buildChapterRunInput } from "../src/server/chapter-input.js";
import { writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const CHAPTER = [
  "沈砚把封存箱的盖子推回去，账册在手里翻了两遍。",
  "他拉住顾青的袖子，低声求她帮忙遮掩这件事。",
  "他从怀里摸出那把备用钥匙，插进封存箱的锁孔。",
].join("\n");

const CHARACTERS = [{ id: "C_ShenYan", name: "沈砚", forbiddenBehaviors: ["绝不主动求人"], wants: "查清旧账", fears: "牵出家里人" }];
const CANON = [{ source: "旧账库", fact: "封存箱只有一枚铜钥匙，没有备用" }];

const parse = (verdict: unknown, over: Partial<Parameters<typeof parseSemanticVerdict>[1]> = {}) =>
  parseSemanticVerdict(verdict, {
    chapterText: CHAPTER, povCharacterId: "C_ShenYan", resolutions: [],
    characters: CHARACTERS, canon: CANON, ...over,
  });
const rules = (verdict: unknown, over = {}) => parse(verdict, over).map((f) => f.rule);
const issues = (list: readonly unknown[]) => ({ issues: list });

describe("语义审查：人物动机与设定矛盾", () => {
  it("违反明确写下的禁止行为，产出 warn 并点名人物与依据", () => {
    const findings = parse(issues([{ kind: "motivation", characterId: "C_ShenYan",
      quote: "他拉住顾青的袖子，低声求她帮忙遮掩这件事。", reason: "他的设定里写明绝不主动求人。" }]));
    expect(findings.map((f) => f.rule)).toEqual(["semantic_motivation_break"]);
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("沈砚");
    expect(findings[0]?.message).toContain("绝不主动求人");
  });

  it("与已确认设定矛盾，产出 warn 并带出被违背的那条事实", () => {
    const findings = parse(issues([{ kind: "contradiction",
      quote: "他从怀里摸出那把备用钥匙，插进封存箱的锁孔。", reason: "设定里封存箱只有一枚铜钥匙。" }]));
    expect(findings.map((f) => f.rule)).toEqual(["semantic_setting_contradiction"]);
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("备用钥匙");
  });

  it("引文找不到时照样丢弃并计数 —— 与前两项同一条纪律", () => {
    const findings = parse(issues([
      { kind: "motivation", characterId: "C_ShenYan", quote: "编的引文", reason: "甲" },
      { kind: "contradiction", quote: "也是编的", reason: "乙" },
    ]));
    expect(findings.map((f) => f.rule)).toEqual(["semantic_verdict_unverifiable"]);
    expect(findings[0]?.message).toContain("2");
  });

  it("动机项指到不在本章的人物就忽略，不猜", () => {
    expect(rules(issues([{ kind: "motivation", characterId: "C_Nobody",
      quote: "他拉住顾青的袖子，低声求她帮忙遮掩这件事。", reason: "x" }]))).toEqual([]);
  });

  it("没有人物基准 / 没有设定事实时，对应那一项不产出", () => {
    const motivation = issues([{ kind: "motivation", characterId: "C_ShenYan", quote: "他拉住顾青的袖子，低声求她帮忙遮掩这件事。", reason: "x" }]);
    expect(rules(motivation, { characters: [] })).toEqual([]);
    const contradiction = issues([{ kind: "contradiction", quote: "他从怀里摸出那把备用钥匙，插进封存箱的锁孔。", reason: "x" }]);
    expect(rules(contradiction, { canon: [] })).toEqual([]);
  });

  it("四类判定可以并存，各走各的 rule", () => {
    expect(rules(issues([
      { kind: "pov", quote: "沈砚把封存箱的盖子推回去，账册在手里翻了两遍。", reason: "甲" },
      { kind: "motivation", characterId: "C_ShenYan", quote: "他拉住顾青的袖子，低声求她帮忙遮掩这件事。", reason: "乙" },
      { kind: "contradiction", quote: "他从怀里摸出那把备用钥匙，插进封存箱的锁孔。", reason: "丙" },
    ]))).toEqual(["semantic_pov_breach", "semantic_motivation_break", "semantic_setting_contradiction"]);
  });
});

/**
 * 基准是**从已确认资料里长出来的**，不是判定时临时编的。
 * 这一组盯住装配环节：喂给模型的 canon 与动机基准确实来自作品设定。
 */
describe("语义审查的基准来自已确认资料", () => {
  it("canon 收进世界规则、能力限制、地点 facts 与不可变外貌，且不收主观描述", () => {
    const root = mkdtempSync(join(tmpdir(), "nf-semantics-canon-"));
    roots.push(root);
    new ProjectStore(root).save(writingSnapshot());
    const input = buildChapterRunInput(new ProjectSession(root), 3);
    const canon = input.gate?.canon ?? [];
    const facts = canon.map((item) => item.fact);

    expect(facts).toContain("灵石是唯一通用货币，一枚灵石可换十日灵米。");
    expect(canon.some((item) => item.source === "世界规则")).toBe(true);
    // 地点 facts 带出处，作者才知道是跟哪条设定矛盾。
    expect(canon.some((item) => item.source === "青云门" || item.source === "青州城")).toBe(true);
    // 不可变外貌进来，可变的（伤势、发型）不进 —— 那些本来就会随剧情变。
    expect(facts.some((fact) => fact.includes("不可变"))).toBe(true);
    expect(facts.some((fact) => fact.includes("左肩旧伤未愈"))).toBe(false);
    // 风格关键词是主观描述，拿它当矛盾判据只会产生无法辩驳的提示。
    expect(facts.some((fact) => fact.includes("冷硬"))).toBe(false);
  });

  it("动机基准取本章点名人物的禁止行为与诉求", () => {
    const root = mkdtempSync(join(tmpdir(), "nf-semantics-baseline-"));
    roots.push(root);
    new ProjectStore(root).save(writingSnapshot());
    const characters = buildChapterRunInput(new ProjectSession(root), 3).gate?.characters ?? [];
    expect(characters.length).toBeGreaterThan(0);
    // profile 确实到得了检查层 —— 类型以前声明得比实际窄，动机判定就是靠它。
    expect(characters.every((card) => card.profile !== undefined)).toBe(true);
    expect(characters.some((card) => (card.profile?.forbiddenBehaviors ?? []).length > 0)).toBe(true);
  });
});
