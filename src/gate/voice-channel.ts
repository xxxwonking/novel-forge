/**
 * C6 人物声音一致性的 **code 通道**（§12.3 的 `VOICE_CHECKS` 清单）。
 *
 * 这批检查值钱的前提是**知道每句台词是谁说的**（`src/text/speaker.ts`）。
 * 归不了属的台词一律不参与判定 —— 错归属会凭空造出消不掉的假警告，
 * 那比漏检更伤（§10.10）。所以文件末尾专门为「没归上属的台词」留了出口：
 * 有禁用词落在无归属的引号里时必须说出来，**看不到的覆盖缺口比噪声更危险**。
 *
 * 与 model 通道的分工：这里只做能机械判定的（词表命中、中位句长、占比）。
 * `register` / `emotionalExpression` / `addressForms` 需要语义判断，归 model 通道。
 * 特别是 `addressForms` —— 注册表原先把它标成 code，但「第三句里提到某人名字」
 * 未必是当面称呼，硬做只会产出假阳性，因此改标 model（见 types/character.ts）。
 *
 * 阈值全部来自 `rules.voice`，代码里没有数字（`test/rules.test.ts` 会扫描本目录）。
 */

import type { GateFinding } from "../types/beat.js";
import type { SpeechProfile } from "../types/character.js";
import type { Rules, VoiceRules } from "../rules/schema.js";
import { attributeSpeech, type Speaker } from "../text/speaker.js";
import { countWords } from "../text/measure.js";

export interface VoiceCharacter extends Speaker {
  readonly speech: SpeechProfile;
}

export interface VoiceGateInput {
  readonly chapterText: string;
  /** 本章节拍点名的人物 —— 与 L3 装配的是同一批（`buildChapterRunInput`）。 */
  readonly characters: readonly VoiceCharacter[];
}

/** 句末标点，用来把一句台词切成一串句子再量长度。 */
const SENTENCE_BREAK = /[。！？…]+/u;

const sentencesOf = (line: string): readonly string[] =>
  line.split(SENTENCE_BREAK).map((s) => s.trim()).filter((s) => s !== "");

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

const hit = (words: readonly string[], text: string): readonly string[] =>
  words.filter((word) => word !== "" && text.includes(word));

/**
 * 逐句归属，再把同一人物的台词归拢。返回按说话人分组的台词与未能归属的台词。
 * 这个函数是整条链路的入口，测试可以直接拿它查归属覆盖面。
 */
export function groupSpeech(input: VoiceGateInput, rules: Rules): {
  readonly bySpeaker: ReadonlyMap<string, readonly string[]>;
  readonly unattributed: readonly string[];
} {
  const speech = attributeSpeech(input.chapterText, input.characters, rules.voice.speechVerbs);
  const bySpeaker = new Map<string, string[]>();
  const unattributed: string[] = [];
  for (const line of speech) {
    if (line.speakerId === null) unattributed.push(line.text);
    else bySpeaker.set(line.speakerId, [...(bySpeaker.get(line.speakerId) ?? []), line.text]);
  }
  return { bySpeaker, unattributed };
}

/** 禁用词命中即 block —— 「古代角色说 OK」不是风格问题，是硬错。 */
function checkForbidden(character: VoiceCharacter, lines: readonly string[]): readonly GateFinding[] {
  const hits = hit(character.speech.forbiddenLexicon, lines.join("\n"));
  return hits.length === 0 ? [] : [{
    rule: "voice_forbidden_lexicon",
    level: "block",
    message: `「${character.name}」说了他明确不会说的词：${hits.join("、")}。这是他自己的禁用词表里列的，必须改。`,
  }];
}

/**
 * 中位句长落在区间外就 warn。
 *
 * 用中位数而不是均值：一句长的爆发台词不该把整个角色判成话痨，而均值会被它拽走。
 */
function checkSentenceLength(character: VoiceCharacter, lines: readonly string[], v: VoiceRules): readonly GateFinding[] {
  const lengths = lines.flatMap(sentencesOf).map(countWords).filter((n) => n > 0);
  if (lengths.length === 0) return [];
  const { min, max } = character.speech.sentenceLength;
  const width = max - min;
  const lower = min - v.sentenceLengthTolerance * width;
  const upper = max + v.sentenceLengthTolerance * width;
  const measured = median(lengths);
  if (measured >= lower && measured <= upper) return [];
  const side = measured < lower ? "短" : "长";
  return [{
    rule: "voice_sentence_length",
    level: "warn",
    message: `「${character.name}」本章台词的中位句长约 ${Math.round(measured)} 字，比设定的 ${min}–${max} 字偏${side}。确认这是他该有的说话节奏，还是这几句写成了别人的腔调。`,
    measured: Math.round(measured),
    threshold: side === "短" ? lower : upper,
  }];
}

/** 台词够多却没命中任何口头禅 —— 台词太少时不查，两三句话不带口头禅很正常。 */
function checkVerbalTics(character: VoiceCharacter, lines: readonly string[], v: VoiceRules): readonly GateFinding[] {
  const tics = character.speech.verbalTics;
  if (tics.length === 0 || lines.length < v.verbalTicMinLines) return [];
  if (hit(tics, lines.join("\n")).length > 0) return [];
  return [{
    rule: "voice_verbal_tic_missing",
    level: "warn",
    message: `「${character.name}」说了 ${lines.length} 句，一次都没用上他的口头禅（${tics.join("、")}）。要么补一处，要么这套口头禅已经不适合他了。`,
    measured: 0,
    threshold: v.verbalTicMinLines,
  }];
}

/** 专属词跑到别人嘴里就是串味。只报"在谁的台词里"，不报词主人自己说了几次。 */
function checkSignatureLeak(
  characters: readonly VoiceCharacter[],
  bySpeaker: ReadonlyMap<string, readonly string[]>,
): readonly GateFinding[] {
  const findings: GateFinding[] = [];
  for (const owner of characters) {
    for (const other of characters) {
      if (other.id === owner.id) continue;
      const leaked = hit(owner.speech.signatureLexicon, (bySpeaker.get(other.id) ?? []).join("\n"));
      if (leaked.length === 0) continue;
      findings.push({
        rule: "voice_signature_leak",
        level: "warn",
        message: `「${owner.name}」的专属词（${leaked.join("、")}）出现在了「${other.name}」的台词里。专属词串味会让人物的声音糊在一起。`,
      });
    }
  }
  return findings;
}

/**
 * 句式占比。**只判疑问句**：问号加句尾语气词是可靠的机械判据；祈使与省略句
 * 在中文里没有可靠的形态标记，硬判会把陈述句也算进去，所以它们归 model 通道。
 */
function checkSyntaxBias(character: VoiceCharacter, lines: readonly string[], v: VoiceRules): readonly GateFinding[] {
  const sentences = lines.flatMap(sentencesOf);
  if (sentences.length === 0) return [];
  const target = character.speech.syntaxBias.question;
  // 只认问号会把「你数过吗。」这类写法全算成陈述句 —— 语气词收尾同样是问句。
  const questions = sentences.filter((sentence) =>
    /[？?]$/u.test(sentence) || v.questionMarkers.some((marker) => marker !== "" && sentence.endsWith(marker))).length;
  const measured = questions / sentences.length;
  if (Math.abs(measured - target) <= v.syntaxBiasTolerance) return [];
  return [{
    rule: "voice_syntax_bias",
    level: "warn",
    message: `「${character.name}」本章问句占比约 ${measured.toFixed(2)}，设定目标是 ${target}。审问型与寡言型的说话方式差别就在这里。`,
    measured: Number(measured.toFixed(2)),
    threshold: target,
  }];
}

/**
 * 归属覆盖的两条出口。
 *
 * 没归上属的台词不参与上面的检查，但**不能因此静默消失**：作者看到"本章没有声音问题"
 * 时，必须知道这个结论覆盖了多少内容。有禁用词落在无归属台词里时更要单独说出来 ——
 * 那是一条真实的、只是拿不准算在谁头上的问题。
 */
function attributionNotes(
  unattributed: readonly string[],
  characters: readonly VoiceCharacter[],
): readonly GateFinding[] {
  if (unattributed.length === 0) return [];
  const findings: GateFinding[] = [];
  const text = unattributed.join("\n");
  const loose = characters.flatMap((character) => hit(character.speech.forbiddenLexicon, text));
  if (loose.length > 0) {
    findings.push({
      rule: "voice_forbidden_unattributed",
      level: "warn",
      message: `有禁用词出现在无法确认说话人的台词里：${[...new Set(loose)].join("、")}。该处是谁说的没有判据，需要人工看一眼。`,
    });
  }
  findings.push({
    rule: "voice_attribution_incomplete",
    level: "info",
    message: `本章有 ${unattributed.length} 句台词无法确认说话人，未参与声音一致性检查。合写在同一段里的对话最容易这样，把它拆成一人一段就能查。`,
    measured: unattributed.length,
  });
  return findings;
}

/** 声音一致性 code 通道全套。顺序与 `VOICE_CHECKS` 的声明顺序一致。 */
export function gateVoice(input: VoiceGateInput, rules: Rules): readonly GateFinding[] {
  if (input.characters.length === 0) return [];
  const { bySpeaker, unattributed } = groupSpeech(input, rules);
  const findings: GateFinding[] = [];
  for (const character of input.characters) {
    const lines = bySpeaker.get(character.id) ?? [];
    if (lines.length === 0) continue;
    findings.push(...checkForbidden(character, lines));
    findings.push(...checkSentenceLength(character, lines, rules.voice));
    findings.push(...checkVerbalTics(character, lines, rules.voice));
    findings.push(...checkSyntaxBias(character, lines, rules.voice));
  }
  findings.push(...checkSignatureLeak(input.characters, bySpeaker));
  findings.push(...attributionNotes(unattributed, input.characters));
  return findings;
}
