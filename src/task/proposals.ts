/** C4 建议的受控预览与选择；这里不写正式资料，也不把未来安排当成已发生事实。 */
import type { ChapterDraft, DraftProposal, DraftProposalOption } from "./types.js";
import type { CharacterCard, CharacterProfile, SpeechProfile } from "../types/character.js";
import type { AppendInput } from "../store/event-stream.js";
import { ChapterWriteError, foreshadowAllocator, type ChapterSource } from "../server/chapter-input.js";
import { validateCharacterInput } from "../preparation/schema.js";

type Card = Omit<CharacterCard, "state">;
const profileText = ["role", "wants", "fears", "background"] as const;
const profileLists = ["traits", "forbiddenBehaviors"] as const;
const speechText = ["register", "emotionalExpression"] as const;
const speechJson = ["sentenceLength", "verbalTics", "signatureLexicon", "forbiddenLexicon", "addressForms", "syntaxBias", "exemplars", "counterExemplars"] as const;
const fieldNames: Readonly<Record<string, string>> = { "profile.role": "人物定位", "profile.wants": "目标", "profile.fears": "恐惧", "profile.background": "背景", "profile.traits": "性格", "profile.forbiddenBehaviors": "行为约束", "speech.sentenceLength": "台词句长", "speech.verbalTics": "口头习惯", "speech.signatureLexicon": "专属用词", "speech.forbiddenLexicon": "禁用词", "speech.addressForms": "称谓", "speech.syntaxBias": "句式偏好", "speech.register": "语言风格", "speech.emotionalExpression": "情绪表达", "speech.exemplars": "台词正例", "speech.counterExemplars": "台词反例" };
const display = (value: unknown): string | null => value === undefined || value === null ? null : typeof value === "string" ? value : JSON.stringify(value);
function fail(message: string): never { throw new ChapterWriteError(400, message); }
const required = (value: unknown, field: string): string => typeof value === "string" && value.trim() ? value.trim() : fail(`${field} 不能为空`);

export function selectedProposalIndices(raw: unknown, count: number): readonly number[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw) || raw.some(index => !Number.isSafeInteger(index) || index < 0 || index >= count)) fail("selectedProposals 必须是本稿有效建议的索引数组");
  const indices = raw as number[];
  if (new Set(indices).size !== indices.length) fail("同一条建议不能重复选择");
  return [...indices].sort((a, b) => a - b);
}

function changeCharacter(proposal: Extract<DraftProposal, { kind: "character_update" }>, cards: readonly Card[], chapter: number, now: string) {
  const name = required(proposal.name, "人物姓名");
  const matches = cards.filter(c => (c.id === name || c.name === name || c.aliases.includes(name)) && (c.provenance === "committed" || c.provenance === "authored"));
  if (matches.length !== 1) fail(matches.length === 0 ? `人物「${name}」不存在或未确认` : `人物「${name}」不能唯一定位，请明确人物编号`);
  const before = matches[0]!;
  const field = required(proposal.field, "资料字段");
  const value = required(proposal.value, "建议新值");
  required(proposal.reason, "修改原因");
  let from: unknown;
  let profile = before.profile;
  let speech = before.speech;
  if (field.startsWith("profile.appearance.")) {
    const key = field.slice("profile.appearance.".length);
    if (!key.trim() || key.includes(".") || ["__proto__", "constructor", "prototype"].includes(key)) fail("外貌属性名无效");
    const existing = profile.appearance.filter(item => item.key === key);
    if (existing.length > 1) fail(`外貌属性「${key}」存在重复记录，请先整理资料`);
    const attribute = existing[0];
    if (attribute?.immutable && attribute.value !== value) fail(`不可变属性「${key}」已是「${attribute.value}」，需先核对已有正文，不能随本章覆盖`);
    from = attribute?.value;
    const updated = attribute === undefined ? { key, value, establishedAt: chapter, immutable: true } : { ...attribute, value };
    profile = { ...profile, appearance: attribute === undefined ? [...profile.appearance, updated] : profile.appearance.map(item => item.key === key ? updated : item) };
  } else {
    const [section, key, extra] = field.split(".");
    if (extra !== undefined || key === undefined) fail("只支持明确的人物 profile / speech 资料字段");
    let parsed: unknown = value;
    const isProfileText = section === "profile" && (profileText as readonly string[]).includes(key);
    const isProfileList = section === "profile" && (profileLists as readonly string[]).includes(key);
    const isSpeechText = section === "speech" && (speechText as readonly string[]).includes(key);
    const isSpeechJson = section === "speech" && (speechJson as readonly string[]).includes(key);
    if (!isProfileText && !isProfileList && !isSpeechText && !isSpeechJson) fail(`不能通过资料建议修改 ${field}；身份编号、姓名和派生状态需走相应流程`);
    if (isProfileList || isSpeechJson) {
      try { parsed = JSON.parse(value); } catch { fail(`${field} 需要有效的 JSON 列表或对象`); }
    }
    if (section === "profile") {
      from = profile[key as keyof CharacterProfile];
      profile = { ...profile, [key]: parsed } as CharacterProfile;
    } else {
      from = speech[key as keyof SpeechProfile];
      speech = { ...speech, [key]: parsed } as SpeechProfile;
    }
  }
  const card: Card = { ...before, profile, speech, provenance: "committed", updatedAt: now };
  const { provenance: _p, updatedAt: _u, introducedAt: _i, ...input } = card;
  validateCharacterInput(input);
  if (speech.sentenceLength.min > speech.sentenceLength.max) fail("台词句长区间无效");
  for (const address of speech.addressForms) if (address.target !== null && !cards.some(c => c.id === address.target)) fail(`称谓引用了不存在的人物 ${address.target}`);
  return { card, from: display(from), to: value, key: `${card.id}/${field}` };
}

function validateForeshadow(proposal: Extract<DraftProposal, { kind: "foreshadow" }>, chapter: number, source: ChapterSource): void {
  const label = required(proposal.label, "伏笔标签");
  required(proposal.intent, "伏笔意图");
  if (!["main", "sub", "detail"].includes(proposal.weight)) fail("伏笔权重必须是 main/sub/detail");
  if (!Number.isSafeInteger(proposal.expectedBy) || proposal.expectedBy <= chapter) fail("本章之外的伏笔规划必须指定未来的章号");
  if (source.events().some(event => (event.envelope.provenance === "committed" || event.envelope.provenance === "authored") && event.payload.type === "foreshadow_planted" && event.payload.label === label)) fail(`「${label}」已有记录，请修改原规划，避免重复创建`);
}

export function previewDraftProposals(draft: ChapterDraft, source: ChapterSource): readonly DraftProposalOption[] {
  if (draft.proposalAdoption !== undefined) return draft.proposalAdoption.options;
  return draft.proposals.map((proposal, index) => {
    const option: DraftProposalOption = {
      index, kind: proposal.kind, title: proposal.kind === "character_update" ? `${proposal.name} · ${fieldNames[proposal.field] ?? (proposal.field.startsWith("profile.appearance.") ? proposal.field.slice("profile.appearance.".length) : "资料修改")}` : `未来伏笔 · ${proposal.label}`,
      from: null, to: proposal.kind === "character_update" ? proposal.value : `${proposal.intent}（预期第 ${proposal.expectedBy} 章前兑现）`,
      reason: proposal.kind === "character_update" ? proposal.reason : "只确认未来规划，尚未写成正文。",
      available: true, problem: null, status: draft.status === "adopted" ? "not_selected" : "suggested",
    };
    try {
      if (proposal.kind === "character_update") return { ...option, ...pickDisplay(changeCharacter(proposal, source.meta.characters, draft.chapter, draft.updatedAt)) };
      if (draft.declaration?.foreshadowPlanted.some(item => item.label === proposal.label.trim())) fail("本稿已经声明埋设这条伏笔，采用结构记录即可，不应另建未来规划");
      validateForeshadow(proposal, draft.chapter, source);
      return option;
    } catch (error) {
      if (!(error instanceof ChapterWriteError)) throw error;
      return { ...option, available: false, problem: error.message };
    }
  });
}

function pickDisplay(change: { from: string | null; to: string }): Pick<DraftProposalOption, "from" | "to"> {
  return { from: change.from, to: change.to };
}

export function prepareDraftProposals(draft: ChapterDraft, source: ChapterSource, selected: readonly number[], now: string) {
  let characters = source.meta.characters;
  const options = previewDraftProposals(draft, source).map(option => ({ ...option, status: selected.includes(option.index) ? "applied" as const : "not_selected" as const }));
  const planned: AppendInput[] = [];
  const changed = new Set<string>();
  const allocate = foreshadowAllocator(source);
  for (const index of selected) {
    const option = options[index]!;
    if (!option.available) fail(option.problem ?? "此建议暂不能应用");
    const proposal = draft.proposals[index]!;
    if (proposal.kind === "character_update") {
      const update = changeCharacter(proposal, characters, draft.chapter, now);
      if (changed.has(update.key)) fail("多条建议修改同一人物字段，请明确选择其中一条");
      changed.add(update.key);
      characters = characters.map(c => c.id === update.card.id ? update.card : c);
    } else {
      if (planned.some(e => e.payload.type === "foreshadow_planted" && e.payload.label === proposal.label.trim())) fail("不能同时接受同名的重复伏笔建议");
      const id = allocate();
      options[index] = { ...option, foreshadowId: id };
      planned.push({ chapter: draft.chapter, origin: "P4_outline", provenance: "authored", payload: {
        type: "foreshadow_planted", foreshadowId: id, label: proposal.label.trim(), intent: proposal.intent.trim(),
        weight: proposal.weight, visibility: "covert", expectedBy: proposal.expectedBy,
        // 规划没有正文依据；视图不得将这个占位显示为已埋设原文。
        anchor: { chapter: draft.chapter, quote: "", offsetHint: -1, occurrence: 0 },
      } });
    }
  }
  return { characters, planned, options };
}
