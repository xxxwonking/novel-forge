/**
 * 章循环 C4 → C5 → C8（§12.3）。
 *
 * 两个关键设计点：
 *
 * ① **C5 是同会话第二轮，不是独立调用。** 把 C4 的响应原样追加回 messages
 *    后再问结构声明 —— 缓存全命中（输入几乎免费），且模型埋伏笔的意图还在
 *    上下文里。事后抽取拿不到意图，只能猜，退回过度抽取的老问题。
 *
 * ② **C8 之前一切都是 proposed。** 用户接受才 committed，投影才更新。
 */

import type Anthropic from "@anthropic-ai/sdk";
import { ClaudeClient, type CallResult } from "../client/claude.js";
import { assemble, type AssembleInput } from "../context/assemble.js";
import { C5_OUTPUT_SCHEMA, parseC5, type ParseContext, type ParseResult } from "./c5-schema.js";
import { c5OutputIssue } from "./c5-validation.js";
import { checkPromisedResolutions, crossCheckC5 } from "./c5-crosscheck.js";
import { recordCacheMetrics, type CacheRecord } from "../metrics/cache.js";
import { commitDeclaration, EventStream } from "../store/event-stream.js";
import { gateChapter, type ChapterGateResult } from "../gate/code-channel.js";
import type { CanonFact, ReviewCharacter } from "../gate/semantics-channel.js";
import { canAccept, routeChapter, unresolvedFromFindings, type RouteResult } from "../gate/route.js";
import type { ReviewRules, Rules } from "../rules/schema.js";
import type { GateFinding, WorkProfile } from "../types/beat.js";
import type { StructuralEvent } from "../types/events.js";
import type { ChapterNo } from "../types/primitives.js";

/** C4 的任务指令。分场展开时每场一次调用；这里给整章版本。 */
export const C4_TASK = [
  "写出本章正文。要求：",
  "1. 严格遵守上面的写作纪律与本章节拍。",
  "2. 字数落在预算区间内，向甜点值靠。不要为了凑字数加环境描写或心理活动。",
  "3. 要收的伏笔必须在本章兑现其埋设意图，并与埋设处的写法呼应。",
  "4. 暗线伏笔不要点明。",
  "5. 只输出正文，不要任何说明、标题或分析。",
].join("\n");

/** C5 的任务指令。作为第二轮 user message 追加。 */
export const C5_TASK = [
  "现在为刚写完的这一章做结构声明。",
  "",
  "事件的判定标准：一个事件 = 造成不可逆状态变化的一次动作或信息披露。",
  "对每个候选事件问一遍：把这段删掉，后面的章节需要改吗？不需要改就不是事件，不要声明。",
  "内心活动、反应、氛围、铺垫、未产生信息的试探一律不算。每章通常 1-3 个。",
  "超过 4 个先检查是不是把描写当成了事件。",
  "",
  "伏笔声明要求：intent 必须写清这条伏笔将来要兑现什么，这决定了什么算「收」。",
  "expected_by 必须是未来的章号。宁可少报不要多报。",
  "",
  "每条声明的 quote 必须从本章正文逐字复制一个连续片段，8-40 字，用于定位。保留原标点，不改写、不拼接不同位置的句子。",
].join("\n");

/**
 * 引用 ID 与字段范围随作品传入，避免模型把人名或未支持字段当作结构记录。
 *
 * 单独导出是因为旧稿反推（`src/import/infer.ts`）与 C5 共用同一套 ID 约束 ——
 * 两处各写一份，改了人物 ID 规则只改一处就会静默分歧。
 */
export function idConstraints(context: Omit<ParseContext, "chapterText">): readonly string[] {
  return [
    `人物引用必须使用这些 ID，不能填写姓名：${JSON.stringify([...context.knownCharacters])}`,
    `情节线引用只能使用这些 ID 或 null：${JSON.stringify([...context.knownPlotLines])}`,
    ...(context.knownSettings === undefined ? [] : [`地点 ID：${JSON.stringify([...context.knownSettings])}`]),
    "character_states 的 field 只支持 condition、location、vital。持有物或处境变化写在 condition 的完整现状中；location 的 from/to 用地点 ID；vital 的值只用 alive/dead/missing/unknown；无原值用 null。",
  ];
}

export function buildC5Task(context: Omit<ParseContext, "chapterText">): string {
  return [C5_TASK, ...idConstraints(context)].join("\n");
}

export interface ChapterRunInput {
  readonly chapter: ChapterNo;
  readonly assembleInput: AssembleInput;
  readonly parseContextBase: Omit<ParseContext, "chapterText">;
  /** 节拍表承诺要收的伏笔，用于 C7 收束完整性校验。 */
  readonly promisedResolutions: readonly {
    readonly foreshadowId: string;
    readonly completeness: "full" | "partial";
  }[];
  readonly maxOutputTokens?: number;
  /**
   * 收束补写的字数区间（`rules.resolutionPatchWords`）。
   *
   * 与闸门是否配置无关 —— C5 阶段字数是未知的，收束完整性提示必须自己带数，
   * 而那个数只能来自 rules，不能在这个文件里再写一份。
   */
  readonly patchWords: readonly [number, number];
  /**
   * C6/C7 所需。缺省则跳过质量闸门 —— M1 的调用方（缓存实测工装）不需要
   * 闸门，而给它一份假 profile 会让实测数据里混进无意义的 findings。
   */
  readonly gate?: {
    readonly profile: WorkProfile;
    readonly rules: Rules;
    /**
     * 本章出场人物的完整卡（含 `speech`）。缺省即跳过声音一致性检查 ——
     * 与整个 gate 缺省同一语义：工装不需要闸门，也不该收到假人物卡。
     */
    readonly characters?: readonly ReviewCharacter[];
    /**
     * 两个 model 审查通道的开关，**按作品**取（`ProjectSession.reviewSettings`），
     * 不从 `rules` 取 —— 来源指纹含整个 rules，走那条路会让作者改个开关就作废
     * 所有未采用草稿。缺省视为都开。
     */
    readonly review?: ReviewRules;
    /** 判"与已确认设定矛盾"的既定事实：地点/组织 facts、世界规则、能力限制等。 */
    readonly canon?: readonly CanonFact[];
  };
}

export type ChapterRunResult =
  | {
      readonly kind: "ok";
      readonly chapterText: string;
      readonly parse: ParseResult;
      readonly findings: readonly GateFinding[];
      readonly metrics: readonly CacheRecord[];
      /** proposed 状态的事件。用户接受后调 stream.decideChapter 提交。 */
      readonly proposed: readonly StructuralEvent[];
      /** C6 代码通道的度量。gate 未配置时为 null。 */
      readonly gate: ChapterGateResult | null;
      /** C7 的分流结论。gate 未配置时为 null。 */
      readonly route: RouteResult | null;
      /** §12.3 C7 末条：block 未清不允许接受。 */
      readonly acceptable: boolean;
    }
  /** C4 被拒 —— 整章作废，但带可展示的文案（§2：空白页面是最差处理）。 */
  | { readonly kind: "refused"; readonly userMessage: string; readonly metrics: readonly CacheRecord[] }
  /** C5 失败时 `chapterText` 带回已生成的正文 —— 正文不该因结构步失败而丢（草稿可恢复）。 */
  | { readonly kind: "failed"; readonly step: "C4" | "C5"; readonly detail: string; readonly chapterText?: string; readonly metrics: readonly CacheRecord[] };

/**
 * 跑一章：C4 生成正文 → C5 同会话声明结构 → 校验 → 产出 proposed 事件。
 *
 * 不做 C8 提交 —— 提交需要用户接受（§12.0），由调用方在用户点接受后
 * 调 `stream.decideChapter(chapter, "committed")`。
 */
export async function runChapter(
  client: ClaudeClient,
  stream: EventStream,
  input: ChapterRunInput,
): Promise<ChapterRunResult> {
  const req = assemble(input.assembleInput);
  const metrics: CacheRecord[] = [];

  const recordOf = (step: string, result: CallResult): void => {
    if (result.kind === "error") return;
    metrics.push(
      recordCacheMetrics(
        { chapter: input.chapter, step, usage: result.message.usage, segmentTokens: req.segmentTokens },
        client.official,
      ),
    );
  };

  // ── C4 ──
  const c4 = await client.call({
    purpose: "chapter",
    role: "creative",
    effort: "xhigh",
    thinking: true,
    maxTokens: input.maxOutputTokens ?? 16_000,
    tools: req.tools,
    system: req.system,
    messages: req.messages,
  });
  recordOf("C4", c4);

  if (c4.kind === "error") {
    return { kind: "failed", step: "C4", detail: c4.error.message, metrics };
  }
  if (c4.kind === "refusal") {
    return { kind: "refused", userMessage: c4.userMessage, metrics };
  }
  const chapterText = textOf(c4.message);
  if (chapterText.trim() === "") {
    return { kind: "failed", step: "C4", detail: "C4 返回空正文", metrics };
  }

  // ── C5：同会话第二轮 ──
  // 追加**整个 response.content**，不能只取 text（§附录：压缩块必须保留）。
  const c5Messages: Anthropic.MessageParam[] = [
    ...req.messages,
    { role: "assistant", content: c4.message.content },
    { role: "user", content: [{ type: "text", text: buildC5Task(input.parseContextBase) }] },
  ];

  const c5 = await client.call({

    purpose: "chapter",
    role: "creative",
    effort: "medium",
    maxTokens: 4_000,
    tools: req.tools,
    system: req.system,
    messages: c5Messages,
    outputSchema: C5_OUTPUT_SCHEMA,
  });
  recordOf("C5", c5);

  if (c5.kind === "error") {
    return { kind: "failed", step: "C5", detail: c5.error.message, chapterText, metrics };
  }
  if (c5.kind === "refusal") {
    // C5 被拒很反常（它只是结构化描述），但正文已经拿到了，不该丢弃。
    return { kind: "failed", step: "C5", detail: `C5 被拒：${c5.userMessage}`, chapterText, metrics };
  }
  if (c5.kind === "max_tokens" || (c5.message.stop_reason !== "end_turn" && c5.message.stop_reason !== "stop_sequence")) {
    return { kind: "failed", step: "C5", detail: "C5 声明未完整结束，正文已保留", chapterText, metrics };
  }

  const parse = parseJson(textOf(c5.message));
  if (parse === null) {
    return { kind: "failed", step: "C5", detail: "C5 输出不是合法 JSON", chapterText, metrics };
  }
  const issue = c5OutputIssue(parse);
  if (issue !== null) return { kind: "failed", step: "C5", detail: `C5 输出结构不完整或字段无效：${issue}`, chapterText, metrics };

  const parsed = parseC5(parse, { ...input.parseContextBase, chapterText });
  if (parsed.errors.length > 0) return { kind: "failed", step: "C5", detail: `C5 结构记录需要核对：${parsed.errors.join("；")}`, chapterText, metrics };
  const c5Findings = [
    ...crossCheckC5({ declaration: parsed.declaration, chapterText }),
    ...checkPromisedResolutions(parsed.declaration, input.promisedResolutions, input.patchWords),
  ];
  const proposed = commitDeclaration(stream, input.chapter, parsed.declaration);

  // ── C6 → C7 ──
  // 顺序不能反：C7 的分流依赖 C6 算出的实际字数，而 C6 的字数越界只报
  // warn，最终级别由 C7 定（回收章收束未完成时超额是 pass 而非 block）。
  const beat = input.assembleInput.volatile.beat;
  if (input.gate === undefined || beat.budget === null) {
    return {
      kind: "ok",
      chapterText,
      parse: parsed,
      findings: c5Findings,
      metrics,
      proposed,
      gate: null,
      route: null,
      acceptable: canAccept(c5Findings),
    };
  }

  const gate = gateChapter(
    {
      chapterText,
      plan: beat.plan,
      budget: beat.budget,
      profile: input.gate.profile,
      declaredEventWeights: parsed.declaration.events.map((e) => e.weight),
    },
    input.gate.rules,
  );

  const route = routeChapter(
    {
      words: gate.words,
      plan: beat.plan,
      budget: beat.budget,
      unresolvedPromises: unresolvedFromFindings(c5Findings),
    },
    input.gate.rules,
  );

  // C6 的字数 finding 与 C7 的分流结论重复，去掉前者 —— C7 的结论更完整
  // （带补写/删减清单与放行理由），两条并列会让用户不知道该看哪个。
  const findings = [
    ...c5Findings,
    ...gate.findings.filter((f) => f.rule !== "word_count_under" && f.rule !== "word_count_over"),
    ...route.findings,
  ];

  return {
    kind: "ok",
    chapterText,
    parse: parsed,
    findings,
    metrics,
    proposed,
    gate,
    route,
    acceptable: canAccept(findings),
  };
}

/** 取响应里的文本。工具调用块和 thinking 块跳过。 */
export function textOf(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** 结构化输出理论上是纯 JSON，但模型偶尔会包 markdown 围栏。 */
function parseJson(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
