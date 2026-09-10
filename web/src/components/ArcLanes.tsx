/**
 * 人物弧线（视图三）。
 *
 * 出场画成竖条（POV 最高，仅被提及最矮），转折点画成菱形。**缺席段用红条**，
 * 与另两张图同一语言。
 *
 * 出场是稀疏的（只有出场的章在数组里），所以这里逐点画而不是画一条连续线 ——
 * 连续线会让"隔十几章才出场一次"看起来和"每章都在"一样。
 */

import type { ArcLane } from "../api.js";
import { LAYOUT, makeScale, tierLabel, type Axis } from "../chart.js";
import { useWidth } from "../hooks.js";
import { AnchorDot } from "./AnchorDot.js";
import { Grid, truncate } from "./Timeline.js";

const ROLE_HEIGHT: Record<ArcLane["presence"][number]["role"], number> = {
  pov: 9,
  major: 7,
  minor: 5,
  mentioned: 3,
};

export interface ArcLanesProps {
  axis: Axis;
  arcs: ArcLane[];
  onJump: (chapter: number, quote: string) => void;
  highlight?: string | null;
}

export function ArcLanes({ axis, arcs, onJump, highlight }: ArcLanesProps): React.ReactElement {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = makeScale(axis, arcs.length, width);

  return (
    <div className="chart" ref={ref}>
      <svg width={scale.width} height={scale.height} role="img" aria-label="人物弧线">
        <Grid axis={axis} scale={scale} />

        {arcs.map((arc, row) => {
          const y = scale.y(row);
          const strong = highlight === arc.characterId;

          return (
            <g key={arc.characterId}>
              <text className="chart-label" data-strong={strong || undefined} x={LAYOUT.padLeft} y={y + 4}>
                {truncate(arc.name, 11)}
              </text>
              <text className="chart-axis" x={LAYOUT.padLeft + LAYOUT.labelWidth - 34} y={y + 4}>
                {tierLabel(arc.tier)}
              </text>

              <line
                x1={scale.x(arc.introducedAt)}
                x2={scale.x(axis.to)}
                y1={y}
                y2={y}
                stroke="var(--line-bright)"
                strokeWidth={1}
              />

              {arc.absenceSpan !== null && (
                <line
                  x1={scale.x(arc.absenceSpan.from)}
                  x2={scale.x(arc.absenceSpan.to)}
                  y1={y}
                  y2={y}
                  stroke="var(--alarm)"
                  strokeWidth={4}
                  strokeLinecap="round"
                  opacity={0.7}
                />
              )}

              {arc.presence.map((p) => {
                const h = ROLE_HEIGHT[p.role];
                return (
                  <line
                    key={p.chapter}
                    x1={scale.x(p.chapter)}
                    x2={scale.x(p.chapter)}
                    y1={y - h / 2}
                    y2={y + h / 2}
                    stroke={p.role === "mentioned" ? "var(--ink-faint)" : "var(--sub)"}
                    strokeWidth={2}
                  >
                    <title>{`第 ${p.chapter} 章 · ${roleLabel(p.role)}`}</title>
                  </line>
                );
              })}

              {arc.turningPoints.map((t, i) => (
                <AnchorDot
                  key={i}
                  point={t.point}
                  x={scale.x(t.point.chapter)}
                  y={y}
                  r={LAYOUT.nodeRadius + 1}
                  fill="var(--main)"
                  title={`第 ${t.point.chapter} 章 ${t.field}：${t.from ?? "（未设）"} → ${t.to}`}
                  onJump={onJump}
                />
              ))}

              {arc.absenceSpan !== null && (
                <text className="chart-axis" x={scale.x(axis.to) + 8} y={y + 4} fill="var(--alarm)">
                  消失 {axis.current - arc.lastSeenAt}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function roleLabel(role: ArcLane["presence"][number]["role"]): string {
  switch (role) {
    case "pov":
      return "视角人物";
    case "major":
      return "主要参与";
    case "minor":
      return "次要参与";
    default:
      return "仅被提及";
  }
}
