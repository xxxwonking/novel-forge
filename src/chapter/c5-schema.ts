/**
 * C5 结构声明的 schema 与解析（§12.3）。
 *
 * C5 必须是**同会话第二轮**，不是独立抽取。三个理由（§12.3）：
 * 正文生成不受结构任务干扰；缓存全命中，输入几乎免费；模型刚写完，
 * 埋伏笔的意图还在上下文里 —— 事后抽取拿不到意图，只能猜。
 *
 * 解析遵循一条原则：**模型只填它有资格填的字段**。信封、seq、时间戳、
 * plot_advance 全部由代码补齐或派生（见 events.ts 的 C5Declaration 注释）。
 */

import type {
  C5Declaration,
  CharacterPresencePayload,
  CharacterStateChangedPayload,
  EventKind,
  EventWeight,
  ForeshadowPlantedPayload,
  ForeshadowResolvedPayload,
  ForeshadowWeight,
  PlotEventPayload,
  RelationChangedPayload,
  RelationKind,
} from "../types/events.js";
import { C5_LIMITS } from "../types/events.js";
import type { CharacterId, ForeshadowId, PlotLineId, TextAnchor } from "../types/primitives.js";

/**
 * 结构化输出 schema。传给 `output_config.format`。
 *
 * 刻意不含 plot_advances —— §11.6：能派生的绝不让模型填。少一个字段
 * 就少一处出错和注水的机会。
 */
export const C5_OUTPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  additionalProperties: false,
  required: [
    "events",
    "foreshadow_planted",
    "foreshadow_resolved",
    "relations_changed",
    "character_states",
    "character_presence",
  ],
  properties: {
    events: {
      type: "array",
      maxItems: C5_LIMITS.events,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "summary", "weight", "plot_line", "participants", "quote"],
        properties: {
          kind: { type: "string", enum: ["action", "info", "relation", "resource", "decision"] },
          summary: { type: "string", description: "一句话，必须包含具体的状态变化" },
          weight: { type: "integer", enum: [1, 2, 3] },
          plot_line: { type: ["string", "null"], description: "情节线 ID，如 P01；不属于任何线则 null" },
          participants: { type: "array", items: { type: "string" }, description: "人物 ID 数组" },
          quote: { type: "string", description: "本章原文片段，8-40 字，用于定位" },
        },
      },
    },
    foreshadow_planted: {
      type: "array",
      maxItems: C5_LIMITS.foreshadowPlanted,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "intent", "weight", "visibility", "expected_by", "quote"],
        properties: {
          label: { type: "string", description: "短标签，6 字以内" },
          intent: { type: "string", description: "这条伏笔将来要兑现什么。这是最重要的字段。" },
          weight: { type: "string", enum: ["main", "sub", "detail"] },
          visibility: { type: "string", enum: ["overt", "covert"] },
          expected_by: { type: "integer", description: "打算在第几章之前收" },
          quote: { type: "string" },
        },
      },
    },
    foreshadow_resolved: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["foreshadow_id", "completeness", "quote"],
        properties: {
          foreshadow_id: { type: "string" },
          completeness: { type: "string", enum: ["full", "partial"] },
          quote: { type: "string" },
        },
      },
    },
    relations_changed: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "from_kind", "to_kind", "note", "quote"],
        properties: {
          from: { type: "string" },
          to: { type: "string" },
          from_kind: { type: ["string", "null"] },
          to_kind: {
            type: "string",
            enum: ["ally", "hostile", "kin", "romantic", "mentor", "subordinate", "acquaintance", "unknown"],
          },
          note: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
    character_states: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["character_id", "field", "from", "to", "quote"],
        properties: {
          character_id: { type: "string" },
          field: { type: "string", description: "如 condition / location / vital" },
          from: { type: ["string", "null"] },
          to: { type: "string" },
          quote: { type: "string" },
        },
      },
    },
    character_presence: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["character_id", "role"],
        properties: {
          character_id: { type: "string" },
          role: { type: "string", enum: ["pov", "major", "minor", "mentioned"] },
        },
      },
    },
  },
};

// ── 解析 ────────────────────────────────────────────────────────────────

export interface ParseContext {
  readonly chapter: number;
  /** 本章正文，用于把 quote 解析成 offsetHint。 */
  readonly chapterText: string;
  /** 已知人物 ID 集合。模型引用不存在的 ID 时丢弃该条并记 warn。 */
  readonly knownCharacters: ReadonlySet<string>;
  readonly knownForeshadows: ReadonlySet<string>;
  readonly knownPlotLines: ReadonlySet<string>;
  /** 新伏笔 ID 的分配器。由存储层提供，保证 F 序号不冲突。 */
  readonly allocateForeshadowId: () => ForeshadowId;
}

export interface ParseResult {
  readonly declaration: C5Declaration;
  /** 被丢弃或修正的项。这是校准 C5 prompt 的数据来源。 */
  readonly warnings: readonly string[];
}

/** 把模型给的 quote 定位到正文，生成锚点。找不到时 offsetHint 为 -1。 */
function makeAnchor(chapter: number, chapterText: string, quote: string): TextAnchor {
  const idx = chapterText.indexOf(quote);
  return { chapter, quote, offsetHint: idx, occurrence: 0 };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function arr(v: unknown): readonly unknown[] {
  return Array.isArray(v) ? v : [];
}

/**
 * 解析 C5 输出。
 *
 * **宁可丢弃也不放行残缺条目** —— 一条 intent 为空的伏笔进了清单，
 * 它就永远无法被判定"收了没有"，而清单一旦失去可信度用户就不看了（§6.1）。
 */
export function parseC5(raw: unknown, ctx: ParseContext): ParseResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) {
    return { declaration: emptyDeclaration(), warnings: ["C5 返回的不是对象，整章声明作废"] };
  }

  const events: PlotEventPayload[] = [];
  for (const item of arr(raw["events"]).slice(0, C5_LIMITS.events)) {
    if (!isRecord(item)) continue;
    const summary = str(item["summary"]);
    const quote = str(item["quote"]);
    const kind = str(item["kind"]);
    const weight = item["weight"];
    if (summary === null || quote === null || kind === null) {
      warnings.push("丢弃一条缺 summary/quote/kind 的事件声明");
      continue;
    }
    if (!isEventKind(kind) || !isEventWeight(weight)) {
      warnings.push(`丢弃一条 kind/weight 非法的事件声明：${kind}/${String(weight)}`);
      continue;
    }
    const plotLine = str(item["plot_line"]);
    if (plotLine !== null && !ctx.knownPlotLines.has(plotLine)) {
      warnings.push(`事件引用了不存在的情节线 ${plotLine}，已置空`);
    }
    const participants = arr(item["participants"])
      .map((p) => str(p))
      .filter((p): p is string => p !== null && ctx.knownCharacters.has(p));

    events.push({
      type: "plot_event",
      kind,
      summary,
      weight,
      plotLine: plotLine !== null && ctx.knownPlotLines.has(plotLine) ? (plotLine as PlotLineId) : null,
      participants: participants as readonly CharacterId[],
      anchor: makeAnchor(ctx.chapter, ctx.chapterText, quote),
    });
  }
  if (arr(raw["events"]).length > C5_LIMITS.events) {
    warnings.push(
      `声明了 ${arr(raw["events"]).length} 个事件，超过上限 ${C5_LIMITS.events}，已截断 —— 可能把描写当成了事件`,
    );
  }

  const foreshadowPlanted: ForeshadowPlantedPayload[] = [];
  for (const item of arr(raw["foreshadow_planted"]).slice(0, C5_LIMITS.foreshadowPlanted)) {
    if (!isRecord(item)) continue;
    const label = str(item["label"]);
    const intent = str(item["intent"]);
    const quote = str(item["quote"]);
    const weight = str(item["weight"]);
    const visibility = str(item["visibility"]);
    const expectedBy = item["expected_by"];
    if (label === null || intent === null || quote === null) {
      warnings.push("丢弃一条缺 label/intent/quote 的伏笔声明");
      continue;
    }
    if (!isForeshadowWeight(weight) || (visibility !== "overt" && visibility !== "covert")) {
      warnings.push(`丢弃一条 weight/visibility 非法的伏笔声明：${label}`);
      continue;
    }
    if (typeof expectedBy !== "number" || expectedBy <= ctx.chapter) {
      warnings.push(`伏笔「${label}」的 expected_by 非法或不在未来，已丢弃`);
      continue;
    }
    foreshadowPlanted.push({
      type: "foreshadow_planted",
      foreshadowId: ctx.allocateForeshadowId(),
      label,
      intent,
      weight,
      visibility,
      expectedBy,
      anchor: makeAnchor(ctx.chapter, ctx.chapterText, quote),
    });
  }

  const foreshadowResolved: ForeshadowResolvedPayload[] = [];
  for (const item of arr(raw["foreshadow_resolved"])) {
    if (!isRecord(item)) continue;
    const id = str(item["foreshadow_id"]);
    const quote = str(item["quote"]);
    const completeness = str(item["completeness"]);
    if (id === null || quote === null) continue;
    if (!ctx.knownForeshadows.has(id)) {
      warnings.push(`声明收束了不存在的伏笔 ${id}，已丢弃`);
      continue;
    }
    if (completeness !== "full" && completeness !== "partial") {
      warnings.push(`伏笔 ${id} 的 completeness 非法，已按 partial 处理`);
    }
    foreshadowResolved.push({
      type: "foreshadow_resolved",
      foreshadowId: id as ForeshadowId,
      completeness: completeness === "full" ? "full" : "partial",
      anchor: makeAnchor(ctx.chapter, ctx.chapterText, quote),
    });
  }

  const relationsChanged: RelationChangedPayload[] = [];
  for (const item of arr(raw["relations_changed"])) {
    if (!isRecord(item)) continue;
    const from = str(item["from"]);
    const to = str(item["to"]);
    const toKind = str(item["to_kind"]);
    const note = str(item["note"]);
    const quote = str(item["quote"]);
    if (from === null || to === null || toKind === null || note === null || quote === null) continue;
    if (!ctx.knownCharacters.has(from) || !ctx.knownCharacters.has(to)) {
      warnings.push(`关系变更引用了不存在的人物 ${from}→${to}，已丢弃`);
      continue;
    }
    if (!isRelationKind(toKind)) {
      warnings.push(`关系变更的 to_kind 非法：${toKind}，已丢弃`);
      continue;
    }
    const fromKind = str(item["from_kind"]);
    relationsChanged.push({
      type: "relation_changed",
      from: from as CharacterId,
      to: to as CharacterId,
      fromKind: fromKind !== null && isRelationKind(fromKind) ? fromKind : null,
      toKind,
      note,
      anchor: makeAnchor(ctx.chapter, ctx.chapterText, quote),
    });
  }

  const characterStates: CharacterStateChangedPayload[] = [];
  for (const item of arr(raw["character_states"])) {
    if (!isRecord(item)) continue;
    const id = str(item["character_id"]);
    const field = str(item["field"]);
    const to = str(item["to"]);
    const quote = str(item["quote"]);
    if (id === null || field === null || to === null || quote === null) continue;
    if (!ctx.knownCharacters.has(id)) {
      warnings.push(`状态变更引用了不存在的人物 ${id}，已丢弃`);
      continue;
    }
    characterStates.push({
      type: "character_state_changed",
      characterId: id as CharacterId,
      field,
      from: str(item["from"]),
      to,
      anchor: makeAnchor(ctx.chapter, ctx.chapterText, quote),
    });
  }

  const seenPresence = new Set<string>();
  const characterPresence: CharacterPresencePayload[] = [];
  for (const item of arr(raw["character_presence"])) {
    if (!isRecord(item)) continue;
    const id = str(item["character_id"]);
    const role = str(item["role"]);
    if (id === null || role === null) continue;
    if (!ctx.knownCharacters.has(id)) continue;
    if (role !== "pov" && role !== "major" && role !== "minor" && role !== "mentioned") continue;
    // 每章每人最多一条 —— presence 是章级布尔，不是计数。
    if (seenPresence.has(id)) {
      warnings.push(`人物 ${id} 的出场声明重复，已去重`);
      continue;
    }
    seenPresence.add(id);
    characterPresence.push({ type: "character_presence", characterId: id as CharacterId, role });
  }

  return {
    declaration: {
      events,
      foreshadowPlanted,
      foreshadowResolved,
      relationsChanged,
      characterStates,
      characterPresence,
    },
    warnings,
  };
}

function emptyDeclaration(): C5Declaration {
  return {
    events: [],
    foreshadowPlanted: [],
    foreshadowResolved: [],
    relationsChanged: [],
    characterStates: [],
    characterPresence: [],
  };
}

function isEventKind(v: string): v is EventKind {
  return v === "action" || v === "info" || v === "relation" || v === "resource" || v === "decision";
}

function isEventWeight(v: unknown): v is EventWeight {
  return v === 1 || v === 2 || v === 3;
}

function isForeshadowWeight(v: string | null): v is ForeshadowWeight {
  return v === "main" || v === "sub" || v === "detail";
}

function isRelationKind(v: string): v is RelationKind {
  return (
    v === "ally" ||
    v === "hostile" ||
    v === "kin" ||
    v === "romantic" ||
    v === "mentor" ||
    v === "subordinate" ||
    v === "acquaintance" ||
    v === "unknown"
  );
}
