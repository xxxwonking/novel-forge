/**
 * 语义审查（model 通道）：POV 越界与伏笔兑现。
 *
 * 为什么必须有这一层：C6 至今只判机械项 —— 引文定位、权重、密度、句长、标点。
 * 《雾港封签》真实验收里人工发现的三处问题，C6 一处都没抓到，其中两处归这里：
 * 「结尾离开视角人物后仍描述库内」（POV 越界）与「声明已收的伏笔其实没交代清楚」。
 *
 * 两项都问**针对本章正文的具体问题**，不是开放式评论 —— 判据越具体，模型越难
 * 用一段泛泛的话糊过去，作者也越容易核对。这是与 voice 通道同一条道理。
 *
 * 与 `voice-model.ts` 共享同一套纪律：纯解析不碰 client、引文必须真实存在于正文、
 * 降级为 info 而不是失败。**等级一律 warn**：这是模型判断而非机械事实，做成 block
 * 等于让第二个模型的意见否决作者的采用权（§10.10）。
 */

import type { GateFinding } from "../types/beat.js";
import type { VoiceCharacter } from "./voice-channel.js";

/** 本章声明收束的一条伏笔：判定要它的意图与声明引文。 */
export interface ResolutionUnderReview {
  readonly foreshadowId: string;
  readonly label: string;
  /** 当初埋下时写明的意图。判定「有没有真交代」的基准。 */
  readonly intent: string;
  /** C5 声明里指向正文的那段引文。 */
  readonly quote: string;
}

/**
 * 判动机要用的基准。**只取作者明确写下的东西** —— `forbiddenBehaviors` 是
 * 「绝不主动求人」这类硬约束，比正面标签可判得多；wants/fears 提供动机方向。
 */
export interface MotivationBaseline {
  readonly id: string;
  readonly name: string;
  readonly forbiddenBehaviors: readonly string[];
  readonly wants: string;
  readonly fears: string;
}

/**
 * 检查链实际拿到的人物卡：声音通道只要 `speech`，动机判定还要 `profile`。
 * `buildChapterRunInput` 传进来的本来就是完整卡，这里只是把类型说全。
 */
export interface ReviewCharacter extends VoiceCharacter {
  readonly profile?: {
    readonly forbiddenBehaviors: readonly string[];
    readonly wants: string;
    readonly fears: string;
  };
}

/** 判矛盾要用的既定事实：地点/组织的 facts、世界规则、能力限制、不可变外貌。 */
export interface CanonFact {
  /** 这条事实的出处，进提示也进消息，让作者知道是跟什么矛盾了。 */
  readonly source: string;
  readonly fact: string;
}

export interface SemanticTaskInput {
  readonly chapterText: string;
  /** 声明的视角人物。为空则本次不判 POV（没有基准就无从判越界）。 */
  readonly pov: { readonly id: string; readonly name: string } | null;
  readonly resolutions: readonly ResolutionUnderReview[];
  readonly characters: readonly MotivationBaseline[];
  readonly canon: readonly CanonFact[];
}

/** 给模型的输出契约。`quote` 必填 —— 没有引文就无法核对，判定不该成立。 */
export const SEMANTIC_VERDICT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    issues: {
      type: "array",
      description: "只报确实有问题的项；没有问题时返回空数组",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          kind: { type: "string", enum: ["pov", "resolution", "motivation", "contradiction"] },
          foreshadowId: { type: "string", description: "kind 为 resolution 时必填，逐字复制给出的编号；否则留空字符串" },
          characterId: { type: "string", description: "kind 为 motivation 时必填，逐字复制人物编号；否则留空字符串" },
          quote: { type: "string", description: "问题所在的原文片段，必须逐字复制自本章正文，连续且不改写" },
          reason: { type: "string", description: "说明这里为什么越界或为什么没有真正兑现" },
        },
        required: ["kind", "foreshadowId", "characterId", "quote", "reason"],
      },
    },
  },
  required: ["issues"],
} as const;

/**
 * 拼判定任务。
 *
 * 正文放在最后、独占一段：它最长，也最需要模型逐字对着看，不该被指令夹在中间。
 */
export function buildSemanticTask(input: SemanticTaskInput): string {
  const sections = [
    "以下是本章正文。核对下面两组问题，只报确实有问题的项。",
    "",
    "【判定一：视角越界】",
    input.pov === null
      ? "本章没有声明视角人物，这一项跳过，不要产出 kind 为 pov 的记录。"
      : `本章的视角人物是「${input.pov.name}」（编号 ${input.pov.id}）。正文里出现任何他看不到、听不到、想不到的内容，都属于越界：别人的内心活动、他不在场的场景、他无从得知的信息。他的推测与疑问不算越界，只要正文明确写成他的推测即可。`,
    "",
    "【判定二：伏笔兑现】",
    input.resolutions.length === 0
      ? "本章没有声明收束任何伏笔，这一项跳过，不要产出 kind 为 resolution 的记录。"
      : [
          "本章声明收束了以下伏笔。逐条核对正文是否真的交代了当初埋下的意图 —— 只提一嘴、答非所问、或绕过去都算没有兑现。",
          ...input.resolutions.map((item) =>
            `- ${item.foreshadowId}「${item.label}」：当初的意图是「${item.intent}」。声明指认的正文是「${item.quote}」`),
        ].join("\n"),
    "",
    "【判定三：人物动机】",
    input.characters.length === 0
      ? "本章没有给出人物的动机基准，这一项跳过，不要产出 kind 为 motivation 的记录。"
      : [
          "逐人核对本章行为是否与他自己的设定冲突 —— 尤其是「绝不做的事」，那是作者写死的硬约束。",
          ...input.characters.map((item) => {
            const forbidden = item.forbiddenBehaviors.length === 0 ? "（未指定）" : item.forbiddenBehaviors.join("、");
            return `- ${item.id}「${item.name}」：绝不做的事＝${forbidden}；想要＝${item.wants || "（未指定）"}；害怕＝${item.fears || "（未指定）"}`;
          }),
          "只报有正文支撑的违反。人物在压力下改变做法本身不是问题，除非它明确撞上「绝不做的事」或与他的核心诉求相悖且正文没有交代理由。",
        ].join("\n"),
    "",
    "【判定四：与已确认设定矛盾】",
    input.canon.length === 0
      ? "本章没有给出可比对的既定事实，这一项跳过，不要产出 kind 为 contradiction 的记录。"
      : [
          "正文有没有写出与下列既定事实相抵触的内容？",
          ...input.canon.map((item) => `- 【${item.source}】${item.fact}`),
          "只报直接抵触。正文没提到的事实不算矛盾；人物说错话、记错事，如果正文明确写成他的主观判断，也不算。",
        ].join("\n"),
    "",
    "【要求】",
    "- quote 必须逐字复制自本章正文的连续片段，保留标点，不要改写、不要拼接。核对不上就等于没有依据。",
    "- 只报有把握的问题。拿不准就不要报 —— 误报会让作者去改本来没问题的段落。",
    "",
    "【本章正文】",
    input.chapterText,
  ];
  return sections.join("\n");
}

const KINDS = ["pov", "resolution", "motivation", "contradiction"] as const;
type IssueKind = (typeof KINDS)[number];

interface RawIssue {
  readonly kind: IssueKind;
  readonly foreshadowId: string;
  readonly characterId: string;
  readonly quote: string;
  readonly reason: string;
}

function readIssues(json: unknown): readonly RawIssue[] | null {
  if (typeof json !== "object" || json === null || Array.isArray(json)) return null;
  const raw = (json as Record<string, unknown>)["issues"];
  if (!Array.isArray(raw)) return null;
  const out: RawIssue[] = [];
  const text = (record: Record<string, unknown>, key: string): string =>
    typeof record[key] === "string" ? (record[key] as string).trim() : "";
  for (const item of raw) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    const kind = KINDS.find((candidate) => candidate === record["kind"]);
    if (kind === undefined) continue;
    out.push({
      kind,
      foreshadowId: text(record, "foreshadowId"),
      characterId: text(record, "characterId"),
      quote: text(record, "quote"),
      reason: text(record, "reason"),
    });
  }
  return out;
}

/**
 * 判定 → findings。
 *
 * 每条都要过三关：**这一项本章判得了吗**（有没有视角人物／有没有基准）、
 * **指认的对象存在吗**（伏笔编号、人物编号必须在本次给出的范围里）、
 * **引文能在正文里找到吗**。任何一关不过就丢，丢了几条要说出来 ——
 * 静默少报比多报一条更危险。
 */
export function parseSemanticVerdict(
  json: unknown,
  context: {
    readonly chapterText: string;
    readonly povCharacterId: string | null;
    readonly resolutions: readonly { readonly foreshadowId: string; readonly label: string }[];
    readonly characters?: readonly { readonly id: string; readonly name: string; readonly forbiddenBehaviors?: readonly string[] }[];
    readonly canon?: readonly CanonFact[];
  },
): readonly GateFinding[] {
  const issues = readIssues(json);
  if (issues === null) {
    return [{
      rule: "semantic_verdict_unusable",
      level: "info",
      message: "模型没有按约定格式给出语义核对结果，这几项本轮未查。正文与其余检查不受影响。",
    }];
  }

  const resolutionById = new Map(context.resolutions.map((item) => [item.foreshadowId, item.label]));
  const characterById = new Map((context.characters ?? []).map((item) => [item.id, item]));
  const hasCanon = (context.canon ?? []).length > 0;
  const findings: GateFinding[] = [];
  const dropped: string[] = [];
  let dropAt = -1;
  const drop = (what: string): void => {
    if (dropAt === -1) dropAt = findings.length;
    dropped.push(what);
  };
  const because = (reason: string, fallback: string): string => reason === "" ? fallback : reason;

  for (const issue of issues) {
    // 引用不能核对 → 一律丢弃，不管这一项本身判得通不通。
    const unverifiable = issue.quote === "" || !context.chapterText.includes(issue.quote);

    if (issue.kind === "pov") {
      if (context.povCharacterId === null) continue;
      if (unverifiable) { drop("视角越界"); continue; }
      findings.push({
        rule: "semantic_pov_breach",
        level: "warn",
        message: `正文越出了视角人物的感知范围：${because(issue.reason, "写了视角人物感知不到的内容")}（原文「${issue.quote}」）`,
      });
      continue;
    }

    if (issue.kind === "motivation") {
      const character = characterById.get(issue.characterId);
      if (character === undefined) continue;
      if (unverifiable) { drop(`「${character.name}」的动机`); continue; }
      const forbidden = character.forbiddenBehaviors ?? [];
      const against = forbidden.length === 0 ? "" : `他的设定里写明：${forbidden.join("、")}。`;
      findings.push({
        rule: "semantic_motivation_break",
        level: "warn",
        message: `「${character.name}」的行为与他自己的设定冲突：${because(issue.reason, "正文里的做法与他的设定相悖")}${against === "" ? "" : ` ${against}`}（原文「${issue.quote}」）`,
      });
      continue;
    }

    if (issue.kind === "contradiction") {
      if (!hasCanon) continue;
      if (unverifiable) { drop("设定矛盾"); continue; }
      findings.push({
        rule: "semantic_setting_contradiction",
        level: "warn",
        message: `正文与已确认的设定相抵触：${because(issue.reason, "与既定事实冲突")}（原文「${issue.quote}」）`,
      });
      continue;
    }

    const label = resolutionById.get(issue.foreshadowId);
    if (label === undefined) continue;
    if (unverifiable) { drop(`伏笔「${label}」的兑现`); continue; }
    findings.push({
      rule: "semantic_resolution_unfulfilled",
      level: "warn",
      message: `本章声明收束了伏笔「${label}」，但正文没有真正交代它：${because(issue.reason, "正文明细不足")}（原文「${issue.quote}」）`,
    });
  }

  if (dropped.length > 0) {
    findings.splice(dropAt, 0, {
      rule: "semantic_verdict_unverifiable",
      level: "info",
      message: `模型给出 ${dropped.length} 条判定（${dropped.join("、")}），但它引用的原文在本章正文里找不到，这些判定已丢弃。要看这一项，请人工核对对应段落。`,
    });
  }
  return findings;
}
