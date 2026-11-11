import type { JumpToSource } from "../source-navigation.js";
import { useRelationNetwork } from "./useRelationNetwork.js";
import { Chip } from "./Chip.js";
import { useEffect, useState, type CSSProperties } from "react";
import {
  Pause,
  Play,
  X,
  ZoomIn,
  ZoomOut,
  Maximize,
  RotateCcw,
  ArrowRight,
} from "lucide-react";
import { Button } from "./controls.js";
import "./relation-map.css";
import type { RelationGraph } from "../api.js";
import { relationLabel, tierLabel } from "../chart.js";

const NODE_BASE = 5;

const KIND_COLOR: Record<string, string> = {
  ally: "var(--calm)",
  hostile: "var(--alarm)",
  kin: "var(--main)",
  romantic: "var(--relation-romantic)",
  mentor: "var(--sub)",
  subordinate: "var(--detail)",
  acquaintance: "var(--canvas-edge)",
  unknown: "var(--canvas-edge)",
};

export interface RelationMapProps {
  graph: RelationGraph;
  onJump: JumpToSource;
  highlight?: string | null;
}

export function RelationMap({
  graph,
  onJump,
  highlight,
}: RelationMapProps): React.ReactElement {
  const [hover, setHover] = useState<string | null>(null);
  const [focused, setFocused] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    const update = () => setHidden(document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  const ordered = [...graph.nodes].sort(
    (a, b) => b.degree - a.degree || a.id.localeCompare(b.id),
  );
  const network = useRelationNetwork(graph, paused);
  const positions = network.positions;

  const active = hover ?? focused ?? selected ?? highlight ?? null;
  let particles = 0;

  return (
    <div className="chart relation-map">
      <section className="relation-network" aria-label="关系网络">
        <div className="relation-toolbar">
          <span className="muted">
            {active === null
              ? "选择人物查看关联"
              : `正在聚焦：${nameOf(graph, active)}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="放大关系图"
            title="放大"
            onClick={() => network.zoom(0.8)}
          >
            <ZoomIn aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="缩小关系图"
            title="缩小"
            onClick={() => network.zoom(1.25)}
          >
            <ZoomOut aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="适配关系图"
            title="适配全部"
            onClick={network.fit}
          >
            <Maximize aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label="重新整理人物布局"
            title="重新整理"
            onClick={network.reset}
          >
            <RotateCcw aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            aria-label={paused ? "开启连线动效" : "暂停连线动效"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? (
              <Play aria-hidden="true" />
            ) : (
              <Pause aria-hidden="true" />
            )}
            {paused ? "开启连线动效" : "暂停连线动效"}
          </Button>
          {selected !== null && (
            <Button
              variant="ghost"
              size="sm"
              aria-label="清除选择"
              onClick={() => {
                setSelected(null);
                setHover(null);
                setFocused(null);
              }}
            >
              <X aria-hidden="true" />
              清除选择
            </Button>
          )}
        </div>
        <svg
          className="relation-canvas"
          ref={network.svg}
          {...network.handlers}
          viewBox={`${network.view.x} ${network.view.y} ${network.view.size} ${network.view.size}`}
          role="group"
          aria-label="人物关系图"
          data-paused={paused || hidden}
        >
          {graph.edges.map((e, i) => {
            const from = positions.get(e.from);
            const to = positions.get(e.to);
            if (from === undefined || to === undefined) return null;
            const dim = active !== null && active !== e.from && active !== e.to;
            const jumpable =
              e.point === null || e.point.resolution.status === "stale"
                ? null
                : e.point;

            const color = KIND_COLOR[e.kind] ?? "var(--line-bright)";
            const animated =
              active !== null &&
              !dim &&
              !e.declared &&
              jumpable !== null &&
              particles++ < 24;
            return (
              <g
                key={i}
                className="relation-connection"
                opacity={dim ? 0.14 : active === null ? 0.5 : 0.9}
              >
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  stroke={color}
                  strokeWidth={
                    (e.historyCount > 1 ? 2 : 1) +
                    (active !== null && !dim ? 0.5 : 0)
                  }
                  strokeDasharray={e.declared ? "4 4" : undefined}
                  className={jumpable === null ? undefined : "node"}
                  onClick={
                    jumpable === null
                      ? undefined
                      : () =>
                          !network.moved.current &&
                          onJump(jumpable.chapter, jumpable.anchor.quote, jumpable.anchor)
                  }
                >
                  <title>{`${nameOf(graph, e.from)} · ${nameOf(graph, e.to)}：${relationLabel(e.kind)}${e.declared ? "（仅档案设定）" : `（第 ${e.changedAt} 章）`}\n${e.note}`}</title>
                </line>
                {animated && (
                  <circle
                    className="relation-particle"
                    r={2}
                    fill={color}
                    aria-hidden="true"
                    style={
                      {
                        "--particle-from": `translate(${from.x}px, ${from.y}px)`,
                        "--particle-to": `translate(${to.x}px, ${to.y}px)`,
                        animationDelay: `${-(i % 7) * 0.6}s`,
                      } as CSSProperties
                    }
                  />
                )}
              </g>
            );
          })}

          {ordered.map((n) => {
            const p = positions.get(n.id)!;
            const dim =
              active !== null &&
              active !== n.id &&
              !isNeighbour(graph, active, n.id);

            return (
              <g
                key={n.id}
                className="relation-person"
                data-person={n.id}
                role="button"
                tabIndex={0}
                aria-label={`聚焦人物：${n.name}`}
                aria-pressed={selected === n.id}
                opacity={dim ? 0.25 : 1}
                onClick={() => {
                  if (!network.moved.current)
                    setSelected((value) => (value === n.id ? null : n.id));
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    setSelected((value) => (value === n.id ? null : n.id));
                  }
                  if (event.key === "Escape") {
                    setSelected(null);
                    setHover(null);
                    setFocused(null);
                  }
                }}
                onFocus={() => setFocused(n.id)}
                onBlur={() => setFocused(null)}
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover(null)}
              >
                <circle
                  className="relation-hit"
                  cx={p.x}
                  cy={p.y}
                  r={Math.max(24, 24 * network.unitsPerPixel)}
                  fill="transparent"
                />
                <circle
                  className="relation-focus"
                  cx={p.x}
                  cy={p.y}
                  r={Math.min(16, NODE_BASE + n.degree) + 5}
                  fill="none"
                  stroke="var(--ring)"
                  strokeWidth={1}
                />
                <circle
                  cx={p.x}
                  cy={p.y}
                  r={Math.min(16, NODE_BASE + n.degree)}
                  fill={n.tier === "protagonist" ? "var(--main)" : "var(--sub)"}
                  stroke="var(--bg)"
                  strokeWidth={2}
                />
                <text
                  className="chart-label"
                  style={{ fontSize: 12 * network.unitsPerPixel }}
                  data-strong={active === n.id || undefined}
                  x={p.x}
                  y={p.y - Math.min(16, NODE_BASE + n.degree) - 10}
                  textAnchor="middle"
                >
                  {n.name}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="relation-caption muted">
          拖动人物调整分布，拖动空白平移，滚轮或双指缩放。点选人物聚焦关系。
        </p>
      </section>
      <div className="relation-history">
        <h2>关系沿革</h2>
        <p className="relation-history-intro">按人物关系查看当前状态、变化记录与正文出处。</p>
        <div className="relation-history-scroll" role="region" aria-label="人物关系沿革明细" tabIndex={0}>
        <table>
          <thead>
            <tr>
              <th scope="col">人物关系</th>
              <th scope="col">当前关系</th>
              <th scope="col">说明与沿革</th>
              <th scope="col">最近变化</th>
            </tr>
          </thead>
          <tbody>
            {graph.edges.map((e, i) => (
              <tr
                key={i}
                style={{
                  opacity:
                    active === null || active === e.from || active === e.to
                      ? 1
                      : 0.35,
                }}
              >
                <th scope="row">
                  <div className="relation-pair">
                    <span>{nameOf(graph, e.from)}</span>
                    <ArrowRight aria-hidden="true" /><span className="sr-only">对</span>
                    <span>{nameOf(graph, e.to)}</span>
                  </div>
                </th>
                <td>
                  <div className="relation-status">
                    <Chip>{relationLabel(e.kind)}</Chip>
                    {e.declared && <Chip color="orange">仅设定</Chip>}
                  </div>
                </td>
                <td>
                  <p className="relation-note">{e.note || "暂无关系说明"}</p>
                  {e.historyCount > 1 && (
                    <ol className="relation-changes" aria-label="历次关系变化">
                      {e.history.map((h, index) => (
                        <li key={index}>
                          <span>第 {h.chapter} 章</span>
                          <span>{relationLabel(h.kind)}</span>
                        </li>
                      ))}
                    </ol>
                  )}
                </td>
                <td>
                  <div className="relation-evidence">
                  <span className={e.declared ? "muted" : undefined}>{e.declared ? "暂无正文记录" : `第 ${e.changedAt} 章`}</span>
                  {!e.declared &&
                    e.point !== null &&
                    e.point.resolution.status !== "stale" && (
                      <Button
                        variant="link"
                        size="sm"
                        className="relation-source px-0"
                        aria-label={`查看原文：${nameOf(graph, e.from)}与${nameOf(graph, e.to)}`}
                        onClick={() =>
                          onJump(e.point!.chapter, e.point!.anchor.quote, e.point!.anchor)
                        }
                      >
                        查看原文
                      </Button>
                    )}
                  {!e.declared && e.point?.resolution.status === "stale" && <span className="muted">原文已变化</span>}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
        <p className="relation-history-help muted">
          节点大小按连边数，主角用暖色。悬停、点选或键盘聚焦人物可突出其关系。
          <br />
          虚线表示这条关系只来自资料、<strong>尚未写进正文</strong>
          ；正文写到那里就会变成实线，也才能点着跳过去。
          <br />
          人物按关联自然聚合，拖动后固定位置；重新整理可释放固定。粒子往返仅提示关联，不表示因果方向。
        </p>
      </div>
    </div>
  );
}

function isNeighbour(graph: RelationGraph, a: string, b: string): boolean {
  return graph.edges.some(
    (e) => (e.from === a && e.to === b) || (e.from === b && e.to === a),
  );
}

function nameOf(graph: RelationGraph, id: string): string {
  return graph.nodes.find((n) => n.id === id)?.name ?? id;
}

export function tierText(tier: Parameters<typeof tierLabel>[0]): string {
  return tierLabel(tier);
}
