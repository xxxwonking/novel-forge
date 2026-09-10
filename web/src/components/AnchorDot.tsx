/**
 * 图上一个可点的点。
 *
 * 三种锚点状态在这里分化（§6.3：stale 是一等状态，不是错误）：
 *   exact/shifted → 实心，可点，跳到原文并高亮
 *   stale         → 空心虚边，不可点，提示"原文已变动"
 *
 * 把这件事收在一个组件里，是因为四张图都要点回原文，而"能不能点"的判断
 * 只应该有一处 —— 散落在四个图里必然出现某张图忘了处理 stale。
 */

import type { AnchorPoint } from "../api.js";

export interface AnchorDotProps {
  point: AnchorPoint;
  x: number;
  y: number;
  r: number;
  fill: string;
  title: string;
  onJump: (chapter: number, quote: string) => void;
}

export function AnchorDot({ point, x, y, r, fill, title, onJump }: AnchorDotProps): React.ReactElement {
  const stale = point.resolution.status === "stale";
  const hint = stale
    ? `${title}\n（原文已变动，无法定位）`
    : point.resolution.status === "shifted"
      ? `${title}\n（位置有变动，仍可定位）`
      : title;

  return (
    <circle
      className={stale ? undefined : "node"}
      cx={x}
      cy={y}
      r={r}
      fill={stale ? "var(--bg-raised)" : fill}
      stroke={stale ? "var(--ink-faint)" : "none"}
      strokeDasharray={stale ? "2 2" : undefined}
      onClick={stale ? undefined : () => onJump(point.chapter, point.anchor.quote)}
    >
      <title>{hint}</title>
    </circle>
  );
}
