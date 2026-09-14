/**
 * 首页（§12.6.7 的界面草图）。
 *
 * 呈现顺序是刻意的：**先三条告警，再统计，最后下一章节拍表。**
 * §12.6.7 明说告警的呈现时机固定两个 —— 打开项目时、规划下一章前，
 * 而这两个时机在界面上就是这一页的上半和下半。
 */

import type { Alert, AlertAction, Overview } from "../api.js";
import { AlertCard } from "../components/AlertCard.js";
import { chapterTypeLabel, genreLabel, platformLabel } from "../labels.js";

export interface HomeProps {
  overview: Overview;
  onAction: (alert: Alert, action: AlertAction) => void;
  onIgnore: (alert: Alert) => void;
}

export function Home({ overview, onAction, onIgnore }: HomeProps): React.ReactElement {
  const { counts, homepage, nextBeat } = overview;

  return (
    <>
      <div className="page-head">
        <h1>现在需要处理（{homepage.length}）</h1>
        <p>
          按修复成本的<strong>增长速度</strong>排序，不是按当前严重度 ——
          逾期 8 章的伏笔下一章顺手就收了，逾期 35 章的读者早忘了，想收好得先重新提起。
          点按钮直接写进第 {overview.nextChapter} 章的节拍表。
        </p>
      </div>

      {homepage.length === 0 ? (
        <div className="empty">当前没有需要处理的结构债。</div>
      ) : (
        <div className="alerts">
          {homepage.map((alert, i) => (
            <AlertCard key={alert.id} alert={alert} rank={i + 1} onAction={onAction} onIgnore={onIgnore} />
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 26 }}>
        <a href="#/alerts" className="muted">
          另有 {Math.max(0, counts.fullList - homepage.length)} 条提示
        </a>
        {counts.repairQueue > 0 && <span className="muted">· 待返修 {counts.repairQueue} 条</span>}
      </div>

      <div className="stats">
        <Stat label="已写章数" value={overview.chapterCount} />
        <Stat label="未收伏笔" value={counts.openForeshadows} />
        <Stat label="其中逾期" value={counts.overdueForeshadows} tone={counts.overdueForeshadows > 0 ? "warn" : undefined} />
        <Stat label="断线情节" value={counts.brokenPlotLines} tone={counts.brokenPlotLines > 0 ? "alarm" : undefined} />
        <Stat label="题材／平台" value={`${genreLabel(overview.genre)}／${platformLabel(overview.platform)}`} kind="text" />
      </div>

      <section className="section">
        <h2>下一章：第 {overview.nextChapter} 章</h2>
        {nextBeat === null ? (
          <div className="empty">还没有排下一章的节拍表。告警的一键动作需要它。</div>
        ) : (
          <NextBeat beat={nextBeat} />
        )}
      </section>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  kind,
}: {
  label: string;
  value: string | number;
  tone?: "warn" | "alarm" | undefined;
  /** 文字型的格子（如题材／平台）不能按数字的字号排，会撑成两行。 */
  kind?: "text" | undefined;
}): React.ReactElement {
  return (
    <div className="stat" data-tone={tone} data-kind={kind}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

function NextBeat({ beat }: { beat: NonNullable<Overview["nextBeat"]> }): React.ReactElement {
  const { plan, budget } = beat;

  return (
    <div className="chart" style={{ padding: "16px 18px" }}>
      <div className="row" style={{ marginBottom: 10 }}>
        <span className="tag">{chapterTypeLabel(plan.chapterType)}</span>
        {budget !== null && (
          <>
            {/* 字数预算是派生的（§10.2 必须在写作前算出来），所以这里显示的是
                V3 的产物 —— 一键动作改了节拍表，这个数会跟着变。 */}
            <span className="muted">
              预算 {budget.words.min}–{budget.words.max} 字（甜点 {budget.words.sweet}）
            </span>
            <span className="muted">
              · 密度 {budget.density.min}–{budget.density.max}/千字
            </span>
            <span className="muted">· 流程档 {budget.tier}</span>
          </>
        )}
      </div>

      <table>
        <tbody>
          <Row label="核心事件">{plan.coreEvent}</Row>
          {plan.secondaryThread !== null && <Row label="次级线">{plan.secondaryThread}</Row>}
          <Row label="阶段反馈">{plan.stageFeedback}</Row>
          <Row label="章末钩子">{plan.hook}</Row>
          <Row label="计划事件">
            {plan.events.length === 0 ? (
              <span className="muted">无</span>
            ) : (
              plan.events.map((e, i) => (
                <div key={i}>
                  <span className="tag">权重 {e.weight}</span> {e.summary}
                  {e.plotLine !== null && <span className="muted"> · {e.plotLine}</span>}
                </div>
              ))
            )}
          </Row>
          <Row label="计划收束">
            {plan.resolves.length === 0 ? (
              <span className="muted">无 —— 首页告警的「加入回收」会写到这里</span>
            ) : (
              plan.resolves.map((r) => (
                <div key={r.foreshadowId}>
                  <span className="tag" data-w={r.weight}>
                    {r.foreshadowId}
                  </span>{" "}
                  {r.completeness === "full" ? "完全收束" : "部分收束"}
                </div>
              ))
            )}
          </Row>
          <Row label="出场人物">{plan.characters.join("、") || <span className="muted">无</span>}</Row>
        </tbody>
      </table>

      {budget?.splitAdvice != null && (
        <div className="finding" data-level="warn" style={{ marginTop: 12 }}>
          <div className="finding-rule">拆章建议</div>
          <div className="finding-msg">{budget.splitAdvice.note}</div>
        </div>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <tr>
      <td className="muted" style={{ width: 92, whiteSpace: "nowrap" }}>
        {label}
      </td>
      <td>{children}</td>
    </tr>
  );
}
