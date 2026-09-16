/**
 * C6 声音一致性 code 通道。
 *
 * 每条检查都成对写：命中要给得出 finding，不该命中时要真的沉默。
 * 后半边更重要 —— 一个消不掉的假警告会让作者关掉整个检查器（§10.10）。
 */

import { describe, expect, it } from "vitest";
import { gateVoice, groupSpeech, type VoiceCharacter } from "../src/gate/voice-channel.js";
import { loadRules } from "../src/rules/load.js";
import type { SpeechProfile } from "../src/types/character.js";

const rules = loadRules();

const speech = (over: Partial<SpeechProfile> = {}): SpeechProfile => ({
  sentenceLength: { min: 0, max: 0 },
  verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [],
  syntaxBias: { question: 0, imperative: 0, elliptical: 0 },
  register: "neutral", emotionalExpression: "direct",
  exemplars: [""], counterExemplars: [],
  ...over,
});

const SHEN: VoiceCharacter = { id: "C_ShenYan", name: "沈砚", aliases: [],
  speech: speech({ sentenceLength: { min: 4, max: 14 }, verbalTics: ["对不上"], signatureLexicon: ["凭据"], forbiddenLexicon: ["没问题"] }) };
const GU: VoiceCharacter = { id: "C_GuQing", name: "顾青", aliases: [],
  speech: speech({ sentenceLength: { min: 2, max: 10 } }) };

const rules_fired = (text: string, characters: readonly VoiceCharacter[] = [SHEN, GU]) =>
  gateVoice({ chapterText: text, characters }, rules).map((finding) => finding.rule);

describe("声音一致性 code 通道", () => {
  it("说了自己的禁用词就 block，并指名道姓", () => {
    const findings = gateVoice({ chapterText: "沈砚把册子推回去。「这账没问题。」", characters: [SHEN] }, rules);
    expect(findings.map((f) => f.rule)).toContain("voice_forbidden_lexicon");
    expect(findings.find((f) => f.rule === "voice_forbidden_lexicon")?.level).toBe("block");
    expect(findings[0]?.message).toContain("沈砚");
  });

  it("禁用词表为空时不误报", () => {
    expect(rules_fired("顾青把钥匙收好。「钥匙在我这儿。」")).not.toContain("voice_forbidden_lexicon");
  });

  it("中位句长偏长会 warn，且不被一句爆发台词带偏", () => {
    const chatty = "沈砚把册子摊开，一句一句念下去，念完又回头核对了一遍方才的数目。";
    const short = "沈砚：「这本账对不上。」";
    expect(rules_fired(short)).not.toContain("voice_sentence_length");
    // 一句长 + 三句短：中位数仍在区间内，均值会被拽出去。
    const mixed = `沈砚把册子推回去。「对不上。」\n沈砚：「少了三箱。」\n沈砚：「我先记下。」\n沈砚：${chatty}`;
    expect(rules_fired(mixed)).not.toContain("voice_sentence_length");
    const allLong = `沈砚把册子推回去，一页一页重新核对过往三年的旧账数目。\n沈砚：「这批封存箱的编号与清册上记的对不上。」`;
    expect(rules_fired(allLong)).toContain("voice_sentence_length");
  });

  it("台词够多却没用到口头禅才 warn，台词少时不查", () => {
    const few = "沈砚：「对不上。」\n沈砚：「我再看看。」";
    expect(rules_fired(few)).not.toContain("voice_verbal_tic_missing");
    const many = Array.from({ length: 6 }, (_, i) => `沈砚把第 ${i} 册翻开，逐页核对。\n沈砚：「这一册也少了。」`).join("\n");
    expect(rules_fired(many)).toContain("voice_verbal_tic_missing");
  });

  it("专属词跑到别人嘴里才算串味，主人自己说没问题", () => {
    const mine = "沈砚把手按住清册。「我只看凭据。」";
    expect(rules_fired(mine)).not.toContain("voice_signature_leak");
    const leaked = "沈砚把手按住清册。\n顾青把灯挑亮：「凭据在他手里。」";
    expect(rules_fired(leaked)).toContain("voice_signature_leak");
  });

  it("问句占比偏离目标会 warn，落在容差内则沉默", () => {
    const asks = speech({ sentenceLength: { min: 2, max: 22 }, syntaxBias: { question: 0.9, imperative: 0, elliptical: 0 } });
    const asker: VoiceCharacter = { id: "C_Ask", name: "审问者", aliases: [], speech: asks };
    // 目标是几乎句句发问，实际一句都没问 —— 这就是"说话不像他"。
    const flat = "审问者把灯挑亮。\n审问者：「封存箱我数过了。」\n审问者：「清册也对过。」\n审问者：「少了三箱。」";
    expect(rules_fired(flat, [asker])).toContain("voice_syntax_bias");
    // 「吗」「呢」收尾同样算问句 —— 中文里问句不总带问号。
    const matching = "审问者把灯挑亮。\n审问者：「你数过吗。」\n审问者：「钥匙在谁那儿呢。」\n审问者：「封条是新的？」";
    expect(rules_fired(matching, [asker])).not.toContain("voice_syntax_bias");
  });

  it("归不上属的台词不参与判定，但覆盖缺口要显式说出来", () => {
    // 两人同段、引号前后都没有言说动词 —— 归属必须沉默。
    const ambiguous = "沈砚与顾青在库房里站了很久。四壁的册子一直堆到梁上。「这里少了三箱。」";
    const { bySpeaker, unattributed } = groupSpeech({ chapterText: ambiguous, characters: [SHEN, GU] }, rules);
    expect(bySpeaker.size).toBe(0);
    expect(unattributed).toHaveLength(1);
    const findings = gateVoice({ chapterText: ambiguous, characters: [SHEN, GU] }, rules);
    expect(findings.map((f) => f.rule)).toContain("voice_attribution_incomplete");
    expect(findings.find((f) => f.rule === "voice_attribution_incomplete")?.level).toBe("info");
    // 没归属就没有主语级判定 —— 不能凭空说「沈砚句长不对」。
    expect(findings.map((f) => f.rule)).not.toContain("voice_sentence_length");
  });

  it("禁用词落在无归属的台词里时单独报出来，不装作没看见", () => {
    const text = "沈砚与顾青在库房里站了很久。「这账没问题。」";
    const findings = gateVoice({ chapterText: text, characters: [SHEN, GU] }, rules);
    expect(findings.map((f) => f.rule)).toContain("voice_forbidden_unattributed");
    // 拿不准是谁说的，就不能按 block 算在沈砚头上。
    expect(findings.map((f) => f.rule)).not.toContain("voice_forbidden_lexicon");
  });

  it("没有人物的章节完全跳过，不产出噪声", () => {
    expect(gateVoice({ chapterText: "沈砚把灯搁下。「对不上。」", characters: [] }, rules)).toEqual([]);
  });
});
