import { expect, it } from "vitest";
import { relationSimulation } from "../web/src/relation-layout.js";

it("关系布局稳定、有限且不改变作品数据，孤立人物仍可见", () => {
  const graph = {
    nodes: Array.from({ length: 8 }, (_, i) => ({
      id: `C${i}`,
      name: `人物${i}`,
      tier: "major",
      degree: i ? 1 : 6,
    })),
    edges: Array.from({ length: 6 }, (_, i) => ({
      from: "C0",
      to: `C${i + 1}`,
    })),
  };
  const before = JSON.stringify(graph);
  const a = relationSimulation(graph).tick(240).nodes();
  const b = relationSimulation(graph).tick(240).nodes();
  expect(a).toEqual(b);
  expect(JSON.stringify(graph)).toBe(before);
  expect(a).toHaveLength(8);
  for (const n of a) {
    expect(Number.isFinite(n.x + n.y)).toBe(true);
    for (const m of a)
      if (n !== m) expect(Math.hypot(n.x - m.x, n.y - m.y)).toBeGreaterThan(70);
  }
  expect(
    new Set(a.map((n) => Math.round(Math.hypot(n.x - 260, n.y - 260) / 20)))
      .size,
  ).toBeGreaterThan(2);
});
