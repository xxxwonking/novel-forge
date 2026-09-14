/**
 * 方案的解析与执行。
 *
 * 两件事都刻意**复用 `executeMainTool`**，不另起一套写入路径：
 *   - 提案期：把条目丢给它跑一次「执行被打桩」的空转，借此拿到真实的入参校验结果。
 *     校验逻辑将来怎么改，这里自动跟上，不会两处走偏。
 *   - 采纳期：把条目还原成 tool_use 真跑一遍。于是编号仍由代码分配、plan_chapter 的
 *     两道闸与 V2 校验原样生效、effect→chip 链路直接复用。
 *
 * 占位名解决的是「第 3 条要引用第 1 条新建的人物，但那时编号还不存在」：第 1 条给
 * `ref`，后续条目写 `@占位名`，执行时从前一条的 effect 里回读真编号换上去。
 * 提案期没有真编号，就换成前缀正确的哨兵（`C00`），好让编号格式检查照常生效。
 */

import type Anthropic from "@anthropic-ai/sdk";
import { executeMainTool, type AgentActionOutcome, type MainAgentToolContext } from "./tool-exec.js";
import type { AgentEffect } from "./types.js";
import {
  isProposalTool,
  REF_PREFIX,
  type ProposalDraft,
  type ProposalFailure,
  type ProposalItem,
  type ProposalTool,
} from "./proposal-types.js";

const REF_MARK = "@";

/** 占位名的哨兵序号。真编号从 01 起，00 不会与任何真对象撞。 */
const SENTINEL_SEQ = "00";

// ── 解析 ────────────────────────────────────────────────────────────────

/**
 * 校验 propose_plan 的入参。返回错误串时由调用方回 is_error，模型当轮自纠。
 *
 * 刻意在提案期就做足校验：作者不该看到一份点下去才在第 3 条炸掉的方案。
 */
export async function parseProposalDraft(
  raw: Readonly<Record<string, unknown>>,
  maxItems: number,
): Promise<ProposalDraft | string> {
  const summary = raw["summary"];
  if (typeof summary !== "string" || summary.trim() === "") return "summary 必须是非空字符串";

  const impactRaw = raw["impact"] ?? [];
  if (!Array.isArray(impactRaw) || impactRaw.some((s) => typeof s !== "string")) return "impact 必须是字符串数组";

  const itemsRaw = raw["items"];
  if (!Array.isArray(itemsRaw) || itemsRaw.length === 0) return "items 必须是非空数组";
  if (itemsRaw.length > maxItems) return `items 最多 ${maxItems} 条；拆成几次讨论，或把同一对象的改动合并成一条`;

  const items: ProposalItem[] = [];
  /** 占位名 → 声明它的工具对应的编号前缀。按顺序累积，只能引用更早声明的。 */
  const declared = new Map<string, "C" | "S" | "P">();

  for (const [index, entry] of itemsRaw.entries()) {
    const at = `第 ${index + 1} 条`;
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) return `${at}不是对象`;
    const item = entry as Record<string, unknown>;

    const tool = item["tool"];
    if (!isProposalTool(tool)) return `${at}的 tool 不在方案可用的工具里：${String(tool)}`;

    const input = item["input"];
    if (typeof input !== "object" || input === null || Array.isArray(input)) return `${at}的 input 必须是对象`;

    const note = item["note"];
    if (typeof note !== "string" || note.trim() === "") return `${at}缺少 note（给作者看的一句话）`;

    const ref = readRef(item["ref"], tool, declared, at);
    if ("error" in ref) return ref.error;

    const record = input as Record<string, unknown>;
    const dangling = collectRefs(record).find((r) => !declared.has(r));
    if (dangling !== undefined) return `${at}引用的 ${REF_MARK}${dangling} 没有在更早的条目里声明`;

    const shapeError = await validateShape(tool, record, declared);
    if (shapeError !== undefined) return `${at}（${tool}）入参不合法：${shapeError}`;

    const prefix = REF_PREFIX[tool];
    if (ref.ref !== null && prefix !== undefined) declared.set(ref.ref, prefix);
    items.push({ ...(ref.ref === null ? {} : { ref: ref.ref }), tool, input: record, note });
  }

  return { summary, impact: impactRaw as readonly string[], items };
}

/** 本条声明的占位名（null = 不声明），或一条给模型自纠的错误。 */
function readRef(
  raw: unknown,
  tool: ProposalTool,
  declared: ReadonlyMap<string, unknown>,
  at: string,
): { readonly ref: string | null } | { readonly error: string } {
  if (raw === undefined) return { ref: null };
  if (typeof raw !== "string" || raw.trim() === "") return { error: `${at}的 ref 必须是非空字符串` };
  if (raw.startsWith(REF_MARK)) return { error: `${at}的 ref 不要带 ${REF_MARK}，引用时才加` };
  if (declared.has(raw)) return { error: `${at}的占位名 ${raw} 与更早的条目重复` };
  if (REF_PREFIX[tool] === undefined) return { error: `${at}的 ${tool} 不新建对象，不该给 ref` };
  return { ref: raw };
}

/** 用「执行被打桩」的空转拿到真实的入参校验结果。走到动作层即视为形状合法。 */
async function validateShape(
  tool: ProposalTool,
  input: Readonly<Record<string, unknown>>,
  declared: ReadonlyMap<string, "C" | "S" | "P">,
): Promise<string | undefined> {
  const probe = dryRunContext();
  const { result } = await executeMainTool(
    toolUse(tool, mapRefs(input, (r) => `${declared.get(r) ?? "C"}${SENTINEL_SEQ}`), 0),
    probe.ctx,
  );
  return probe.reached() ? undefined : textOf(result) || "入参不合法";
}

const DRY_OUTCOME: AgentActionOutcome = { message: "", effect: { kind: "action_failed", tool: "", message: "" } };

/** 所有动作打桩、读类回空：只走到「校验通过」那一刻就停。 */
function dryRunContext(): { readonly ctx: MainAgentToolContext; readonly reached: () => boolean } {
  let hit = false;
  const stub = async (): Promise<AgentActionOutcome> => {
    hit = true;
    return DRY_OUTCOME;
  };
  return {
    reached: () => hit,
    ctx: {
      getOverview: () => "",
      listChapterDrafts: () => "",
      getChapterText: () => null,
      getCharacter: () => null,
      listOpenForeshadows: () => "",
      getNextPlan: () => "",
      getDirection: () => "",
      setDirection: stub,
      upsertCharacter: stub,
      upsertLocation: stub,
      definePlotLine: stub,
      setDiscipline: stub,
      planChapter: stub,
      addToNextChapter: stub,
      rescheduleForeshadow: stub,
      abandonForeshadow: stub,
      recordIdea: stub,
      writeNextChapter: stub,
      rewriteChapterDraft: stub,
      adoptChapter: stub,
      proposePlan: stub,
    },
  };
}

// ── 执行 ────────────────────────────────────────────────────────────────

export interface ApplyProposalResult {
  readonly status: "adopted" | "partially_applied";
  /** 真实发生的变化，顺序与条目一致。 */
  readonly effects: readonly AgentEffect[];
  /** 每条成功执行后的回执文案，转述给作者。 */
  readonly messages: readonly string[];
  readonly failure?: ProposalFailure;
}

/**
 * 按顺序执行方案条目。**失败即停，已落的保留** —— 筹备类本就是幂等 upsert，
 * 资料层没有事务，为全回滚引入一套补偿逻辑不值得；停下来让 Agent 重提剩余部分更诚实。
 */
export async function applyProposal(
  items: readonly ProposalItem[],
  ctx: MainAgentToolContext,
): Promise<ApplyProposalResult> {
  const refs = new Map<string, string>();
  const effects: AgentEffect[] = [];
  const messages: string[] = [];

  for (const [index, item] of items.entries()) {
    const missing = collectRefs(item.input).find((r) => !refs.has(r));
    if (missing !== undefined) {
      return stopped(effects, messages, { index, tool: item.tool, message: `${REF_MARK}${missing} 没有对应的编号，前面的条目没有建出它` });
    }

    const input = mapRefs(item.input, (r) => refs.get(r) ?? `${REF_MARK}${r}`);
    const { result, effect } = await executeMainTool(toolUse(item.tool, input, index), ctx);
    if (result.is_error === true) {
      return stopped(effects, messages, { index, tool: item.tool, message: textOf(result) || "执行失败" });
    }

    if (effect !== undefined) {
      effects.push(effect);
      const id = idOf(effect);
      if (item.ref !== undefined && id !== undefined) refs.set(item.ref, id);
    }
    messages.push(textOf(result));
  }

  return { status: "adopted", effects, messages };
}

function stopped(
  effects: readonly AgentEffect[],
  messages: readonly string[],
  failure: ProposalFailure,
): ApplyProposalResult {
  return { status: "partially_applied", effects, messages, failure };
}

/** 新建类 effect 带着代码分配的编号，占位名靠它落地。 */
function idOf(effect: AgentEffect): string | undefined {
  switch (effect.kind) {
    case "character_upserted":
    case "location_upserted":
    case "plotline_defined":
      return effect.id;
    default:
      return undefined;
  }
}

// ── 占位名 ──────────────────────────────────────────────────────────────

/** 深走一遍，收集所有形如 `@名字` 的整串引用。只认整串，避免误伤正文里的 @。 */
function collectRefs(value: unknown): readonly string[] {
  const found: string[] = [];
  walk(value, (s) => {
    const ref = asRef(s);
    if (ref !== undefined && !found.includes(ref)) found.push(ref);
  });
  return found;
}

/** 深走一遍，把整串占位换成 `resolve` 给的值。结构原样重建，不改非字符串。 */
function mapRefs<T>(value: T, resolve: (ref: string) => string): T {
  if (typeof value === "string") {
    const ref = asRef(value);
    return (ref === undefined ? value : resolve(ref)) as T;
  }
  if (Array.isArray(value)) return value.map((v) => mapRefs(v, resolve)) as T;
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapRefs(v, resolve)])) as T;
  }
  return value;
}

function asRef(s: string): string | undefined {
  return s.startsWith(REF_MARK) && s.length > REF_MARK.length ? s.slice(REF_MARK.length) : undefined;
}

function walk(value: unknown, onString: (s: string) => void): void {
  if (typeof value === "string") return onString(value);
  if (Array.isArray(value)) return value.forEach((v) => walk(v, onString));
  if (typeof value === "object" && value !== null) Object.values(value).forEach((v) => walk(v, onString));
}

// ── 工具 ────────────────────────────────────────────────────────────────

/** 条目 → tool_use。`caller: direct` 是 SDK 对「模型直接发起」的标记，这里的调用与它同类。 */
function toolUse(name: string, input: unknown, index: number): Anthropic.ToolUseBlock {
  return { type: "tool_use", caller: { type: "direct" }, id: `proposal_${index}`, name, input };
}

function textOf(result: Anthropic.ToolResultBlockParam): string {
  return typeof result.content === "string" ? result.content : "";
}
