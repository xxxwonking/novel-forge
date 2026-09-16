/**
 * 全部提示（§12.6.8 生命周期图的另外两个分组）。
 *
 * 首页只有三条，其余在这里。分三段：完整列表、待返修、被挡下的。
 * 第三段平时没人看，但"我明明处理了它怎么还在/怎么不见了"是必然会问的问题，
 * 所以把 gate 的判断结果显式列出来。
 */

import { Button } from "antd";
import { api, type Alert, type AlertAction, type PlanningAction } from "../api.js";
import { useFetch } from "../hooks.js";
import { AlertCard } from "../components/AlertCard.js";
import { StoryProgressList } from "../components/StoryProgressList.js";

const REASON_LABEL: Record<string, string> = {
  scheduled: "已安排，等待正文完成并采用",
  acknowledged: "已标「有意为之」",
  fatigued: "忽略多次，退出首页",
};

export interface AlertListProps {
  onAction: (alert: Alert, action: AlertAction) => void;
  onIgnore: (alert: Alert) => void;
  refreshKey: number;
  onPlanningAction: (title: string, action: PlanningAction) => void;
}

export function AlertList({ onAction, onIgnore, refreshKey, onPlanningAction }: AlertListProps): React.ReactElement {
  const { data, error, loading } = useFetch(() => api.alerts(), [refreshKey]);

  if (error !== null) return <div className="empty">读取失败：{error}</div>;
  if (loading || data === null) return <div className="empty">载入中</div>;

  const rest = data.fullList.filter((a) => !data.homepage.some((h) => h.id === a.id));

  return (
    <>
      <div className="page-head">
        <h1>全部提示</h1>
        <p>
          查看当前需要处理的问题、后续安排及完成依据。需要修改已写章节的问题单独放在「待返修」。
        </p>
      </div>

      <StoryProgressList entries={data.progress} onAction={onPlanningAction} />

      <section className="section">
        <h2>首页三条</h2>
        <div className="alerts">
          {data.homepage.map((alert, i) => (
            <AlertCard key={alert.id} alert={alert} rank={i + 1} onAction={onAction} onIgnore={onIgnore} />
          ))}
          {data.homepage.length === 0 && <div className="empty">当前没有需要处理的结构债。</div>}
        </div>
      </section>

      <section className="section">
        <h2>其余（{rest.length}）</h2>
        {rest.length === 0 ? (
          <div className="empty">没有更多提示。</div>
        ) : (
          <div className="alerts">
            {rest.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onAction={onAction} onIgnore={onIgnore} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>待返修（{data.repairQueue.length}）</h2>
        {data.repairQueue.length === 0 ? (
          <div className="empty">
            没有需要回头改的问题。设定矛盾、属性冲突这类要改已写章节的项会进这里。
          </div>
        ) : (
          <div className="alerts">
            {data.repairQueue.map((alert) => (
              <AlertCard key={alert.id} alert={alert} onAction={onAction} />
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <h2>暂不在当前提示中（{data.suppressed.length}）</h2>
        {data.suppressed.length === 0 ? (
          <div className="empty">没有暂时移出的提示。</div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>告警</th>
                <th>原因</th>
                <th className="num">分数</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.suppressed.map(({ alert, reason }) => (
                <tr key={alert.id}>
                  <td>{alert.title}</td>
                  <td>
                    <span className="tag" data-tone={reason === "scheduled" ? "warn" : "done"}>
                      {REASON_LABEL[reason] ?? reason}
                    </span>
                  </td>
                  <td className="num">{alert.score.toFixed(2)}</td>
                  <td>
                    {reason === "acknowledged" && (
                      <Button size="small" type="text" onClick={() => void api.unacknowledge(alert.id).then(() => window.location.reload())}>
                        取消静音
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
