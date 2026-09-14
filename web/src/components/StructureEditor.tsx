import { useRef, useState } from "react";
import { api, type DraftView } from "../api.js";

type Section = keyof NonNullable<DraftView["declaration"]>;
const sections: Record<Section, string> = { events: "剧情事件", characterStates: "人物状态", relationsChanged: "人物关系", foreshadowPlanted: "新埋伏笔", foreshadowResolved: "伏笔兑现", characterPresence: "人物出场" };
const fields: Record<Section, string[]> = {
  events: ["summary", "kind", "weight", "plotLine", "participants"],
  characterStates: ["characterId", "field", "from", "to"], relationsChanged: ["from", "to", "fromKind", "toKind", "note"],
  foreshadowPlanted: ["label", "intent", "weight", "visibility", "expectedBy"], foreshadowResolved: ["foreshadowId", "completeness"], characterPresence: ["characterId", "role"],
};
const labels: Record<string, string> = { summary: "事件概述", kind: "事件类型", weight: "影响程度", plotLine: "情节线编号（可空）", participants: "涉及人物", characterId: "人物", field: "状态字段", from: "变化前", to: "变化后", fromKind: "原关系", toKind: "新关系", note: "变化说明", label: "伏笔名称", intent: "预期兑现内容", visibility: "明暗线", expectedBy: "预期兑现章号", foreshadowId: "伏笔编号", completeness: "兑现程度", role: "本章作用", quote: "正文依据" };
const enums: Record<string, [string, string][]> = {
  kind: [["action", "行动"], ["info", "信息"], ["relation", "关系"], ["resource", "资源"], ["decision", "决定"]],
  visibility: [["overt", "明线"], ["covert", "暗线"]], completeness: [["partial", "部分兑现"], ["full", "完整兑现"]],
  role: [["pov", "视角人物"], ["major", "主要出场"], ["minor", "次要出场"], ["mentioned", "仅被提及"]],
  field: [["condition", "身体／处境"], ["location", "所在地点"], ["vital", "生存状态"]],
  relations: [["ally", "盟友"], ["hostile", "敌对"], ["kin", "亲属"], ["romantic", "情感"], ["mentor", "师徒"], ["subordinate", "上下级"], ["acquaintance", "相识"], ["unknown", "未明"]],
};

export function StructureEditor({ draft, characters, onSaved, onClose }: { draft: DraftView; characters: readonly { id: string; name: string }[]; onSaved: (draft: DraftView) => void; onClose: () => void }): React.ReactElement {
  const [source] = useState(draft);
  const [section, setSection] = useState<Section>("characterStates");
  const [index, setIndex] = useState(0);
  const initial = (category: Section, n: number): Record<string, unknown> => {
    const entry = source.declaration?.[category][n];
    const values = Object.fromEntries(fields[category].map(key => [key, ""]));
    const defaults: Record<Section, Record<string, unknown>> = {
      events: { kind: "action", weight: 1, plotLine: null, participants: [] }, characterStates: { characterId: characters[0]?.id ?? "", field: "condition", from: null },
      relationsChanged: { from: characters[0]?.id ?? "", to: characters[1]?.id ?? "", fromKind: null, toKind: "acquaintance" },
      foreshadowPlanted: { weight: "sub", visibility: "covert", expectedBy: source.chapter + 1 }, foreshadowResolved: { completeness: "partial" }, characterPresence: { characterId: characters[0]?.id ?? "", role: "major" },
    };
    if (entry === undefined) return { ...values, ...defaults[category], ...(category === "characterPresence" ? {} : { quote: "" }) };
    const record = entry as unknown as Record<string, unknown>;
    return { ...Object.fromEntries(fields[category].map(key => [key, record[key]])), ...("anchor" in entry ? { quote: entry.anchor.quote } : {}) };
  };
  const [value, setValue] = useState<Record<string, unknown>>(() => initial("characterStates", 0));
  const [summary, setSummary] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = useRef<{ content: string; id: string } | null>(null);
  const select = (category: Section, n: number): void => { setSection(category); setIndex(n); setValue(initial(category, n)); setError(null); };
  const save = async (remove = false): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    const payload = { chapter: source.chapter, draftId: source.draftId, revisionToken: source.revisionToken,
      summary: summary.trim() || `纠正${sections[section]}，正文保持不变`, changes: [{ section, index, value: remove ? null : value }] };
    const content = JSON.stringify(payload);
    if (receipt.current?.content !== content) receipt.current = { content, id: crypto.randomUUID() };
    try {
      onSaved(await api.correctDraft({ ...payload, requestId: receipt.current.id }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const entryLabel = (entry: unknown, n: number): string => {
    const record = entry as Record<string, unknown>;
    return `${n + 1}. ${record["summary"] ?? record["label"] ?? characters.find(c => c.id === record["characterId"])?.name ?? record["foreshadowId"] ?? record["note"] ?? "记录"}`;
  };
  const characterOptions = characters.map(c => [c.id, c.name] as [string, string]);
  const choices = (key: string): [string, string][] | undefined => {
    if (key === "characterId" || (section === "relationsChanged" && ["from", "to"].includes(key))) return characterOptions;
    if (key === "weight") return section === "events" ? [["1", "局部推进"], ["2", "影响本卷"], ["3", "影响全书"]] : [["main", "主线"], ["sub", "支线"], ["detail", "细节"]];
    if (key === "fromKind") return [["", "未记录"], ...enums.relations!];
    if (key === "toKind") return enums.relations;
    if (section === "characterStates" && value["field"] === "vital" && ["from", "to"].includes(key)) return [...(key === "from" ? [["", "未记录"] as [string, string]] : []), ["alive", "存活"], ["dead", "死亡"], ["missing", "失踪"]];
    return enums[key];
  };
  return <section className="prep-section draft-editor" aria-label="纠正结构记录"><h2>正文保持，纠正记录</h2><p className="muted">选择误读的记录，并填写准确的正文依据。保存为候选新版本后重新检查。</p>
    <div className="revision-fields"><label>记录类别<select value={section} onChange={e => select(e.target.value as Section, 0)}>{Object.entries(sections).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label>选择记录<select value={index} onChange={e => select(section, Number(e.target.value))}>{source.declaration?.[section].map((entry, n) => <option key={n} value={n}>{entryLabel(entry, n)}</option>)}<option value={source.declaration?.[section].length ?? 0}>新增一条记录</option></select></label></div>
    <div className="revision-fields">{[...fields[section], ...(section === "characterPresence" ? [] : ["quote"])].map(key => {
      const options = choices(key);
      const update = (next: unknown): void => setValue(previous => ({ ...previous, [key]: next }));
      const nullable = key === "plotLine" || key === "fromKind" || (key === "from" && section === "characterStates");
      return <label key={key}>{labels[key] ?? key}{key === "participants" ? <select multiple value={value[key] as string[]} onChange={e => update(Array.from(e.target.selectedOptions, option => option.value))}>{characterOptions.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        : options ? <select value={String(value[key] ?? "")} onChange={e => update(key === "weight" && section === "events" ? Number(e.target.value) : nullable && e.target.value === "" ? null : e.target.value)}>{!options.some(([id]) => id === String(value[key] ?? "")) && <option value={String(value[key] ?? "")}>{String(value[key] ?? "请选择")}</option>}{options.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
          : key === "expectedBy" ? <input type="number" min={source.chapter + 1} value={String(value[key] ?? "")} onChange={e => update(Number(e.target.value))} />
            : <textarea rows={key === "quote" || key === "summary" || key === "intent" ? 3 : 2} value={String(value[key] ?? "")} onChange={e => update(nullable && e.target.value === "" ? null : e.target.value)} />}</label>;
    })}</div>
    <label>纠错说明<input value={summary} onChange={e => setSummary(e.target.value)} placeholder="例如：正文写的是昏倒，应保留存活状态" /></label>
    {error && <p className="finding" data-level="block" role="alert">{error}</p>}
    <div className="row"><button data-primary="true" disabled={busy} onClick={() => void save()}>保存记录修订</button>{index < (source.declaration?.[section].length ?? 0) && <button disabled={busy} onClick={() => void save(true)}>移除此条记录</button>}<button disabled={busy} onClick={onClose}>取消纠错</button></div>
  </section>;
}
