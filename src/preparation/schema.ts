/** 工具参数和服务端校验共享同一份资料形状，拒绝额外字段及模型伪造的预算/来源。 */
import { ChapterWriteError } from "../server/chapter-input.js";
import type { PreparationInput } from "./types.js";

interface Schema {
  readonly [key: string]: unknown;
  readonly type: string | readonly string[];
  readonly properties?: Readonly<Record<string, Schema>>;
  readonly required?: string[];
  readonly additionalProperties?: false;
  readonly items?: Schema;
  readonly enum?: readonly (string | number)[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly minItems?: number;
  readonly minProperties?: number;
  readonly pattern?: string;
}
const text: Schema = { type: "string", maxLength: 20000 };
const nonempty: Schema = { ...text, minLength: 1 };
const strings: Schema = { type: "array", items: nonempty };
const integer = (minimum: number): Schema => ({ type: "integer", minimum });
const enumeration = (...values: string[]): Schema => ({ type: "string", enum: values });
const id = (prefix: string): Schema => ({ type: "string", pattern: `^${prefix}[A-Za-z0-9_-]+$`, maxLength: 80 });
const array = (items: Schema, minItems = 0): Schema => ({ type: "array", items, minItems });
const object = (properties: Readonly<Record<string, Schema>>, partial = false): Schema & { type: "object" } => ({ type: "object", properties, required: partial ? [] : Object.keys(properties), additionalProperties: false, ...(partial ? { minProperties: 1 } : {}) });
const genre = enumeration("xuanhuan", "xianxia", "urban", "scifi", "mystery", "rulehorror");
const platform = enumeration("fanqie", "feilu", "qidian", "unpublished");
const weight = enumeration("main", "sub", "detail");
const nullableId = (prefix: string): Schema => ({ ...id(prefix), type: ["string", "null"] });
const ratio: Schema = { type: "number", minimum: 0, maximum: 1 };
const speech = object({
  sentenceLength: object({ min: integer(0), max: integer(1) }), verbalTics: strings, signatureLexicon: strings,
  forbiddenLexicon: strings,
  addressForms: array({ ...object({ target: nullableId("C"), form: nonempty, condition: text }), required: ["target", "form"] }),
  syntaxBias: object({ question: ratio, imperative: ratio, elliptical: ratio }),
  register: enumeration("vulgar", "colloquial", "neutral", "formal", "literary", "archaic"),
  emotionalExpression: enumeration("suppressed", "direct", "ironic", "explosive", "oblique"),
  exemplars: array(nonempty, 1), counterExemplars: strings,
});
const character = object({
  id: id("C"), name: nonempty, aliases: strings, tier: enumeration("protagonist", "major", "minor", "extra"),
  profile: object({
    role: nonempty, appearance: array(object({ key: nonempty, value: nonempty, establishedAt: integer(0), immutable: { type: "boolean" } })),
    traits: strings, forbiddenBehaviors: strings, wants: text, fears: text, background: text,
  }), speech,
});
const plan = object({
  chapterType: enumeration("transition", "setup", "event", "payoff", "climax"), coreEvent: nonempty,
  secondaryThread: { type: ["string", "null"] }, stageFeedback: nonempty, hook: nonempty,
  events: array(object({ kind: enumeration("action", "info", "relation", "resource", "decision"), summary: nonempty, weight: { type: "integer", enum: [1, 2, 3] }, plotLine: nullableId("P") })),
  resolves: array(object({ foreshadowId: id("F"), weight, completeness: enumeration("full", "partial") })),
  plants: array(object({ label: nonempty, weight })), characters: array(id("C"), 1), locations: array(id("S"), 1),
});

export const PREPARATION_CHANGES_SCHEMA = object({
  setting: object({
    title: nonempty, genre, platform, premise: nonempty, centralConflict: text,
    pov: enumeration("first", "third_limited", "third_omniscient"), tense: enumeration("past", "present"),
    protagonistTraits: strings, protagonistForbidden: strings, specialAbility: text, abilityLimits: strings,
    worldRules: strings, openingSituation: text, styleKeywords: strings, romanceLine: text, taboos: strings,
  }, true),
  profile: object({ genre, platform, targetWords: integer(1) }, true),
  writingRules: strings, characters: array(character),
  settings: array(object({ id: id("S"), name: nonempty, kind: enumeration("location", "organization"), description: nonempty, facts: strings })),
  plotLines: array(object({ id: id("P"), label: nonempty, weight })),
  beats: array(object({ chapter: integer(1), volume: integer(1), plan })),
}, true);

export const PREPARATION_INPUT_SCHEMA = object({ summary: { ...nonempty, maxLength: 1000 }, baseFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" }, changes: PREPARATION_CHANGES_SCHEMA });

export function parsePreparationInput(input: unknown): PreparationInput {
  validate(input, PREPARATION_INPUT_SCHEMA, "方案");
  return structuredClone(input) as PreparationInput;
}

/** 字段级建议也必须满足同一份完整人物结构。 */
export function validateCharacterInput(input: unknown): void {
  validate(input, character, "人物资料");
}

function validate(value: unknown, schema: Schema, path: string): void {
  const fail = (detail: string): never => { throw new ChapterWriteError(400, `${path}：${detail}`); };
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  if (value === null && types.includes("null")) return;
  const type = types.find((kind) => kind === "array" ? Array.isArray(value)
    : kind === "object" ? typeof value === "object" && value !== null && !Array.isArray(value)
      : kind === "integer" ? typeof value === "number" && Number.isSafeInteger(value)
        : typeof value === kind);
  if (type === undefined) fail(`必须是 ${types.join(" / ")}`);
  if (schema.enum !== undefined && !schema.enum.includes(value as string | number)) fail("不支持的值");
  if (typeof value === "number" && (!Number.isFinite(value) || (schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) fail("数值超出范围");
  if (typeof value === "string" && ((schema.minLength !== undefined && value.trim().length < schema.minLength) || (schema.maxLength !== undefined && value.length > schema.maxLength) || (schema.pattern !== undefined && !new RegExp(schema.pattern, "u").test(value)))) fail("文本或编号格式无效");
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail("缺少必需的条目");
    for (const [index, item] of value.entries()) validate(item, schema.items!, `${path}[${index}]`);
  }
  if (type === "object") {
    const record = value as Record<string, unknown>;
    if (schema.minProperties !== undefined && Object.keys(record).length < schema.minProperties) fail("不能是空对象");
    for (const key of schema.required ?? []) if (!Object.hasOwn(record, key)) fail(`缺少 ${key}`);
    for (const [key, item] of Object.entries(record)) {
      if (!Object.hasOwn(schema.properties ?? {}, key)) fail(`不允许字段 ${key}`);
      validate(item, schema.properties![key]!, `${path}.${key}`);
    }
  }
}
