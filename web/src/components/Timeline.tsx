/**
 * 伏笔时间线（视图一）。
 *
 * 一条伏笔一行：埋点 ● ──── 期限 ┃ ──逾期段── 现在。
 * 逾期段单独上色是这张图的全部意义 —— 用户扫一眼就知道哪几条拖太久了，
 * 不必读任何数字。
 */

import type { ForeshadowLane } from "../api.js";
import { LAYOUT, makeScale, weightColor, weightLabel, type Axis } from "../chart.js";
import { useWidth } from "../hooks.js";
import { AnchorDot } from "./AnchorDot.js";

export interface TimelineProps {
  axis: Axis;
  lanes: ForeshadowLane[];
  onJump: (chapter: number, quote: string) => void;
  highlight?: string | null;
}

export function Timeline({ axis, lanes, onJump, highlight }: TimelineProps): React.ReactElement {
  const [ref, width] = useWidth<HTMLDivElement>();
  const scale = makeScale(axis, lanes.length, width);

  return (
    <div className="chart" ref={ref}>
      <svg width={scale.width} height={scale.height} role="img" aria-label="伏笔时间线">
        <Grid axis={axis} scale={scale} />

        {lanes.map((lane, row) => {
          const y = scale.y(row);
          const from = scale.x(lane.planted.chapter);
          const end = lane.resolutions.at(-1)?.point.chapter ?? Math.max(axis.current, lane.expectedBy);
          const strong = highlight === lane.id;
          const done = lane.status === "resolved" || lane.status === "abandoned";

          return (
            <g key={lane.id}>
              <text
                className="chart-label"
                data-strong={strong || undefined}
                x={LAYOUT.padLeft}
                y={y + 4}
              >
                {truncate(lane.label, 11)}
              </text>
              <text className="chart-axis" x={LAYOUT.padLeft + LAYOUT.labelWidth - 34} y={y + 4}>
                {weightLabel(lane.weight)}
              </text>

              {/* 主段：埋点 → 终点。已了结的用低对比色。 */}
              <line
                x1={from}
                x2={scale.x(end)}
                y1={y}
                y2={y}
                stroke={done ? "var(--done)" : weightColor(lane.weight)}
                strokeWidth={strong ? 3 : 2}
                strokeDasharray={lane.status === "planned" ? "4 3" : undefined}
                opacity={done ? 0.5 : 1}
              />

              {/* 逾期段盖在主段上。这是整张图唯一需要用户注意的东西。 */}
              {lane.overdueSpan !== null && (
                <line
                  x1={scale.x(lane.overdueSpan.from)}
                  x2={scale.x(lane.overdueSpan.to)}
                  y1={y}
                  y2={y}
                  stroke="var(--alarm)"
                  strokeWidth={LAYOUT.barHeight}
                  strokeLinecap="round"
                  opacity={0.85}
                />
              )}

              {/* 期限刻度 */}
              <line
                x1={scale.x(lane.expectedBy)}
                x2={scale.x(lane.expectedBy)}
                y1={y - 7}
                y2={y + 7}
                stroke={done ? "var(--done)" : "var(--warn)"}
                strokeWidth={1.5}
              />

              <AnchorDot
                point={lane.planted}
                x={from}
                y={y}
                r={LAYOUT.nodeRadius}
                fill={weightColor(lane.weight)}
                title={`第 ${lane.planted.chapter} 章埋下：${lane.intent}`}
                onJump={onJump}
              />

              {lane.resolutions.map((r, i) => (
                <AnchorDot
                  key={i}
                  point={r.point}
                  x={scale.x(r.point.chapter)}
                  y={y}
                  r={LAYOUT.nodeRadius}
                  fill={r.completeness === "full" ? "var(--ink)" : "var(--ink-dim)"}
                  title={`第 ${r.point.chapter} 章${r.completeness === "full" ? "完全" : "部分"}收束`}
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

export function Grid({ axis, scale }: { axis: Axis; scale: ReturnType<typeof makeScale> }): React.ReactElement {
  return (
    <g>
      {scale.ticks.map((c) => (
        <g key={c}>
          <line className="grid-line" x1={scale.x(c)} x2={scale.x(c)} y1={LAYOUT.padTop - 8} y2={scale.height - LAYOUT.padBottom} />
          <text className="chart-axis" x={scale.x(c)} y={LAYOUT.padTop - 12} textAnchor="middle">
            {c}
          </text>
        </g>
      ))}
      <line
        className="now-line"
        x1={scale.x(axis.current)}
        x2={scale.x(axis.current)}
        y1={LAYOUT.padTop - 18}
        y2={scale.height - LAYOUT.padBottom}
      />
      <text className="chart-axis" x={scale.x(axis.current)} y={scale.height - 8} textAnchor="middle">
        现在
      </text>
    </g>
  );
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}
