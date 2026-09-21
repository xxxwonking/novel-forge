/**
 * 四张结构视图的 view-model（§12.3、§12.9 M3）。
 *
 * 产品前提（§12.3、决策 #3-4）：**AI 写小说时作者不读正文**，所以结构视图
 * 取代正文成为主界面。这一层的职责是把投影变成"前端拿到就能画"的形状 ——
 * 轨道序数、时间轴范围、锚点解析结果全部在这里算完。
 *
 * 两条边界：
 * 1. **不含任何像素/尺寸/颜色** —— 那些是 CSS 的事。这里只给序数与区间，
 *    前端自己乘缩放系数。所以本目录能通过"代码里没有数字"的源码扫描。
 * 2. **不含任何阈值判断** —— 越界与否由 alerts/ 与 gate/ 判定。这里只带上
 *    `gapLimit` 这类投影已算好的值，供前端画参考线。
 */

import type {
  CharacterArc,
  ForeshadowStatus,
  ForeshadowTimelineItem,
  PlotLineTrack,
  RelationEdge,
} from "../types/projections.js";
import type { AnchorResolution, ChapterNo, TextAnchor } from "../types/primitives.js";
import type { CharacterTier } from "../types/character.js";
import type { EventKind, EventWeight, ForeshadowWeight, RelationKind } from "../types/events.js";
import type { AnchorRules } from "../rules/schema.js";
import { resolveAnchor, type ChapterTextSource } from "../anchor/resolve.js";

/**
 * 横轴：章号区间。四张图共用同一个范围，否则并排看时刻度对不上 ——
 * 而"对比伏笔时间线和情节线"正是这套视图的主要用法。
 */
export interface ChapterAxis {
  readonly from: ChapterNo;
  readonly to: ChapterNo;
  readonly current: ChapterNo;
}

/** 可点击的点：锚点 + 解析结果。stale 时前端渲染降级态而非隐藏。 */
export interface AnchorPoint {
  readonly chapter: ChapterNo;
  readonly anchor: TextAnchor;
  readonly resolution: AnchorResolution;
}

// ── 视图一：伏笔时间线 ──────────────────────────────────────────────────

/**
 * 一条伏笔在时间线上的形状：埋点 → 期限 → 收束点。
 *
 * `overdueFrom`/`overdueTo` 分出来是为了让前端能单独给逾期段上色 ——
 * 「第 8 章埋、第 30 章前该收、现在第 45 章」这条线上，30→45 那一段
 * 是用户唯一需要看的部分。
 */
export interface ForeshadowLane {
  readonly id: ForeshadowTimelineItem["id"];
  readonly label: string;
  readonly intent: string;
  readonly weight: ForeshadowWeight;
  readonly visibility: ForeshadowTimelineItem["visibility"];
  readonly status: ForeshadowStatus;
  readonly planted: AnchorPoint;
  readonly expectedBy: ChapterNo;
  readonly resolutions: readonly {
    readonly completeness: "full" | "partial";
    readonly point: AnchorPoint;
  }[];
  /** 逾期段。null 表示未逾期或已了结。 */
  readonly overdueSpan: { readonly from: ChapterNo; readonly to: ChapterNo } | null;
  /** 轨道序号，从 0 起。同一时间跨度不重叠的伏笔会被排进同一轨道。 */
  readonly lane: number;
}

// ── 视图二：情节线 ──────────────────────────────────────────────────────

export interface PlotTrack {
  readonly id: PlotLineTrack["id"];
  readonly label: string;
  readonly weight: ForeshadowWeight;
  readonly gapLimit: number;
  readonly lastAdvancedAt: ChapterNo;
  readonly currentGap: number;
  readonly nodes: readonly {
    readonly summary: string;
    readonly weight: EventWeight;
    readonly kind: EventKind;
    /** 规划态（V1 排了还没写）—— 前端画虚线（§12.1 P4 的"规划态显示虚线"）。 */
    readonly planned: boolean;
    readonly point: AnchorPoint;
  }[];
  /** 断线段：最后一个节点到当前章。前端画成空档。 */
  readonly gapSpan: { readonly from: ChapterNo; readonly to: ChapterNo } | null;
}

// ── 视图三：人物弧线 ────────────────────────────────────────────────────

export interface ArcLane {
  readonly characterId: CharacterArc["characterId"];
  readonly name: string;
  readonly tier: CharacterTier;
  readonly introducedAt: ChapterNo;
  readonly lastSeenAt: ChapterNo;
  /** 出场分桶。稀疏数组：只有出场的章在里面（§projections 的稠密矩阵警告）。 */
  readonly presence: readonly {
    readonly chapter: ChapterNo;
    readonly role: CharacterArc["presence"][number]["role"];
  }[];
  readonly turningPoints: readonly {
    readonly field: string;
    readonly from: string | null;
    readonly to: string;
    readonly point: AnchorPoint;
  }[];
  /** 当前缺席段。前端画成断裂。 */
  readonly absenceSpan: { readonly from: ChapterNo; readonly to: ChapterNo } | null;
}

// ── 视图四：关系图 ──────────────────────────────────────────────────────

export interface RelationGraph {
  readonly nodes: readonly {
    readonly id: CharacterArc["characterId"];
    readonly name: string;
    readonly tier: CharacterTier;
    /** 连边数。前端用它定节点大小，不必自己数。 */
    readonly degree: number;
  }[];
  readonly edges: readonly {
    readonly from: RelationEdge["from"];
    readonly to: RelationEdge["to"];
    readonly kind: RelationKind;
    readonly note: string;
    readonly changedAt: ChapterNo;
    /** 没有正文出处时为 null —— 不是"解析失败"，而是"还没写进正文"。 */
    readonly point: AnchorPoint | null;
    readonly declared: boolean;
    /** 历史沿革条数。>1 时前端提示"这两人怎么走到这一步"可展开。 */
    readonly historyCount: number;
    readonly history: RelationEdge["history"];
  }[];
}

// ── 组装 ────────────────────────────────────────────────────────────────

export interface ViewModel {
  readonly axis: ChapterAxis;
  readonly foreshadows: readonly ForeshadowLane[];
  readonly plotTracks: readonly PlotTrack[];
  readonly arcs: readonly ArcLane[];
  readonly relations: RelationGraph;
}

export interface BuildViewInput {
  readonly currentChapter: ChapterNo;
  readonly foreshadows: readonly ForeshadowTimelineItem[];
  readonly plotLines: readonly PlotLineTrack[];
  readonly arcs: readonly CharacterArc[];
  readonly relations: readonly RelationEdge[];
  readonly text: ChapterTextSource;
}

export function buildViewModel(input: BuildViewInput, rules: AnchorRules): ViewModel {
  const resolve = (anchor: TextAnchor): AnchorPoint => ({
    chapter: anchor.chapter,
    anchor,
    resolution: resolveAnchor(anchor, input.text, rules),
  });

  return {
    axis: buildAxis(input),
    foreshadows: buildForeshadowLanes(input, resolve),
    plotTracks: buildPlotTracks(input, resolve),
    arcs: buildArcLanes(input, resolve),
    relations: buildRelationGraph(input, resolve),
  };
}

/**
 * 横轴范围。
 *
 * 上界取 `max(当前章, 所有 expectedBy)` —— 期限排在未来的伏笔必须在轴上有
 * 位置，否则"还有 5 章到期"这件事在图上看不见，而那恰好是最该提前看到的。
 */
function buildAxis(input: BuildViewInput): ChapterAxis {
  let to = input.currentChapter;
  for (const f of input.foreshadows) {
    if (f.expectedBy > to) to = f.expectedBy;
  }
  return { from: 1, to, current: input.currentChapter };
}

type Resolver = (anchor: TextAnchor) => AnchorPoint;

function buildForeshadowLanes(input: BuildViewInput, resolve: Resolver): readonly ForeshadowLane[] {
  const drafts = input.foreshadows.map((f) => {
    const lastResolution = f.resolutions[f.resolutions.length - 1];
    // 时间跨度的终点：已了结的到收束点，未了结的延伸到当前章或期限（取远的）。
    const end =
      f.status === "resolved" && lastResolution !== undefined
        ? lastResolution.chapter
        : Math.max(input.currentChapter, f.expectedBy);

    const overdue = (f.overdueBy as number) > 0 && f.status === "open";

    return {
      f,
      span: { from: f.plantedAt, to: end },
      lane: {
        id: f.id,
        label: f.label,
        intent: f.intent,
        weight: f.weight,
        visibility: f.visibility,
        status: f.status,
        planted: resolve(f.plantedAnchor),
        expectedBy: f.expectedBy,
        resolutions: f.resolutions.map((r) => ({
          completeness: r.completeness,
          point: resolve(r.anchor),
        })),
        overdueSpan: overdue ? { from: f.expectedBy, to: input.currentChapter } : null,
      },
    };
  });

  // 按埋设章排序后做轨道装箱。排序保证同一份数据每次得到同样的轨道分配。
  drafts.sort((a, b) => a.span.from - b.span.from || a.lane.id.localeCompare(b.lane.id));
  const laneEnds: number[] = [];

  return drafts.map(({ span, lane }) => {
    let index = laneEnds.findIndex((end) => end < span.from);
    if (index === -1) {
      index = laneEnds.length;
      laneEnds.push(span.to);
    } else {
      laneEnds[index] = span.to;
    }
    return { ...lane, lane: index };
  });
}

function buildPlotTracks(input: BuildViewInput, resolve: Resolver): readonly PlotTrack[] {
  return input.plotLines.map((line) => {
    const gap = line.currentGap as number;
    return {
      id: line.id,
      label: line.label,
      weight: line.weight,
      gapLimit: line.gapLimit as number,
      lastAdvancedAt: line.lastAdvancedAt,
      currentGap: gap,
      nodes: line.points.map((p) => ({
        summary: p.summary,
        weight: p.weight,
        kind: p.kind,
        planned: p.planned,
        point: resolve(p.anchor),
      })),
      // 从未推进过的线不画断线段 —— 它还没开始，不是断了
      // （同 gate/cross-chapter.ts 与 alerts/compute.ts 的判定）。
      gapSpan:
        line.lastAdvancedAt > 0 && gap > 0
          ? { from: line.lastAdvancedAt, to: input.currentChapter }
          : null,
    };
  });
}

function buildArcLanes(input: BuildViewInput, resolve: Resolver): readonly ArcLane[] {
  return input.arcs.map((arc) => {
    const gap = input.currentChapter - arc.lastSeenAt;
    return {
      characterId: arc.characterId,
      name: arc.name,
      tier: arc.tier,
      introducedAt: arc.introducedAt,
      lastSeenAt: arc.lastSeenAt,
      presence: arc.presence,
      turningPoints: arc.turningPoints.map((t) => ({
        field: t.field,
        from: t.from,
        to: t.to,
        point: resolve(t.anchor),
      })),
      absenceSpan:
        arc.presence.length > 0 && gap > 0
          ? { from: arc.lastSeenAt, to: input.currentChapter }
          : null,
    };
  });
}

function buildRelationGraph(input: BuildViewInput, resolve: Resolver): RelationGraph {
  const degree = new Map<string, number>();
  for (const e of input.relations) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }

  // 节点表从人物弧线取（有名字和档位），只保留在关系图里出现过的。
  const nodes = input.arcs
    .filter((a) => degree.has(a.characterId))
    .map((a) => ({
      id: a.characterId,
      name: a.name,
      tier: a.tier,
      degree: degree.get(a.characterId) ?? 0,
    }));

  return {
    nodes,
    edges: input.relations.map((e) => ({
      from: e.from,
      to: e.to,
      kind: e.kind,
      note: e.note,
      changedAt: e.changedAt,
      point: e.anchor === null ? null : resolve(e.anchor),
      declared: e.declared,
      historyCount: e.history.length,
      history: e.history,
    })),
  };
}
