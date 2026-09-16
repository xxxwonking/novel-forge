import { useState } from "react";
import { Button, Input } from "antd";
import { Chip } from "../components/Chip.js";
import { api, type PreparationContent, type PreparationPayload, type PreparationProposal } from "../api.js";
import { useFetch, useRouteActive } from "../hooks.js";

const discuss = (prompt: string): string => `#/chat?prompt=${encodeURIComponent(prompt)}`;
const planPrompt = "请先读取作品资料，根据我已指定的想法整理人物、必要设定和下一章的具体计划，保存为待确认方案让我看。";
const status = (p: PreparationProposal): string => p.status === "confirmed" ? "已确认" : p.status === "rejected" ? "已丢弃" : p.stale ? "需要重新核对" : "待确认";

export function Preparation({ refresh, proposalId }: { refresh: () => void; proposalId: string | null }): React.ReactElement {
  const isCurrent = useRouteActive();
  const data = useFetch(() => api.preparation(), []);
  const [selected, setSelected] = useState<string | null>(proposalId);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (data.data === null) return <div className="empty">{data.error ?? "读取作品资料…"} <Button size="small" onClick={data.reload}>重新读取</Button></div>;
  const view = data.data;
  const candidate = view.proposals.find((p) => p.id === selected);

  const act = async (proposal: PreparationProposal, action: "confirm" | "write" | "trial" | "reject"): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    let confirmed = false;
    try {
      if (action === "reject") {
        await api.rejectPreparation(proposal.id);
        if (isCurrent()) setNotice("方案已丢弃，保留历史记录。");
      } else {
        if (action !== "trial") {
          await api.confirmPreparation(proposal.id);
          confirmed = true;
          if (isCurrent()) { setNotice("方案已确认。资料和章节计划已经更新。"); data.reload(); }
          refresh();
        }
        if (action === "write" || action === "trial") {
          if (isCurrent()) setNotice(`${confirmed ? "方案已确认。" : "保留为建议。"}正在写第 ${view.nextChapter} 章，离开页面后服务会继续处理。`);
          const draft = await api.writeChapter({ chapter: view.nextChapter, ...(action === "trial" ? { proposalId: proposal.id } : {}) });
          if (isCurrent()) window.location.hash = `/draft/${draft.chapter}/${draft.draftId}`;
        }
      }
    } catch (e) { if (isCurrent()) setError(`${confirmed ? "方案已确认；本次写章未完成：" : ""}${(e as Error).message}`); }
    finally { if (isCurrent()) { setBusy(false); data.reload(); } refresh(); }
  };

  return <>
    <div className="page-head"><h1>作品资料</h1><p>从想法到人物、世界与章计划。你明确指定的内容会保存，Agent 补充的建议由你选择。</p></div>
    <div className="prep-readiness">
      <div><strong>{view.readiness.ready ? `第 ${view.nextChapter} 章资料已就绪` : "继续准备你的故事"}</strong><p>{view.readiness.ready ? "可以按当前计划创作，结果将作为待采用稿交付。" : `还需要：${view.readiness.missing.join("、")}。`}</p></div>
      <a className="prep-link" href={discuss(planPrompt)}>到对话整理方案 →</a>
    </div>
    <p className="muted">本次写章包含一份初稿，按需自动修订最多 {view.taskPolicy.autoRevisionLimit} 次，模型用量随任务显示。离开页面后服务继续执行，结果等待你采用。</p>
    {(error ?? data.error) !== null && <div className="finding" role="alert" data-level="block">{error ?? data.error}</div>}
    {notice !== null && <p className="prep-notice" role="status">{notice}</p>}
    <div className="prep-tabs" role="group" aria-label="资料视图">
      <Button type={selected === null ? "primary" : "default"} onClick={() => { setSelected(null); setEditing(false); }}>已指定 / 已确认</Button>
      <span className="muted">{view.proposals.filter((p) => p.status === "proposed").length} 份方案等待处理</span>
    </div>
    <div className="prep-layout">
      <div className="prep-main">
        {candidate === undefined ? <>
          <div className="section-head"><h2>当前创作依据</h2><Button onClick={() => setEditing(!editing)}>{editing ? "返回资料" : "编辑基本设定与偏好"}</Button></div>
          {editing ? <AuthorForm view={view} onSaved={(p) => { setEditing(false); setSelected(p.status === "proposed" ? p.id : null); setNotice(p.status === "confirmed" ? "作者设定已更新。" : "修改涉及已有正文，已保存为候选，请查看影响。" ); data.reload(); refresh(); }} /> : <Content content={view.confirmed} />}
          <section className="prep-section"><h2>未来伏笔计划</h2><p className="muted">这些安排已确认，尚未写成正文中的埋设或兑现。</p>{view.plannedForeshadows.length === 0 ? <p className="muted">暂时没有独立的未来伏笔规划。</p> : view.plannedForeshadows.map(plan => <div className="draft-change" key={plan.id}><strong>{plan.label}</strong><p>{plan.intent}</p><small>预期第 {plan.expectedBy} 章前兑现 · 尚未埋设</small></div>)}</section>
          <section className="prep-section"><h2>备选想法</h2>{view.ideas.length === 0 ? <p className="muted">暂时没有记录。可以在对话中说“把这个想法记为备选”。</p> : <ul>{view.ideas.map((idea) => <li key={idea.id}>{idea.text}</li>)}</ul>}</section>
        </> : <>
          <div className="prep-proposal-head"><Chip color={candidate.stale ? "orange" : "cyan"}>{status(candidate)}</Chip><h2>{candidate.summary}</h2><p className="muted">{candidate.source === "author" ? "作者指定的修改" : "Agent 提出的建议"} · {new Date(candidate.createdAt).toLocaleString("zh-CN")}</p></div>
          {candidate.stale && <p className="finding" data-level="warn">这份方案依据的资料已改变。请回到对话重新整理，避免覆盖你的新选择。</p>}
          {candidate.impacts.map((impact, index) => <div key={index} className="finding" data-level="warn"><strong>{impact.message}</strong><div>{impact.chapters.map((n) => <a key={n} href={`#/chapter/${n}`}>第 {n} 章　</a>)}</div><p>先形成相应章节的候选修改，再核对这些设定。</p></div>)}
          {candidate.findings.map((finding, index) => <div key={index} className="finding" data-level={finding.level}>{finding.message}</div>)}
          {candidate.status === "proposed" && <div className="prep-proposal-actions">
            <div className="row"><Button type="primary" disabled={busy || candidate.stale || candidate.impacts.length > 0} onClick={() => void act(candidate, "write")}>确认并写第 {view.nextChapter} 章</Button><Button disabled={busy || candidate.stale || candidate.impacts.length > 0} onClick={() => void act(candidate, "confirm")}>只确认方案</Button><Button disabled={busy || candidate.stale || candidate.impacts.length > 0} onClick={() => void act(candidate, "trial")}>按方案先试写</Button><Button type="text" disabled={busy} onClick={() => void act(candidate, "reject")}>丢弃</Button></div>
            <p className="muted">试写会把这份方案附在草稿上；采用章节时，再一并确认这些依赖。</p>
          </div>}
          <p className="muted">以下为该方案保存时的完整预览。</p><Content content={candidate.content} />
        </>}
      </div>
      <aside className="prep-sidebar"><h2>方案记录</h2>{view.proposals.length === 0 ? <p className="muted">还没有方案。先和 Agent 聊聊想写的故事。</p> : view.proposals.map((p) => <button className="prep-proposal-item" data-selected={p.id === selected} key={p.id} onClick={() => { setSelected(p.id); setEditing(false); }}><Chip>{status(p)}</Chip><strong>{p.summary}</strong><small>{new Date(p.createdAt).toLocaleDateString("zh-CN")}</small></button>)}</aside>
    </div>
  </>;
}

function AuthorForm({ view, onSaved }: { view: PreparationPayload; onSaved: (proposal: PreparationProposal) => void }): React.ReactElement {
  const initial = view.confirmed.setting;
  const [values, setValues] = useState({ title: initial.title, premise: initial.premise, centralConflict: initial.centralConflict, openingSituation: initial.openingSituation, writingRules: view.confirmed.discipline.rules.join("\n") });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const labels: Record<keyof typeof values, string> = { title: "暂定书名", premise: "故事想法", centralConflict: "核心冲突", openingSituation: "故事起点", writingRules: "写作规则与偏好（每行一条）" };
  return <form className="prep-form" onSubmit={(event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    const { writingRules, ...setting } = values;
    const changed = Object.fromEntries(Object.entries(setting).filter(([key, value]) => value !== initial[key as keyof typeof setting]));
    const rules = writingRules.split("\n").map((line) => line.trim()).filter(Boolean);
    const changes = { ...(Object.keys(changed).length > 0 ? { setting: changed } : {}), ...(writingRules === view.confirmed.discipline.rules.join("\n") ? {} : { writingRules: rules }) };
    if (Object.keys(changes).length === 0) { setError("没有需要保存的修改。"); setBusy(false); return; }
    void api.recordAuthorDetails({ summary: "作者修改基本设定与写作偏好", baseFingerprint: view.fingerprint, changes }).then(onSaved).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  }}><fieldset disabled={busy}>{(Object.keys(labels) as (keyof typeof values)[]).map((key) => <label key={key}>{labels[key]}{key === "title" ? <Input required value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} /> : <Input.TextArea required={key === "premise"} rows={key === "writingRules" ? 6 : 3} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />}</label>)}{error && <p role="alert" className="finding" data-level="block">{error}</p>}<Button type="primary" htmlType="submit" loading={busy}>保存作者设定</Button></fieldset></form>;
}

function Content({ content }: { content: PreparationContent }): React.ReactElement {
  const s = content.setting;
  return <>
    <section className="prep-section"><h2>{s.title}</h2><dl className="prep-facts">{([
      ["故事想法", s.premise], ["核心冲突", s.centralConflict], ["故事起点", s.openingSituation], ["主角特征", s.protagonistTraits], ["行为边界", s.protagonistForbidden],
      ["特殊能力", s.specialAbility], ["能力限制", s.abilityLimits], ["世界规则", s.worldRules], ["感情线", s.romanceLine], ["风格", s.styleKeywords], ["不写的内容", s.taboos],
    ] as [string, string | string[]][]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{(Array.isArray(value) ? value.join("；") : value) || <span className="muted">尚未指定</span>}</dd></div>)}</dl></section>
    <section className="prep-section"><h2>人物档案 <small>{content.characters.length}</small></h2>{content.characters.length === 0 && <p className="muted">还没有人物档案。</p>}<div className="prep-card-grid">{content.characters.map((c) => <article className="prep-character" key={c.id}><div className="row"><h3>{c.name}</h3><Chip>{c.provenance === "proposed" ? "建议" : c.tier === "protagonist" ? "主角" : "已确认"}</Chip></div><p>{c.profile.role}</p><p className="muted">{c.profile.traits.join(" · ")}</p><dl className="prep-facts"><div><dt>想要什么</dt><dd>{c.profile.wants || "尚未指定"}</dd></div><div><dt>害怕什么</dt><dd>{c.profile.fears || "尚未指定"}</dd></div><div><dt>背景</dt><dd>{c.profile.background || "尚未指定"}</dd></div></dl><details><summary>外貌与说话方式</summary><p>{c.profile.appearance.map((a) => `${a.key}：${a.value}`).join("；")}</p>{c.speech.exemplars.map((line, i) => <blockquote key={i}>{line}</blockquote>)}{c.speech.forbiddenLexicon.length > 0 && <p>不使用：{c.speech.forbiddenLexicon.join("、")}</p>}</details></article>)}</div></section>
    <section className="prep-section"><h2>地点与组织</h2>{content.settings.length === 0 && <p className="muted">还没有地点或组织设定。</p>}{content.settings.map((place) => <article className="prep-place" key={place.id}><h3>{place.name} <span className="muted">{place.kind === "organization" ? "组织" : "地点"}</span></h3><p>{place.description}</p>{place.facts.length > 0 && <ul>{place.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul>}</article>)}</section>
    <section className="prep-section"><h2>情节方向</h2>{content.plotLines.length === 0 ? <p className="muted">还没有情节线规划。</p> : <ul>{content.plotLines.map((line) => <li key={line.id}><Chip>{line.weight === "main" ? "主线" : line.weight === "sub" ? "支线" : "细节"}</Chip> {line.label}</li>)}</ul>}</section>
    <section className="prep-section"><h2>章节计划</h2>{content.beats.length === 0 && <p className="muted">还没有章节计划。先明确这一章的目标、冲突和结束位置。</p>}{content.beats.map((beat) => <article className="prep-beat" key={beat.chapter}><div className="row"><h3>第 {beat.chapter} 章</h3><Chip>{beat.provenance === "proposed" ? "建议计划" : "已确认计划"}</Chip>{beat.budget && <span className="muted">{beat.budget.words.min}–{beat.budget.words.max} 字</span>}</div><strong>{beat.plan.coreEvent}</strong><dl className="prep-facts"><div><dt>本章兑现</dt><dd>{beat.plan.stageFeedback}</dd></div><div><dt>结束位置</dt><dd>{beat.plan.hook}</dd></div><div><dt>出场人物</dt><dd>{beat.plan.characters.map((id) => content.characters.find((c) => c.id === id)?.name ?? id).join("、")}</dd></div><div><dt>地点</dt><dd>{beat.plan.locations.map((id) => content.settings.find((s) => s.id === id)?.name ?? id).join("、")}</dd></div>{beat.plan.secondaryThread && <div><dt>次级推进</dt><dd>{beat.plan.secondaryThread}</dd></div>}</dl>{beat.plan.resolves.length > 0 && <p>计划兑现：{beat.plan.resolves.map((r) => `${r.foreshadowId}（${r.completeness === "partial" ? "部分" : "完整"}）`).join("、")}</p>}</article>)}</section>
    <section className="prep-section"><h2>写作规则与偏好</h2><ul>{content.discipline.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></section>
  </>;
}
