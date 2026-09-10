/**
 * 情节线（视图二）。
 *
 * 每条线一行，节点是事件（半径按权重）。**断线段画成红色实条** —— 与伏笔
 * 逾期段同一视觉语言，因为对用户是同一件事："这里拖太久了"。
 *
 * 规划态节点画空心虚边（§12.1 P4 的"规划态显示虚线"）：它还没写，锚点必然
 * stale，所以 AnchorDot 自然就渲染成不可点的形态。
 */

import type { PlotTrack } from "../api.js";
import { LAYOUT, makeScale, nodeRadius, weightColor, weightLabel, type Axis } from "../chart.js";
import { useWidth } from "../hooks.js";
import { AnchorDot } from "./AnchorDot.js";
import { Grid, truncate } from "./Timeline.js";

export interface PlotTracksProps {
  axis: Axis;
  tracks: PlotTrack[];
  onJump: (chapter: number, quote: string) => void;
  highlight?: string | null;
}

export function PlotTracks({ axis, tracks, onJump, highlight }: PlotTracksProps): React.ReactElement {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = makeScale(axis, tracks.length, width);

  return (
    <div className="chart" ref={ref}>
      <svg width={scale.width} height={scale.height} role="img" aria-label="情节线">
        <Grid axis={axis} scale={scale} />

        {tracks.map((track, row) => {
          const y = scale.y(row);
          const broken = track.gapSpan !== null && track.currentGap > track.gapLimit;
          const strong = highlight === track.id;

          return (
            <g key={track.id}>
              <text className="chart-label" data-strong={strong || undefined} x={LAYOUT.padLeft} y={y + 4}>
                {truncate(track.label, 11)}
              </text>
              <text className="chart-axis" x={LAYOUT.padLeft + LAYOUT.labelWidth - 34} y={y + 4}>
                {weightLabel(track.weight)}
              </text>

              {/* 基线贯穿全轴，让"这条线在哪几段是空的"看得出来。 */}
              <line
                x1={scale.x(axis.from)}
                x2={scale.x(axis.to)}
                y1={y}
                y2={y}
                stroke="var(--line-bright)"
                strokeWidth={1}
              />

              {track.nodes.length > 0 && (
                <line
                  x1={scale.x(track.nodes[0]!.point.chapter)}
                  x2={scale.x(track.lastAdvancedAt)}
                  y1={y}
                  y2={y}
                  stroke={weightColor(track.weight)}
                  strokeWidth={strong ? 3 : 2}
                />
              )}

              {track.gapSpan !== null && (
                <line
                  x1={scale.x(track.gapSpan.from)}
                  x2={scale.x(track.gapSpan.to)}
                  y1={y}
                  y2={y}
                  stroke={broken ? "var(--alarm)" : "var(--calm)"}
                  strokeWidth={broken ? LAYOUT.barHeight : 2}
                  strokeDasharray={broken ? undefined : "3 3"}
                  strokeLinecap="round"
                  opacity={broken ? 0.85 : 0.6}
                />
              )}

              {track.nodes.map((node, i) => (
                <AnchorDot
                  key={i}
                  point={node.point}
                  x={scale.x(node.point.chapter)}
                  y={y}
                  r={nodeRadius(node.weight)}
                  fill={weightColor(track.weight)}
                  title={`第 ${node.point.chapter} 章（权重 ${node.weight}${node.planned ? "，规划中" : ""}）：${node.summary}`}
                  onJump={onJump}
                />
              ))}

              {broken && (
                <text
                  className="chart-axis"
                  x={scale.x(track.gapSpan!.to) + 8}
                  y={y + 4}
                  fill="var(--alarm)"
                >
                  断 {track.currentGap}／上限 {track.gapLimit}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
