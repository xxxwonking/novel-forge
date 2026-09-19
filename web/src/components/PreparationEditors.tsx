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
import { Button, Input, InputNumber, Modal, Popconfirm, Select } from "antd";
import { api, type CharacterRecord, type PreparationProposal, type ChapterBeat } from "../api.js";
import {
  beatInput, characterInput, plotLineInput, settingInput, volumeInput, emptyCharacter, emptySetting, emptyPlotLine, emptyBeat, emptyVolume,
  type BeatInput, type BeatRecord, type CharacterInput, type EventKind, type PlotLineInput, type SettingInput, type VolumeInput, type Weight,
} from "../preparation-changes.js";

type Kind = "character" | "setting" | "plotLine" | "beat" | "volume";
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

function Frame({ title, hint, busy, error, disabled, remove, onSubmit, onClose, children }: {
  title: string; hint?: string; busy: boolean; error: string | null; disabled: boolean;
  /** 只有编辑既有条目时才给：删除入口与「保存」分处页脚两端，不混进主按钮堆里。 */
  remove?: { label: string; note: string; onConfirm: () => void };
  onSubmit: () => void; onClose: () => void; children: React.ReactNode;
}): React.ReactElement {
  return <Modal open className="prep-editor" title={title} width={720} onCancel={() => { if (!busy) onClose(); }} maskClosable={!busy}
    footer={<div className="prep-editor-footer">
      {remove === undefined ? <span /> : <Popconfirm title={remove.label} description={remove.note} okText="删除" cancelText="取消" okButtonProps={{ danger: true }} placement="topLeft" onConfirm={remove.onConfirm}>
        <Button type="text" danger disabled={busy}>{remove.label}</Button>
      </Popconfirm>}
      <span className="row">
        <Button disabled={busy} onClick={onClose}>取消</Button>
        <Button type="primary" loading={busy} disabled={disabled} onClick={onSubmit}>保存</Button>
      </span>
    </div>}>
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

/**
 * 「让 AI 起草」的确认框。
 *
 * 它是资料页的主入口，不是补充功能：这个产品里的作者更像导演 —— 他按需跳读正文，
 * 未必说得清某个角色的性格与说话方式。所以默认路径是 AI 从作品想法与现有资料推断，
 * 作者只审阅与纠正。
 *
 * 这里**只**触发起草并交回方案编号；确认、丢弃、确认并写全部复用既有的方案审阅流程，
 * 不另开一条拍板路径。
 */
export function DraftDialog({ focus, onProposed, onClose }: {
  focus: "characters" | "full" | "chapters"; onProposed: (proposalId: string) => void; onClose: () => void;
}): React.ReactElement {
  const [brief, setBrief] = useState("");
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const characters = focus === "characters";
  const chapters = focus === "chapters";
  const submit = async (): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const trimmed = brief.trim();
      const result = await api.draftPreparation({ focus, apply: true, ...(trimmed === "" ? {} : { brief: trimmed }), ...(chapters ? { count } : {}) });
      if (result.proposalId === undefined) throw new Error("这次起草没有返回方案，请再试一次。");
      onProposed(result.proposalId);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <Modal open className="prep-editor" title={characters ? "让 AI 起草人物" : chapters ? "让 AI 排后面几章" : "让 AI 起草整份资料"} width={620}
    onCancel={() => { if (!busy) onClose(); }} maskClosable={!busy}
    footer={[<Button key="cancel" disabled={busy} onClick={onClose}>取消</Button>,
      <Button key="ok" type="primary" loading={busy} onClick={() => void submit()}>{busy ? "正在起草…" : "开始起草"}</Button>]}>
    <p className="muted">{characters
      ? "AI 会读作品的想法与你已确认的资料，推断出人物的性格、动机与说话方式，保存成一份待确认方案。"
      : chapters
        ? "AI 会接着最后一章已确认的计划往后排，每章一份章计划，合成一份待确认方案；确认后就能授权连写。"
        : "AI 会读作品的想法与你已确认的资料，补齐人物、地点组织、情节线和下一章的计划，保存成一份待确认方案。"}它不会确认方案，也不会开始写章。</p>
    {chapters && <Field label="排几章"><Select value={count} disabled={busy} onChange={(value: number) => setCount(value)} options={[3, 5, 8].map((n) => ({ value: n, label: `${n} 章` }))} /></Field>}
    {error !== null && <div className="finding" role="alert" data-level="block">{error}</div>}
    <Field label="补充要求（可留空）" wide><Input.TextArea rows={3} value={brief} disabled={busy}
      onChange={(e) => setBrief(e.target.value)} placeholder="例如：主要写一个账房和一个守夜的老人；基调要冷，别写感情线。" /></Field>
    {busy && <p className="muted" role="status">正在起草，读完作品资料再写……这一步可能要几十秒。</p>}
  </Modal>;
}

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

  /**
   * 用 AI 草稿覆盖表单。作者还没保存，覆盖的是表单不是资料，随时可以取消退出。
   *
   * 编号与姓名保留作者已经填的：那是他用来告诉 AI「起草谁」的凭据，也是他确定知道的部分 ——
   * 让 AI 的推断反过来改掉它，等于把作者唯一能给的信息也拿走了。
   */
  const fill = (card: CharacterRecord): void => {
    setId((current) => current.trim() === "" ? card.id : current);
    setName((current) => current.trim() === "" ? card.name : current);
    setAliases(text(card.aliases)); setTier(card.tier);
    setRole(card.profile.role); setWants(card.profile.wants); setFears(card.profile.fears);
    setBackground(card.profile.background); setTraits(text(card.profile.traits)); setForbidden(text(card.profile.forbiddenBehaviors));
    setAppearance([...card.profile.appearance]);
    setSpeech(card.speech);
    setSpeechLines({ verbalTics: text(card.speech.verbalTics), signatureLexicon: text(card.speech.signatureLexicon),
      forbiddenLexicon: text(card.speech.forbiddenLexicon), exemplars: text(card.speech.exemplars), counterExemplars: text(card.speech.counterExemplars) });
    setAddresses(card.speech.addressForms.map((a) => ({ target: a.target, form: a.form, condition: a.condition ?? "" })));
  };
  const [drafting, setDrafting] = useState(false);
  const aiFill = async (): Promise<void> => {
    const hint = [name.trim(), role.trim()].filter((part) => part !== "").join("：");
    if (hint === "") { setError("先填个姓名或一句话定位，AI 才知道要起草谁。"); return; }
    setDrafting(true); setError(null);
    try {
      const result = await api.draftPreparation({ focus: "characters", apply: false, brief: `只起草这一个人物：${hint}。已有的其他人物不要动。` });
      const card = result.characters[0];
      if (card === undefined) throw new Error("AI 这次没有给出人物草稿，请再试一次。");
      fill({ ...card, introducedAt: 0, provenance: "", updatedAt: "" });
    } catch (e) { setError((e as Error).message); }
    finally { setDrafting(false); }
  };

  const setRow = <T,>(rows: T[], n: number, next: T): T[] => rows.map((row, i) => i === n ? next : row);
  return <Frame title={base === null ? "新增人物" : `编辑人物「${base.name}」`}
    {...(base === null ? {} : { remove: { label: `删除人物「${base.name}」`, note: "删掉后还能再建一条；如果它还被章节计划、称谓或正式事件引用，会先告诉你要改哪里。", onConfirm: () => void save(`作者删除人物「${base.name}」`, { removals: { characters: [base.id] } }) } })}
    hint="这里是你审阅 AI 的推断的地方：只改你不同意的，拿不准的可以留着让 AI 定。" busy={busy} error={error} disabled={busy} onSubmit={submit} onClose={onClose}>
    <div className="prep-ai-bar">
      <Button size="small" loading={drafting} disabled={busy} onClick={() => void aiFill()}>让 AI 起草这位人物</Button>
      <span className="muted">填个姓名或一句话，AI 会把性格、动机与说话方式一并补上，你再改。</span>
    </div>
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

    <h4 className="prep-editor-head">说话方式</h4>
    <p className="muted">这几项直接决定声音一致性检查，写空等于关掉对应的检查项。</p>
    <div className="prep-grid">
      <Field label="语域"><Select value={speech.register} onChange={(v) => setSpeech({ ...speech, register: v as typeof speech.register })} options={options(REGISTERS)} /></Field>
      <Field label="情绪表达"><Select value={speech.emotionalExpression} onChange={(v) => setSpeech({ ...speech, emotionalExpression: v as typeof speech.emotionalExpression })} options={options(EMOTIONS)} /></Field>
      <Field label="口头禅（一行一个）"><Input.TextArea rows={2} value={speechLines.verbalTics} onChange={(e) => setSpeechLines({ ...speechLines, verbalTics: e.target.value })} /></Field>
      <Field label="禁用词（一行一个，命中即拦截）"><Input.TextArea rows={2} value={speechLines.forbiddenLexicon} onChange={(e) => setSpeechLines({ ...speechLines, forbiddenLexicon: e.target.value })} /></Field>
    </div>
    <Field label="正例台词（一行一句，至少一条）" wide><Input.TextArea rows={4} value={speechLines.exemplars} onChange={(e) => setSpeechLines({ ...speechLines, exemplars: e.target.value })} /></Field>

    <details className="prep-advanced"><summary>高级 · AI 的机械参数与外貌</summary>
      <p className="muted">这些是喂给检查算法的参数，通常由 AI 起草，你不用逐项核对；只有发现模型写偏了才需要动。</p>
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

      <div className="prep-grid">
        <Field label="台词句长下限（字）"><InputNumber value={speech.sentenceLength.min} min={0} onChange={(v) => setSpeech({ ...speech, sentenceLength: { ...speech.sentenceLength, min: num(v, 0) } })} /></Field>
        <Field label="台词句长上限（字，至少 1）"><InputNumber value={speech.sentenceLength.max} min={1} onChange={(v) => setSpeech({ ...speech, sentenceLength: { ...speech.sentenceLength, max: num(v, 1) } })} /></Field>
        <Field label="疑问句占比目标（0–1）"><InputNumber value={speech.syntaxBias.question} min={0} max={1} step={0.05} onChange={(v) => setSpeech({ ...speech, syntaxBias: { ...speech.syntaxBias, question: num(v, 0) } })} /></Field>
        <Field label="祈使句占比目标（0–1）"><InputNumber value={speech.syntaxBias.imperative} min={0} max={1} step={0.05} onChange={(v) => setSpeech({ ...speech, syntaxBias: { ...speech.syntaxBias, imperative: num(v, 0) } })} /></Field>
        <Field label="省略句占比目标（0–1）"><InputNumber value={speech.syntaxBias.elliptical} min={0} max={1} step={0.05} onChange={(v) => setSpeech({ ...speech, syntaxBias: { ...speech.syntaxBias, elliptical: num(v, 0) } })} /></Field>
        <Field label="专属词汇（一行一个）"><Input.TextArea rows={2} value={speechLines.signatureLexicon} onChange={(e) => setSpeechLines({ ...speechLines, signatureLexicon: e.target.value })} /></Field>
      </div>
      <Field label="反例台词（一行一句，模型写崩的句子可以粘这里）" wide><Input.TextArea rows={3} value={speechLines.counterExemplars} onChange={(e) => setSpeechLines({ ...speechLines, counterExemplars: e.target.value })} /></Field>

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
    </details>
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
    {...(base === null ? {} : { remove: { label: `删除「${base.name}」`, note: "删掉后还能再建一条；如果它还被章节计划、称谓或正式事件引用，会先告诉你要改哪里。", onConfirm: () => void save(`作者删除设定「${base.name}」`, { removals: { settings: [base.id] } }) } })}
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
    {...(base === null ? {} : { remove: { label: `删除情节线「${base.label}」`, note: "删掉后还能再建一条；如果它还被章节计划、称谓或正式事件引用，会先告诉你要改哪里。", onConfirm: () => void save(`作者删除情节线「${base.label}」`, { removals: { plotLines: [base.id] } }) } })}
    hint="节拍表里的事件要挂到情节线上；主线权重会影响字数预算与密度校验。" busy={busy} error={error} disabled={busy} onClose={onClose}
    onSubmit={() => void save(base === null ? `作者新增情节线「${label}」` : `作者修改情节线「${label}」`, { plotLines: [plotLineInput({ id, label, weight: weight as Weight })] })}>
    <div className="prep-grid">
      <Field label="编号"><Input value={id} disabled={base !== null} onChange={(e) => setId(e.target.value)} placeholder="P_MainLine" /></Field>
      <Field label="名称"><Input value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <Field label="权重"><Select value={weight} onChange={setWeight} options={options(WEIGHTS)} /></Field>
    </div>
  </Frame>;
}

// ── 卷 ──────────────────────────────────────────────────────────────────

/**
 * 卷名与卷纲。
 *
 * 这里**不问章号**：哪几章属于这一卷由章节计划的卷号决定，那是唯一的一份边界。
 * 所以表单里给出当前推出来的范围供核对，但它是只读的。
 *
 * 卷纲不是装饰 —— 远距离的逐章梗概会被它整段顶替。章数一多，那一段本来是按每 15 章
 * 一桶原样堆着的，卷纲是唯一真正把它压下去的东西。
 */
export function VolumeEditor({ base, volume, span, written, fingerprint, onSaved, onClose }: {
  base: VolumeInput | null; volume: number; span: { from: number; to: number } | null; written: boolean;
  fingerprint: string; onSaved: (proposal: PreparationProposal) => void; onClose: () => void;
}): React.ReactElement {
  const seed = base ?? emptyVolume(volume);
  const [title, setTitle] = useState(seed.title);
  const [summary, setSummary] = useState(seed.summary);
  const { busy, error, save } = useSave(fingerprint, onSaved);
  const range = span === null ? "还没有章节排进这一卷" : span.from === span.to ? `第 ${span.from} 章` : `第 ${span.from}–${span.to} 章`;
  return <Frame title={base === null ? `新增卷 ${volume}` : `编辑卷 ${volume}`}
    {...(base === null ? {} : { remove: { label: `删除卷 ${volume} 的卷名与卷纲`, note: "只去掉这张卡片；哪几章属于这一卷由章节自己的卷号决定，不受影响。", onConfirm: () => void save(`作者删除卷 ${volume} 的卷名与卷纲`, { removals: { volumes: [volume] } }) } })}
    hint="卷纲只写这一卷已经写完的内容。它会顶替这几章的逐章梗概进入模型上下文 —— 写得含糊，后面的章就看不清前面发生过什么。"
    busy={busy} error={error} disabled={busy} onClose={onClose}
    onSubmit={() => void save(base === null ? `作者新增卷 ${volume}「${title}」` : `作者修改卷 ${volume}「${title}」`, { volumes: [volumeInput({ volume, title, summary })] })}>
    <div className="prep-grid">
      <Field label="卷号"><InputNumber value={volume} disabled /></Field>
      <Field label="卷名"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="风起青州" /></Field>
    </div>
    <Field label="覆盖章节（由章节计划的卷号决定，改卷界请去改那几章的计划）" wide><Input value={range} disabled /></Field>
    <Field label="卷纲（一到三句，写这一卷实际发生了什么）" wide>
      <Input.TextArea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)}
        placeholder="被逐出师门到查明师父死于内应之手。" />
    </Field>
    {!written && summary.trim() !== "" && <p className="finding" data-level="warn">这一卷还没有写完的章节。卷纲只写已经发生的事 —— 现在保存会被退回。</p>}
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
    {...(base === null ? {} : { remove: { label: `删除第 ${base.chapter} 章计划`, note: "已经写出正文的章节不能删掉计划 —— 那是这一章的依据。", onConfirm: () => void save(`作者删除第 ${base.chapter} 章计划`, { removals: { beats: [base.chapter] } }) } })}
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
