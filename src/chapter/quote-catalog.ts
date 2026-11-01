import { C5_OUTPUT_SCHEMA, type ParseContext } from "./c5-schema.js";

const SECTIONS = ["events", "foreshadow_planted", "foreshadow_resolved", "relations_changed", "character_states"] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** 编号属于本次正文；模型选出处，代码复制原文，不对改写引文做模糊修补。 */
export function quoteCatalog(body: string, context?: Omit<ParseContext, "chapterText">) {
  const fragments = [...body.matchAll(/[^\n。！？；]+[。！？；]?[”’」』]*/gu)]
    .map(m => m[0].trim()).filter(text => /[\p{L}\p{N}]/u.test(text));
  const entries = [...new Set(fragments)].map((text, index) => ({ ref: `@quote:${index + 1}`, text }));
  const byRef = new Map(entries.map(entry => [entry.ref, entry.text]));
  const schema = structuredClone(C5_OUTPUT_SCHEMA);
  const properties = schema.properties as Record<string, { items: { properties: Record<string, unknown> } }>;
  for (const key of SECTIONS) {
    properties[key]!.items.properties.quote = { type: "string", description: "从本次原文目录选择引文编号；不要重抄或改写原句",
      ...(entries.length === 0 ? {} : { enum: entries.map(entry => entry.ref) }) };
  }
  if (context) {
    const sections = schema.properties as Record<string, { maxItems?: number; items: { properties: Record<string, Record<string, unknown>> } }>;
    const characters = [...context.knownCharacters];
    for (const [section, fields] of [["character_presence", ["character_id"]], ["character_states", ["character_id"]], ["relations_changed", ["from", "to"]]] as const) {
      if (characters.length === 0) sections[section]!.maxItems = 0;
      else for (const field of fields) sections[section]!.items.properties[field]!.enum = characters;
    }
    if (characters.length === 0) sections.events!.items.properties.participants!.maxItems = 0;
    else sections.events!.items.properties.participants!.items = { type: "string", enum: characters };
    const planned = context.foreshadows?.filter(f => f.status === "planned").map(f => f.id) ?? [];
    if (planned.length === 0) delete sections.foreshadow_planted!.items.properties.planned_foreshadow_id;
    else sections.foreshadow_planted!.items.properties.planned_foreshadow_id!.enum = planned;
    const open = [...context.knownForeshadows];
    if (open.length === 0) sections.foreshadow_resolved!.maxItems = 0;
    else sections.foreshadow_resolved!.items.properties.foreshadow_id!.enum = open;
    if (context.knownSettings?.size === 0) sections.character_states!.items.properties.field!.enum = ["condition", "vital"];
  }
  const instruction = ["【本次正文引文目录】", "本轮 quote 字段改为填写下面的 @quote:编号，由程序还原为连续原文。先选出处，再写摘要；不要把两处对白或句子拼成引文。",
    ...entries.map(entry => `${entry.ref} ${JSON.stringify(entry.text)}`)].join("\n");
  function resolve(raw: unknown): unknown {
    if (!record(raw)) return raw;
    const result = { ...raw };
    for (const key of SECTIONS) {
      const items = raw[key];
      if (!Array.isArray(items)) continue;
      result[key] = items.map(item => {
        if (!record(item) || typeof item.quote !== "string" || !item.quote.startsWith("@quote:")) return item;
        const quote = byRef.get(item.quote);
        if (quote === undefined) throw new Error(`引文编号不存在：${item.quote}`);
        return { ...item, quote };
      });
    }
    return result;
  }
  return { entries, schema, instruction, resolve };
}
