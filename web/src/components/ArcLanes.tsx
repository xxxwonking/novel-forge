import type { JumpToSource } from "../source-navigation.js";
/**
 * 人物弧线（视图三）。
 *
 * 出场画成竖条（POV 最高，仅被提及最矮），转折点画成圆点。**缺席段用红条**，
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
import { characterStateFieldLabel, characterStateValueLabel } from "../labels.js";

const ROW_HEIGHT = 48;
const ROLE_HEIGHT: Record<ArcLane["presence"][number]["role"], number> = {
  pov: 20,
  major: 14,
  minor: 9,
  mentioned: 5,
};

export interface ArcLanesProps {
  axis: Axis;
  arcs: ArcLane[];
  onJump: JumpToSource;
  highlight?: string | null;
}

export function ArcLanes({ axis, arcs, onJump, highlight }: ArcLanesProps): React.ReactElement {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = makeScale(axis, arcs.length, width, ROW_HEIGHT);

  return (
    <div className="chart arc-chart" ref={ref} role="region" aria-label="人物出场分布，可横向滚动" tabIndex={0}>
      <svg width={scale.width} height={scale.height} role="img" aria-label="人物弧线">
        <desc>每行一位人物，横轴为章节。竖条表示出场记录，圆点表示人物状态变化，红色横条表示超过缺席提醒阈值。具体记录可在下方人物明细中阅读。</desc>
        {arcs.map((arc, row) => (
          <rect key={arc.characterId} className="arc-row-background" data-highlighted={highlight === arc.characterId || undefined}
            x={0} y={LAYOUT.padTop + row * ROW_HEIGHT} width={scale.width} height={ROW_HEIGHT} />
        ))}
        <Grid axis={axis} scale={scale} />
        <text className="chart-axis" x={LAYOUT.padLeft} y={LAYOUT.padTop - 12}>人物 / 出场情况</text>

        {arcs.map((arc, row) => {
          const y = scale.y(row);
          const strong = highlight === arc.characterId;

          return (
            <g key={arc.characterId}>
              <text className="chart-label" data-strong={strong || undefined} x={LAYOUT.padLeft} y={y - 3}>
                <title>{arc.name}</title>
                {truncate(arc.name, 9)}
              </text>
              <text className="arc-character-meta" data-absent={arc.absenceSpan !== null || undefined} x={LAYOUT.padLeft} y={y + 15}>
                {tierLabel(arc.tier)}{arc.absenceSpan !== null ? ` · ${axis.current - arc.lastSeenAt}章未出场` : arc.presence.length === 0 ? " · 未记录出场" : ""}
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
                  opacity={0.8}
                ><title>{`连续 ${axis.current - arc.lastSeenAt} 章没有出场记录，已超过提醒阈值`}</title></line>
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
                    stroke={p.role === "mentioned" ? "var(--muted-foreground)" : "var(--info)"}
                    strokeWidth={3}
                    strokeLinecap="round"
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
                  title={`第 ${t.point.chapter} 章 ${characterStateFieldLabel(t.field)}：${characterStateValueLabel(t.field, t.from)} → ${characterStateValueLabel(t.field, t.to)}`}
                  onJump={onJump}
                />
              ))}
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
