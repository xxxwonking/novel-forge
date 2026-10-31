import { C5_OUTPUT_SCHEMA } from "./c5-schema.js";

const SECTIONS = ["events", "foreshadow_planted", "foreshadow_resolved", "relations_changed", "character_states"] as const;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** 编号属于本次正文；模型选出处，代码复制原文，不对改写引文做模糊修补。 */
export function quoteCatalog(body: string) {
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
