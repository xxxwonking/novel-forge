/**
 * 事件流 → 四张视图的投影（§12.3 C8 的 ⚙ 投影更新）。
 *
 * 纯函数：给定事件流，产出全部读模型。不做增量更新 —— 300 章的事件流
 * 全量重放也只是几千条记录的单次扫描，比维护增量正确性便宜得多，
 * 而且天然保证"视图和事件流一致"这条不变量。
 *
 * 只消费 effective()（committed + authored），proposed 不进视图（§12.0）。
 */

import type { StructuralEvent } from "../types/events.js";
import type {
  Alert,
  CharacterArc,
  ForeshadowStatus,
  ForeshadowTimelineItem,
  PlotLinePoint,
  PlotLineTrack,
  RelationEdge,
} from "../types/projections.js";
import type {
  ChapterNo,
  CharacterId,
  Derived,
  ForeshadowId,
  PlotLineId,
  SettingId,
} from "../types/primitives.js";
import type { CharacterCard, CharacterTier, VitalStatus } from "../types/character.js";
import type { ForeshadowWeight } from "../types/events.js";

/** 派生值的唯一构造入口。只有本模块与 derive/* 可以调用。 */
function derived<T>(value: T): Derived<T> {
  return value as Derived<T>;
}

/** §10.8 断线阈值按权重派生：主线 3 / 支线 12 / 细节 20 章。 */
const GAP_LIMIT: Readonly<Record<ForeshadowWeight, number>> = { main: 3, sub: 12, detail: 20 };

export interface ProjectionInput {
  readonly events: readonly StructuralEvent[];
  readonly currentChapter: ChapterNo;
  /** 人物卡的设定块（投影只产出 state 块）。 */
  readonly characterProfiles: readonly Pick<CharacterCard, "id" | "name" | "tier" | "introducedAt">[];
  /** 情节线的静态定义。 */
  readonly plotLineDefs: readonly {
    readonly id: PlotLineId;
    readonly label: string;
    readonly weight: ForeshadowWeight;
  }[];
}

export interface Projections {
  readonly foreshadows: readonly ForeshadowTimelineItem[];
  readonly plotLines: readonly PlotLineTrack[];
  readonly arcs: readonly CharacterArc[];
  readonly relations: readonly RelationEdge[];
}

export function project(input: ProjectionInput): Projections {
  return {
    foreshadows: projectForeshadows(input),
    plotLines: projectPlotLines(input),
    arcs: projectArcs(input),
    relations: projectRelations(input),
  };
}

// ── 伏笔时间线 ──────────────────────────────────────────────────────────

function projectForeshadows(input: ProjectionInput): readonly ForeshadowTimelineItem[] {
  type Draft = {
    id: ForeshadowId;
    label: string;
    intent: string;
    weight: ForeshadowWeight;
    visibility: "overt" | "covert";
    status: ForeshadowStatus;
    plantedAt: ChapterNo;
    plantedAnchor: ForeshadowTimelineItem["plantedAnchor"];
    expectedBy: ChapterNo;
    resolutions: ForeshadowTimelineItem["resolutions"][number][];
  };
  const drafts = new Map<ForeshadowId, Draft>();

  for (const e of input.events) {
    const p = e.payload;
    if (p.type === "foreshadow_planted") {
      drafts.set(p.foreshadowId, {
        id: p.foreshadowId,
        label: p.label,
        intent: p.intent,
        weight: p.weight,
        visibility: p.visibility,
        status: e.envelope.origin === "P4_outline" ? "planned" : "open",
        plantedAt: e.envelope.chapter,
        plantedAnchor: p.anchor,
        expectedBy: p.expectedBy,
        resolutions: [],
      });
      continue;
    }
    if (
      p.type !== "foreshadow_resolved" &&
      p.type !== "foreshadow_abandoned" &&
      p.type !== "foreshadow_rescheduled"
    ) {
      continue;
    }
    // 引用了未埋设的伏笔 —— 解析层已拦掉大部分，这里静默跳过而非造空条目。
    const d = drafts.get(p.foreshadowId);
    if (d === undefined) continue;

    if (p.type === "foreshadow_resolved") {
      d.resolutions.push({
        chapter: e.envelope.chapter,
        completeness: p.completeness,
        anchor: p.anchor,
      });
      // 部分收束不改状态 —— 只有完全收束才算收（§12.3）。
      if (p.completeness === "full") d.status = "resolved";
    } else if (p.type === "foreshadow_abandoned") {
      d.status = "abandoned";
    } else {
      d.expectedBy = p.expectedBy;
    }
  }

  return [...drafts.values()]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map<ForeshadowTimelineItem>((d) => ({
      id: d.id,
      label: d.label,
      intent: d.intent,
      weight: d.weight,
      visibility: d.visibility,
      status: d.status,
      plantedAt: d.plantedAt,
      plantedAnchor: d.plantedAnchor,
      expectedBy: d.expectedBy,
      resolutions: d.resolutions,
      overdueBy: derived(
        d.status === "resolved" || d.status === "abandoned"
          ? 0
          : input.currentChapter - d.expectedBy,
      ),
    }));
}

// ── 情节线 ──────────────────────────────────────────────────────────────

function projectPlotLines(input: ProjectionInput): readonly PlotLineTrack[] {
  const points = new Map<PlotLineId, PlotLinePoint[]>();
  for (const def of input.plotLineDefs) points.set(def.id, []);

  for (const e of input.events) {
    const p = e.payload;
    if (p.type !== "plot_event" || p.plotLine === null) continue;
    const bucket = points.get(p.plotLine);
    if (bucket === undefined) continue;
    bucket.push({
      chapter: e.envelope.chapter,
      eventId: e.envelope.id,
      summary: p.summary,
      weight: p.weight,
      kind: p.kind,
      anchor: p.anchor,
      planned: false,
    });
  }

  return input.plotLineDefs
    .map<PlotLineTrack>((def) => {
      const pts = (points.get(def.id) ?? []).sort((a, b) => a.chapter - b.chapter);
      const last = pts[pts.length - 1];
      const lastAdvancedAt = last?.chapter ?? 0;
      return {
        id: def.id,
        label: def.label,
        weight: def.weight,
        gapLimit: derived(GAP_LIMIT[def.weight]),
        lastAdvancedAt,
        currentGap: derived(input.currentChapter - lastAdvancedAt),
        points: pts,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

// ── 人物弧线 ────────────────────────────────────────────────────────────

function projectArcs(input: ProjectionInput): readonly CharacterArc[] {
  const presence = new Map<CharacterId, CharacterArc["presence"][number][]>();
  const turning = new Map<CharacterId, CharacterArc["turningPoints"][number][]>();

  for (const e of input.events) {
    const p = e.payload;
    if (p.type === "character_presence") {
      push(presence, p.characterId, { chapter: e.envelope.chapter, role: p.role });
    } else if (p.type === "character_state_changed") {
      push(turning, p.characterId, {
        chapter: e.envelope.chapter,
        field: p.field,
        from: p.from,
        to: p.to,
        anchor: p.anchor,
      });
    }
  }

  return input.characterProfiles
    .map<CharacterArc>((c) => {
      const pres = (presence.get(c.id) ?? []).sort((a, b) => a.chapter - b.chapter);
      const last = pres[pres.length - 1];
      return {
        characterId: c.id,
        name: c.name,
        tier: c.tier,
        introducedAt: c.introducedAt,
        lastSeenAt: last?.chapter ?? c.introducedAt,
        presence: pres,
        turningPoints: (turning.get(c.id) ?? []).sort((a, b) => a.chapter - b.chapter),
      };
    })
    .sort((a, b) => a.characterId.localeCompare(b.characterId));
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing === undefined) map.set(key, [value]);
  else existing.push(value);
}

// ── 关系图 ──────────────────────────────────────────────────────────────

function projectRelations(input: ProjectionInput): readonly RelationEdge[] {
  type Draft = {
    from: CharacterId;
    to: CharacterId;
    kind: RelationEdge["kind"];
    note: string;
    changedAt: ChapterNo;
    anchor: RelationEdge["anchor"];
    history: RelationEdge["history"][number][];
  };
  const edges = new Map<string, Draft>();

  for (const e of input.events) {
    const p = e.payload;
    if (p.type !== "relation_changed") continue;
    const key = `${p.from}->${p.to}`;
    const entry = { chapter: e.envelope.chapter, kind: p.toKind, note: p.note };
    const existing = edges.get(key);
    if (existing === undefined) {
      edges.set(key, {
        from: p.from,
        to: p.to,
        kind: p.toKind,
        note: p.note,
        changedAt: e.envelope.chapter,
        anchor: p.anchor,
        history: [entry],
      });
    } else {
      existing.kind = p.toKind;
      existing.note = p.note;
      existing.changedAt = e.envelope.chapter;
      existing.history.push(entry);
    }
  }

  return [...edges.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([, d]) => ({
      from: d.from,
      to: d.to,
      kind: d.kind,
      note: d.note,
      changedAt: d.changedAt,
      anchor: d.anchor,
      history: d.history,
    }));
}

// ── 人物 state 块的投影 ─────────────────────────────────────────────────

/**
 * 从事件流算出人物卡的 `state` 块。
 *
 * 这是 CharacterState 全部字段带 Derived 标记的兑现处 —— 除了这个函数，
 * 系统里没有别的地方能构造它，所以"模型直接改人物当前状态"不可能发生。
 */
export function projectCharacterState(
  events: readonly StructuralEvent[],
  characterId: CharacterId,
  fallbackChapter: ChapterNo,
): CharacterCard["state"] {
  let vital: VitalStatus = "alive";
  let location: SettingId | null = null;
  let condition = "";
  let lastSeenAt = fallbackChapter;
  let appearanceCount = 0;

  for (const e of events) {
    const p = e.payload;
    if (p.type === "character_presence" && p.characterId === characterId) {
      lastSeenAt = e.envelope.chapter;
      appearanceCount += 1;
    } else if (p.type === "character_state_changed" && p.characterId === characterId) {
      if (p.field === "vital" && isVital(p.to)) vital = p.to;
      else if (p.field === "location") location = isSettingId(p.to) ? p.to : null;
      else if (p.field === "condition") condition = p.to;
    }
  }

  return {
    vital: derived(vital),
    location: derived(location),
    condition: derived(condition),
    lastSeenAt: derived(lastSeenAt),
    appearanceCount: derived(appearanceCount),
  };
}

function isVital(v: string): v is VitalStatus {
  return v === "alive" || v === "dead" || v === "missing" || v === "unknown";
}

/** location 字段的值必须是设定 ID；模型给了自由文本时置空而非污染 state。 */
function isSettingId(v: string): v is SettingId {
  return /^S\d+$/.test(v);
}

/** 供告警模块复用的类型出口。 */
export type { Alert, CharacterTier };
