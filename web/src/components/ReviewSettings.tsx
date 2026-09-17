import { useState } from "react";
import { Button, Switch } from "antd";
import { api, type ReviewSettings as Settings } from "../api.js";
import { useFetch } from "../hooks.js";

/**
 * 两个模型审查通道的开关。
 *
 * 为什么值得给界面入口：整条检查链上只有这两项会发网络请求，**每章各一次**。
 * 长篇算下来是实打实的钱，旋钮该在作者手上，而不是只躺在 `rules.yaml` 里。
 *
 * 关掉不影响正文的生成依据 —— 它不进来源指纹，所以改开关不会作废任何待采用稿。
 */
const ITEMS: readonly { key: keyof Settings; title: string; detail: string }[] = [
  { key: "voice", title: "人物说话方式", detail: "语域、情绪表达、称呼是否符合这个人的设定。句长、口头禅、禁用词这些机械项由代码检查，不受开关影响。" },
  { key: "semantics", title: "视角与伏笔兑现", detail: "正文有没有写到视角人物感知不到的东西；声明已收的伏笔，正文是否真交代了当初埋下的意图。" },
];

export function ReviewSettings(): React.ReactElement {
  const data = useFetch(() => api.reviewSettings(), []);
  const [busy, setBusy] = useState<keyof Settings | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (data.data === null) {
    return <section className="prep-section"><h2>模型审查</h2>
      <p className="muted">{data.error ?? "读取设置…"} <Button size="small" onClick={data.reload}>重新读取</Button></p>
    </section>;
  }
  const value = data.data;
  const toggle = async (key: keyof Settings, next: boolean): Promise<void> => {
    if (busy !== null) return;
    setBusy(key); setError(null);
    try { await api.saveReviewSettings({ ...value, [key]: next }); data.reload(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(null); }
  };

  return <section className="prep-section">
    <h2>模型审查</h2>
    <p className="muted">这两项由模型核对，每章检查时<strong>各多一次模型调用</strong>。关掉只是不再出这类提示，字数、密度、词表等代码检查照常；已写好的草稿不受影响。</p>
    {error !== null && <div className="finding" role="alert" data-level="block">{error}</div>}
    {ITEMS.map((item) => <label className="review-toggle" key={item.key}>
      <Switch checked={value[item.key]} loading={busy === item.key} onChange={(next) => void toggle(item.key, next)} />
      <span><strong>{item.title}</strong><small>{item.detail}</small></span>
    </label>)}
  </section>;
}
