/**
 * 首页（§12.6.7 的界面草图）。
 *
 * 呈现顺序是刻意的：**先三条告警，再统计，最后下一章节拍表。**
 * §12.6.7 明说告警的呈现时机固定两个 —— 打开项目时、规划下一章前，
 * 而这两个时机在界面上就是这一页的上半和下半。
 */

import { Tag } from "antd";
import { ArrowRightOutlined } from "@ant-design/icons";
import type { Alert, AlertAction, Overview } from "../api.js";
import { AlertCard } from "../components/AlertCard.js";
import { genreLabel, platformLabel } from "../labels.js";

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

      <div className="alerts-more">
        <a href="#/alerts">另有 {Math.max(0, counts.fullList - homepage.length)} 条提示 <ArrowRightOutlined /></a>
        {counts.repairQueue > 0 && <span className="muted">待返修 {counts.repairQueue} 条</span>}
      </div>

      <div className="stats">
        <Stat label="已写章数" value={overview.chapterCount} />
        <Stat label="未收伏笔" value={counts.openForeshadows} />
        <Stat label="其中逾期" value={counts.overdueForeshadows} tone={counts.overdueForeshadows > 0 ? "warn" : undefined} />
        <Stat label="断线情节" value={counts.brokenPlotLines} tone={counts.brokenPlotLines > 0 ? "alarm" : undefined} />
        <Stat label="题材／平台" value={`${genreLabel(overview.genre)} · ${platformLabel(overview.platform)}`} wide />
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
  wide = false,
}: {
  label: string;
  value: string | number;
  tone?: "warn" | "alarm" | undefined;
  wide?: boolean;
}): React.ReactElement {
  return (
    <div className="stat" data-tone={tone} data-wide={wide}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  transition: "过渡章",
  setup: "布局章",
  event: "事件章",
  payoff: "回收章",
  climax: "高潮章",
};

function NextBeat({ beat }: { beat: NonNullable<Overview["nextBeat"]> }): React.ReactElement {
  const { plan, budget } = beat;

  return (
    <div className="panel next-beat">
      <header className="next-beat-head">
        <Tag color="gold">{TYPE_LABEL[plan.chapterType] ?? plan.chapterType}</Tag>
        {budget !== null && (
          <div className="next-beat-budget">
            {/* 字数预算是派生的（§10.2 必须在写作前算出来），所以这里显示的是
                V3 的产物 —— 一键动作改了节拍表，这个数会跟着变。 */}
            <span><b>{budget.words.min}–{budget.words.max}</b> 字（甜点 {budget.words.sweet}）</span>
            <span><b>{budget.density.min}–{budget.density.max}</b> 密度 / 千字</span>
            <span>流程档 <b>{budget.tier}</b></span>
          </div>
        )}
      </header>

      <dl className="next-beat-list">
        <Item label="核心事件">{plan.coreEvent}</Item>
        {plan.secondaryThread !== null && <Item label="次级线">{plan.secondaryThread}</Item>}
        <Item label="阶段反馈">{plan.stageFeedback}</Item>
        <Item label="章末钩子">{plan.hook}</Item>
        <Item label="计划事件">
          {plan.events.length === 0 ? (
            <span className="muted">无</span>
          ) : (
            <ul className="next-beat-events">
              {plan.events.map((e, i) => (
                <li key={i}>
                  <Tag>权重 {e.weight}</Tag> {e.summary}
                  {e.plotLine !== null && <span className="muted"> · {e.plotLine}</span>}
                </li>
              ))}
            </ul>
          )}
        </Item>
        <Item label="计划收束">
          {plan.resolves.length === 0 ? (
            <span className="muted">无 —— 首页告警的「加入回收」会写到这里</span>
          ) : (
            <ul className="next-beat-events">
              {plan.resolves.map((r) => (
                <li key={r.foreshadowId}>
                  <Tag color="gold">{r.foreshadowId}</Tag> {r.completeness === "full" ? "完全收束" : "部分收束"}
                </li>
              ))}
            </ul>
          )}
        </Item>
        <Item label="出场人物">{plan.characters.join("、") || <span className="muted">无</span>}</Item>
      </dl>

      {budget?.splitAdvice != null && (
        <div className="finding" data-level="warn" style={{ marginTop: 6 }}>
          <div className="finding-rule">拆章建议</div>
          <div className="finding-msg">{budget.splitAdvice.note}</div>
        </div>
      )}
    </div>
  );
}

function Item({ label, children }: { label: string; children: React.ReactNode }): React.ReactElement {
  return (
    <div className="next-beat-item">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
