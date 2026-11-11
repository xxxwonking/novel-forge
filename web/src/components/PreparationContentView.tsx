import { useState } from "react";
import { Button, Input, ChoiceSelect } from "./controls.js";
import { Chip } from "./Chip.js";
import { OutlineNodes } from "./OutlineNodes.js";
import { ReviewSettings } from "./ReviewSettings.js";
import type { Editing } from "./PreparationEditors.js";
import type { PreparationContent, DraftFocus } from "../api.js";
import type { CharacterTier } from "../preparation-changes.js";
import { CHARACTER_TIERS, filterCharacters, type PreparationSection } from "../preparation-browse.js";

export function PreparationContentView({ content, onEdit, onDraft, onImport, importing, expanded, section = "all" }: { content: PreparationContent; onEdit?: (editing: Editing) => void; onDraft?: (focus: DraftFocus) => void; onImport?: () => void; importing?: boolean; expanded?: boolean; section?: PreparationSection | "all" }): React.ReactElement {
  const s = content.setting;
  const [query, setQuery] = useState("");
  const [tier, setTier] = useState<CharacterTier | "all">("all");
  const characters = expanded ? content.characters : filterCharacters(content.characters, query, tier);
  const add = (kind: Editing["kind"], label: string): React.ReactElement | null => onEdit === undefined ? null : <Button size="sm" onClick={() => onEdit({ kind, base: null })}>{label}</Button>;
  // 起草是主路径，手改是纠正路径 —— 按钮的视觉权重按这个顺序排。
  const draft = (label: string, focus: DraftFocus): React.ReactElement | null => onDraft === undefined ? null : <Button size="sm" variant="default"  onClick={() => onDraft(focus)}>{label}</Button>;
  const edit = (kind: Editing["kind"], base: unknown, name: string): React.ReactElement | null => onEdit === undefined ? null : <Button size="sm" variant="ghost" onClick={() => onEdit({ kind, base })}>编辑{name}</Button>;
  return <>
    <div hidden={section !== "all" && section !== "basics"}>
    <section className="prep-section"><h2>{s.title}</h2><dl className="prep-facts">{([
      ["故事想法", s.premise], ["核心冲突", s.centralConflict], ["故事起点", s.openingSituation], ["主角特征", s.protagonistTraits], ["行为边界", s.protagonistForbidden],
      ["特殊能力", s.specialAbility], ["能力限制", s.abilityLimits], ["世界规则", s.worldRules], ["感情线", s.romanceLine], ["风格", s.styleKeywords], ["不写的内容", s.taboos],
    ] as [string, string | string[]][]).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{(Array.isArray(value) ? value.join("；") : value) || <span className="muted">尚未指定</span>}</dd></div>)}</dl></section>
    </div>
    <div hidden={section !== "all" && section !== "characters"}>
    <section className="prep-section"><div className="section-head"><h2>人物档案 <small>{content.characters.length}</small></h2><div className="row">{onImport === undefined ? null : <Button size="sm" loading={importing === true} onClick={onImport}>导入人物档案</Button>}{draft("让 AI 起草人物", "characters")}{add("character", "手工补一个")}</div></div>{content.characters.length === 0 && <p className="muted">还没有人物档案。有现成的角色档案就导进来 —— 上传后会读它并整理出人物供你核对；也可以让 Agent 从正文起草，或直接手填。</p>}<div className="prep-character-tools" hidden={expanded === true || content.characters.length === 0}>
      <label>查找人物<Input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="姓名、别名或身份" /></label>
      <label>角色分量<ChoiceSelect aria-label="角色分量" value={tier} onChange={setTier} options={[{ value: "all", label: "全部角色" }, ...Object.entries(CHARACTER_TIERS).map(([value, label]) => ({ value: value as CharacterTier, label }))]} /></label>
      <span className="muted" role="status">显示 {characters.length} / {content.characters.length} 人</span>
      {(query || tier !== "all") && <Button size="sm" variant="ghost" onClick={() => { setQuery(""); setTier("all"); }}>清除筛选</Button>}
    </div>
    {!expanded && content.characters.length > 0 && characters.length === 0 && <p className="muted">没有匹配的人物，请换一个关键词或清除筛选。</p>}
    <div className="prep-card-grid">{characters.map((c) => <article className="prep-character" key={c.id}><div className="row"><h3>{c.name}</h3><Chip>{c.provenance === "proposed" ? "建议" : CHARACTER_TIERS[c.tier]}</Chip></div><p>{c.profile.role}</p>{c.aliases.length > 0 && <p className="muted">别名：{c.aliases.join("、")}</p>}<p className="muted">{c.profile.traits.join(" · ")}</p><dl className="prep-facts"><div><dt>想要什么</dt><dd>{c.profile.wants || "尚未指定"}</dd></div><div><dt>害怕什么</dt><dd>{c.profile.fears || "尚未指定"}</dd></div><div><dt>背景</dt><dd>{c.profile.background || "尚未指定"}</dd></div></dl><details open={expanded === true}><summary>外貌与说话方式</summary><p>{c.profile.appearance.map((a) => `${a.key}：${a.value}`).join("；")}</p>{c.speech.exemplars.map((line, i) => <blockquote key={i}>{line}</blockquote>)}{c.speech.forbiddenLexicon.length > 0 && <p>不使用：{c.speech.forbiddenLexicon.join("、")}</p>}</details>{edit("character", c, `「${c.name}」`)}</article>)}</div></section>
    </div>
    <div hidden={section !== "all" && section !== "basics"}>
    <section className="prep-section"><div className="section-head"><h2>地点与组织</h2>{add("setting", "新增地点／组织")}</div>{content.settings.length === 0 && <p className="muted">还没有地点或组织设定。</p>}{content.settings.map((place) => <article className="prep-place" key={place.id}><div className="row"><h3>{place.name} <span className="muted">{place.kind === "organization" ? "组织" : "地点"}</span></h3>{edit("setting", place, "设定")}</div><p>{place.description}</p>{place.facts.length > 0 && <ul>{place.facts.map((fact, i) => <li key={i}>{fact}</li>)}</ul>}</article>)}</section>
    <section className="prep-section"><h2>写作规则与偏好</h2><ul>{content.discipline.rules.map((rule, i) => <li key={i}>{rule}</li>)}</ul></section>
    {/* 方案预览里不显示 —— 它是这本书的设置，不属于某一份候选资料。 */}
    {onEdit !== undefined && <ReviewSettings />}

    </div>
    <div hidden={section !== "all" && section !== "plans"}>
    <section className="prep-section"><div className="section-head"><h2>情节方向</h2><div className="row">{draft("从资料识别情节线", "plotlines")}{add("plotLine", "新增情节线")}</div></div>{content.plotLines.length === 0 ? <p className="muted">还没有情节线规划。有大纲或简介，就让 AI 从里面认出主线与支线供你核对；也可以直接手填。</p> : <ul>{content.plotLines.map((line) => <li key={line.id}><Chip>{line.weight === "main" ? "主线" : line.weight === "sub" ? "支线" : "细节"}</Chip> {line.label}{edit("plotLine", line, "情节线")}</li>)}</ul>}</section>
    <OutlineNodes nodes={content.outlineNodes??[]} lines={content.plotLines}/>
    <section className="prep-section"><div className="section-head"><h2>卷</h2>{add("volume", "新增一卷")}</div>
      <p className="muted">卷纲会顶替这几章的逐章梗概进入模型上下文 —— 章数一多，它是唯一能把远处的篇幅压下去的东西。哪几章属于哪一卷由下面章节计划的卷号决定。</p>
      {(() => {
        const spans = new Map<number, number[]>();
        for (const beat of content.beats) spans.set(beat.volume, [...(spans.get(beat.volume) ?? []), beat.chapter]);
        const volumes = [...new Set([...spans.keys(), ...content.volumes.map((v) => v.volume)])].sort((a, b) => a - b);
        if (volumes.length === 0) return <p className="muted">还没有章节计划，也就还没有卷。</p>;
        return volumes.map((volume) => {
          const card = content.volumes.find((v) => v.volume === volume) ?? null;
          const chapters = spans.get(volume) ?? [];
          const range = chapters.length === 0 ? "还没有章节" : `第 ${Math.min(...chapters)}–${Math.max(...chapters)} 章`;
          return <article className="prep-beat" key={volume}>
            <div className="row"><h3>卷 {volume}{card?.title ? `·${card.title}` : ""}</h3>
              <Chip>{card?.summary.trim() ? "有卷纲" : "缺卷纲"}</Chip>
              <span className="muted">{range}{chapters.length > 0 ? ` · ${chapters.length} 章` : ""}</span>
              <span className="push-right">{edit("volume", card ?? { volume, title: "", summary: "", updatedAt: "" }, "这一卷")}</span></div>
            {card?.summary.trim()
              ? <p>{card.summary}</p>
              : <p className="muted">还没写卷纲。写完这一卷之后补上，前面这几章在上下文里就能压成一句话。</p>}
          </article>;
        });
      })()}
    </section>
    <section className="prep-section"><div className="section-head"><h2>章节计划</h2>{add("beat", "新增章计划")}</div>{content.beats.length === 0 && <p className="muted">还没有章节计划。先明确这一章的目标、冲突和结束位置。</p>}{content.beats.map((beat) => <article className="prep-beat" key={beat.chapter}><div className="row"><h3>第 {beat.chapter} 章</h3><Chip>{beat.provenance === "proposed" ? "建议计划" : "已确认计划"}</Chip>{beat.budget && <span className="muted">{beat.budget.words.min}–{beat.budget.words.max} 字</span>}<span className="push-right">{edit("beat", beat, "计划")}</span></div><strong>{beat.plan.coreEvent}</strong><dl className="prep-facts"><div><dt>本章兑现</dt><dd>{beat.plan.stageFeedback}</dd></div><div><dt>结束位置</dt><dd>{beat.plan.hook}</dd></div><div><dt>出场人物</dt><dd>{beat.plan.characters.map((id) => content.characters.find((c) => c.id === id)?.name ?? id).join("、")}</dd></div><div><dt>地点</dt><dd>{beat.plan.locations.map((id) => content.settings.find((s) => s.id === id)?.name ?? id).join("、")}</dd></div>{beat.plan.secondaryThread && <div><dt>次级推进</dt><dd>{beat.plan.secondaryThread}</dd></div>}</dl>{beat.plan.resolves.length > 0 && <p>计划兑现：{beat.plan.resolves.map((r) => `${r.foreshadowId}（${r.completeness === "partial" ? "部分" : "完整"}）`).join("、")}</p>}</article>)}</section>
    </div>
  </>;
}
