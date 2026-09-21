import { Button } from "antd";
import { api, type CreditSummary } from "../api.js";
import { useFetch } from "../hooks.js";

const PURPOSE_LABELS: Record<string, string> = {
  chapter: "写章", conversation: "对话", inference: "从正文反推结构", revision: "跨章返修定位", other: "其他",
};
const credits = (value: number): string => value.toLocaleString("zh-CN", { maximumFractionDigits: 2 });

export function Credits(): React.ReactElement {
  const work = useFetch(() => api.credits(), []);
  const workspace = useFetch(() => api.workspace(), []);
  const summary: CreditSummary | null = work.data;
  const balance = workspace.data?.credits ?? null;

  return <>
    <div className="page-head">
      <h1>用量与积分</h1>
      <p>每一次模型调用都记在这里 —— 写章、对话、反推结构、返修定位都算在内。</p>
    </div>
    {(work.error ?? workspace.error) !== null && <div className="finding" role="alert" data-level="block">{work.error ?? workspace.error}</div>}

    {balance !== null && (
      <section className="credit-balance">
        <div><span className="credit-figure">{credits(balance.balance)}</span><small>剩余积分</small></div>
        <div><span className="credit-figure">{credits(balance.spent)}</span><small>已消耗</small></div>
        <div><span className="credit-figure">{credits(balance.granted)}</span><small>赠送额度</small></div>
      </section>
    )}
    {balance !== null && balance.unpricedCalls > 0 && (
      <p className="finding" data-level="warn">
        有 {balance.unpricedCalls} 次调用用的模型不在价格表里：用量照记，但没有折进余额。补上 pricing.yaml 里对应的型号，这部分才算得进来。
      </p>
    )}
    <p className="muted">本批只有赠送额度，还没有充值入口。余额 = 赠送额度 − 已消耗。</p>

    {summary !== null && (
      <section className="prep-section">
        <h2>这本书 <small>{summary.calls} 次调用</small></h2>
        {summary.calls === 0 ? <p className="muted">这本书还没有过模型调用。</p> : <>
          <div className="credit-rows">
            {Object.entries(summary.byPurpose).sort((a, b) => b[1].credits - a[1].credits).map(([purpose, row]) => (
              <div className="credit-row" key={purpose}>
                <strong>{PURPOSE_LABELS[purpose] ?? purpose}</strong>
                <span className="muted">{row.calls} 次</span>
                <span>{credits(row.credits)} 积分</span>
              </div>
            ))}
          </div>
          {/* 四档分开列：缓存读与原样输入差一个量级，合成一个数就看不出钱花在哪。 */}
          <p className="muted">
            输入 {summary.tokens.input.toLocaleString()} · 输出 {summary.tokens.output.toLocaleString()} ·
            缓存写入 {summary.tokens.cacheWrite.toLocaleString()} · 缓存命中 {summary.tokens.cacheRead.toLocaleString()} tokens
          </p>
        </>}
      </section>
    )}
    {work.loading && summary === null && <div className="empty">读取用量…</div>}
    {work.error !== null && <Button size="small" onClick={work.reload}>重试</Button>}
  </>;
}
