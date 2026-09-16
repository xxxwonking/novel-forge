/**
 * 说话人归属：把引号里的台词对到具体人物。
 *
 * 为什么需要它：声音一致性检查（§12.3）问的是「**这个人**说话像不像他」，
 * 而 `speechAndThought()` 只切出引号内容与心理标记句，不带归属。不知道谁说的，
 * 句长区间、口头禅、专属词串味这些检查全都无从谈起。
 *
 * **核心原则：不确定就不归属。** 错归属比不归属糟得多 —— 它会凭空造出一条假警告，
 * 而作者消掉它的唯一办法是放宽规则，那正是这个项目一直在防的事（§10.10 同一逻辑）。
 * 所以这里的每条判断都靠**中文里本来就存在的结构**：段落边界、句读、称呼+言说动词。
 * 不使用"前后 N 字以内"这类窗口数字（`src/text` 因此能继续通过
 * `test/rules.test.ts` 的「代码无数字」扫描），言说动词表来自 `rules.voice.speechVerbs`。
 *
 * 代词（他/她）刻意不解析：同一段里两个同性别人物时"他说"指谁是语义问题。
 * 这类台词在结果里是 null，归 model 通道的范畴，不是这里该猜的。
 */

import { paragraphs, QUOTED } from "./measure.js";

/** 归属只需要人物的身份与称呼，不需要整张卡。 */
export interface Speaker {
  readonly id: string;
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface AttributedSpeech {
  /** 引号内的原文，不含引号。 */
  readonly text: string;
  /** 台词所在段落（去掉首尾空白）。 */
  readonly paragraph: string;
  /** 无法确定说话人时为 null —— 调用方必须显式处理，不能当成别人的台词。 */
  readonly speakerId: string | null;
}

/** 句末标点。用它切出自包含的句子，作为"邻接"的结构边界。 */
const SENTENCE_BREAK = /[。！？…\n]/u;
/** 前式里动词与引号之间的连接符。 */
const TRAILING_PUNCT = /[，,：:\s]+$/u;

const formsOf = (speaker: Speaker): readonly string[] =>
  [speaker.name, ...speaker.aliases].filter((form) => form !== "");

/** 一个段落里出现了哪些人物（按名字与别名匹配）。 */
function speakersIn(paragraph: string, speakers: readonly Speaker[]): readonly Speaker[] {
  return speakers.filter((speaker) => formsOf(speaker).some((form) => paragraph.includes(form)));
}

/** 引号之前的那一句（从上一个句末标点之后算起）。 */
function clauseBefore(paragraph: string, quoteIndex: number): string {
  const head = paragraph.slice(0, quoteIndex);
  for (let i = head.length - 1; i >= 0; i -= 1) if (SENTENCE_BREAK.test(head[i]!)) return head.slice(i + 1);
  return head;
}

/** 引号之后的那一句（到下一个句末标点为止）。 */
function clauseAfter(paragraph: string, quoteEnd: number): string {
  const tail = paragraph.slice(quoteEnd);
  const stop = tail.search(SENTENCE_BREAK);
  return stop === -1 ? tail : tail.slice(0, stop);
}

/**
 * 后式：`「…」沈砚说`。称呼之后紧跟言说动词才算 ——
 * `「…」沈砚没有接话` 里的沈砚是下一句的主语，不是说话人。
 */
function speakerAfterClause(clause: string, speakers: readonly Speaker[], verbs: readonly string[]): string | null {
  const hits = speakers.filter((speaker) =>
    formsOf(speaker).some((form) => {
      const at = clause.indexOf(form);
      return at !== -1 && verbs.some((verb) => clause.slice(at + form.length).startsWith(verb));
    }));
  return hits.length === 1 ? hits[0]!.id : null;
}

/**
 * 前式：`沈砚说：「…」` 或 `沈砚把灯搁下，说：「…」`。整句以言说动词收尾
 * （动词与引号之间只有标点）时，说话人是**离动词最近的那个称呼**。
 */
function speakerBeforeClause(clause: string, speakers: readonly Speaker[], verbs: readonly string[]): string | null {
  const trimmed = clause.replace(TRAILING_PUNCT, "");
  if (!verbs.some((verb) => trimmed.endsWith(verb))) return null;
  const nearest = speakers
    .map((speaker) => ({ id: speaker.id, at: Math.max(...formsOf(speaker).map((form) => trimmed.lastIndexOf(form))) }))
    .filter((candidate) => candidate.at !== -1)
    .sort((a, b) => b.at - a.at);
  // 离动词最近的称呼必须唯一，两个人并列就是判断不了。
  if (nearest.length === 0 || (nearest[1] !== undefined && nearest[1].at === nearest[0]!.at)) return null;
  return nearest[0]!.id;
}

/**
 * 逐段归属台词。
 *
 *   ① 段内只出现一个人物 → 该段所有引号归他（绝大多数对话段的形状）。
 *   ② 段内多个人物 → 按前式/后式判断；两式都定不下来就是 null。
 *   ③ 段内没有人物 → 只有"上一段唯一说话人 + 本段以引号开头"才沿用。
 *      携带只在**本段确实有台词**时保留：一段没有台词的叙述是对话的断点，
 *      跨过它继续沿用会把前面的人物粘到很远的后面去。
 */
export function attributeSpeech(
  text: string,
  speakers: readonly Speaker[],
  verbs: readonly string[],
): readonly AttributedSpeech[] {
  const out: AttributedSpeech[] = [];
  if (speakers.length === 0) return out;

  let carried: string | null = null;
  for (const paragraph of paragraphs(text)) {
    const present = speakersIn(paragraph, speakers);
    const sole = present.length === 1 ? present[0]!.id : null;
    const quotes = [...paragraph.matchAll(QUOTED)]
      .map((match) => ({ inner: match[1], index: match.index, end: match.index + match[0].length }))
      .filter((quote) => quote.inner !== undefined && quote.inner.trim() !== "");

    for (const quote of quotes) {
      let speakerId: string | null = null;
      if (sole !== null) speakerId = sole;
      else if (present.length > 1) {
        speakerId = speakerAfterClause(clauseAfter(paragraph, quote.end), present, verbs)
          ?? speakerBeforeClause(clauseBefore(paragraph, quote.index), present, verbs);
      } else if (carried !== null && paragraph.slice(0, quote.index).trim() === "") {
        speakerId = carried;
      }
      out.push({ text: quote.inner!, paragraph, speakerId });
    }

    carried = sole ?? (quotes.length > 0 ? carried : null);
  }
  return out;
}
