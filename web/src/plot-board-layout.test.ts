import { describe, expect, it } from "vitest";
import { boardCards, restoreBoardLayout, boardStorageKey, boardMinZoom } from "./plot-board-layout.js";
import type { PlotBoard } from "./api.js";

const board: PlotBoard = { groups: [{ id: "P01", label: "主线", weight: "main" }], edges: [], nodes:
  [1, 1, 5000].map((chapter, i) => ({ id: `event:${i}`, groupId: "P01", chapter, volume: null, summary: `事件${i}`, status: "written", source: "正文", characters: [], point: null, kind: "action" })) };

describe("白板布局", () => {
  it("稀疏章号按实际章排序，不预创建空章节；同章多事件不会重叠", () => {
    const cards = boardCards(board, []);
    expect(cards).toHaveLength(3);
    expect(cards[1]!.position.y).toBeGreaterThan(cards[0]!.position.y);
    expect(cards[2]!.position.x - cards[0]!.position.x).toBeLessThan(1000);
  });
  it("收起章节或情节线只改变显示；展开可还原真实事件", () => {
    expect(boardCards(board, ["chapter:P01:1"]).map(c => c.id)).toEqual(["chapter:P01:1", "event:2"]);
    expect(boardCards(board, ["group:P01"])[0]?.members).toHaveLength(3);
    expect(boardCards(board, ["group:P01"])).toHaveLength(1);
    expect(boardCards(board, [])).toHaveLength(3);
    expect(board.nodes).toHaveLength(3);
  });
  it("坏布局安全降级，清除已删除/换版节点坐标和折叠项", () => {
    expect(restoreBoardLayout("broken", board).positions).toEqual({});
    const saved = restoreBoardLayout(JSON.stringify({ version: 1, positions: { "event:0": { x: 5, y: -8 }, deleted: { x: 20, y: 30 }, "event:1": { x: "wrong", y: 8 } }, collapsed: ["chapter:P01:1", "group:gone", 4], viewport: { x: 0, y: 0, zoom: 0 } }), board);
    expect(saved.positions).toEqual({ "event:0": { x: 5, y: -8 } });
    expect(saved.collapsed).toEqual(["chapter:P01:1"]);
    expect(saved.viewport).toBeNull();
  });
  it("有效视口可恢复，作品 ID 隔离且不发生连接歧义", () => {
    const viewport = { x: -555, y: 20, zoom: 0.4 };
    expect(restoreBoardLayout(JSON.stringify({ version: 1, viewport }), board).viewport).toEqual(viewport);
    expect(boardStorageKey("work-a")).not.toBe(boardStorageKey("work-b"));
    expect(restoreBoardLayout(JSON.stringify({ version: 999, viewport }), board).viewport).toBeNull();
  });
  it("全部收起时紧凑排列情节线，避免总览缩成一列小字", () => {
    const groups = Array.from({ length: 8 }, (_, i) => ({ id: `P${i}`, label: `线${i}`, weight: "sub" as const }));
    const data = { groups, edges: [], nodes: groups.map((g, i) => ({ ...board.nodes[0]!, id: `e${i}`, groupId: g.id })) };
    const cards = boardCards(data, groups.map(g => `group:${g.id}`));
    expect(new Set(cards.map(c => c.position.x)).size).toBe(3);
    expect(Math.max(...cards.map(c => c.position.y))).toBeLessThan(600);
  });
  it("密集长篇的最小缩放随实际画布扩展，不以固定缩放限制适配章数", () => {
    const dense = { ...board, nodes: Array.from({ length: 5000 }, (_, i) => ({ ...board.nodes[0]!, id: `event:${i}`, chapter: i + 1 })) };
    expect(boardMinZoom(boardCards(dense, []), {})).toBeLessThan(0.001);
    const viewport = { x: 0, y: 0, zoom: 0.0001 };
    expect(restoreBoardLayout(JSON.stringify({ version: 1, viewport }), dense).viewport).toEqual(viewport);
  });
});
