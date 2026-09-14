/** 作者纠错比模型解析更严格：不能静默删掉引用，也不能信任旧锚点偏移。 */
import { C5_OUTPUT_SCHEMA, parseC5, type ParseContext } from "./c5-schema.js";
import { outputShapeIssue, type OutputShape } from "./c5-validation.js";
import type { C5Declaration } from "../types/events.js";
import { ChapterWriteError } from "../server/chapter-input.js";

type Section = keyof C5Declaration;
type Entry = C5Declaration[Section][number];
export interface StructureCorrection {
  readonly section: Section;
  /** 以源版本为准；等于数组长度时新增，value=null 时删除该条。 */
  readonly index: number;
  readonly value: unknown;
  readonly occurrence?: number;
}
const sections = {
  events: "events", foreshadowPlanted: "foreshadow_planted", foreshadowResolved: "foreshadow_resolved",
  relationsChanged: "relations_changed", characterStates: "character_states", characterPresence: "character_presence",
} as const;
const names: Readonly<Record<string, string>> = {
  plotLine: "plot_line", expectedBy: "expected_by", foreshadowId: "foreshadow_id", fromKind: "from_kind",
  toKind: "to_kind", characterId: "character_id",
};
const outputProperties = C5_OUTPUT_SCHEMA["properties"] as Record<string, { items: OutputShape; maxItems?: number }>;

/** UI/对话使用领域字段名；工具仍提供明确的字段形状，而非任意文件/事件写入。 */
export const CORRECTION_VALUE_SCHEMAS = Object.fromEntries(Object.entries(sections).map(([section, raw]) => {
  const item = outputProperties[raw]!.items;
  const domainName = (key: string): string => Object.keys(names).find(name => names[name] === key) ?? key;
  return [section, { ...item, required: item.required!.map(domainName), properties: Object.fromEntries(Object.entries(item.properties!).map(([key, value]) => [domainName(key), value])) }];
})) as unknown as Record<Section, OutputShape>;

export function correctionValue(entry: Entry): Record<string, unknown> {
  const { type: _type, ...value } = entry;
  if ("anchor" in value) {
    const { anchor, ...fields } = value;
    if (entry.type === "foreshadow_planted") delete (fields as Record<string, unknown>)["foreshadowId"];
    return { ...fields, quote: anchor.quote };
  }
  return value;
}

export function correctDeclaration(original: C5Declaration, changes: readonly StructureCorrection[], ctx: ParseContext): C5Declaration {
  if (!Array.isArray(changes) || changes.length === 0) throw new ChapterWriteError(400, "请指定要纠正的结构记录");
  const revised = Object.fromEntries(Object.keys(sections).map(key => [key, [...original[key as Section]]])) as Record<Section, (Entry | null)[]>;
  const seen = new Set<string>();
  const typedChanges: readonly StructureCorrection[] = changes;
  for (const change of typedChanges) {
    if (change === null || typeof change !== "object" || !Object.hasOwn(sections, change.section)) throw new ChapterWriteError(400, "未知的结构记录类别");
    const entries = original[change.section];
    if (!Number.isSafeInteger(change.index) || change.index < 0 || change.index > entries.length || (change.value === null && change.index === entries.length)) throw new ChapterWriteError(400, "结构记录位置无效，请重新读取源版本");
    const key = `${change.section}/${change.index}`;
    if (seen.has(key)) throw new ChapterWriteError(400, "同一条结构记录不能重复修改");
    seen.add(key);
    if (change.value === null) { revised[change.section][change.index] = null; continue; }
    const issue = outputShapeIssue(change.value, CORRECTION_VALUE_SCHEMAS[change.section], change.section);
    if (issue !== null) throw new ChapterWriteError(400, issue);
    const value = change.value as Record<string, unknown>;
    const raw = Object.fromEntries(Object.entries(value).map(([name, item]) => [names[name] ?? name, item]));
    const previous = entries[change.index];
    const parsed = parseC5({ [sections[change.section]]: [raw] }, {
      ...ctx,
      allocateForeshadowId: () => previous?.type === "foreshadow_planted" ? previous.foreshadowId : ctx.allocateForeshadowId(),
    });
    const entry = parsed.declaration[change.section][0];
    if (parsed.warnings.length > 0 || entry === undefined) throw new ChapterWriteError(400, `结构记录含无效人物/伏笔引用或字段：${parsed.warnings.join("；") || change.section}`);
    const normalized = correctionValue(entry);
    if (Object.keys(value).some(name => JSON.stringify(value[name]) !== JSON.stringify(normalized[name]))) throw new ChapterWriteError(400, "结构记录含无效人物引用或字段；未静默删改，请核对后重试");
    if (entry.type === "character_state_changed" && entry.field === "vital" && !["alive", "dead", "missing"].includes(entry.to)) throw new ChapterWriteError(400, "人物生存状态必须是 alive、dead 或 missing");
    let corrected: Entry = entry;
    if ("anchor" in entry) {
      const occurrence = change.occurrence ?? (previous && "anchor" in previous && previous.anchor.quote === entry.anchor.quote ? previous.anchor.occurrence : 0);
      if (!Number.isSafeInteger(occurrence) || occurrence < 0 || !entry.anchor.quote.trim()) throw new ChapterWriteError(400, "原文引用及出现次数无效");
      let offset = ctx.chapterText.indexOf(entry.anchor.quote);
      for (let n = 0; n < occurrence && offset >= 0; n++) offset = ctx.chapterText.indexOf(entry.anchor.quote, offset + 1);
      if (offset < 0) throw new ChapterWriteError(400, "纠错引用在当前正文中不存在，请重新选择原文依据");
      corrected = { ...entry, anchor: { chapter: ctx.chapter, quote: entry.anchor.quote, offsetHint: offset, occurrence } };
    }
    revised[change.section][change.index] = corrected;
  }
  for (const [section, raw] of Object.entries(sections)) {
    revised[section as Section] = revised[section as Section].filter(entry => entry !== null);
    const limit = outputProperties[raw]!.maxItems;
    if (limit !== undefined && revised[section as Section].length > limit) throw new ChapterWriteError(400, `${section} 超出结构条目上限 ${limit}`);
  }
  return revised as unknown as C5Declaration;
}
