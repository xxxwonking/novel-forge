/** 白板只读模型。确认状态、出处与时序由数据决定，不在这里设置章数或画布尺寸。 */
import { createHash } from "node:crypto";
import { resolveAnchor, type ChapterTextSource } from "../anchor/resolve.js";
import { isPlanOrigin, type StructuralEvent, type ForeshadowWeight, type EventKind } from "../types/events.js";
import type { ChapterBeat } from "../types/beat.js";
import type { AnchorRules } from "../rules/schema.js";
import type { AnchorPoint } from "./models.js";

export interface PlotBoardInput {
  readonly events: readonly StructuralEvent[];
  readonly beats: readonly ChapterBeat[];
  readonly currentChapter: number;
  readonly plotLines: readonly { readonly id: string; readonly label: string; readonly weight: ForeshadowWeight }[];
  readonly characters: readonly { readonly id: string; readonly name: string }[];
  readonly text: ChapterTextSource;
}
export interface BoardNode {
  readonly id: string;
  readonly groupId: string;
  readonly chapter: number;
  readonly volume: number | null;
  readonly summary: string;
  readonly kind: EventKind;
  readonly status: "written" | "planned";
  readonly source: string;
  readonly characters: readonly { readonly id: string; readonly name: string }[];
  readonly point: AnchorPoint | null;
}
export interface PlotBoard {
  readonly groups: readonly { readonly id: string; readonly label: string; readonly weight: ForeshadowWeight | null }[];
  readonly nodes: readonly BoardNode[];
  readonly edges: readonly { readonly id: string; readonly source: string; readonly target: string; readonly kind: "sequence" }[];
}
const confirmed = (p: string): boolean => p === "authored" || p === "committed";

export function buildPlotBoard(input: PlotBoardInput, rules: AnchorRules): PlotBoard {
  const groups: PlotBoard["groups"][number][] = [...input.plotLines].sort((a, b) => {
    const order = { main: 0, sub: 1, detail: 2 };
    return order[a.weight] - order[b.weight] || a.id.localeCompare(b.id);
  });
  const known = new Set(groups.map(g => g.id));
  const group = (id: string | null): string => id !== null && known.has(id) ? id : "unassigned";
  const names = new Map(input.characters.map(c => [c.id, c.name]));
  const characters = (ids: readonly string[]) => ids.map(id => ({ id, name: names.get(id) ?? id }));
  const volumes = new Map(input.beats.filter(b => confirmed(b.provenance)).map(b => [b.chapter, b.volume]));
  const nodes: BoardNode[] = [];
  for (const event of input.events) {
    const { envelope: e, payload: p } = event;
    if (!confirmed(e.provenance) || isPlanOrigin(e.origin) || p.type !== "plot_event") continue;
    nodes.push({ id: `event:${e.id}`, groupId: group(p.plotLine), chapter: e.chapter,
      volume: volumes.get(e.chapter) ?? null, summary: p.summary, kind: p.kind, status: "written",
      source: e.origin === "import_inference" ? "已确认旧稿反推" : e.origin === "user_edit" ? "作者标注" : "已确认正文事件",
      characters: characters(p.participants), point: { chapter: e.chapter, anchor: p.anchor, resolution: resolveAnchor(p.anchor, input.text, rules) } });
  }
  for (const beat of input.beats) {
    if (!confirmed(beat.provenance) || beat.chapter <= input.currentChapter || input.text(beat.chapter) !== undefined) continue;
    const plan = beat.plan;
    // 整章内容的版本进入 ID；重排事件或调整参与人物后，不误套另一版本的位置。
    const version = createHash("sha256").update(JSON.stringify({ volume: beat.volume, plan })).digest("hex");
    const events = plan.events.length > 0 ? plan.events : [{ kind: "info" as const, summary: plan.coreEvent, plotLine: null }];
    events.forEach((event, i) => nodes.push({ id: `plan:${beat.chapter}:${version}:${i}`, groupId: group(event.plotLine),
      chapter: beat.chapter, volume: beat.volume, summary: event.summary, kind: event.kind, status: "planned", source: "章计划",
      characters: characters(plan.characters), point: null }));
  }
  nodes.sort((a, b) => a.chapter - b.chapter);
  if (nodes.some(n => n.groupId === "unassigned")) groups.push({ id: "unassigned", label: "未分线", weight: null });
  const edges: PlotBoard["edges"][number][] = [];
  for (const g of groups) {
    // 未分线不代表同一故事线，不自动把无关联的事件串起来。
    if (g.id === "unassigned") continue;
    const line = nodes.filter(n => n.groupId === g.id);
    line.forEach((node, i) => {
      const previous = line[i - 1];
      if (previous) edges.push({ id: `sequence:${previous.id}:${node.id}`, source: previous.id, target: node.id, kind: "sequence" });
    });
  }
  return { groups, nodes, edges };
}
