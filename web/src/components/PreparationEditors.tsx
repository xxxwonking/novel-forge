/**
 * 资料页的手改编辑器：人物 / 地点组织 / 情节线 / 章节计划。
 *
 * 三条贯穿全文件的取舍：
 *
 * 1. **以服务端对象为底稿展开覆盖。** 表单只改它露出来的字段，没露面的子字段
 *    （如 `addressForms[].condition`、`appearance[].establishedAt`）靠展开原对象活下来。
 *    从表单字段凭空拼一个新对象会把它们连同对应的检查规则一起抹掉 —— 所以每个
 *    `toXxx()` 都是 `{ ...base.block, ...改动 }`，最后交给 `preparation-changes.ts` 裁剪。
 * 2. **编号不可改。** 服务端按 `id` / `chapter` 做 upsert，改编号等于新增一条并留下旧的。
 *    编辑既有条目时编号输入框锁住，新增时才可填。
 * 3. **列表字段用「一行一条」的文本框**，与基本设定表单的写作规则一致；空行自动丢弃。
 */

import { useRef, useState } from "react";
import { Button, Input, InputNumber, Modal, Select } from "antd";
import { api, type CharacterRecord, type PreparationProposal, type ChapterBeat } from "../api.js";
import {
  beatInput, characterInput, plotLineInput, settingInput, emptyCharacter, emptySetting, emptyPlotLine, emptyBeat,
  type BeatInput, type BeatRecord, type CharacterInput, type EventKind, type PlotLineInput, type SettingInput, type Weight,
} from "../preparation-changes.js";

type Kind = "character" | "setting" | "plotLine" | "beat";
/** 编辑既有条目时带上原对象；新增时 base 为 null。 */
export type Editing = { readonly kind: Kind; readonly base: unknown | null };

const CHAR_TIER: [string, string][] = [["protagonist", "主角"], ["major", "主要"], ["minor", "次要"], ["extra", "龙套"]];
const WEIGHTS: [string, string][] = [["main", "主线"], ["sub", "支线"], ["detail", "细节"]];
const REGISTERS: [string, string][] = [["vulgar", "粗俗"], ["colloquial", "口语"], ["neutral", "中性"], ["formal", "正式"], ["literary", "文雅"], ["archaic", "古语"]];
const EMOTIONS: [string, string][] = [["suppressed", "压抑（越激动越沉默）"], ["direct", "直给（情绪写在话里）"], ["ironic", "反讽（用玩笑掩饰）"], ["explosive", "爆发（平静到失控）"], ["oblique", "迂回（从不直说重点）"]];
const CHAPTER_TYPES: [string, string][] = [["transition", "过渡"], ["setup", "布局"], ["event", "事件"], ["payoff", "回收"], ["climax", "高潮"]];
const EVENT_KINDS: [string, string][] = [["action", "行动"], ["info", "信息"], ["relation", "关系"], ["resource", "资源"], ["decision", "决定"]];
const COMPLETENESS: [string, string][] = [["partial", "部分兑现"], ["full", "完整兑现"]];
const KINDS: [string, string][] = [["location", "地点"], ["organization", "组织"]];

const options = (pairs: readonly [string, string][]): { value: string; label: string }[] => pairs.map(([value, label]) => ({ value, label }));
const lines = (text: string): string[] => text.split("\n").map((line) => line.trim()).filter(Boolean);
const text = (values: readonly string[]): string => values.join("\n");

/** 保存入口共用：指纹取自打开表单那一刻的视图，提交时由服务端再核对一次。 */
function useSave(fingerprint: string, onSaved: (proposal: PreparationProposal) => void) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const receipt = useRef<{ content: string; id: string } | null>(null);
  const save = async (summary: string, changes: Record<string, unknown>): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    const content = JSON.stringify(changes);
    // 同一份改动重试复用编号；内容变了才是新一次意图。
    if (receipt.current?.content !== content) receipt.current = { content, id: crypto.randomUUID() };
    try {
      onSaved(await api.recordAuthorDetails({ summary, baseFingerprint: fingerprint, changes }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return { busy, error, save, setError };
}

function Frame({ title, hint, busy, error, disabled, onSubmit, onClose, children }: {
  title: string; hint?: string; busy: boolean; error: string | null; disabled: boolean;
  onSubmit: () => void; onClose: () => void; children: React.ReactNode;
}): React.ReactElement {
  return <Modal open className="prep-editor" title={title} width={720} onCancel={() => { if (!busy) onClose(); }} maskClosable={!busy}
    footer={[<Button key="cancel" disabled={busy} onClick={onClose}>取消</Button>, <Button key="ok" type="primary" loading={busy} disabled={disabled} onClick={onSubmit}>保存</Button>]}>
    {hint !== undefined && <p className="muted">{hint}</p>}
    {error !== null && <div className="finding" role="alert" data-level="block">{error}</div>}
    <div className="prep-editor-body">{children}</div>
  </Modal>;
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }): React.ReactElement {
  return <label className={wide === true ? "prep-field prep-field-wide" : "prep-field"}><span>{label}</span>{children}</label>;
}

/** 读取工具：表单里没有的字段一律保持 undefined，交给展开原对象兜底。 */
const num = (value: number | null, fallback: number): number => value ?? fallback;

// ── 人物 ────────────────────────────────────────────────────────────────

interface Appearance { key: string; value: string; establishedAt: number; immutable: boolean }
interface Address { target: string | null; form: string; condition: string }

export function CharacterEditor({ base, characters, fingerprint, onSaved, onClose }: {
  base: CharacterRecord | null; characters: readonly CharacterRecord[]; fingerprint: string; onSaved: (proposal: PreparationProposal) => void; onClose: () => void;
}): React.ReactElement {
  const seed = base ?? { ...emptyCharacter(), introducedAt: 0, provenance: "", updatedAt: "" } as CharacterRecord;
  const [id, setId] = useState(seed.id);
  const [name, setName] = useState(seed.name);
  const [aliases, setAliases] = useState(text(seed.aliases));
  const [tier, setTier] = useState<string>(seed.tier);
  const [role, setRole] = useState(seed.profile.role);
  const [wants, setWants] = useState(seed.profile.wants);
  const [fears, setFears] = useState(seed.profile.fears);
  const [background, setBackground] = useState(seed.profile.background);
  const [traits, setTraits] = useState(text(seed.profile.traits));
  const [forbidden, setForbidden] = useState(text(seed.profile.forbiddenBehaviors));
  const [appearance, setAppearance] = useState<Appearance[]>([...seed.profile.appearance]);
  const [speech, setSpeech] = useState(seed.speech);
  const [speechLines, setSpeechLines] = useState({
    verbalTics: text(seed.speech.verbalTics), signatureLexicon: text(seed.speech.signatureLexicon),
    forbiddenLexicon: text(seed.speech.forbiddenLexicon), exemplars: text(seed.speech.exemplars), counterExemplars: text(seed.speech.counterExemplars),
  });
  const [addresses, setAddresses] = useState<Address[]>(seed.speech.addressForms.map((a) => ({ target: a.target, form: a.form, condition: a.condition ?? "" })));
  const { busy, error, save, setError } = useSave(fingerprint, onSaved);

  const submit = (): void => {
    if (lines(speechLines.exemplars).length === 0) { setError("正例台词至少写一条 —— 声音检查拿它做对比，没有它这项检查对本章失效。"); return; }
    const draft: CharacterRecord = {
      ...seed,
      id, name, aliases: lines(aliases), tier: tier as CharacterRecord["tier"],
      profile: {
        ...seed.profile,
        role, wants, fears, background, traits: lines(traits), forbiddenBehaviors: lines(forbidden),
        appearance: appearance.filter((a) => a.key.trim() !== "" && a.value.trim() !== "").map((a) => ({ key: a.key.trim(), value: a.value.trim(), establishedAt: a.establishedAt, immutable: a.immutable })),
      },
      speech: {
        ...seed.speech,
        ...speech,
        verbalTics: lines(speechLines.verbalTics), signatureLexicon: lines(speechLines.signatureLexicon),
        forbiddenLexicon: lines(speechLines.forbiddenLexicon), exemplars: lines(speechLines.exemplars), counterExemplars: lines(speechLines.counterExemplars),
        // 空的 condition 省略而不是留空串：schema 允许省略，空串会白白写进资料。
        addressForms: addresses.filter((a) => a.form.trim() !== "").map((a) => ({ target: a.target, form: a.form.trim(), ...(a.condition.trim() === "" ? {} : { condition: a.condition.trim() }) })),
      },
    };
    void save(base === null ? `作者新增人物「${name}」` : `作者修改人物「${name}」`, { characters: [characterInput(draft)] });
  };

  const setRow = <T,>(rows: T[], n: number, next: T): T[] => rows.map((row, i) => i === n ? next : row);
  return <Frame title={base === null ? "新增人物" : `编辑人物「${base.name}」`}
    hint="外貌与说话方式会随人物卡进入模型上下文。「不可变」的属性（如瞳色）改动会触发属性冲突提示。" busy={busy} error={error} disabled={busy} onSubmit={submit} onClose={onClose}>
    <div className="prep-grid">
      <Field label="编号"><Input value={id} disabled={base !== null} onChange={(e) => setId(e.target.value)} placeholder="C_LinYu" /></Field>
      <Field label="姓名"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="别名（一行一个）"><Input.TextArea rows={2} value={aliases} onChange={(e) => setAliases(e.target.value)} /></Field>
      <Field label="出场权重"><Select value={tier} onChange={setTier} options={options(CHAR_TIER)} /></Field>
      <Field label="一句话定位" wide><Input value={role} onChange={(e) => setRole(e.target.value)} /></Field>
      <Field label="想要什么" wide><Input value={wants} onChange={(e) => setWants(e.target.value)} /></Field>
      <Field label="害怕什么" wide><Input value={fears} onChange={(e) => setFears(e.target.value)} /></Field>
      <Field label="背景" wide><Input.TextArea rows={3} value={background} onChange={(e) => setBackground(e.target.value)} /></Field>
      <Field label="性格标签（一行一个）"><Input.TextArea rows={2} value={traits} onChange={(e) => setTraits(e.target.value)} /></Field>
      <Field label="禁止行为（一行一个）"><Input.TextArea rows={2} value={forbidden} onChange={(e) => setForbidden(e.target.value)} /></Field>
    </div>

    <h4 className="prep-editor-head">外貌要点</h4>
    <p className="muted">拆成键值对才能比对属性冲突（眼睛颜色变了、惯用手换了）。改变键名等于换一条属性。</p>
    {appearance.map((row, n) => <div className="prep-row" key={n}>
      <Input value={row.key} placeholder="属性名，如 眼睛颜色" onChange={(e) => setAppearance(setRow(appearance, n, { ...row, key: e.target.value }))} />
      <Input value={row.value} placeholder="值，如 浅褐" onChange={(e) => setAppearance(setRow(appearance, n, { ...row, value: e.target.value }))} />
      <InputNumber value={row.establishedAt} min={0} placeholder="确立章" onChange={(v) => setAppearance(setRow(appearance, n, { ...row, establishedAt: num(v, 0) }))} />
      <Select value={row.immutable ? "yes" : "no"} options={[{ value: "yes", label: "不可变" }, { value: "no", label: "可变" }]} onChange={(v) => setAppearance(setRow(appearance, n, { ...row, immutable: v === "yes" }))} />
      <Button type="text" onClick={() => setAppearance(appearance.filter((_, i) => i !== n))}>删除</Button>
    </div>)}
    <Button onClick={() => setAppearance([...appearance, { key: "", value: "", establishedAt: 0, immutable: false }])}>添加外貌属性</Button>

    <h4 className="prep-editor-head">说话方式</h4>
    <p className="muted">这些字段直接喂给声音一致性检查，写空等于关掉对应的检查项。</p>
    <div className="prep-grid">
      <Field label="台词句长下限（字）"><InputNumber value={speech.sentenceLength.min} min={0} onChange={(v) => setSpeech({ ...speech, sentenceLength: { ...speech.sentenceLength, min: num(v, 0) } })} /></Field>
      <Field label="台词句长上限（字，至少 1）"><InputNumber value={speech.sentenceLength.max} min={1} onChange={(v) => setSpeech({ ...speech, sentenceLength: { ...speech.sentenceLength, max: num(v, 1) } })} /></Field>
      <Field label="语域"><Select value={speech.register} onChange={(v) => setSpeech({ ...speech, register: v as typeof speech.register })} options={options(REGISTERS)} /></Field>
      <Field label="情绪表达"><Select value={speech.emotionalExpression} onChange={(v) => setSpeech({ ...speech, emotionalExpression: v as typeof speech.emotionalExpression })} options={options(EMOTIONS)} /></Field>
      <Field label="口头禅（一行一个）"><Input.TextArea rows={2} value={speechLines.verbalTics} onChange={(e) => setSpeechLines({ ...speechLines, verbalTics: e.target.value })} /></Field>
      <Field label="专属词汇（一行一个）"><Input.TextArea rows={2} value={speechLines.signatureLexicon} onChange={(e) => setSpeechLines({ ...speechLines, signatureLexicon: e.target.value })} /></Field>
      <Field label="禁用词（一行一个，命中即拦截）"><Input.TextArea rows={2} value={speechLines.forbiddenLexicon} onChange={(e) => setSpeechLines({ ...speechLines, forbiddenLexicon: e.target.value })} /></Field>
      <Field label="疑问句占比目标（0–1）"><InputNumber value={speech.syntaxBias.question} min={0} max={1} step={0.05} onChange={(v) => setSpeech({ ...speech, syntaxBias: { ...speech.syntaxBias, question: num(v, 0) } })} /></Field>
      <Field label="祈使句占比目标（0–1）"><InputNumber value={speech.syntaxBias.imperative} min={0} max={1} step={0.05} onChange={(v) => setSpeech({ ...speech, syntaxBias: { ...speech.syntaxBias, imperative: num(v, 0) } })} /></Field>
      <Field label="省略句占比目标（0–1）"><InputNumber value={speech.syntaxBias.elliptical} min={0} max={1} step={0.05} onChange={(v) => setSpeech({ ...speech, syntaxBias: { ...speech.syntaxBias, elliptical: num(v, 0) } })} /></Field>
    </div>
    <Field label="正例台词（一行一句，至少一条）" wide><Input.TextArea rows={4} value={speechLines.exemplars} onChange={(e) => setSpeechLines({ ...speechLines, exemplars: e.target.value })} /></Field>
    <Field label="反例台词（一行一句，写崩的句子可以粘这里）" wide><Input.TextArea rows={3} value={speechLines.counterExemplars} onChange={(e) => setSpeechLines({ ...speechLines, counterExemplars: e.target.value })} /></Field>

    <h4 className="prep-editor-head">称谓表</h4>
    <p className="muted">这个人提到谁时该怎么称呼。留空条件表示任何时候都这么叫。</p>
    {addresses.map((row, n) => <div className="prep-row" key={n}>
      <Select value={row.target ?? ""} onChange={(v) => setAddresses(setRow(addresses, n, { ...row, target: v === "" ? null : v }))}
        options={[{ value: "", label: "对所有人" }, ...characters.filter((c) => c.id !== id).map((c) => ({ value: c.id, label: c.name }))]} />
      <Input value={row.form} placeholder="称呼，如 苏姑娘" onChange={(e) => setAddresses(setRow(addresses, n, { ...row, form: e.target.value }))} />
      <Input value={row.condition} placeholder="限定情境，可空" onChange={(e) => setAddresses(setRow(addresses, n, { ...row, condition: e.target.value }))} />
      <Button type="text" onClick={() => setAddresses(addresses.filter((_, i) => i !== n))}>删除</Button>
    </div>)}
    <Button onClick={() => setAddresses([...addresses, { target: null, form: "", condition: "" }])}>添加称谓</Button>
  </Frame>;
}

// ── 地点 / 组织 ─────────────────────────────────────────────────────────

export function SettingEditor({ base, fingerprint, onSaved, onClose }: {
  base: SettingInput | null; fingerprint: string; onSaved: (proposal: PreparationProposal) => void; onClose: () => void;
}): React.ReactElement {
  const seed = base ?? emptySetting();
  const [id, setId] = useState(seed.id);
  const [name, setName] = useState(seed.name);
  const [kind, setKind] = useState<string>(seed.kind);
  const [description, setDescription] = useState(seed.description);
  const [facts, setFacts] = useState(text(seed.facts));
  const { busy, error, save } = useSave(fingerprint, onSaved);
  return <Frame title={base === null ? "新增地点或组织" : `编辑「${base.name}」`}
    hint="写章装配按节拍表点名的地点取用这里的描述与要点。" busy={busy} error={error} disabled={busy} onClose={onClose}
    onSubmit={() => void save(base === null ? `作者新增设定「${name}」` : `作者修改设定「${name}」`, { settings: [settingInput({ id, name, kind: kind as SettingInput["kind"], description, facts: lines(facts) })] })}>
    <div className="prep-grid">
      <Field label="编号"><Input value={id} disabled={base !== null} onChange={(e) => setId(e.target.value)} placeholder="S_OldArchive" /></Field>
      <Field label="名称"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="类型"><Select value={kind} onChange={setKind} options={options(KINDS)} /></Field>
    </div>
    <Field label="描述" wide><Input.TextArea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
    <Field label="要点（一行一条）" wide><Input.TextArea rows={4} value={facts} onChange={(e) => setFacts(e.target.value)} /></Field>
  </Frame>;
}

// ── 情节线 ──────────────────────────────────────────────────────────────

export function PlotLineEditor({ base, fingerprint, onSaved, onClose }: {
  base: PlotLineInput | null; fingerprint: string; onSaved: (proposal: PreparationProposal) => void; onClose: () => void;
}): React.ReactElement {
  const seed = base ?? emptyPlotLine();
  const [id, setId] = useState(seed.id);
  const [label, setLabel] = useState(seed.label);
  const [weight, setWeight] = useState<string>(seed.weight);
  const { busy, error, save } = useSave(fingerprint, onSaved);
  return <Frame title={base === null ? "新增情节线" : `编辑情节线「${base.label}」`}
    hint="节拍表里的事件要挂到情节线上；主线权重会影响字数预算与密度校验。" busy={busy} error={error} disabled={busy} onClose={onClose}
    onSubmit={() => void save(base === null ? `作者新增情节线「${label}」` : `作者修改情节线「${label}」`, { plotLines: [plotLineInput({ id, label, weight: weight as Weight })] })}>
    <div className="prep-grid">
      <Field label="编号"><Input value={id} disabled={base !== null} onChange={(e) => setId(e.target.value)} placeholder="P_MainLine" /></Field>
      <Field label="名称"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label="权重"><Select value={weight} onChange={setWeight} options={options(WEIGHTS)} /></Field>
    </div>
  </Frame>;
}

// ── 章节计划 ────────────────────────────────────────────────────────────

export function BeatEditor({ base, chapter, characters, settings, plotLines, fingerprint, onSaved, onClose }: {
  base: ChapterBeat | null; chapter: number; characters: readonly CharacterRecord[]; settings: readonly SettingInput[];
  plotLines: readonly PlotLineInput[]; fingerprint: string; onSaved: (proposal: PreparationProposal) => void; onClose: () => void;
}): React.ReactElement {
  const seed: BeatRecord = base ?? { ...emptyBeat(chapter, 1, characters.filter((c) => c.tier === "protagonist").map((c) => c.id), settings[0] === undefined ? [] : [settings[0].id]), budget: null };
  const [volume, setVolume] = useState(seed.volume);
  const [plan, setPlan] = useState(seed.plan);
  const { busy, error, save, setError } = useSave(fingerprint, onSaved);
  const characterOptions = characters.map((c) => ({ value: c.id, label: c.name }));
  const settingOptions = settings.map((s) => ({ value: s.id, label: s.name }));
  const plotLineOptions = [{ value: "", label: "不挂情节线" }, ...plotLines.map((p) => ({ value: p.id, label: p.label }))];
  const submit = (): void => {
    if (plan.characters.length === 0) { setError("至少点名一个出场人物 —— 写章装配按这里决定给模型看谁的档案。"); return; }
    if (plan.locations.length === 0) { setError("至少点名一个地点或组织 —— 装配按它决定给模型看哪份设定。"); return; }
    void save(base === null ? `作者新增第 ${seed.chapter} 章计划` : `作者修改第 ${seed.chapter} 章计划`, { beats: [beatInput({ chapter: seed.chapter, volume, plan })] });
  };
  const patch = (next: Partial<typeof plan>): void => setPlan({ ...plan, ...next });
  const setRow = <T,>(rows: T[], n: number, next: T): T[] => rows.map((row, i) => i === n ? next : row);
  return <Frame title={base === null ? `新增第 ${seed.chapter} 章计划` : `编辑第 ${seed.chapter} 章计划`}
    hint="核心事件、阶段反馈、章末钩子都不能是「继续铺垫」这类推迟的说法，也不要用「更大的风暴」这类空钩。" busy={busy} error={error} disabled={busy} onSubmit={submit} onClose={onClose}>
    <div className="prep-grid">
      <Field label="卷号"><InputNumber value={volume} min={1} onChange={(v) => setVolume(num(v, 1))} /></Field>
      <Field label="章节类型"><Select value={plan.chapterType} onChange={(v) => patch({ chapterType: v as typeof plan.chapterType })} options={options(CHAPTER_TYPES)} /></Field>
      <Field label="出场人物（至少一个）" wide><Select mode="multiple" value={[...plan.characters]} onChange={(v) => patch({ characters: v })} options={characterOptions} /></Field>
      <Field label="地点／组织（至少一个）" wide><Select mode="multiple" value={[...plan.locations]} onChange={(v) => patch({ locations: v })} options={settingOptions} /></Field>
      <Field label="核心事件" wide><Input value={plan.coreEvent} onChange={(e) => patch({ coreEvent: e.target.value })} /></Field>
      <Field label="阶段反馈（本章给读者的实际兑现）" wide><Input.TextArea rows={2} value={plan.stageFeedback} onChange={(e) => patch({ stageFeedback: e.target.value })} /></Field>
      <Field label="章末钩子" wide><Input.TextArea rows={2} value={plan.hook} onChange={(e) => patch({ hook: e.target.value })} /></Field>
      <Field label="次级推进（可空）" wide><Input value={plan.secondaryThread ?? ""} onChange={(e) => patch({ secondaryThread: e.target.value === "" ? null : e.target.value })} /></Field>
    </div>

    <h4 className="prep-editor-head">计划事件</h4>
    <p className="muted">权重直接决定本章字数预算：「事件章」及以上至少要有一件事发生。</p>
    {plan.events.map((row, n) => <div className="prep-row" key={n}>
      <Select value={row.kind} options={options(EVENT_KINDS)} onChange={(v) => patch({ events: setRow([...plan.events], n, { ...row, kind: v as EventKind }) })} />
      <Input value={row.summary} placeholder="一句话说清发生了什么" onChange={(e) => patch({ events: setRow([...plan.events], n, { ...row, summary: e.target.value }) })} />
      <InputNumber value={row.weight} min={1} max={3} onChange={(v) => patch({ events: setRow([...plan.events], n, { ...row, weight: num(v, 1) as 1 | 2 | 3 }) })} />
      <Select value={row.plotLine ?? ""} options={plotLineOptions} onChange={(v) => patch({ events: setRow([...plan.events], n, { ...row, plotLine: v === "" ? null : v }) })} />
      <Button type="text" onClick={() => patch({ events: plan.events.filter((_, i) => i !== n) })}>删除</Button>
    </div>)}
    <Button onClick={() => patch({ events: [...plan.events, { kind: "action", summary: "", weight: 1, plotLine: null }] })}>添加事件</Button>

    <h4 className="prep-editor-head">本章埋设伏笔</h4>
    <p className="muted">这里只写名称与权重；意图由模型在写作时给出。兑现要留到后面的章节。</p>
    {plan.plants.map((row, n) => <div className="prep-row" key={n}>
      <Input value={row.label} placeholder="伏笔名称" onChange={(e) => patch({ plants: setRow([...plan.plants], n, { ...row, label: e.target.value }) })} />
      <Select value={row.weight} options={options(WEIGHTS)} onChange={(v) => patch({ plants: setRow([...plan.plants], n, { ...row, weight: v as Weight }) })} />
      <Button type="text" onClick={() => patch({ plants: plan.plants.filter((_, i) => i !== n) })}>删除</Button>
    </div>)}
    <Button onClick={() => patch({ plants: [...plan.plants, { label: "", weight: "sub" }] })}>添加伏笔</Button>

    <h4 className="prep-editor-head">本章兑现伏笔</h4>
    <p className="muted">只能收束已经正式埋设、且尚未结束的伏笔，权重必须与该伏笔一致；填错会在保存时被打回。</p>
    {plan.resolves.map((row, n) => <div className="prep-row" key={n}>
      <Input value={row.foreshadowId} placeholder="伏笔编号，如 F02" onChange={(e) => patch({ resolves: setRow([...plan.resolves], n, { ...row, foreshadowId: e.target.value }) })} />
      <Select value={row.weight} options={options(WEIGHTS)} onChange={(v) => patch({ resolves: setRow([...plan.resolves], n, { ...row, weight: v as Weight }) })} />
      <Select value={row.completeness} options={options(COMPLETENESS)} onChange={(v) => patch({ resolves: setRow([...plan.resolves], n, { ...row, completeness: v as "full" | "partial" }) })} />
      <Button type="text" onClick={() => patch({ resolves: plan.resolves.filter((_, i) => i !== n) })}>删除</Button>
    </div>)}
    <Button onClick={() => patch({ resolves: [...plan.resolves, { foreshadowId: "", weight: "sub", completeness: "partial" }] })}>添加兑现</Button>
  </Frame>;
}
