import type { PlotBoard, PlotBoardNode } from "./api.js";

export interface BoardPosition { x: number; y: number }
export interface BoardViewport extends BoardPosition { zoom: number }
export interface BoardLayout {
  version: 1;
  positions: Record<string, BoardPosition>;
  collapsed: string[];
  viewport: BoardViewport | null;
}
export interface BoardCard {
  id: string;
  groupId: string;
  title: string;
  summary: string;
  type: "event" | "chapter" | "group";
  members: PlotBoardNode[];
  position: BoardPosition;
}
export const boardStorageKey = (projectId: string): string => `novel-forge:plot-board:v1:${encodeURIComponent(projectId)}`;
export const chapterKey = (groupId: string, chapter: number | null): string => `chapter:${groupId}:${chapter ?? "unassigned"}`;
export const groupKey = (groupId: string): string => `group:${groupId}`;

/** 按实际出现的章号排布；不按章号预分配数组，不留几千个空章节。 */
export function boardCards(board: PlotBoard, collapsed: readonly string[]): BoardCard[] {
  const result: BoardCard[] = [];
  const chapters = [...new Set(board.nodes.map(n => n.chapter))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
  const columns = new Map(chapters.map((chapter, i) => [chapter, i]));
  const folded = new Set(collapsed);
  const activeGroups = board.groups.filter(g => board.nodes.some(n => n.groupId === g.id));
  const overview = activeGroups.every(g => folded.has(groupKey(g.id)));
  const overviewColumns = Math.ceil(Math.sqrt(activeGroups.length));
  let y = 0;
  for (const group of board.groups) {
    const members = board.nodes.filter(n => n.groupId === group.id);
    if (members.length === 0) continue;
    const lineChapters = [...new Set(members.map(n => n.chapter))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
    if (folded.has(groupKey(group.id))) {
      const index = result.length;
      result.push({ id: groupKey(group.id), groupId: group.id, title: group.label,
        summary: `${members.length} 个节点 · ${lineChapters.some(c=>c!==null)?`第 ${lineChapters.find(c=>c!==null)}–${lineChapters.filter(c=>c!==null).at(-1)} 章`:"资料未标注章号"}`, type: "group", members,
        position: overview ? { x: (index % overviewColumns) * 312, y: Math.floor(index / overviewColumns) * 240 } : { x: 0, y } });
      y += 240;
      continue;
    }
    let rows = 1;
    for (const chapter of lineChapters) {
      const chapterMembers = members.filter(n => n.chapter === chapter);
      const x = (columns.get(chapter) ?? 0) * 312;
      if (folded.has(chapterKey(group.id, chapter))) {
        result.push({ id: chapterKey(group.id, chapter), groupId: group.id, title: chapter === null ? "未标注章号的资料" : `第 ${chapter} 章`,
          summary: `${chapterMembers.length} 个事件 · 点击展开`, type: "chapter", members: chapterMembers, position: { x, y } });
      } else {
        rows = Math.max(rows, chapterMembers.length);
        chapterMembers.forEach((node, i) => result.push({ id: node.id, groupId: group.id, title: node.chapter === null ? `资料节点 ${node.outlineOrder ?? i+1}` : `第 ${node.chapter} 章`, summary: node.summary,
          type: "event", members: [node], position: { x, y: y + i * 216 } }));
      }
    }
    y += rows * 216 + 80;
  }
  return result;
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
/** 适配范围取决于实际节点坐标，长篇不会被固定最小缩放挡住。 */
export function boardMinZoom(cards: readonly BoardCard[], positions: Readonly<Record<string, BoardPosition>>): number {
  let minX = 0, minY = 0, maxX = 272, maxY = 184;
  for (const card of cards) {
    const p = positions[card.id] ?? card.position;
    minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + 272); maxY = Math.max(maxY, p.y + 184);
  }
  return Math.min(0.01, 100 / Math.max(maxX - minX, maxY - minY));
}
function position(value: unknown): value is BoardPosition {
  return record(value) && typeof value["x"] === "number" && typeof value["y"] === "number" && Number.isFinite(value["x"]) && Number.isFinite(value["y"]);
}
export function restoreBoardLayout(raw: string | null, board: PlotBoard): BoardLayout {
  const layout: BoardLayout = { version: 1, positions: {}, collapsed: [], viewport: null };
  if (raw === null) return layout;
  let saved: unknown;
  try { saved = JSON.parse(raw); } catch { return layout; }
  if (!record(saved) || saved["version"] !== 1) return layout;
  const collapsible = new Set<string>(board.groups.map(g => groupKey(g.id)));
  for (const n of board.nodes) collapsible.add(chapterKey(n.groupId, n.chapter));
  const ids = new Set([...collapsible, ...board.nodes.map(n => n.id)]);
  if (record(saved["positions"])) {
    for (const [id, p] of Object.entries(saved["positions"])) if (ids.has(id) && position(p)) layout.positions[id] = { x: p.x, y: p.y };
  }
  if (Array.isArray(saved["collapsed"])) layout.collapsed = saved["collapsed"].filter((id): id is string => typeof id === "string" && collapsible.has(id));
  const viewport = saved["viewport"];
  if (position(viewport) && record(viewport) && typeof viewport["zoom"] === "number" && viewport["zoom"] > 0 && viewport["zoom"] <= 2) {
    layout.viewport = { x: viewport.x, y: viewport.y, zoom: viewport["zoom"] };
  }
  return layout;
}
