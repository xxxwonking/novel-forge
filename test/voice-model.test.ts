/**
 * 声音一致性 model 通道的判定解析。
 *
 * 这个文件里最重要的一组用例是**证据核对**：模型说的每一句话都要能在正文里
 * 找到原文，找不到就丢掉 —— 与 C5 交叉校验同一条原则。让无法核对的判定进入
 * 结论，作者就只能靠放宽规则消掉它（§10.10）。
 */

import { describe, expect, it } from "vitest";
import { parseVoiceVerdict } from "../src/gate/voice-model.js";
import type { VoiceCharacter } from "../src/gate/voice-channel.js";
import type { SpeechProfile } from "../src/types/character.js";

const speech = (over: Partial<SpeechProfile> = {}): SpeechProfile => ({
  sentenceLength: { min: 0, max: 0 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [],
  syntaxBias: { question: 0, imperative: 0, elliptical: 0 }, register: "neutral", emotionalExpression: "direct",
  exemplars: [""], counterExemplars: [], ...over,
});

const SHEN: VoiceCharacter = { id: "C_ShenYan", name: "沈砚", aliases: [], speech: speech({ register: "colloquial" }) };
const GU: VoiceCharacter = { id: "C_GuQing", name: "顾青", aliases: [], speech: speech() };
const CHAPTER = "沈砚把册子推回去。\n沈砚说：「此册所记，与清册不符。」\n顾青把灯挑亮，没有接话。";

const parse = (verdict: unknown) =>
  parseVoiceVerdict(verdict, { chapterText: CHAPTER, characters: [SHEN, GU] });
const rules = (verdict: unknown) => parse(verdict).map((f) => f.rule);

const verdict = (entries: readonly unknown[]) => ({ characters: entries });

describe("声音 model 通道的判定解析", () => {
  it("判不符且引文能在正文里找到时，产出对应字段的 warn", () => {
    const findings = parse(verdict([{ characterId: "C_ShenYan", field: "register", ok: false,
      quote: "此册所记，与清册不符。", reason: "这句是书面语，他平时说话不是这个腔调。" }]));
    expect(findings.map((f) => f.rule)).toEqual(["voice_register"]);
    expect(findings[0]?.level).toBe("warn");
    expect(findings[0]?.message).toContain("沈砚");
    expect(findings[0]?.message).toContain("书面语");
    // 引文要带进消息里 —— 作者得能凭它自己看一眼再决定改不改。
    expect(findings[0]?.message).toContain("此册所记，与清册不符。");
  });

  it("三个字段各自映射到自己的 rule", () => {
    expect(rules(verdict([
      { characterId: "C_ShenYan", field: "register", ok: false, quote: "此册所记，与清册不符。", reason: "腔调不对" },
      { characterId: "C_ShenYan", field: "emotionalExpression", ok: false, quote: "此册所记，与清册不符。", reason: "他不这样直给" },
      { characterId: "C_GuQing", field: "addressForms", ok: false, quote: "顾青把灯挑亮", reason: "不该直呼其名" },
    ]))).toEqual(["voice_register", "voice_emotional_expression", "voice_address_form"]);
  });

  it("引文在正文里找不到就丢掉这条判定，并说明丢弃了什么", () => {
    const findings = parse(verdict([{ characterId: "C_ShenYan", field: "register", ok: false,
      quote: "这句正文里根本没有。", reason: "随便编的" }]));
    expect(findings.map((f) => f.rule)).not.toContain("voice_register");
    const note = findings.find((f) => f.rule === "voice_verdict_unverifiable");
    expect(note?.level).toBe("info");
    // 丢弃也要说清丢了几条，不能静默少报。
    expect(note?.message).toContain("1");
  });

  it("判为一致的条目不产出任何东西", () => {
    expect(parse(verdict([{ characterId: "C_ShenYan", field: "register", ok: true, quote: "", reason: "" }]))).toEqual([]);
  });

  it("未知人物或未知字段一律忽略，不猜也不崩", () => {
    expect(rules(verdict([
      { characterId: "C_Nobody", field: "register", ok: false, quote: "此册所记，与清册不符。", reason: "x" },
      { characterId: "C_ShenYan", field: "vital", ok: false, quote: "此册所记，与清册不符。", reason: "x" },
    ]))).toEqual([]);
  });

  it("输出结构不对时说明判不了，而不是当作没有问题", () => {
    for (const bad of [null, {}, { characters: "nope" }, { characters: null }]) {
      const findings = parse(bad);
      expect(findings.map((f) => f.rule)).toEqual(["voice_verdict_unusable"]);
      expect(findings[0]?.level).toBe("info");
    }
  });

  it("同一人物的多条判定逐条核对，一条不合格不影响其他条", () => {
    const findings = parse(verdict([
      { characterId: "C_ShenYan", field: "register", ok: false, quote: "沈砚把册子推回去", reason: "甲" },
      { characterId: "C_ShenYan", field: "emotionalExpression", ok: false, quote: "编的引文", reason: "乙" },
      { characterId: "C_ShenYan", field: "addressForms", ok: false, quote: "顾青把灯挑亮", reason: "丙" },
    ]));
    expect(findings.map((f) => f.rule)).toEqual(["voice_register", "voice_verdict_unverifiable", "voice_address_form"]);
  });
});
