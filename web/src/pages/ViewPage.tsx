/**
 * 四张结构视图的容器。
 *
 * 图之下都跟一张表：**图负责"哪里有问题"，表负责"具体是什么"。**
 * 只给图的话用户看到红条也不知道那条伏笔的意图是什么，而 §6.3 的判断是
 * intent 决定了什么算"收" —— 它必须能看到。
 */

import { api, type Views } from "../api.js";
import { useFetch } from "../hooks.js";
import { weightLabel, tierLabel } from "../chart.js";
import { Timeline } from "../components/Timeline.js";
import { PlotTracks } from "../components/PlotTracks.js";
import { ArcLanes } from "../components/ArcLanes.js";
import { RelationMap } from "../components/RelationMap.js";

const BLURB: Record<string, string> = {
  "/foreshadow":
    "图中展示已经埋设的伏笔：埋点 → 期限 → 收束。红条表示逾期，点击有依据的点可跳到原文。尚未埋设的未来规划列在下方表格中。",
  "/plotlines":
    "每条线一行，圆点是事件（越大权重越高）。红条是断线段，虚线是还没推进但阈值内。断线阈值按权重派生：主线 3 章、支线 12、细节 20。",
  "/arcs": "竖条是出场（越高越吃重），菱形是状态转折点，红条是当前缺席段。阈值按人物档位派生：主角 2 章、主要 15、次要 30。",
  "/relations": "有向边表示「谁对谁」的态度。粗边表示这对关系变过多次，点边跳到那一章。",
};

export interface ViewPageProps {
  kind: string;
  title: string;
  onJump: (chapter: number, quote: string) => void;
  highlight: string | null;
  refresh: () => void;
}

export function ViewPage({ kind, title, onJump, highlight }: ViewPageProps): React.ReactElement {
  const { data, error, loading } = useFetch(() => api.views(), [kind]);

  if (error !== null) return <div className="empty">读取失败：{error}</div>;
  if (loading || data === null) return <div className="empty">载入中</div>;

  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
        <p>{BLURB[kind]}</p>
      </div>
      {body(kind, data, onJump, highlight)}
    </>
  );
}

function body(kind: string, views: Views, onJump: ViewPageProps["onJump"], highlight: string | null): React.ReactElement {
  switch (kind) {
    case "/foreshadow":
      return <ForeshadowBody views={views} onJump={onJump} highlight={highlight} />;
    case "/plotlines":
      return <PlotBody views={views} onJump={onJump} highlight={highlight} />;
    case "/arcs":
      return <ArcBody views={views} onJump={onJump} highlight={highlight} />;
    default:
      return <RelationMap graph={views.relations} onJump={onJump} highlight={highlight} />;
  }
}

interface BodyProps {
  views: Views;
  onJump: ViewPageProps["onJump"];
  highlight: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  planned: "已规划",
  open: "待兑现",
  resolved: "已兑现",
  abandoned: "已放弃",
};

function ForeshadowBody({ views, onJump, highlight }: BodyProps): React.ReactElement {
  if (views.foreshadows.length === 0) return <div className="empty">还没有伏笔。</div>;

  return (
    <>
      <div className="legend">
        <span>
          <i className="swatch" style={{ background: "var(--main)" }} /> 主线
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--sub)" }} /> 支线
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--detail)" }} /> 细节
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--alarm)", height: 6 }} /> 逾期段
        </span>
        <span>
          <i className="swatch" style={{ background: "var(--warn)", width: 3, height: 12 }} /> 期限
        </span>
        <span>空心点 = 原文已变动，无法定位</span>
      </div>

      <Timeline axis={views.axis} lanes={views.foreshadows.filter(f => f.status !== "planned" && f.planted.anchor.quote.trim())} onJump={onJump} highlight={highlight} />

      <table>
        <thead>
          <tr>
            <th>伏笔</th>
            <th>作者意图（决定什么算"收"）</th>
            <th className="num">埋</th>
            <th className="num">期限</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          {views.foreshadows.map((f) => {
            const overdue = f.overdueSpan !== null ? f.overdueSpan.to - f.overdueSpan.from : 0;
            return (
              <tr key={f.id}>
                <td>
                  <span className="tag" data-w={f.weight}>
                    {weightLabel(f.weight)}
                  </span>{" "}
                  {f.label}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {f.id} · {f.visibility === "overt" ? "明线" : "暗线"}
                  </div>
                </td>
                <td>{f.intent}</td>
                <td className="num">{f.planted.anchor.quote.trim() ? f.planted.chapter : "尚未埋设"}</td>
                <td className="num">{f.expectedBy}</td>
                <td>
                  <span className="tag" data-tone={f.status === "open" ? undefined : "done"}>
                    {f.status === "open" && f.resolutions.some(r => r.completeness === "partial") ? "部分兑现" : STATUS_LABEL[f.status] ?? f.status}
                  </span>
                  {overdue > 0 && (
                    <span className="tag" data-tone="alarm" style={{ marginLeft: 4 }}>
                      逾期 {overdue}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function PlotBody({ views, onJump, highlight }: BodyProps): React.ReactElement {
  if (views.plotTracks.length === 0) return <div className="empty">还没有情节线。</div>;

  return (
    <>
      <PlotTracks axis={views.axis} tracks={views.plotTracks} onJump={onJump} highlight={highlight} />

      <table>
        <thead>
          <tr>
            <th>情节线</th>
            <th className="num">节点</th>
            <th className="num">上次推进</th>
            <th className="num">已断</th>
            <th className="num">上限</th>
            <th>最近一次</th>
          </tr>
        </thead>
        <tbody>
          {views.plotTracks.map((t) => (
            <tr key={t.id}>
              <td>
                <span className="tag" data-w={t.weight}>
                  {weightLabel(t.weight)}
                </span>{" "}
                {t.label}
              </td>
              <td className="num">{t.nodes.length}</td>
              <td className="num">{t.lastAdvancedAt === 0 ? "—" : t.lastAdvancedAt}</td>
              <td className="num" style={{ color: t.currentGap > t.gapLimit ? "var(--alarm)" : undefined }}>
                {t.currentGap}
              </td>
              <td className="num muted">{t.gapLimit}</td>
              <td className="muted">{t.nodes.at(-1)?.summary ?? "尚未推进"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function ArcBody({ views, onJump, highlight }: BodyProps): React.ReactElement {
  if (views.arcs.length === 0) return <div className="empty">还没有人物。</div>;

  return (
    <>
      <ArcLanes axis={views.axis} arcs={views.arcs} onJump={onJump} highlight={highlight} />

      <table>
        <thead>
          <tr>
            <th>人物</th>
            <th className="num">登场</th>
            <th className="num">末次</th>
            <th className="num">出场章数</th>
            <th>转折点</th>
          </tr>
        </thead>
        <tbody>
          {views.arcs.map((a) => (
            <tr key={a.characterId}>
              <td>
                <span className="tag">{tierLabel(a.tier)}</span> {a.name}
                <div className="muted" style={{ fontSize: 11 }}>
                  {a.characterId}
                </div>
              </td>
              <td className="num">{a.introducedAt}</td>
              <td className="num" style={{ color: a.absenceSpan !== null ? "var(--warn)" : undefined }}>
                {a.presence.length === 0 ? "—" : a.lastSeenAt}
              </td>
              <td className="num">{a.presence.length}</td>
              <td>
                {a.turningPoints.length === 0 ? (
                  <span className="muted">无</span>
                ) : (
                  a.turningPoints.map((t, i) => (
                    <div key={i} className="muted">
                      ch{t.point.chapter} {t.field}：{t.to}
                    </div>
                  ))
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
