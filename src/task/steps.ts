/**
 * 章节任务的三个可复用步骤（Stage 1）：write / declare / check。
 *
 * 它们是 LangGraph 章节图（graph.ts）的节点主体。与 `chapter/pipeline.ts` 的
 * `runChapter` 的关系：
 *   - runChapter 是**遗留一次性路径**（缓存实测工装 + 21 个测试依赖），保持独立、
 *     内部自带缓存度量与 commitDeclaration。
 *   - 这里是**产品任务路径**：C4 带工具循环、C5 只产出声明**不入事件流**（草稿在
 *     事件流之外，见 types.ts），供图逐步落草稿、失败可恢复。
 * 两处对 C4/C5 调用形态有少量刻意重复；改 C5 协议时两边都要同步。
 */

import type Anthropic from "@anthropic-ai/sdk";
import type { CallOptions } from "../client/claude.js";
import type { ModelClient } from "../client/model.js";
import { assemble, type AssembledRequest } from "../context/assemble.js";
import { buildC5Task, textOf, type ChapterRunInput } from "../chapter/pipeline.js";
import { C5_OUTPUT_SCHEMA, parseC5, type ParseResult } from "../chapter/c5-schema.js";
import { c5OutputIssue } from "../chapter/c5-validation.js";
import { checkPromisedResolutions, crossCheckC5 } from "../chapter/c5-crosscheck.js";
import { gateChapter, type ChapterGateResult } from "../gate/code-channel.js";
import { groupSpeech, type VoiceCharacter } from "../gate/voice-channel.js";
import { buildVoiceTask, parseVoiceVerdict, VOICE_VERDICT_SCHEMA } from "../gate/voice-model.js";
import { buildSemanticTask, parseSemanticVerdict, SEMANTIC_VERDICT_SCHEMA } from "../gate/semantics-channel.js";
import { canAccept, routeChapter, unresolvedFromFindings, type RouteResult } from "../gate/route.js";
import { runToolLoop, type ToolContext } from "./tool-exec.js";
import type { GateFinding } from "../types/beat.js";
import type { C5Declaration } from "../types/events.js";

/**
 * API 调用的输出规模 —— 是**管线常量**（等同 client.ts 的 STREAMING_THRESHOLD /
 * pipeline.ts 的 16_000/4_000），不是 §10.1 的派生阈值，故不进 rules.yaml。
 */
export const C4_MAX_TOKENS = 16_000;
const C5_MAX_TOKENS = 4_000;
/** 声音判定只报不一致项，输出很短；这是上限而非目标。 */
const VOICE_MAX_TOKENS = 4_000;
/** 语义核对要带原文与理由，比声音判定长一些。 */
const SEMANTIC_MAX_TOKENS = 4_000;

// ── C4：写正文（带工具循环）─────────────────────────────────────────────

export type WriteResult =
  | {
      readonly kind: "ok";
      readonly body: string;
      readonly req: AssembledRequest;
      readonly c4Response: Anthropic.Message | null;
      /** 传给最终 C4 调用的消息（含工具往返），C5 同会话第二轮据此续接。 */
      readonly sessionMessages: readonly Anthropic.MessageParam[];
      readonly hitToolCap: boolean;
      readonly declarationBody?: boolean;
      readonly summary?: string;
    }
  | { readonly kind: "refused"; readonly userMessage: string }
  | { readonly kind: "incomplete"; readonly body: string; readonly detail: string }
  | { readonly kind: "scope_change"; readonly summary: string; readonly advice: string }
  | { readonly kind: "failed"; readonly detail: string };

export async function writeChapterBody(
  client: ModelClient,
  input: ChapterRunInput,
  ctx: ToolContext,
  maxToolRounds: number,
): Promise<WriteResult> {
  const req = assemble(input.assembleInput);
  const callOpts: CallOptions = {
    role: "creative",
    effort: "xhigh",
    thinking: true,
    maxTokens: input.maxOutputTokens ?? C4_MAX_TOKENS,
    tools: req.tools,
    system: req.system,
    messages: req.messages,
  };
  const loop = await runToolLoop(client, callOpts, ctx, maxToolRounds);
  const r = loop.result;

  if (r.kind === "error") return r.partialText?.trim()
    ? { kind: "incomplete", body: r.partialText, detail: `${r.error.message} 已收到的正文片段已保留；请继续完成或重新生成后再检查。` }
    : { kind: "failed", detail: r.error.message };
  if (r.kind === "refusal") return { kind: "refused", userMessage: r.userMessage };

  const body = textOf(r.message);
  if (r.kind === "max_tokens") return { kind: "incomplete", body, detail: "正文达到模型输出上限，片段已保留；请继续完成或重新生成后再检查。" };
  if (r.message.stop_reason !== "end_turn" && r.message.stop_reason !== "stop_sequence") {
    return { kind: "incomplete", body, detail: loop.hitCap
      ? "正文工具调用达到轮数上限，已有文字仅作为未完成片段保留；请核对后继续完成或重新生成。"
      : "正文响应尚未完整结束，片段已保留；请继续完成或重新生成后再检查。" };
  }
  if (body.trim() === "") {
    return {
      kind: "failed",
      detail: loop.hitCap ? "C4 工具调用达上限仍未产出正文" : "C4 返回空正文",
    };
  }
  return {
    kind: "ok",
    body,
    req,
    c4Response: r.message,
    sessionMessages: loop.messages,
    hitToolCap: loop.hitCap,
  };
}

// ── C5：结构声明（不入事件流）───────────────────────────────────────────

export type DeclareResult =
  | { readonly kind: "ok"; readonly parse: ParseResult; readonly c5Findings: readonly GateFinding[] }
  | { readonly kind: "failed"; readonly detail: string };

export async function declareStructure(
  client: ModelClient,
  input: ChapterRunInput,
  write: Extract<WriteResult, { kind: "ok" }>,
): Promise<DeclareResult> {
  // 真实响应完整保留；局部生成还须声明代码合成后的全文，不能只分析替换片段。
  const instruction = buildC5Task(input.parseContextBase);
  const task = write.c4Response === null || write.declarationBody === true
    ? `以下是本次版本的完整正文，是本次结构核对的唯一正文依据。此前的源稿或替换片段不代表本次完整结果。\n\n${write.body}\n\n${instruction}` : instruction;
  const c5Messages: Anthropic.MessageParam[] = write.c4Response === null ? [
    ...write.sessionMessages,
    { role: "user", content: [{ type: "text", text: task }] },
  ] : [
    ...write.sessionMessages,
    { role: "assistant", content: write.c4Response.content },
    { role: "user", content: [{ type: "text", text: task }] },
  ];

  const c5 = await client.call({
    role: "creative",
    effort: "medium",
    maxTokens: C5_MAX_TOKENS,
    tools: write.req.tools,
    system: write.req.system,
    messages: c5Messages,
    outputSchema: C5_OUTPUT_SCHEMA,
  });

  if (c5.kind === "error") return { kind: "failed", detail: c5.error.message };
  if (c5.kind === "refusal") return { kind: "failed", detail: `C5 被拒：${c5.userMessage}` };
  if (c5.kind === "max_tokens") return { kind: "failed", detail: "C5 达到模型输出上限，声明未完成，正文已保留" };
  if (c5.message.stop_reason !== "end_turn" && c5.message.stop_reason !== "stop_sequence") return { kind: "failed", detail: "C5 响应尚未完整结束，正文已保留，请重新检查" };

  const json = parseJson(textOf(c5.message));
  if (json === null) return { kind: "failed", detail: "C5 输出不是合法 JSON" };
  const issue = c5OutputIssue(json);
  if (issue !== null) return { kind: "failed", detail: `C5 输出结构不完整或字段无效：${issue}` };

  const parse = parseC5(json, { ...input.parseContextBase, chapterText: write.body });
  if (parse.errors.length > 0) return { kind: "failed", detail: `C5 结构记录需要核对：${parse.errors.join("；")}` };
  const c5Findings = [
    ...crossCheckC5({ declaration: parse.declaration, chapterText: write.body }),
    ...checkPromisedResolutions(parse.declaration, input.promisedResolutions),
  ];
  return { kind: "ok", parse, c5Findings };
}

// ── C6 → C7：质量闸门与分流 ─────────────────────────────────────────────

export interface CheckResult {
  readonly findings: readonly GateFinding[];
  readonly acceptable: boolean;
  readonly gate: ChapterGateResult | null;
  readonly route: RouteResult | null;
}

/**
 * C6 代码通道 + C7 分流。顺序与理由同 pipeline.ts：C7 依赖 C6 的实际字数，
 * 字数越界的最终级别由 C7 定。gate 未配置或预算未派生时只保留 C5 的 findings。
 *
 * 吃 `declaration` 而非 ParseResult —— resume 时只需从草稿恢复声明即可复算，
 * 不必重建完整解析结果。
 */
/**
 * 声音一致性的 model 通道（§12.3 注册表里 `channel: "model"` 的三项）。
 *
 * **降级而不是失败**：这是整条检查链上唯一会发网络请求的一步，而它判的是语域、
 * 情绪表达、称呼表这三项"加分项"。模型没配、调用失败、输出不合格式，都不该让
 * 一章已经写好的正文变成"检查崩了" —— 一律降级成 info，作者看到的应是
 * "这一项没查成"，其余检查结论照常成立。
 *
 * 没有可归属台词的章节直接跳过：那种情况 code 通道已经报过覆盖缺口，不重复。
 */
export async function checkVoiceWithModel(
  client: ModelClient,
  input: ChapterRunInput,
  body: string,
  characters: readonly VoiceCharacter[],
): Promise<readonly GateFinding[]> {
  const rules = input.gate?.rules;
  if (rules === undefined) return [];
  const { bySpeaker } = groupSpeech({ chapterText: body, characters }, rules);
  const speaking = characters.filter((character) => (bySpeaker.get(character.id) ?? []).length > 0);
  if (speaking.length === 0) return [];

  let call: Awaited<ReturnType<ModelClient["call"]>>;
  try {
    call = await client.call({
      role: "judge",
      maxTokens: VOICE_MAX_TOKENS,
      system: [{ type: "text", text: VOICE_JUDGE_SYSTEM }],
      messages: [{ role: "user", content: [{ type: "text", text: buildVoiceTask(speaking, bySpeaker) }] }],
      outputSchema: VOICE_VERDICT_SCHEMA,
    });
  } catch (error) {
    return [voiceUnavailable(error instanceof Error ? error.message : String(error))];
  }

  if (call.kind === "error") return [voiceUnavailable(call.error.message)];
  if (call.kind === "refusal") return [voiceUnavailable(`模型拒绝了这次判定：${call.userMessage}`)];
  if (call.kind === "max_tokens") return [voiceUnavailable("判定达到模型输出上限，未完成")];
  if (call.message.stop_reason !== "end_turn" && call.message.stop_reason !== "stop_sequence") {
    return [voiceUnavailable("判定响应尚未完整结束")];
  }
  const json = parseJson(textOf(call.message));
  if (json === null) return [voiceUnavailable("判定输出不是合法 JSON")];
  return parseVoiceVerdict(json, { chapterText: body, characters });
}

const VOICE_JUDGE_SYSTEM = "你是小说编辑，负责核对人物说话方式是否与设定一致。只报确实不像的地方，并逐字引用原文作为依据。";

function voiceUnavailable(detail: string): GateFinding {
  return {
    rule: "voice_verdict_unavailable",
    level: "info",
    message: `语域、情绪表达与称呼表这三项本轮未查：${detail}。正文与其余检查结论不受影响。`,
  };
}

/**
 * 语义审查的 model 通道：POV 越界与伏笔兑现。
 *
 * 与 `checkVoiceWithModel` 同一条纪律 —— **降级而不是失败**：模型没配、调用失败、
 * 输出不合格式，都只出一句 info，其余检查结论照常成立。
 *
 * 三项前置条件缺一就跳过，不花这次调用：没有正文 / 没有声明 / 既没有视角人物
 * 也没有声明收束的伏笔。
 */
export async function checkSemanticsWithModel(
  client: ModelClient,
  input: ChapterRunInput,
  body: string,
  declaration: C5Declaration,
): Promise<readonly GateFinding[]> {
  if (body.trim() === "") return [];
  const characters = input.gate?.characters ?? [];
  const povId = declaration.characterPresence.find((item) => item.role === "pov")?.characterId ?? null;
  const povCard = povId === null ? undefined : characters.find((character) => character.id === povId);
  const timeline = new Map((input.parseContextBase.foreshadows ?? []).map((item) => [item.id, item]));
  const resolutions = declaration.foreshadowResolved.flatMap((item) => {
    const known = timeline.get(item.foreshadowId);
    return known === undefined ? [] : [{ foreshadowId: item.foreshadowId, label: known.label, intent: known.intent, quote: item.anchor.quote }];
  });
  if (povCard === undefined && resolutions.length === 0) return [];

  let call: Awaited<ReturnType<ModelClient["call"]>>;
  try {
    call = await client.call({
      role: "judge",
      maxTokens: SEMANTIC_MAX_TOKENS,
      system: [{ type: "text", text: SEMANTIC_JUDGE_SYSTEM }],
      messages: [{ role: "user", content: [{ type: "text", text: buildSemanticTask({
        chapterText: body,
        pov: povCard === undefined ? null : { id: povCard.id, name: povCard.name },
        resolutions,
      }) }] }],
      outputSchema: SEMANTIC_VERDICT_SCHEMA,
    });
  } catch (error) {
    return [semanticsUnavailable(error instanceof Error ? error.message : String(error))];
  }

  if (call.kind === "error") return [semanticsUnavailable(call.error.message)];
  if (call.kind === "refusal") return [semanticsUnavailable(`模型拒绝了这次核对：${call.userMessage}`)];
  if (call.kind === "max_tokens") return [semanticsUnavailable("核对达到模型输出上限，未完成")];
  if (call.message.stop_reason !== "end_turn" && call.message.stop_reason !== "stop_sequence") {
    return [semanticsUnavailable("核对响应尚未完整结束")];
  }
  const json = parseJson(textOf(call.message));
  if (json === null) return [semanticsUnavailable("核对输出不是合法 JSON")];
  return parseSemanticVerdict(json, {
    chapterText: body,
    povCharacterId: povCard?.id ?? null,
    resolutions: resolutions.map((item) => ({ foreshadowId: item.foreshadowId, label: item.label })),
  });
}

const SEMANTIC_JUDGE_SYSTEM = "你是小说编辑，负责核对本章正文是否守住视角纪律、以及声明收束的伏笔是否真的交代清楚。只报确实有问题的项，并逐字引用原文作为依据。";

function semanticsUnavailable(detail: string): GateFinding {
  return {
    rule: "semantic_verdict_unavailable",
    level: "info",
    message: `视角越界与伏笔兑现这两项本轮未查：${detail}。正文与其余检查结论不受影响。`,
  };
}

export function checkChapter(
  input: ChapterRunInput,
  chapterText: string,
  declaration: C5Declaration,
  c5Findings: readonly GateFinding[],
): CheckResult {
  const beat = input.assembleInput.volatile.beat;
  if (input.gate === undefined || beat.budget === null) {
    return { findings: c5Findings, acceptable: canAccept(c5Findings), gate: null, route: null };
  }

  const gate = gateChapter(
    {
      chapterText,
      plan: beat.plan,
      budget: beat.budget,
      profile: input.gate.profile,
      declaredEventWeights: declaration.events.map((e) => e.weight),
      ...(input.gate.characters === undefined ? {} : { characters: input.gate.characters }),
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
  const findings = [
    ...c5Findings,
    ...gate.findings.filter((f) => f.rule !== "word_count_under" && f.rule !== "word_count_over"),
    ...route.findings,
  ];
  return { findings, acceptable: canAccept(findings), gate, route };
}

/** 结构化输出理论上是纯 JSON，模型偶尔包 markdown 围栏（同 pipeline.ts 的私有版）。 */
function parseJson(text: string): unknown {
  const stripped = text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gu, "");
  try {
    return JSON.parse(stripped);
  } catch {
    return null;
  }
}
