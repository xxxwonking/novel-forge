/**
 * 轨道图的坐标换算。
 *
 * 四张图共用同一个横轴映射，否则并排看时刻度对不上 —— 而"对比伏笔时间线
 * 与情节线"正是这套视图的主要用法（§12.3）。
 *
 * 这里的数字全是**布局参数**（行高、边距、点半径），不是规则常量，所以
 * 不进 rules.yaml。判据很简单：改了它们只影响好不好看，不影响任何判定。
 */

export const LAYOUT = {
  rowHeight: 26,
  labelWidth: 150,
  padLeft: 12,
  padRight: 28,
  padTop: 26,
  padBottom: 22,
  minPlotWidth: 620,
  nodeRadius: 4,
  barHeight: 6,
} as const;

export interface Axis {
  from: number;
  to: number;
  current: number;
}

export interface Scale {
  /** 章号 → x 像素。 */
  x: (chapter: number) => number;
  /** 行序 → y 像素（行中心）。 */
  y: (row: number) => number;
  width: number;
  height: number;
  plotWidth: number;
  /** 刻度章号。 */
  ticks: number[];
}

export function makeScale(axis: Axis, rows: number, available: number): Scale {
  const plotWidth = Math.max(
    LAYOUT.minPlotWidth,
    available - LAYOUT.labelWidth - LAYOUT.padLeft - LAYOUT.padRight,
  );
  const span = Math.max(1, axis.to - axis.from);
  const left = LAYOUT.padLeft + LAYOUT.labelWidth;

  return {
    x: (chapter) => left + ((chapter - axis.from) / span) * plotWidth,
    y: (row) => LAYOUT.padTop + row * LAYOUT.rowHeight + LAYOUT.rowHeight / 2,
    width: left + plotWidth + LAYOUT.padRight,
    height: LAYOUT.padTop + Math.max(1, rows) * LAYOUT.rowHeight + LAYOUT.padBottom,
    plotWidth,
    ticks: makeTicks(axis),
  };
}

/**
 * 刻度。取"能整除到 5/10/25/50/100"里第一个使刻度数落在 6-12 之间的步长 ——
 * 章号是整数且用户按十位数记忆（"三十章左右"），非整步长的刻度反而更难读。
 */
function makeTicks(axis: Axis): number[] {
  const span = Math.max(1, axis.to - axis.from);
  const step = [5, 10, 25, 50, 100, 250].find((s) => span / s <= 12) ?? 500;
  const out: number[] = [];
  for (let c = Math.ceil(axis.from / step) * step; c <= axis.to; c += step) out.push(c);
  if (out[0] !== axis.from) out.unshift(axis.from);
  return out;
}

/** 权重 → CSS 变量。三档配色在 styles.css 里定义。 */
export function weightColor(weight: "main" | "sub" | "detail"): string {
  return `var(--${weight})`;
}

export function weightLabel(weight: "main" | "sub" | "detail"): string {
  return weight === "main" ? "主线" : weight === "sub" ? "支线" : "细节";
}

export function tierLabel(tier: "protagonist" | "major" | "minor" | "extra"): string {
  switch (tier) {
    case "protagonist":
      return "主角";
    case "major":
      return "主要";
    case "minor":
      return "次要";
    default:
      return "龙套";
  }
}

export function relationLabel(kind: string): string {
  const map: Record<string, string> = {
    ally: "同盟",
    hostile: "敌对",
    kin: "亲缘",
    romantic: "情感",
    mentor: "师承",
    subordinate: "从属",
    acquaintance: "相识",
    unknown: "未明",
  };
  return map[kind] ?? kind;
}

/** 事件权重 → 点半径。3 级事件的点要明显大一圈。 */
export function nodeRadius(weight: 1 | 2 | 3): number {
  return LAYOUT.nodeRadius + (weight - 1) * 1.5;
}
