import type Anthropic from "@anthropic-ai/sdk";
import { vi } from "vitest";
import type { ClaudeClient, CallOptions, CallResult } from "../src/client/claude.js";
import { EventStream } from "../src/store/event-stream.js";
import type { ProjectSnapshot } from "../src/store/persist.js";
import type { ChapterBeat } from "../src/types/beat.js";
import type { C5Declaration } from "../src/types/events.js";
import type { ChapterDraft } from "../src/task/types.js";
import { beat, characters, settings, workProfile, workSetting } from "./fixtures.js";
import { loadRules } from "../src/rules/load.js";

// 协议及单次故障恢复用例关闭额外修订；所有正文质量闸门仍使用原规则。
// 自动修订额度与恢复在 automatic-revision.test.ts 单独走完整业务服务验证。
const baseRules = loadRules();

/**
 * 关掉两个 model 通道（声音判定 / 语义核对）的规则基线。
 *
 * 它们每章各发一次模型调用，而脚本化用例都是按固定次序排好的应答 ——
 * 开着只会白白多消耗一次脚本应答。这两个通道的行为由
 * `test/voice-model.test.ts`、`test/semantics-channel.test.ts` 与浏览器端到端
 * 单独覆盖，这里不重复。
 */
export const NO_MODEL_REVIEW = { ...baseRules, review: { voice: false, semantics: false as const } };

/** 协议及单次故障恢复用例：关闭额外修订与两个 model 通道；正文质量闸门仍用原规则。 */
export const SINGLE_PASS_RULES = { ...NO_MODEL_REVIEW, task: { ...baseRules.task, maxAutoRevisions: 0 } };

export const NOW = "2026-09-10T00:00:00.000Z";
export const CH1 = "守夜人将一枚青铜钥匙放在桌上。钥匙的齿缝沾着红泥。李长风收起钥匙，记住了守夜人的面容。";
export const CH2 = "李长风的毒伤尚未痊愈。血刀客把他带到青云门山脚，交给他一张画着密库位置的旧图。";
export const PROSE = "李长风用青铜钥匙打开了宗门密库。钥匙的齿缝与锁眼严丝合缝。血刀客拿走了架上的旧账本。";

export const WRITE_BEAT: ChapterBeat = {
  ...beat,
  chapter: 3,
  volume: 2,
  budget: null,
  plan: {
    ...beat.plan,
    chapterType: "payoff",
    coreEvent: "李长风用钥匙打开密库，取出旧账本",
    stageFeedback: "青铜钥匙打开宗门密库，账本落到血刀客手中",
    hook: "账本的最后一页被人撕去",
    events: [{ kind: "action", summary: "李长风打开密库并取走账本", weight: 2, plotLine: "P01" }],
    resolves: [{ foreshadowId: "F01", weight: "main", completeness: "full" }],
    plants: [],
    characters: ["C02", "C01"],
    locations: ["S02", "S01"],
  },
};

export function writingSnapshot(): ProjectSnapshot {
  const stream = new EventStream(() => NOW);
  const append = (chapter: number, payload: Parameters<EventStream["append"]>[0]["payload"]): void => {
    stream.append({ chapter, origin: "C5_declaration", provenance: "proposed", payload });
  };
  append(1, { type: "plot_event", kind: "action", summary: "李长风收下青铜钥匙", weight: 1, plotLine: "P01", participants: ["C01"], anchor: { chapter: 1, quote: "收起钥匙", offsetHint: 0, occurrence: 0 } });
  append(1, { type: "foreshadow_planted", foreshadowId: "F01", label: "青铜钥匙", intent: "证明钥匙能打开宗门密库。", weight: "main", visibility: "covert", expectedBy: 3, anchor: { chapter: 1, quote: "一枚青铜钥匙放在桌上", offsetHint: 0, occurrence: 0 } });
  append(1, { type: "foreshadow_planted", foreshadowId: "F02", label: "钥匙上的红泥", intent: "守夜人曾去过禁地，留到第八章揭露。", weight: "sub", visibility: "covert", expectedBy: 8, anchor: { chapter: 1, quote: "钥匙的齿缝沾着红泥", offsetHint: 0, occurrence: 0 } });
  append(2, { type: "plot_event", kind: "info", summary: "血刀客交出密库旧图", weight: 2, plotLine: "P01", participants: ["C01", "C02"], anchor: { chapter: 2, quote: "密库位置的旧图", offsetHint: 0, occurrence: 0 } });
  append(2, { type: "character_state_changed", characterId: "C01", field: "condition", from: null, to: "毒伤尚未痊愈", anchor: { chapter: 2, quote: "毒伤尚未痊愈", offsetHint: 0, occurrence: 0 } });
  append(2, { type: "character_presence", characterId: "C01", role: "pov" });
  stream.decideChapter(1, "committed");
  stream.decideChapter(2, "committed");
  return {
    setting: workSetting,
    discipline: { version: "author-d1", rules: ["第三人称有限视角。", "对话避免解释读者已知的事。"] },
    settings,
    profile: workProfile,
    characters: characters.slice(0, 2).map(({ state: _state, ...card }) => ({ ...card, introducedAt: 1 })),
    plotLines: [{ id: "P01", label: "追查旧案", weight: "main" }],
    volumes: [],
    beats: [{ ...WRITE_BEAT, chapter: 2, volume: 1 }, WRITE_BEAT],
    alertStates: [],
    events: stream.all(),
    chapters: new Map([[1, CH1], [2, CH2]]),
  };
}

export function declaration(): C5Declaration {
  return {
    events: [], foreshadowPlanted: [], foreshadowResolved: [],
    relationsChanged: [], characterStates: [], characterPresence: [],
  };
}

export function savedDraft(overrides: Partial<ChapterDraft> = {}): ChapterDraft {
  return {
    chapter: 3, draftId: "ch3d1", status: "ready", body: PROSE,
    declaration: declaration(), findings: [], acceptable: true, proposals: [], session: null,
    baseVersion: 0, baseAdoptedThrough: 2, error: null, createdAt: NOW, updatedAt: NOW,
    ...overrides,
  };
}

export const C5_JSON = JSON.stringify({
  events: [{ kind: "action", summary: "李长风打开宗门密库", weight: 2, plot_line: "P01", participants: ["C01", "C02"], quote: "青铜钥匙打开了宗门密库" }],
  foreshadow_planted: [],
  foreshadow_resolved: [{ foreshadow_id: "F01", completeness: "full", quote: "钥匙的齿缝与锁眼严丝合缝" }],
  relations_changed: [], character_states: [],
  character_presence: [{ character_id: "C01", role: "pov" }, { character_id: "C02", role: "major" }],
});

export function modelMessage(content: Anthropic.ContentBlock[], stopReason = "end_turn"): Anthropic.Message {
  return {
    id: "test-message", type: "message", role: "assistant", model: "test-model",
    content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 100, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}

/**
 * 语义审查 model 通道的「没有问题」应答。
 *
 * C6 现在会在每章检查末尾追加两次模型调用（声音判定、语义核对），脚本化用例
 * 必须为它们安排应答。统一放在这里，免得每个文件各写一份。
 */
export const SEMANTIC_OK: CallResult = modelText(JSON.stringify({ issues: [] }));
/** 声音判定 model 通道的「没有问题」应答。 */
export const VOICE_OK: CallResult = modelText(JSON.stringify({ characters: [] }));

export function modelText(text: string): CallResult {
  return { kind: "ok", message: modelMessage([{ type: "text", text, citations: [] }]) };
}

export function fakeClient(results: readonly CallResult[]): { client: ClaudeClient; calls: CallOptions[] } {
  const calls: CallOptions[] = [];
  const client = {
    official: true,
    call: vi.fn(async (options: CallOptions): Promise<CallResult> => {
      calls.push(options);
      const result = results[calls.length - 1];
      if (result === undefined) throw new Error("测试没有安排额外的模型调用");
      return result;
    }),
  } as unknown as ClaudeClient;
  return { client, calls };
}
