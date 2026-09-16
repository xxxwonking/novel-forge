/**
 * C6 声音一致性的 **model 通道**（§12.3 注册表里 `channel: "model"` 的三项）。
 *
 * 为什么这三项不能走 code：语域、情绪表达、当面称呼在中文里都**没有可靠的形态标记**。
 * 「他从不直说重点」和「他这次直说了」的区别不在标点也不在词表里；第三句提到某人
 * 名字更不是当面称呼。硬用正则判只会产出作者消不掉的假警告 —— 那比不查更糟。
 *
 * 本文件只负责**判定与解析**，不碰模型客户端：`parseVoiceVerdict` 是纯函数，
 * 直接单测；调用与降级在 `src/task/steps.ts` 的 `checkVoiceWithModel`。
 *
 * 一条贯穿的纪律：**模型说的每句话都要能在正文里找到原文**。找不到就丢掉这条判定并
 * 说出来。这是 C5 交叉校验已经在用的原则（见 `chapter/c5-crosscheck.ts`）——
 * 让无法核对的判定进入结论，作者就只能靠放宽规则消掉它（§10.10）。
 */

import type { GateFinding } from "../types/beat.js";
import type { SpeechProfile } from "../types/character.js";
import type { VoiceCharacter } from "./voice-channel.js";

/** 注册表里归 model 通道的三个字段，以及它们各自的 rule 名。 */
const FIELDS = {
  register: "voice_register",
  emotionalExpression: "voice_emotional_expression",
  addressForms: "voice_address_form",
} as const;

type VoiceField = keyof typeof FIELDS;

const isField = (value: unknown): value is VoiceField =>
  typeof value === "string" && Object.hasOwn(FIELDS, value);

/** 给模型的输出契约。`quote` 是必填的 —— 没有引文就无法核对，判定不该成立。 */
export const VOICE_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    characters: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          characterId: { type: "string", description: "本章人物卡上的编号，必须逐字复制" },
          field: { type: "string", enum: Object.keys(FIELDS) },
          ok: { type: "boolean", description: "本章台词与设定一致时为 true" },
          quote: { type: "string", description: "判定依据的原文片段，必须逐字复制自本章正文，连续且不改写" },
          reason: { type: "string", description: "ok 为 false 时说明哪里不像他" },
        },
        required: ["characterId", "field", "ok", "quote", "reason"],
      },
    },
  },
  required: ["characters"],
} as const;

/** 给作者看的字段名。rule 名是给代码认的，不该原样出现在提示里。 */
const FIELD_LABELS: Readonly<Record<VoiceField, string>> = {
  register: "语域",
  emotionalExpression: "情绪表达",
  addressForms: "称呼",
};

const FIELD_ASKS: Readonly<Record<VoiceField, string>> = {
  register: "语域（方言、文白、行业腔、说话人的社会身份）是否与设定一致",
  emotionalExpression: "情绪表达方式（压抑／直给／反讽／爆发／迂回）是否与设定一致",
  addressForms: "他对人（尤其设定表里点名的对象）的称呼是否落在允许的称呼表内",
};

/**
 * 拼判定任务。
 *
 * 只把**已归属到人的台词**给模型 —— 归属不确定的台词进这里是害它，
 * 那些台词连"谁说的"都没定，谈不上"这个人说得像不像"。
 */
export function buildVoiceTask(
  characters: readonly VoiceCharacter[],
  linesBySpeaker: ReadonlyMap<string, readonly string[]>,
): string {
  const blocks = characters
    .map((character) => ({ character, lines: linesBySpeaker.get(character.id) ?? [] }))
    .filter((item) => item.lines.length > 0)
    .map(({ character, lines }) => {
      const speech: SpeechProfile = character.speech;
      const asks = (Object.keys(FIELDS) as VoiceField[]).map((field) => `  - ${field}：${FIELD_ASKS[field]}`).join("\n");
      const addresses = speech.addressForms
        .map((form) => `  - 对${form.target ?? "所有人"}称「${form.form}」${form.condition === undefined ? "" : `（${form.condition}）`}`)
        .join("\n");
      return [
        `【${character.name}｜编号 ${character.id}】`,
        `设定：语域=${speech.register}；情绪表达=${speech.emotionalExpression}`,
        addresses === "" ? "称呼表：未指定" : `称呼表：\n${addresses}`,
        speech.exemplars.length === 0 ? "" : `他的正例台词：${speech.exemplars.join(" / ")}`,
        speech.counterExemplars.length === 0 ? "" : `明确不像他的反例：${speech.counterExemplars.join(" / ")}`,
        `本章他的台词：\n${lines.map((line) => `  「${line}」`).join("\n")}`,
        "要判：",
        asks,
      ].filter((line) => line !== "").join("\n");
    });

  return [
    "下面是本章各人物的说话方式设定与他们实际说出的台词。逐人核对下列判定项，只报**不像他**的项。",
    "",
    ...blocks,
    "",
    "要求：",
    "- 每个「人物 × 判定项」给一条记录，一致的写 ok=true，不一致的写 ok=false 并说明哪里不像。",
    "- 判 ok=false 时，quote 必须是**逐字复制**自上面台词的连续原文片段，保留标点，不要改写、不要拼接。",
    "- 只在台词确实支持这条判断时才报。拿不准的写 ok=true —— 误报会让作者去改本来没问题的句子。",
  ].join("\n");
}

interface VerdictEntry {
  readonly characterId: string;
  readonly field: VoiceField;
  readonly quote: string;
  readonly reason: string;
}

function readEntries(json: unknown, known: ReadonlySet<string>): readonly VerdictEntry[] | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const raw = (json as Record<string, unknown>)["characters"];
  if (!Array.isArray(raw)) return null;
  const out: VerdictEntry[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const characterId = record["characterId"];
    const field = record["field"];
    const ok = record["ok"];
    // 判为一致的不产出 —— 干净的作品不该有任何 findings。
    if (ok !== false || typeof characterId !== "string" || !known.has(characterId) || !isField(field)) continue;
    out.push({
      characterId,
      field,
      quote: typeof record["quote"] === "string" ? record["quote"].trim() : "",
      reason: typeof record["reason"] === "string" ? record["reason"].trim() : "",
    });
  }
  return out;
}

/**
 * 判定 → findings。
 *
 * 两条出口：核对得上的产出 warn（与注册表里声明的级别一致），核对不上的丢弃并计数。
 * 丢弃的通知**插在第一条被丢的位置**：作者读到那一条时就能看到"这里少了一条"，
 * 而不是读到末尾才发现中间少报过东西。
 */
export function parseVoiceVerdict(
  json: unknown,
  context: { readonly chapterText: string; readonly characters: readonly VoiceCharacter[] },
): readonly GateFinding[] {
  const byId = new Map(context.characters.map((character) => [character.id, character]));
  const entries = readEntries(json, new Set(byId.keys()));
  if (entries === null) {
    return [{
      rule: "voice_verdict_unusable",
      level: "info",
      message: "模型没有按约定格式给出语域与情绪表达的判定，这三项本轮未查。正文与其余检查不受影响。",
    }];
  }

  const findings: GateFinding[] = [];
  const dropped: string[] = [];
  let dropAt = -1;
  for (const entry of entries) {
    const character = byId.get(entry.characterId);
    if (character === undefined) continue;
    // 引文必须真的在正文里 —— 核对不上就等于没有证据。
    if (entry.quote === "" || !context.chapterText.includes(entry.quote)) {
      if (dropAt === -1) dropAt = findings.length;
      dropped.push(`「${character.name}」的${FIELD_LABELS[entry.field]}`);
      continue;
    }
    findings.push({
      rule: FIELDS[entry.field],
      level: "warn",
      message: `「${character.name}」的${FIELD_LABELS[entry.field]}与设定不符：${entry.reason === "" ? "模型判定不一致" : entry.reason}（原文「${entry.quote}」）`,
    });
  }

  if (dropped.length > 0) {
    findings.splice(dropAt, 0, {
      rule: "voice_verdict_unverifiable",
      level: "info",
      message: `模型给出 ${dropped.length} 条判定（${dropped.join("、")}），但它引用的原文在本章正文里找不到，这些判定已丢弃。要看这一项，请人工核对对应台词。`,
    });
  }
  return findings;
}
