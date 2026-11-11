import type { JumpToSource } from "../source-navigation.js";
/**
 * 四张结构视图的容器。
 *
 * 图之下都跟一张表：**图负责"哪里有问题"，表负责"具体是什么"。**
 * 只给图的话用户看到红条也不知道那条伏笔的意图是什么，而 §6.3 的判断是
 * intent 决定了什么算"收" —— 它必须能看到。
 */

import { OutlineNodes } from "../components/OutlineNodes.js";
import { api, type Views } from "../api.js";
import { Chip } from "../components/Chip.js";
import { useFetch } from "../hooks.js";
import { weightLabel, tierLabel } from "../chart.js";
import { Timeline } from "../components/Timeline.js";
import { PlotTracks } from "../components/PlotTracks.js";
import { ArcLanes } from "../components/ArcLanes.js";
import { RelationMap } from "../components/RelationMap.js";
import { Button } from "../components/ui/button.js";
import { ActionLink } from "../components/controls.js";
import { characterStateFieldLabel, characterStateValueLabel } from "../labels.js";
import "../styles/character-arcs.css";

const BLURB: Record<string, string> = {
  "/foreshadow":
    "实线是已经埋进正文的伏笔：埋点 → 期限 → 收束。红条表示逾期，点击有依据的点可跳到原文。虚线是还没埋的规划，只有期限，等正文写到那里才会长出埋点。",
  "/plotlines":
    "每条线一行，圆点是事件（越大权重越高）。红条是断线段，虚线是还没推进但阈值内。断线阈值按权重派生：主线 3 章、支线 12、细节 20。",
  "/arcs": "沿章节查看人物何时出场、经历了哪些状态变化，发现长期未出场的人物，帮助检查人物线是否连贯。",
  "/relations": "有向边表示「谁对谁」的态度。粗边表示这对关系变过多次。实线是正文里写过的，点边跳到那一章；虚线只来自资料（角色档案），尚未写进正文。",
};

export interface ViewPageProps {
  kind: string;
  title: string;
  onJump: JumpToSource;
  highlight: string | null;
  refresh: () => void;
}

export function ViewPage({ kind, title, onJump, highlight }: ViewPageProps): React.ReactElement {
  const { data, error } = useFetch(() => api.views(), [kind]);

  if (error !== null) return <div className="empty">读取失败：{error}</div>;
  if (data === null) return <div className="empty">载入中</div>;

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
        <span className="legend-label">图例</span>
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
        <span>
          <i className="swatch swatch-dashed" /> 尚未埋设
        </span>
        <span>空心点 = 原文已变动，无法定位</span>
      </div>

      <Timeline axis={views.axis} lanes={views.foreshadows} onJump={onJump} highlight={highlight} />

      <div className="table-panel">
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
                  <Chip color="gold" className="tag-weight">{weightLabel(f.weight)}</Chip>
                  {f.label}
                  <div className="muted" style={{ fontSize: 11 }}>
                    {f.id} · {f.visibility === "overt" ? "明线" : "暗线"}
                  </div>
                </td>
                <td>{f.intent}</td>
                <td className="num">{f.planted?.chapter ?? "尚未埋设"}</td>
                <td className="num">{f.expectedBy}</td>
                <td>
                  <Chip color={f.status === "open" ? "processing" : undefined}>
                    {f.status === "open" && f.resolutions.some(r => r.completeness === "partial") ? "部分兑现" : STATUS_LABEL[f.status] ?? f.status}
                  </Chip>
                  {overdue > 0 && <Chip color="volcano">逾期 {overdue}</Chip>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </>
  );
}

function PlotBody({ views, onJump, highlight }: BodyProps): React.ReactElement {
  if (views.plotTracks.length === 0 && !(views.outlineNodes?.length)) return (
    <div className="empty empty-with-action">
      <p>还没有剧情内容。</p>
      <ActionLink href="#/preparation">导入大纲并整理剧情节点</ActionLink>
      <p>也可以从已有正文逐章反推。</p>
    </div>
  );

  return (
    <>
      {views.plotTracks.every(t=>t.nodes.length===0) && <p className="muted">尚未从正文确认剧情事件。大纲节点属于资料推断，可在下方浏览并在白板查看。</p>}
      <OutlineNodes nodes={views.outlineNodes??[]} lines={views.plotTracks}/>
      <PlotTracks axis={views.axis} tracks={views.plotTracks} onJump={onJump} highlight={highlight} />

      <div className="table-panel">
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
                <Chip color="gold" className="tag-weight">{weightLabel(t.weight)}</Chip>
                {t.label}
              </td>
              <td className="num">{t.nodes.length}</td>
              <td className="num">{t.lastAdvancedAt === 0 ? "—" : t.lastAdvancedAt}</td>
              <td className="num" style={{ color: t.lastAdvancedAt > 0 && t.currentGap > t.gapLimit ? "var(--alarm)" : undefined }}>
                {t.lastAdvancedAt === 0 ? "—" : t.currentGap}
              </td>
              <td className="num muted">{t.gapLimit}</td>
              <td className="muted">{t.nodes.at(-1)?.summary ?? "尚未推进"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

function ArcBody({ views, onJump, highlight }: BodyProps): React.ReactElement {
  if (views.arcs.length === 0) return <div className="empty">还没有人物记录。先在作品资料中准备人物，再从已写正文提取出场与状态变化。</div>;

  return (
    <div className="arc-view">
      <section className="arc-guide" aria-label="人物弧线阅读说明">
        <p><strong>每行一位人物，从左到右看章节。</strong>竖条越高，人物在这一章参与越多；圆点记录人物状态的变化。</p>
        <ul className="arc-legend" aria-label="人物弧线图例">
          <li><i className="arc-mark" data-role="pov" aria-hidden="true" />视角人物</li>
          <li><i className="arc-mark" data-role="major" aria-hidden="true" />主要参与</li>
          <li><i className="arc-mark" data-role="minor" aria-hidden="true" />次要参与</li>
          <li><i className="arc-mark" data-role="mentioned" aria-hidden="true" />仅被提及</li>
          <li><i className="arc-mark" data-kind="turn" aria-hidden="true" />状态变化，可查看原文</li>
          <li><i className="arc-mark" data-kind="stale" aria-hidden="true" />原文已变化，暂不能定位</li>
          <li><i className="arc-mark" data-kind="absence" aria-hidden="true" />连续未出场提醒</li>
        </ul>
        <p className="arc-data-note">这里展示已提取的结构记录，空白不一定代表正文没有出场。红条表示出场间隔已超过该人物的提醒阈值，是否需要补写仍由你判断。</p>
      </section>
      <div className="arc-section-head">
        <h2>人物出场分布</h2>
        <span>{views.arcs.length} 位人物 · 当前第 {views.axis.current} 章</span>
      </div>
      <p className="arc-scroll-hint">图表可横向滚动；下方明细可查看完整姓名、变化内容和正文出处。</p>
      <ArcLanes axis={views.axis} arcs={views.arcs} onJump={onJump} highlight={highlight} />

      <div className="arc-section-head"><h2>人物明细</h2><span>与上方图表逐行对应</span></div>
      <div className="table-panel arc-details" role="region" aria-label="人物出场与状态变化明细" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th scope="col">人物</th>
            <th scope="col">首次登场</th>
            <th scope="col">最近出场</th>
            <th scope="col">出场章数</th>
            <th scope="col">状态变化与原文</th>
          </tr>
        </thead>
        <tbody>
          {views.arcs.map((a) => (
            <tr key={a.characterId} data-highlighted={highlight === a.characterId || undefined}>
              <th scope="row">
                <div className="arc-person-name">{a.name}</div>
                <Chip>{tierLabel(a.tier)}</Chip>
              </th>
              <td>{a.introducedAt > 0 ? `第 ${a.introducedAt} 章` : "尚未登场"}</td>
              <td>
                {a.presence.length === 0 ? "暂无出场记录" : `第 ${a.lastSeenAt} 章`}
                {a.absenceSpan !== null && <span className="arc-absence-note">连续 {views.axis.current - a.lastSeenAt} 章未记录出场</span>}
              </td>
              <td>{a.presence.length} 章</td>
              <td>
                {a.turningPoints.length === 0 ? (
                  <span className="muted">暂无状态变化记录</span>
                ) : (
                  <ul className="arc-turning-points">
                  {a.turningPoints.map((t, i) => (
                    <li key={i}>
                      <div className="arc-turn-heading"><span>第 {t.point.chapter} 章</span><strong>{characterStateFieldLabel(t.field)}</strong></div>
                      <p>{characterStateValueLabel(t.field, t.from)} → {characterStateValueLabel(t.field, t.to)}</p>
                      {t.point.resolution.status === "stale" ? <span className="muted">原文已变化，暂不能定位</span> : (
                        <Button variant="link" size="sm" className="arc-source px-0"
                          aria-label={`查看${a.name}第${t.point.chapter}章${characterStateFieldLabel(t.field)}变化的原文`}
                          onClick={() => onJump(t.point.chapter, t.point.anchor.quote, t.point.anchor)}>查看原文</Button>
                      )}
                    </li>
                  ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
