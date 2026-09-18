/**
 * 跨章返修的**代码通道**：算出「第 N 章改了什么」以及「哪些后续章因此对不上」。
 *
 * 为什么这一层必须是纯代码：改早章之后真正危险的是**结构事实对不上** ——
 * 后面兑现了一条已经不存在的伏笔、死掉的人又出场、状态与关系接在被改掉的那个值上。
 * 这几件事全部写在结构声明的硬字段里，判得出、判得准、不花钱。把它交给模型，
 * 既贵又会漏。
 *
 * 同样要紧的是**不该圈进来的章**：改一章的事件叙述，不足以指认第 40 章受影响 ——
 * 同一条情节线上的章动辄几十个，全圈进来等于没圈，作者会关掉整个功能。
 * 正文层面的牵连由 `locate.ts` 的模型通道逐章查，范围由作者定。
 */

import type { C5Declaration, StructuralEventPayload } from "../types/events.js";
import type { ChapterNo } from "../types/primitives.js";

export type FactKind = "foreshadow_planted" | "foreshadow_resolved" | "character_state" | "relation" | "plot_event" | "prose";
export type FactDirection = "removed" | "added" | "changed";

/**
 * 一条被改动的结构事实。
 *
 * `subject` 是**可在后续章里检索的编号**（F01 / C01 / C01→C02 / P01），受影响章
 * 的筛选全靠它；`text` 是人读的一句话，既进界面也进模型提示。不带章号 ——
 * 同一条变化在清单里可能被多次引用，章号由调用方在渲染时补。
 */
export interface FactChange {
  readonly kind: FactKind;
  readonly direction: FactDirection;
  readonly subject: string;
  readonly text: string;
  /** 状态变化的字段名（condition / location / vital）。判链断裂用。 */
  readonly field?: string;
  /** 改动前后的值；removed 后为 null，added 前为 null。 */
  readonly before?: string | null;
  readonly after?: string | null;
}

export type ImpactSeverity = "conflict" | "review";

export interface ImpactReason {
  readonly severity: ImpactSeverity;
  readonly rule: string;
  readonly text: string;
}

export interface ChapterImpact {
  readonly chapter: ChapterNo;
  /** 该章诸条理由里最重的一条。 */
  readonly severity: ImpactSeverity;
  readonly reasons: readonly ImpactReason[];
}

/** 一个后续章的结构记录。只要载荷 —— 信封里的东西对判定没有用处。 */
export interface LaterChapter {
  readonly chapter: ChapterNo;
  readonly payloads: readonly StructuralEventPayload[];
}

export interface RevisionImpact {
  readonly source: ChapterNo;
  readonly changes: readonly FactChange[];
  readonly chapters: readonly ChapterImpact[];
}

// ── 结构差异 ────────────────────────────────────────────────────────────

/**
 * 两份声明的事实差异。
 *
 * 按**对象编号**配对，不按位置：模型重写一章会把所有条目重排一遍，按位置比会得出
 * 「全都变了」。没有编号的 plot_event 按所属情节线归并后比摘要 —— 单条事件在两份
 * 声明之间没有身份，能说清的只有「这条线上的事件不一样了」。
 */
export function diffDeclarations(before: C5Declaration | null, after: C5Declaration | null): readonly FactChange[] {
  const a = before ?? EMPTY;
  const b = after ?? EMPTY;
  return [
    ...diffPlanted(a, b),
    ...diffResolved(a, b),
    ...diffStates(a, b),
    ...diffRelations(a, b),
    ...diffEvents(a, b),
  ];
}

/**
 * 正文改了、结构声明一字未动。
 *
 * 这种修订代码指认不出任何受影响的对象，但它**不是没有影响** —— 重写一场戏而不改
 * 声明是常事，后面引用那场戏细节的段落照样会失效。所以仍记一次，让紧接的下一章
 * 亮起来，并留下 `latest` 供作者点查任意后续章。
 */
export const PROSE_ONLY_CHANGE: FactChange = {
  kind: "prose", direction: "changed", subject: "", text: "正文有改动，结构记录不变",
};

const EMPTY: C5Declaration = {
  events: [], foreshadowPlanted: [], foreshadowResolved: [],
  relationsChanged: [], characterStates: [], characterPresence: [],
};

/** 按键配对两侧条目，交给回调决定产出什么。键的并集保持 before → after 的出现顺序。 */
function pair<T>(
  before: readonly T[],
  after: readonly T[],
  key: (item: T) => string,
  emit: (key: string, before: T | undefined, after: T | undefined) => FactChange | null,
): readonly FactChange[] {
  const left = new Map(before.map((item) => [key(item), item]));
  const right = new Map(after.map((item) => [key(item), item]));
  const keys = [...new Set([...left.keys(), ...right.keys()])];
  return keys.flatMap((k) => {
    const change = emit(k, left.get(k), right.get(k));
    return change === null ? [] : [change];
  });
}

function diffPlanted(a: C5Declaration, b: C5Declaration): readonly FactChange[] {
  return pair(a.foreshadowPlanted, b.foreshadowPlanted, (f) => f.foreshadowId as string, (id, left, right) => {
    const label = (right ?? left)!.label;
    if (right === undefined) return { kind: "foreshadow_planted", direction: "removed", subject: id, text: `不再埋下伏笔「${label}」(${id})` };
    if (left === undefined) return { kind: "foreshadow_planted", direction: "added", subject: id, text: `新埋下伏笔「${label}」(${id})，计划第 ${right.expectedBy} 章前收` };
    const diffs = [
      left.label === right.label ? "" : `名称 ${left.label} → ${right.label}`,
      left.intent === right.intent ? "" : "意图有改动",
      left.weight === right.weight ? "" : `权重 ${left.weight} → ${right.weight}`,
      left.expectedBy === right.expectedBy ? "" : `收束章 ${left.expectedBy} → ${right.expectedBy}`,
    ].filter((item) => item !== "");
    return diffs.length === 0 ? null
      : { kind: "foreshadow_planted", direction: "changed", subject: id, text: `伏笔「${label}」(${id}) 的埋设有改动：${diffs.join("、")}` };
  });
}

function diffResolved(a: C5Declaration, b: C5Declaration): readonly FactChange[] {
  return pair(a.foreshadowResolved, b.foreshadowResolved, (f) => f.foreshadowId as string, (id, left, right) => {
    if (right === undefined) return { kind: "foreshadow_resolved", direction: "removed", subject: id, text: `不再收束伏笔 ${id}` };
    if (left === undefined) return { kind: "foreshadow_resolved", direction: "added", subject: id, text: `改为在本章收束伏笔 ${id}（${completeness(right.completeness)}）` };
    return left.completeness === right.completeness ? null
      : { kind: "foreshadow_resolved", direction: "changed", subject: id, text: `伏笔 ${id} 的收束程度 ${completeness(left.completeness)} → ${completeness(right.completeness)}` };
  });
}

const completeness = (value: "full" | "partial"): string => value === "full" ? "完全收束" : "部分收束";

function diffStates(a: C5Declaration, b: C5Declaration): readonly FactChange[] {
  return pair(a.characterStates, b.characterStates, (s) => `${s.characterId as string}|${s.field}`, (key, left, right) => {
    const [id, field] = key.split("|") as [string, string];
    const base = { kind: "character_state", subject: id, field } as const;
    if (right === undefined) return { ...base, direction: "removed", before: left!.to, after: null, text: `${id} 的${field}不再于本章变为「${left!.to}」` };
    if (left === undefined) return { ...base, direction: "added", before: null, after: right.to, text: `${id} 的${field}在本章变为「${right.to}」` };
    return left.to === right.to ? null
      : { ...base, direction: "changed", before: left.to, after: right.to, text: `${id} 的${field}：「${left.to}」→「${right.to}」` };
  });
}

function diffRelations(a: C5Declaration, b: C5Declaration): readonly FactChange[] {
  return pair(a.relationsChanged, b.relationsChanged, (r) => `${r.from as string}→${r.to as string}`, (key, left, right) => {
    const base = { kind: "relation", subject: key } as const;
    if (right === undefined) return { ...base, direction: "removed", before: left!.toKind, after: null, text: `${key} 的关系不再于本章变为 ${left!.toKind}` };
    if (left === undefined) return { ...base, direction: "added", before: null, after: right.toKind, text: `${key} 的关系在本章变为 ${right.toKind}` };
    return left.toKind === right.toKind ? null
      : { ...base, direction: "changed", before: left.toKind, after: right.toKind, text: `${key} 的关系：${left.toKind} → ${right.toKind}` };
  });
}

/** 事件按情节线归并后比摘要。单条事件没有身份，能说清的只有「这条线上的事不一样了」。 */
function diffEvents(a: C5Declaration, b: C5Declaration): readonly FactChange[] {
  const byLine = (decl: C5Declaration): ReadonlyMap<string, string[]> => {
    const map = new Map<string, string[]>();
    for (const event of decl.events) {
      const line = (event.plotLine as string | null) ?? "";
      map.set(line, [...(map.get(line) ?? []), event.summary]);
    }
    return map;
  };
  const left = byLine(a);
  const right = byLine(b);
  const lines = [...new Set([...left.keys(), ...right.keys()])];
  return lines.flatMap((line) => {
    const was = left.get(line) ?? [];
    const now = right.get(line) ?? [];
    if (was.join("｜") === now.join("｜")) return [];
    const where = line === "" ? "不属于任何情节线的事件" : `情节线 ${line} 上的事件`;
    const direction: FactDirection = now.length === 0 ? "removed" : was.length === 0 ? "added" : "changed";
    const text = now.length === 0 ? `${where}被删去：${was.join("；")}`
      : was.length === 0 ? `${where}是新增的：${now.join("；")}`
        : `${where}有改动：${was.join("；")} → ${now.join("；")}`;
    return [{ kind: "plot_event" as const, direction, subject: line, text }];
  });
}

// ── 受影响的后续章 ──────────────────────────────────────────────────────

/**
 * 哪些后续章因这批变化而对不上。
 *
 * conflict 是**代码判得死的矛盾**，必须处理；review 是「值得再读一遍」。两者
 * 分开是因为作者的处置不同 —— 前者不改就是错，后者可能看一眼就过。
 */
export function impactedChapters(
  source: ChapterNo,
  changes: readonly FactChange[],
  later: readonly LaterChapter[],
): readonly ChapterImpact[] {
  if (changes.length === 0) return [];
  return later
    .filter((item) => item.chapter > source)
    .sort((x, y) => x.chapter - y.chapter)
    .map((item) => ({ chapter: item.chapter, reasons: reasonsFor(source, changes, item) }))
    .filter((item) => item.reasons.length > 0)
    .map((item) => ({
      chapter: item.chapter,
      severity: item.reasons.some((r) => r.severity === "conflict") ? "conflict" as const : "review" as const,
      reasons: item.reasons,
    }));
}

function reasonsFor(source: ChapterNo, changes: readonly FactChange[], item: LaterChapter): readonly ImpactReason[] {
  const out: ImpactReason[] = [];
  const add = (severity: ImpactSeverity, rule: string, text: string): void => {
    if (!out.some((r) => r.rule === rule && r.text === text)) out.push({ severity, rule, text });
  };

  for (const change of changes) {
    if (change.kind === "foreshadow_planted") {
      const resolvedHere = item.payloads.some((p) => p.type === "foreshadow_resolved" && (p.foreshadowId as string) === change.subject);
      if (change.direction === "removed" && resolvedHere) {
        add("conflict", "dangling_resolution", `本章收束的伏笔 ${change.subject} 已经不再埋设 —— 这一处兑现落空了。`);
      } else if (resolvedHere) {
        add("review", "foreshadow_touched", `本章收束的伏笔 ${change.subject} 的埋设有改动，兑现方式可能要跟着调整。`);
      }
      continue;
    }
    if (change.kind === "foreshadow_resolved") {
      if (item.payloads.some((p) => p.type === "foreshadow_resolved" && (p.foreshadowId as string) === change.subject)) {
        add("review", "foreshadow_touched", `伏笔 ${change.subject} 的收束安排有改动，本章也收束了它。`);
      }
      continue;
    }
    if (change.kind === "character_state") {
      if (change.field === "vital") {
        if (mentions(item, change.subject)) {
          add("conflict", "vital_changed", `${change.subject} 的生死状态被改动（${change.before ?? "未记录"} → ${change.after ?? "不再变化"}），而本章他仍有记录在案的戏份。`);
        }
        continue;
      }
      const chained = item.payloads.some((p) => p.type === "character_state_changed"
        && (p.characterId as string) === change.subject && p.field === change.field && p.from === (change.before ?? null));
      if (chained && change.before !== change.after) {
        add("conflict", "state_chain_broken", `本章写的是 ${change.subject} 的${change.field}从「${change.before ?? "未设置"}」开始变化，而那个值已经被改掉了。`);
      } else if (item.payloads.some((p) => p.type === "character_state_changed" && (p.characterId as string) === change.subject && p.field === change.field)) {
        add("review", "character_touched", `${change.subject} 的${change.field}在第 ${source} 章有改动，本章也记了这一项。`);
      }
      continue;
    }
    if (change.kind === "relation") {
      const [from = "", to = ""] = change.subject.split("→");
      const here = item.payloads.filter((p) => p.type === "relation_changed" && (p.from as string) === from && (p.to as string) === to);
      const chained = here.some((p) => p.type === "relation_changed" && p.fromKind === (change.before ?? null));
      if (chained && change.before !== change.after) {
        add("conflict", "relation_chain_broken", `本章写的是 ${change.subject} 从 ${change.before ?? "未记录"} 开始转变，而那一档已经被改掉了。`);
      } else if (here.length > 0) {
        add("review", "character_touched", `${change.subject} 的关系在第 ${source} 章有改动，本章也记了这一项。`);
      }
    }
    // plot_event 不单独圈章：同一条情节线上的章太多，代码指认不了是哪一章依赖了它。
  }

  // 紧接着的一章直接承接被改的那一章，无条件复核。这不是阈值，是相邻关系。
  if (item.chapter === source + 1) add("review", "next_chapter", `紧接在第 ${source} 章之后，开头往往直接承接它。`);
  return out;
}

/** 后续章里有没有这个人的记录 —— 出场、参与事件、状态或关系变化都算。 */
function mentions(item: LaterChapter, characterId: string): boolean {
  return item.payloads.some((p) =>
    (p.type === "character_presence" && (p.characterId as string) === characterId) ||
    (p.type === "character_state_changed" && (p.characterId as string) === characterId) ||
    (p.type === "plot_event" && p.participants.some((id) => (id as string) === characterId)) ||
    (p.type === "relation_changed" && ((p.from as string) === characterId || (p.to as string) === characterId)));
}
