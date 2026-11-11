import { PREPARATION_SECTIONS, type PreparationSection } from "../preparation-browse.js";
import { PreparationContentView } from "../components/PreparationContentView.js";
import "../styles/preparation.css";
import { FullTextCharacters } from "../components/FullTextCharacters.js";
import { useRef, useState } from "react";
import { ActionLink, Button, Input, Textarea } from "../components/controls.js";
import { readTextFile } from "../files.js";
import { Chip } from "../components/Chip.js";
import { BeatEditor, CharacterEditor, DraftDialog, PlotLineEditor, SettingEditor, VolumeEditor, type Editing } from "../components/PreparationEditors.js";
import { ImportChapters } from "../components/ImportChapters.js";
import { InferenceChooser } from "../components/InferenceChooser.js";
import { WorkStatus } from "../components/WorkStatus.js";
import { SceneWritingSettings, initialSceneWriting, sceneWritingOptions } from "../components/SceneWritingSettings.js";
import { api, type CharacterRecord, type DraftFocus, type ForeshadowClaim, type PreparationContent, type PreparationPayload, type PreparationProposal, type SettingInput, type PlotLineInput, type VolumeCard } from "../api.js";
import type { RelationClaim, Removals } from "../preparation-changes.js";
import { useFetch, useRouteActive } from "../hooks.js";
import { nextPlanChapter, nextVolumeNumber } from "../preparation-numbering.js";

const discuss = (prompt: string): string => `#/chat?prompt=${encodeURIComponent(prompt)}`;
const planPrompt = "请先读取作品资料，根据我已指定的想法整理人物、必要设定和下一章的具体计划，保存为待确认方案让我看。";
const status = (p: PreparationProposal): string => p.status === "confirmed" ? "已确认" : p.status === "rejected" ? "已丢弃" : p.stale ? "需要重新核对" : "待确认";

export function Preparation({ refresh, proposalId }: { refresh: () => void; proposalId: string | null }): React.ReactElement {
  const isCurrent = useRouteActive();
  const data = useFetch(() => api.preparation(), []);
  const [selected, setSelected] = useState<string | null>(proposalId);
  const [section, setSection] = useState<PreparationSection>("basics");
  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const [entity, setEntity] = useState<Editing | null>(null);
  const [drafting, setDrafting] = useState<DraftFocus | null>(null);
  // 两条反推路线的选择器。分开一个状态而不是塞进 drafting —— 选完才知道走哪条。
  const [choosing, setChoosing] = useState(false);
  const [importingProfile, setImportingProfile] = useState(false);
  const profilePicker = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sceneForm, setSceneForm] = useState(initialSceneWriting);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (data.data === null) return <div className="empty">{data.error ?? "读取作品资料…"} <Button size="sm" onClick={data.reload}>重新读取</Button></div>;
  const view = data.data;
  const candidate = view.proposals.find((p) => p.id === selected);
  const pending = view.proposals.filter(p => p.status === "proposed");
  const history = view.proposals.filter(p => p.status !== "proposed");

  /** 手改与基本设定表单共用的落点：无影响直接生效，触及已采用正文则留下来让作者处理。 */
  const saved = (proposal: PreparationProposal): void => {
    setEntity(null); setEditing(false);
    setSelected(proposal.status === "proposed" ? proposal.id : null);
    const removed = Object.values(proposal.changes.removals ?? {}).some((list) => list.length > 0);
    setNotice(proposal.status === "confirmed" ? removed ? "已删除。" : "作者设定已更新。" : "修改涉及已有正文，已保存为候选，请查看影响。");
    data.reload(); refresh();
  };

  /**
   * 单独导入一份人物档案：先收进作品资料，再立刻按它整理人物。
   *
   * 两步一步到位是这里唯一合理的做法 —— 作者点的是「导入人物档案」，不是
   * 「上传一个文件」；档案收下了却还要去别处再点一次，等于把话说了半句。
   * 结果仍是一份待确认方案，作者核对后才生效。
   */
  const importProfile = async (list: FileList | null): Promise<void> => {
    const chosen = (list === null ? [] : [...list]).filter((f) => /\.(txt|md|markdown|docx|pdf)$/iu.test(f.name) || f.type.startsWith("text/"));
    if (chosen.length === 0) return;
    setImportingProfile(true); setError(null); setNotice(null);
    try {
      const files = await Promise.all(chosen.map(async (f) => ({ name: f.name, text: await readTextFile(f) })));
      const stored = await api.uploadMaterials(files);
      if (stored.saved.length === 0) {
        setError(`没有收下任何文件：${stored.skipped.map((s) => `${s.name}（${s.reason}）`).join("、")}。`);
        return;
      }
      // 先把已经发生的事说出来：文件确实收下了。整理人物是下一步，它失败不该
      // 让作者以为上传也白传了。
      const kept = `已收下 ${stored.saved.join("、")}。${stored.skipped.length === 0 ? "" : `未收下：${stored.skipped.map((s) => `${s.name}（${s.reason}）`).join("、")}。`}`;
      data.reload(); refresh();
      if (isCurrent()) setNotice(kept);
      try {
        const result = await api.draftPreparation({ focus: "characters", apply: true });
        if (isCurrent()) {
          setSelected(result.proposalId ?? null);
          setNotice(`${kept}根据它整理出的人物保存在待确认方案里，请核对后再确认。`);
          data.reload(); refresh();
        }
      } catch (e) {
        if (isCurrent()) setError(`整理人物没有完成：${(e as Error).message} 资料已收下，可以再点「让 AI 起草人物」重试。`);
      }
    } catch (e) { if (isCurrent()) setError((e as Error).message); }
    finally { if (isCurrent()) setImportingProfile(false); }
  };

  const act = async (proposal: PreparationProposal, action: "confirm" | "write" | "trial" | "reject"): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null); setNotice(null);
    let confirmed = false;
    try {
      const sceneWriting = action === "write" || action === "trial" ? sceneWritingOptions(sceneForm) : undefined;
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
          const draft = await api.writeChapter({ chapter: view.nextChapter, ...(sceneWriting === undefined ? {} : { sceneWriting }), ...(action === "trial" ? { proposalId: proposal.id } : {}) });
          if (isCurrent()) window.location.hash = `/draft/${draft.chapter}/${draft.draftId}`;
        }
      }
    } catch (e) { if (isCurrent()) setError(`${confirmed ? "方案已确认；本次写章未完成：" : ""}${(e as Error).message}`); }
    finally { if (isCurrent()) { setBusy(false); data.reload(); } refresh(); }
  };

  return <>
    <div className="page-head"><h1>作品资料</h1><p>从一句想法到人物、世界与章计划。让 AI 先起草，你只核对与改动 —— 不确定的地方不必自己编。</p></div>
    <div className="prep-readiness">
      <div><strong>{view.readiness.ready ? `第 ${view.nextChapter} 章资料已就绪` : "继续准备你的故事"}</strong><p>{view.readiness.ready ? "可以按当前计划创作，结果将作为待采用稿交付。" : `还需要：${view.readiness.missing.join("、")}。`}</p></div>
      <ActionLink href={discuss(planPrompt)}>到对话整理方案 →</ActionLink>
    </div>
    {(error ?? data.error) !== null && <div className="finding" role="alert" data-level="block">{error ?? data.error}</div>}
    {notice !== null && <p className="prep-notice" role="status">{notice}</p>}
    <div className="prep-tabs" role="group" aria-label="资料视图">
      <Button variant={selected === null ? "default" : "outline"} onClick={() => { setSelected(null); setEditing(false); }}>已指定 / 已确认</Button>
      {pending.length > 0 && <Button onClick={() => setSelected(pending[0]!.id)}>查看待确认方案（{pending.length}）</Button>}
    </div>
    <div className="prep-layout">
      <div className="prep-main">
        {candidate === undefined ? <>
          <div className="prep-section-nav" role="group" aria-label="资料分类">{PREPARATION_SECTIONS.map(item => <Button key={item.key} aria-pressed={section === item.key} variant={section === item.key ? "secondary" : "ghost"} onClick={() => setSection(item.key)}>{item.label}</Button>)}</div>
          <div hidden={section !== "basics"} className="prep-section-intro"><h2>基本设定与偏好</h2><p className="muted">确定故事的方向、世界规则和写作偏好。</p><div className="row"><Button variant="default" onClick={() => setDrafting("full")}>让 AI 起草资料</Button><Button onClick={() => setEditing(!editing)}>{editing ? "返回资料" : "编辑基本设定与偏好"}</Button></div></div>
          <div hidden={section !== "characters"} className="prep-section-intro"><p className="muted">按姓名、别名或身份查找角色，再补充档案和说话方式。</p></div>
          <div hidden={section !== "plans"} className="prep-section-intro"><h2>剧情计划</h2><p className="muted">从情节方向到分卷、章节和未来伏笔，安排接下来要写的内容。</p><Button variant="default" onClick={() => setDrafting("chapters")}>让 AI 排后面几章</Button></div>
          <div hidden={section !== "materials"} className="prep-section-intro"><h2>资料导入</h2><p className="muted">导入已有正文，或整理大纲、人物档案与设定。AI 整理的结果需要你确认。</p><div className="row"><Button onClick={() => setImporting(true)}>导入已有正文</Button><Button onClick={() => setChoosing(true)}>反推故事结构</Button></div></div>
          <input type="file" accept=".txt,.md,text/plain" multiple ref={profilePicker} style={{ display: "none" }}
            onChange={(e) => { void importProfile(e.target.files); e.target.value = ""; }} />
          <div hidden={section !== "basics"}>{editing && <AuthorForm view={view} onSaved={saved} />}</div>
          <div hidden={editing && section === "basics"}><PreparationContentView content={view.confirmed} section={section} onEdit={setEntity} onDraft={setDrafting} onImport={() => profilePicker.current?.click()} importing={importingProfile} /></div>
          <div hidden={section !== "characters"}>
            <FullTextCharacters known={view.confirmed.characters} onProposed={proposal => { setSelected(proposal.id); data.reload(); refresh(); }} />
          </div>
          <div hidden={section !== "materials"}>
            <section className="prep-section" aria-label="已导入资料"><div className="section-head"><h2>已导入资料 <small>{view.materials.length}</small></h2><div className="row"><Button disabled={view.materials.length===0} onClick={()=>setDrafting("materials")}>整理人物与剧情资料</Button><Button disabled={view.materials.length===0} onClick={()=>setDrafting("outline")}>从大纲生成剧情节点</Button></div></div>
      {view.materials.length===0?<p className="muted">整项目导入时，大纲、人物档案与设定会保存到这里，也可继续单独导入人物档案。</p>:<ul className="materials-list">{view.materials.map(m=><li key={m.file}><strong>{m.name}</strong><span className="muted"> · {{characters:"人物档案",outline:"大纲／简介",setting:"设定",material:"资料"}[m.kind]??"资料"} · {m.words.toLocaleString()} 字</span></li>)}</ul>}
      {(view.materialWarnings??[]).map(w=><p key={w} role="status" className="finding" data-level="warn">{w}</p>)}
            </section>
          </div>
          <div hidden={section !== "plans"}>
            <SceneWritingSettings value={sceneForm} onChange={setSceneForm} disabled={busy} />
    <p className="muted">本次写章包含一份初稿，按需自动修订最多 {view.taskPolicy.autoRevisionLimit} 次，模型用量随任务显示。离开页面后服务继续执行，结果等待你采用。</p>

          <section className="prep-section"><div className="section-head"><h2>未来伏笔计划</h2><Button size="sm" variant="default"  onClick={() => setDrafting("foreshadows")}>从资料反推伏笔</Button></div><p className="muted">这些安排已确认，尚未写成正文中的埋设或兑现。</p><WorkStatus onChanged={refresh} />{view.plannedForeshadows.length === 0 ? <p className="muted">还没有独立的未来伏笔规划。有大纲或简介，就让 AI 从里面认出你已经安排好的伏笔供你核对 —— 确认后它们会以虚线出现在伏笔时间线上。</p> : view.plannedForeshadows.map(plan => <div className="draft-change" key={plan.id}><strong>{plan.label}</strong><p>{plan.intent}</p><small>预期第 {plan.expectedBy} 章前兑现 · 尚未埋设</small></div>)}</section>
          </div>
          <div hidden={section !== "basics"}><section className="prep-section"><h2>备选想法</h2>{view.ideas.length === 0 ? <p className="muted">暂时没有记录。可以在对话中说“把这个想法记为备选”。</p> : <ul>{view.ideas.map((idea) => <li key={idea.id}>{idea.text}</li>)}</ul>}</section></div>
        </> : <>
          <div className="prep-proposal-head"><Chip color={candidate.stale ? "orange" : "cyan"}>{status(candidate)}</Chip><h2>{candidate.summary}</h2><p className="muted">{candidate.source === "author" ? "作者指定的修改" : "Agent 提出的建议"} · {new Date(candidate.createdAt).toLocaleString("zh-CN")}</p></div>
          {candidate.stale && <p className="finding" data-level="warn">这份方案依据的资料已改变。请回到对话重新整理，避免覆盖你的新选择。</p>}
          <RemovalList removals={candidate.changes.removals} current={view.confirmed} />
          <RelationList relations={candidate.changes.relations} current={candidate.content} />
          <ForeshadowList foreshadows={candidate.changes.foreshadows} />
          {candidate.impacts.map((impact, index) => <div key={index} className="finding" data-level="warn"><strong>{impact.message}</strong><div>{impact.chapters.map((n) => <a key={n} href={`#/chapter/${n}`}>第 {n} 章　</a>)}</div><p>先形成相应章节的候选修改，再核对这些设定。</p></div>)}
          {candidate.findings.map((finding, index) => <div key={index} className="finding" data-level={finding.level}>{finding.message}</div>)}
          {candidate.status === "proposed" && <SceneWritingSettings value={sceneForm} onChange={setSceneForm} disabled={busy} />}
          {candidate.status === "proposed" && <div className="prep-proposal-actions">
            <div className="row"><Button variant="default" disabled={busy || candidate.stale || candidate.impacts.length > 0} onClick={() => void act(candidate, "write")}>确认并写第 {view.nextChapter} 章</Button><Button disabled={busy || candidate.stale || candidate.impacts.length > 0} onClick={() => void act(candidate, "confirm")}>只确认方案</Button><Button disabled={busy || candidate.stale || candidate.impacts.length > 0} onClick={() => void act(candidate, "trial")}>按方案先试写</Button><Button variant="ghost" disabled={busy} onClick={() => void act(candidate, "reject")}>丢弃</Button></div>
            <p className="muted">试写会把这份方案附在草稿上；采用章节时，再一并确认这些依赖。</p>
          </div>}
          <p className="muted">以下为该方案保存时的完整预览。</p><PreparationContentView content={candidate.content} expanded />
        </>}
      </div>
      <aside className="prep-sidebar" aria-label="方案记录">
        <h2>待确认方案 <small>{pending.length}</small></h2>
        <p className="muted">先核对改动与影响，确认后才更新创作依据。</p>
        {pending.length === 0 && <p className="muted">没有待确认方案。</p>}
        {pending.map(p => <ProposalButton key={p.id} proposal={p} selected={selected === p.id} onClick={() => { setSelected(p.id); setEditing(false); }} />)}
        <Button className="mt-6" variant="ghost" aria-expanded={showHistory} onClick={() => setShowHistory(!showHistory)}>{showHistory ? "收起" : "查看"}历史方案（{history.length}）</Button>
        {showHistory && history.map(p => <ProposalButton key={p.id} proposal={p} selected={selected === p.id} onClick={() => { setSelected(p.id); setEditing(false); }} />)}
      </aside>
    </div>
    {entity?.kind === "character" && <CharacterEditor base={entity.base as CharacterRecord | null} characters={view.confirmed.characters} fingerprint={view.fingerprint} onSaved={saved} onClose={() => setEntity(null)} />}
    {entity?.kind === "setting" && <SettingEditor base={entity.base as SettingInput | null} fingerprint={view.fingerprint} onSaved={saved} onClose={() => setEntity(null)} />}
    {entity?.kind === "plotLine" && <PlotLineEditor base={entity.base as PlotLineInput | null} fingerprint={view.fingerprint} onSaved={saved} onClose={() => setEntity(null)} />}
    {entity?.kind === "volume" && (() => {
      const base = entity.base as VolumeCard | null;
      const volume = base?.volume ?? nextVolumeNumber(view.confirmed.volumes, view.confirmed.beats);
      const chapters = view.confirmed.beats.filter((b) => b.volume === volume).map((b) => b.chapter);
      return <VolumeEditor base={base === null ? null : { volume: base.volume, title: base.title, summary: base.summary }}
        volume={volume} span={chapters.length === 0 ? null : { from: Math.min(...chapters), to: Math.max(...chapters) }}
        written={chapters.length > 0 && Math.min(...chapters) < view.nextChapter}
        fingerprint={view.fingerprint} onSaved={saved} onClose={() => setEntity(null)} />;
    })()}
    {drafting !== null && <DraftDialog focus={drafting} onClose={() => setDrafting(null)} onProposed={(proposalId) => { setDrafting(null); setEntity(null); setEditing(false); setSelected(proposalId); setNotice("AI 起草了一份方案，请核对后决定是否确认。"); data.reload(); }} />}
    {choosing && <InferenceChooser onClose={() => setChoosing(false)}
      onMaterials={() => setDrafting("foreshadows")}
      onChapters={() => { window.location.hash = "/inference"; }} />}
    {importing && <ImportChapters onClose={() => setImporting(false)} onImported={(result) => {
      setImporting(false); setEntity(null); setEditing(false); setSelected(null);
      const done = [result.imported.length > 0 ? `新增 ${result.imported.length} 章` : "", result.replaced.length > 0 ? `覆盖 ${result.replaced.length} 章` : "", result.unchanged.length > 0 ? `${result.unchanged.length} 章内容未变` : ""].filter(Boolean).join("、");
      const kept = result.materials.length > 0 ? `另外收下 ${result.materials.length} 份资料：${result.materials.join("、")}。` : "";
      if(result.analysis?.proposalId) setSelected(result.analysis.proposalId);
      const analysis=result.analysis?.error?`资料已保存，但自动整理未完成：${result.analysis.error}。可以在「整理人物与剧情资料」重试。`:result.analysis?.proposalId?"已自动整理为待确认方案，请核对人物和大纲节点后确认；正式事实尚未变更。":result.materials.length>0?"资料已保存，可以在本页整理人物与剧情。":"尚未从正文反推结构，可在需要时逐章核实。";
      setNotice(`导入完成：${done || "未新增正文"}${result.totalWords>0?`，共 ${result.totalWords} 字`:""}。${kept}${analysis}`);
      data.reload(); refresh();
    }} />}
    {entity?.kind === "beat" && <BeatEditor base={entity.base as never} chapter={nextPlanChapter(view.nextChapter, view.confirmed.beats)} characters={view.confirmed.characters} settings={view.confirmed.settings} plotLines={view.confirmed.plotLines} fingerprint={view.fingerprint} onSaved={saved} onClose={() => setEntity(null)} />}
  </>;
}

function ProposalButton({ proposal, selected, onClick }: { proposal: PreparationProposal; selected: boolean; onClick: () => void }): React.ReactElement {
  return <Button className="prep-proposal-item mt-3 grid h-auto w-full min-w-0 grid-cols-1 justify-items-start whitespace-normal p-3.5 text-left" data-selected={selected} aria-pressed={selected} onClick={onClick}><Chip>{status(proposal)}</Chip><strong>{proposal.summary}</strong><small>{new Date(proposal.createdAt).toLocaleDateString("zh-CN")}</small></Button>;
}

function AuthorForm({ view, onSaved }: { view: PreparationPayload; onSaved: (proposal: PreparationProposal) => void }): React.ReactElement {
  // 数据刷新只更新外部视图；编辑内容与提交凭据必须属于同一个源版本。
  const [source] = useState(view);
  const initial = source.confirmed.setting;
  const [values, setValues] = useState({ title: initial.title, premise: initial.premise, centralConflict: initial.centralConflict, openingSituation: initial.openingSituation, writingRules: view.confirmed.discipline.rules.join("\n") });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const labels: Record<keyof typeof values, string> = { title: "暂定书名", premise: "故事想法", centralConflict: "核心冲突", openingSituation: "故事起点", writingRules: "写作规则与偏好（每行一条）" };
  return <form className="prep-form" onSubmit={(event) => {
    event.preventDefault(); if (busy) return; setBusy(true); setError(null);
    const { writingRules, ...setting } = values;
    const changed = Object.fromEntries(Object.entries(setting).filter(([key, value]) => value !== initial[key as keyof typeof setting]));
    const rules = writingRules.split("\n").map((line) => line.trim()).filter(Boolean);
    const changes = { ...(Object.keys(changed).length > 0 ? { setting: changed } : {}), ...(writingRules === source.confirmed.discipline.rules.join("\n") ? {} : { writingRules: rules }) };
    if (Object.keys(changes).length === 0) { setError("没有需要保存的修改。"); setBusy(false); return; }
    void api.recordAuthorDetails({ summary: "作者修改基本设定与写作偏好", baseFingerprint: source.fingerprint, changes }).then(onSaved).catch((e: Error) => setError(e.message)).finally(() => setBusy(false));
  }}><fieldset disabled={busy}>{(Object.keys(labels) as (keyof typeof values)[]).map((key) => <label key={key}>{labels[key]}{key === "title" ? <Input required value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} /> : <Textarea required={key === "premise"} rows={key === "writingRules" ? 6 : 3} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />}</label>)}{error && <p role="alert" className="finding" data-level="block">{error}</p>}<Button variant="default" type="submit" loading={busy}>保存作者设定</Button></fieldset></form>;
}

/**
 * 方案里的删除。
 *
 * 必须单独列出来：下面的预览是**删除之后**的资料，少了一条和从来没有过长得一模一样。
 * 名字要从当前已确认资料里找 —— 方案自己的 content 里已经没有它了。
 */
function RemovalList({ removals, current }: { removals: Removals | undefined; current: PreparationContent }): React.ReactElement | null {
  const items = [
    ...(removals?.characters ?? []).map((id) => `人物「${current.characters.find((c) => c.id === id)?.name ?? id}」`),
    ...(removals?.settings ?? []).map((id) => `地点／组织「${current.settings.find((s) => s.id === id)?.name ?? id}」`),
    ...(removals?.plotLines ?? []).map((id) => `情节线「${current.plotLines.find((p) => p.id === id)?.label ?? id}」`),
    ...(removals?.volumes ?? []).map((volume) => `卷 ${volume} 的卷名与卷纲`),
    ...(removals?.beats ?? []).map((chapter) => `第 ${chapter} 章计划`),
  ];
  if (items.length === 0) return null;
  return <div className="finding" data-level="warn">
    <strong>这份方案会删掉 {items.length} 条资料</strong>
    <p>{items.join("、")}</p>
    <p className="muted">下方预览是删除之后的样子，被删掉的条目不会出现在里面。</p>
  </div>;
}

/**
 * 方案里声明的**人物关系**。
 *
 * 与删除清单同一条理由：这些关系在下面的预览里看不出来（预览是人物卡，不含关系），
 * 不说出来作者就不知道确认这份方案会往关系图里添什么。
 */
function RelationList({ relations, current }: { relations: readonly RelationClaim[] | undefined; current: PreparationContent }): React.ReactElement | null {
  if (relations === undefined || relations.length === 0) return null;
  const name = (id: string): string => current.characters.find((c) => c.id === id)?.name ?? id;
  return <div className="finding" data-level="info">
    <strong>这份方案会声明 {relations.length} 条人物关系</strong>
    <p>{relations.map((r) => `${name(r.from)} → ${name(r.to)}：${r.note}`).join("；")}</p>
    <p className="muted">它们来自资料、尚未写进正文，在关系图上画虚线；正文写到那里就会变成实线。</p>
  </div>;
}

/**
 * 方案里声明的**伏笔规划**。
 *
 * 与关系清单同一条理由：预览是资料卡，不含伏笔，不说出来作者就不知道确认这份方案
 * 会往时间线上添什么。标签也在这里给作者过一眼 —— 正文写到那里要靠它认领这条规划。
 */
function ForeshadowList({ foreshadows }: { foreshadows: readonly ForeshadowClaim[] | undefined }): React.ReactElement | null {
  if (foreshadows === undefined || foreshadows.length === 0) return null;
  return <div className="finding" data-level="info">
    <strong>这份方案会规划 {foreshadows.length} 条伏笔</strong>
    {foreshadows.map((f, index) => <p key={index}>{f.label}：{f.intent}<span className="muted"> · 预期第 {f.expectedBy} 章前兑现</span></p>)}
    <p className="muted">它们来自资料、尚未写进正文，在伏笔时间线上画虚线；正文写到那里凭标签认领，虚线才变实线。</p>
  </div>;
}

/** 只读资料视图。传入 `onEdit` 时才出现手改入口 —— 方案预览复用本组件，那里不能编辑。 */
