/**
 * 关系图（视图四）。
 *
 * §12.9 把关系图排在 M5，这里做的是一个**确定性圆周布局**而不是力导向 ——
 * 节点数是几十不是几千，而力导向的代价是每次打开位置都不一样，用户建立不了
 * 空间记忆（"苏晚晴在右上角"）。真需要更好的布局是 M5 的事。
 *
 * 布局按 degree 降序排在圆周上：连边多的角色彼此靠近，视觉上自然成簇。
 */

import { useState } from "react";
import type { RelationGraph } from "../api.js";
import { relationLabel, tierLabel } from "../chart.js";

const SIZE = 520;
const RADIUS = 190;
const NODE_BASE = 5;

const KIND_COLOR: Record<string, string> = {
  ally: "var(--calm)",
  hostile: "var(--alarm)",
  kin: "var(--main)",
  romantic: "#a86f8f",
  mentor: "var(--sub)",
  subordinate: "var(--detail)",
  acquaintance: "var(--line-bright)",
  unknown: "var(--line-bright)",
};

export interface RelationMapProps {
  graph: RelationGraph;
  onJump: (chapter: number, quote: string) => void;
  highlight?: string | null;
}

export function RelationMap({ graph, onJump, highlight }: RelationMapProps): React.ReactElement {
  const [hover, setHover] = useState<string | null>(null);

  const ordered = [...graph.nodes].sort((a, b) => b.degree - a.degree || a.id.localeCompare(b.id));
  const positions = new Map(
    ordered.map((n, i) => {
      const angle = (i / Math.max(1, ordered.length)) * Math.PI * 2 - Math.PI / 2;
      return [n.id, { x: SIZE / 2 + Math.cos(angle) * RADIUS, y: SIZE / 2 + Math.sin(angle) * RADIUS }];
    }),
  );

  const active = hover ?? highlight ?? null;

  return (
    <div className="chart" style={{ display: "flex", gap: 20, padding: 16 }}>
      <svg width={SIZE} height={SIZE} role="img" aria-label="人物关系图">
        {graph.edges.map((e, i) => {
          const from = positions.get(e.from);
          const to = positions.get(e.to);
          if (from === undefined || to === undefined) return null;
          const dim = active !== null && active !== e.from && active !== e.to;

          return (
            <line
              key={i}
              x1={from.x}
              y1={from.y}
              x2={to.x}
              y2={to.y}
              stroke={KIND_COLOR[e.kind] ?? "var(--line-bright)"}
              strokeWidth={e.historyCount > 1 ? 2.5 : 1.5}
              opacity={dim ? 0.12 : 0.75}
              className="node"
              onClick={
                e.point.resolution.status === "stale" ? undefined : () => onJump(e.point.chapter, e.point.anchor.quote)
              }
            >
              <title>{`${e.from} → ${e.to}　${relationLabel(e.kind)}（第 ${e.changedAt} 章）\n${e.note}`}</title>
            </line>
          );
        })}

        {ordered.map((n) => {
          const p = positions.get(n.id)!;
          const dim = active !== null && active !== n.id && !isNeighbour(graph, active, n.id);

          return (
            <g
              key={n.id}
              opacity={dim ? 0.25 : 1}
              onMouseEnter={() => setHover(n.id)}
              onMouseLeave={() => setHover(null)}
            >
              <circle
                cx={p.x}
                cy={p.y}
                r={NODE_BASE + n.degree}
                fill={n.tier === "protagonist" ? "var(--main)" : "var(--sub)"}
                stroke="var(--bg)"
                strokeWidth={2}
              />
              <text
                className="chart-label"
                data-strong={active === n.id || undefined}
                x={p.x}
                y={p.y - NODE_BASE - n.degree - 6}
                textAnchor="middle"
              >
                {n.name}
              </text>
            </g>
          );
        })}
      </svg>

      <div style={{ flex: 1, minWidth: 260 }}>
        <h3 style={{ font: "10px var(--mono)", letterSpacing: "0.1em", color: "var(--ink-faint)", margin: "0 0 8px" }}>
          关系沿革
        </h3>
        <table>
          <thead>
            <tr>
              <th>关系</th>
              <th>当前</th>
              <th className="num">变于</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((e, i) => (
              <tr key={i} style={{ opacity: active === null || active === e.from || active === e.to ? 1 : 0.35 }}>
                <td>
                  {nameOf(graph, e.from)} → {nameOf(graph, e.to)}
                </td>
                <td>
                  <span className="tag">{relationLabel(e.kind)}</span>{" "}
                  <span className="muted">{e.note}</span>
                  {e.historyCount > 1 && (
                    <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                      {e.history.map((h) => `ch${h.chapter} ${relationLabel(h.kind)}`).join(" → ")}
                    </div>
                  )}
                </td>
                <td className="num">{e.changedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted" style={{ fontSize: 12, marginTop: 14 }}>
          节点大小按连边数，主角用暖色。悬浮某人只留他的边。<br />
          圆周布局是确定的 —— 每次打开位置一样，方便建立空间记忆。力导向布局排在 M5。
        </p>
      </div>
    </div>
  );
}

function isNeighbour(graph: RelationGraph, a: string, b: string): boolean {
  return graph.edges.some((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a));
}

function nameOf(graph: RelationGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.name ?? id;
}

export function tierText(tier: Parameters<typeof tierLabel>[0]): string {
  return tierLabel(tier);
}
