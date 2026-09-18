/**
 * 段 3：L3 按需详情的选择与渲染（§13.5）。
 *
 * 三段式来源（§5.2）：
 *   ① 显式声明 —— 节拍表点名的人物/地点，最可靠，绝大多数情况这步就够
 *   ② 前情衔接 —— 跨卷时的上卷梗概（上一章全文在段 4）
 *   ③ 关联召回 —— 本章要收伏笔的**埋设处原文**
 *
 * 第 ③ 条容易漏但重要：要收一条 47 章前埋的伏笔，模型得看到当时怎么写的，
 * 否则收束会和埋设脱节。
 */

import type { CharacterCard, SpeechProfile } from "../types/character.js";
import type { ChapterBeat } from "../types/beat.js";
import type { ForeshadowId, SettingId, TextAnchor } from "../types/primitives.js";
import type { VolumeBoundary } from "../types/l2.js";

/** 地点/组织设定。L3 的另一类内容。 */
export interface SettingCard {
  readonly id: SettingId;
  readonly name: string;
  readonly kind: "location" | "organization";
  readonly description: string;
  readonly facts: readonly string[];
}

/** 伏笔埋设处的原文片段。§13.5 只需 ±200 字。 */
export interface PlantedExcerpt {
  readonly foreshadowId: ForeshadowId;
  readonly label: string;
  readonly anchor: TextAnchor;
  readonly excerpt: string;
}

export interface L3Input {
  readonly beat: ChapterBeat;
  /** 已按节拍表点名筛出的人物卡。顺序由调用方保证与 beat.plan.characters 一致。 */
  readonly characters: readonly CharacterCard[];
  readonly settings: readonly SettingCard[];
  /** 跨卷第一章才有值。 */
  readonly volumeBoundary: VolumeBoundary | null;
  readonly plantedExcerpts: readonly PlantedExcerpt[];
}

/** §13.1 段 3 预算。 */
export const L3_TOKEN_BUDGET = 5000;

/** §13.5 超预算裁剪的五级顺序。 */
export type TrimStage =
  | "none"
  | "minor_cards_to_index"
  | "settings_to_primary"
  | "excerpt_shorten"
  | "major_cards_compress"
  | "overflow";

export interface L3Selection {
  readonly characters: readonly RenderedCharacter[];
  readonly settings: readonly SettingCard[];
  readonly volumeBoundary: VolumeBoundary | null;
  readonly plantedExcerpts: readonly PlantedExcerpt[];
  readonly trimStage: TrimStage;
  /** trimStage 为 overflow 时非空 —— 节拍表点了太多人物，建议拆章。 */
  readonly overflowNote: string | null;
}

/** 人物卡的两种渲染档：完整 / 压缩。压缩版去外貌背景，保留说话方式与当前状态。 */
export interface RenderedCharacter {
  readonly card: CharacterCard;
  readonly mode: "full" | "compressed" | "index_line";
}

/** token 估算系数：中文按 1 字 ≈ 0.6 token，ASCII 按 4 字符 ≈ 1 token。估算法用，不是产品阈值。 */
const CJK_TOKENS_PER_CHAR = 0.6;

/** 预算溢出降级时，给埋设片段留的字符数上限。 */
const EXCERPT_MAX_CHARS = 80;

/** 粗略 token 估算。 */
export function estimateTokens(text: string): number {
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (ch.charCodeAt(0) > 0x2e7f) cjk += 1;
    else other += 1;
  }
  return Math.ceil(cjk * CJK_TOKENS_PER_CHAR + other / 4);
}

/**
 * L3 选择 + 逐级裁剪（§13.5）。
 *
 * **「说话方式」字段永不裁剪** —— 它是 C6 声音一致性检查的依据，
 * 裁掉 C6 就查不了。所以压缩档去的是外貌与背景，不是 speech。
 */
export function selectL3(input: L3Input, budget = L3_TOKEN_BUDGET): L3Selection {
  const stages: TrimStage[] = [
    "none",
    "minor_cards_to_index",
    "settings_to_primary",
    "excerpt_shorten",
    "major_cards_compress",
  ];

  let last: L3Selection | null = null;
  for (const stage of stages) {
    const candidate = applyTrim(input, stage);
    last = candidate;
    if (estimateTokens(renderL3(candidate)) <= budget) return candidate;
  }

  const base = last ?? applyTrim(input, "major_cards_compress");
  return {
    ...base,
    trimStage: "overflow",
    overflowNote: `本章点名 ${input.characters.length} 位人物、${input.settings.length} 个场景，压缩后仍超出 L3 预算，建议拆章或减少出场人物。`,
  };
}

function applyTrim(input: L3Input, stage: TrimStage): L3Selection {
  const isMajor = (c: CharacterCard): boolean =>
    c.tier === "protagonist" || c.tier === "major";

  const characters = input.characters.map<RenderedCharacter>((card) => {
    if (stage === "none") return { card, mode: "full" };
    if (stage === "minor_cards_to_index" || stage === "settings_to_primary" || stage === "excerpt_shorten") {
      return { card, mode: isMajor(card) ? "full" : "index_line" };
    }
    return { card, mode: isMajor(card) ? "compressed" : "index_line" };
  });

  const settings =
    stage === "none" || stage === "minor_cards_to_index"
      ? input.settings
      : input.settings.slice(0, 1);

  const plantedExcerpts =
    stage === "none" || stage === "minor_cards_to_index" || stage === "settings_to_primary"
      ? input.plantedExcerpts
      : input.plantedExcerpts.map((p) => ({ ...p, excerpt: truncate(p.excerpt, EXCERPT_MAX_CHARS) }));

  return {
    characters,
    settings,
    volumeBoundary: input.volumeBoundary,
    plantedExcerpts,
    trimStage: stage,
    overflowNote: null,
  };
}

function truncate(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars)}…`;
}

// ── 渲染 ────────────────────────────────────────────────────────────────

function renderSpeech(s: SpeechProfile): string {
  const lines = [
    `  句长：${s.sentenceLength.min}-${s.sentenceLength.max} 字`,
    `  语域：${s.register}｜情绪表达：${s.emotionalExpression}`,
  ];
  if (s.verbalTics.length > 0) lines.push(`  口头习惯：${s.verbalTics.join("、")}`);
  if (s.signatureLexicon.length > 0) lines.push(`  专属词汇：${s.signatureLexicon.join("、")}`);
  if (s.forbiddenLexicon.length > 0) lines.push(`  禁用词：${s.forbiddenLexicon.join("、")}`);
  if (s.addressForms.length > 0) {
    const forms = s.addressForms.map((a) =>
      a.condition === undefined ? a.form : `${a.form}（${a.condition}）`,
    );
    lines.push(`  称谓：${forms.join("、")}`);
  }
  for (const ex of s.exemplars) lines.push(`  例句：「${ex}」`);
  for (const ex of s.counterExemplars) lines.push(`  反例（不要这样写）：「${ex}」`);
  return lines.join("\n");
}

function renderCharacter(r: RenderedCharacter): string {
  const c = r.card;
  if (r.mode === "index_line") {
    return `${c.name}｜${c.profile.role}｜${c.state.condition}`;
  }

  const lines = [`### ${c.name}（${c.profile.role}）`];
  if (c.aliases.length > 0) lines.push(`别名：${c.aliases.join("、")}`);
  lines.push(`当前状态：${c.state.condition}`);
  lines.push(`性格：${c.profile.traits.join("、")}`);
  if (c.profile.forbiddenBehaviors.length > 0) {
    lines.push(`禁止行为：${c.profile.forbiddenBehaviors.join("；")}`);
  }
  lines.push(`表层诉求：${c.profile.wants}`);
  lines.push(`深层恐惧：${c.profile.fears}`);

  // 完整档才带外貌与背景；压缩档去掉它们，但 speech 一律保留。
  if (r.mode === "full") {
    if (c.profile.appearance.length > 0) {
      const attrs = c.profile.appearance.map((a) => `${a.key}=${a.value}`);
      lines.push(`外貌：${attrs.join("、")}`);
    }
    if (c.profile.background !== "") lines.push(`背景：${c.profile.background}`);
  }

  lines.push("说话方式：");
  lines.push(renderSpeech(c.speech));
  return lines.join("\n");
}

function renderSetting(s: SettingCard): string {
  const kind = s.kind === "location" ? "地点" : "组织";
  const lines = [`### ${s.name}（${kind}）`, s.description];
  for (const f of s.facts) lines.push(`- ${f}`);
  return lines.join("\n");
}

/** 渲染 L3。段内顺序固定：人物 → 场景 → 卷衔接 → 伏笔埋设处。 */
export function renderL3(sel: L3Selection): string {
  const lines: string[] = [];

  const full = sel.characters.filter((c) => c.mode !== "index_line");
  const brief = sel.characters.filter((c) => c.mode === "index_line");

  if (full.length > 0) {
    lines.push("## 本章人物");
    for (const c of full) lines.push(renderCharacter(c));
  }
  if (brief.length > 0) {
    lines.push("");
    lines.push("## 本章次要人物");
    for (const c of brief) lines.push(renderCharacter(c));
  }
  if (sel.settings.length > 0) {
    lines.push("");
    lines.push("## 本章场景");
    for (const s of sel.settings) lines.push(renderSetting(s));
  }
  if (sel.volumeBoundary !== null) {
    lines.push("");
    lines.push("## 上卷衔接");
    lines.push(sel.volumeBoundary.summary);
    lines.push(`卷末状态：${sel.volumeBoundary.endState}`);
  }
  if (sel.plantedExcerpts.length > 0) {
    lines.push("");
    lines.push("## 要收伏笔的埋设原文");
    for (const p of sel.plantedExcerpts) {
      lines.push(`【${p.label}】ch${p.anchor.chapter}：${p.excerpt}`);
    }
  }

  return lines.join("\n");
}
