/**
 * 筹备类工具（Stage 2·切片 2）：入参解析 / 编号分配 / 合并缺省，以及经真实
 * ProjectSession 走通的端到端（假客户端脚本化 tool_use，不打真实 API）。
 *
 * 重点：编号由代码分配、同名即同一对象、未知 id 报 action_failed；plan_chapter 先过
 * V2 校验（block 不落盘）与引用检查；同一回合内筹备写入后读工具能看到新资料。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type Anthropic from "@anthropic-ai/sdk";
import {
  DEFAULT_SPEECH,
  bumpDisciplineVersion,
  mergeCharacter,
  nextId,
  parseCharacter,
  parseDirection,
  parseDisciplineRules,
  parseLocation,
  parsePlan,
  parsePlotLine,
} from "../src/agent/prep.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { scaffoldSnapshot } from "../src/server/workspace.js";
import type { AgentEffect } from "../src/agent/types.js";
import type { CallResult } from "../src/client/claude.js";
import { fakeClient, modelMessage, modelText } from "./writing-fixtures.js";

describe("入参解析", () => {
  it("set_direction：枚举非法 / 空入参 → 错误串；合法子集原样通过", () => {
    expect(parseDirection({ pov: "second" })).toMatch(/pov/u);
    expect(parseDirection({})).toMatch(/至少/u);
    expect(parseDirection({ worldRules: "不是数组" })).toMatch(/worldRules/u);
    expect(parseDirection({ premise: "少年查案", pov: "first", taboos: ["虐主"] })).toEqual({
      premise: "少年查案",
      pov: "first",
      taboos: ["虐主"],
    });
  });

  it("upsert_character：id/name 至少一个；外貌缺省 immutable=true、establishedAt=0；句长区间校验", () => {
    expect(parseCharacter({ tier: "major" })).toMatch(/id 与 name/u);
    expect(parseCharacter({ id: "X1", name: "甲" })).toMatch(/编号/u);
    expect(parseCharacter({ name: "甲", speech: { sentenceLength: { min: 9, max: 3 } } })).toMatch(/sentenceLength/u);
    const parsed = parseCharacter({
      name: "李长风",
      tier: "protagonist",
      role: "落魄捕快",
      appearance: [{ key: "眼睛颜色", value: "浅褐" }, { key: "伤势", value: "左臂刀伤", immutable: false }],
      speech: { register: "colloquial", exemplars: ["你再说一遍。"], addressForms: [{ target: null, form: "阁下" }] },
    });
    expect(parsed).toMatchObject({
      name: "李长风",
      tier: "protagonist",
      profile: {
        role: "落魄捕快",
        appearance: [
          { key: "眼睛颜色", value: "浅褐", establishedAt: 0, immutable: true },
          { key: "伤势", value: "左臂刀伤", establishedAt: 0, immutable: false },
        ],
      },
      speech: { register: "colloquial", exemplars: ["你再说一遍。"], addressForms: [{ target: null, form: "阁下" }] },
    });
  });

  it("upsert_location / define_plotline / set_discipline 的基本校验", () => {
    expect(parseLocation({ kind: "location" })).toMatch(/id 与 name/u);
    expect(parseLocation({ name: "集市", kind: "city" })).toMatch(/kind/u);
    expect(parseLocation({ name: "集市", facts: ["三州交界"] })).toEqual({ name: "集市", facts: ["三州交界"] });
    expect(parsePlotLine({ weight: "main" })).toMatch(/id 与 label/u);
    expect(parsePlotLine({ label: "复仇", weight: "huge" })).toMatch(/weight/u);
    expect(parseDisciplineRules({ rules: [] })).toMatch(/rules/u);
    expect(parseDisciplineRules({ rules: ["一条", " "] })).toMatch(/rules/u);
    expect(parseDisciplineRules({ rules: ["第三人称有限视角。"] })).toEqual(["第三人称有限视角。"]);
  });

  it("plan_chapter：必填缺失 / 事件权重非法 → 错误串；缺省数组补空、secondaryThread 空串归 null", () => {
    expect(parsePlan({ chapterType: "event", coreEvent: "a", stageFeedback: "b" })).toMatch(/hook/u);
    expect(parsePlan({ chapterType: "event", coreEvent: "a", stageFeedback: "b", hook: "c", events: [{ kind: "action", summary: "x", weight: 5 }] })).toMatch(/weight/u);
    expect(parsePlan({ chapter: 0, chapterType: "event", coreEvent: "a", stageFeedback: "b", hook: "c" })).toMatch(/chapter/u);
    const parsed = parsePlan({ chapterType: "setup", coreEvent: "a", secondaryThread: "", stageFeedback: "b", hook: "c" });
    expect(parsed).toEqual({
      chapter: null,
      plan: { chapterType: "setup", coreEvent: "a", secondaryThread: null, stageFeedback: "b", hook: "c", events: [], resolves: [], plants: [], characters: [], locations: [] },
    });
  });
});

describe("编号与合并", () => {
  it("nextId 取最大序号 +1，两位补零", () => {
    expect(nextId("C", [])).toBe("C01");
    expect(nextId("C", ["C01", "C03"])).toBe("C04");
    expect(nextId("S", ["S09"])).toBe("S10");
  });

  it("bumpDisciplineVersion：平台缺省 d1 → a1，作者版递增", () => {
    expect(bumpDisciplineVersion("d1")).toBe("a1");
    expect(bumpDisciplineVersion("a3")).toBe("a4");
  });

  it("mergeCharacter：新建带缺省，更新只覆盖给定字段、speech 部分合并", () => {
    const created = mergeCharacter(undefined, { name: "甲", profile: { role: "捕快" }, speech: { register: "formal" } }, "C01", "2026-09-11T00:00:00.000Z");
    expect(created).toMatchObject({ id: "C01", name: "甲", tier: "minor", introducedAt: 0, provenance: "authored" });
    expect(created.speech).toEqual({ ...DEFAULT_SPEECH, register: "formal" });
    const updated = mergeCharacter(created, { tier: "major", profile: {}, speech: { exemplars: ["哼。"] } }, "C01", "2026-09-11T01:00:00.000Z");
    expect(updated).toMatchObject({ name: "甲", tier: "major", profile: { role: "捕快" } });
    expect(updated.speech).toEqual({ ...DEFAULT_SPEECH, register: "formal", exemplars: ["哼。"] });
  });
});

// ── 端到端：真实 ProjectSession + 脚本化 tool_use ────────────────────────

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function toolUse(name: string, input: unknown): CallResult {
  return {
    kind: "ok",
    message: modelMessage(
      [{ type: "tool_use", id: `t-${name}`, name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock],
      "tool_use",
    ),
  };
}

/** 一回合：依次执行给定工具调用，最后回一句文本。返回 effects 与每次调用的入参。 */
async function turn(root: string, uses: readonly [string, unknown][]) {
  const results = [...uses.map(([name, input]) => toolUse(name, input)), modelText("好。")];
  const { client, calls } = fakeClient(results);
  const session = new ProjectSession(root, undefined, { client });
  const reply = await session.converse("请照做");
  return { session, effects: reply.effects, calls };
}

function freshRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "novel-forge-prep-tools-"));
  roots.push(root);
  new ProjectStore(root).save(scaffoldSnapshot({ title: "测试作品", genre: "xuanhuan", platform: "fanqie" }));
  return root;
}

const failed = (effects: readonly AgentEffect[]): string[] =>
  effects.flatMap((e) => (e.kind === "action_failed" ? [e.message] : []));

describe("筹备工具经 ProjectSession 端到端", () => {
  it("set_direction 落盘并即时可读；get_direction 回全文", async () => {
    const root = freshRoot();
    const { effects, calls } = await turn(root, [
      ["set_direction", { premise: "少年查案", pov: "first", taboos: ["虐主"] }],
      ["get_direction", {}],
    ]);
    expect(effects).toEqual([{ kind: "setting_updated", fields: ["premise", "pov", "taboos"] }]);
    const back = new ProjectSession(root).meta.setting;
    expect(back.premise).toBe("少年查案");
    expect(back.pov).toBe("first");
    expect(back.title).toBe("测试作品"); // 未触碰的字段保持
    const directionResult = lastToolResult(calls[2]?.messages);
    expect(directionResult.is_error).toBeUndefined();
    expect(JSON.parse(directionResult.content as string)).toMatchObject({ setting: { premise: "少年查案" }, discipline: { version: "d1" } });
  });

  it("upsert_character：顺序分配 C01/C02，同名即更新，未知 id 报失败，同回合内可读到新人物", async () => {
    const root = freshRoot();
    const { effects, calls } = await turn(root, [
      ["upsert_character", { name: "李长风", tier: "protagonist", role: "落魄捕快" }],
      ["upsert_character", { name: "苏晚晴", tier: "major" }],
      ["upsert_character", { name: "李长风", tier: "major", speech: { exemplars: ["你再说一遍。"] } }],
      ["upsert_character", { id: "C09", name: "无此人" }],
      ["get_character", { name: "苏晚晴" }],
    ]);
    expect(effects.slice(0, 3)).toEqual([
      { kind: "character_upserted", id: "C01", name: "李长风", created: true },
      { kind: "character_upserted", id: "C02", name: "苏晚晴", created: true },
      { kind: "character_upserted", id: "C01", name: "李长风", created: false },
    ]);
    expect(failed(effects)).toEqual([expect.stringContaining("C09")]);
    const chars = new ProjectSession(root).meta.characters;
    expect(chars.map((c) => c.id)).toEqual(["C01", "C02"]);
    expect(chars[0]).toMatchObject({ tier: "major", profile: { role: "落魄捕快" }, speech: { exemplars: ["你再说一遍。"] }, provenance: "authored" });
    // 第 5 次工具调用（get_character）在同一回合读到本回合新建的人物
    const card = lastToolResult(calls[5]?.messages);
    expect(card.is_error).toBeUndefined();
    expect(JSON.parse(card.content as string)).toMatchObject({ id: "C02", name: "苏晚晴" });
  });

  it("称谓表引用不存在的人物 → 失败，不写入", async () => {
    const root = freshRoot();
    const { effects } = await turn(root, [
      ["upsert_character", { name: "甲", speech: { addressForms: [{ target: "C02", form: "师兄" }] } }],
    ]);
    expect(failed(effects)).toEqual([expect.stringContaining("C02")]);
    expect(new ProjectSession(root).meta.characters).toHaveLength(0);
  });

  it("upsert_location / define_plotline：分配 S01 / P01，同名更新不新建", async () => {
    const root = freshRoot();
    const { effects } = await turn(root, [
      ["upsert_location", { name: "集市", description: "三州交界的商埠" }],
      ["upsert_location", { name: "集市", facts: ["每逢初一开市"] }],
      ["upsert_location", { name: "青云门", kind: "organization" }],
      ["define_plotline", { label: "复仇主线", weight: "main" }],
      ["define_plotline", { id: "P01", weight: "sub" }],
      ["define_plotline", { id: "P07", label: "无此线" }],
    ]);
    expect(effects.filter((e) => e.kind !== "action_failed")).toEqual([
      { kind: "location_upserted", id: "S01", name: "集市", created: true },
      { kind: "location_upserted", id: "S01", name: "集市", created: false },
      { kind: "location_upserted", id: "S02", name: "青云门", created: true },
      { kind: "plotline_defined", id: "P01", label: "复仇主线", created: true },
      { kind: "plotline_defined", id: "P01", label: "复仇主线", created: false },
    ]);
    expect(failed(effects)).toEqual([expect.stringContaining("P07")]);
    const meta = new ProjectSession(root).meta;
    expect(meta.settings).toEqual([
      { id: "S01", name: "集市", kind: "location", description: "三州交界的商埠", facts: ["每逢初一开市"] },
      { id: "S02", name: "青云门", kind: "organization", description: "", facts: [] },
    ]);
    expect(meta.plotLines).toEqual([{ id: "P01", label: "复仇主线", weight: "sub" }]);
  });

  it("set_discipline：版本 d1 → a1 → a2，条目整体替换", async () => {
    const root = freshRoot();
    const { effects } = await turn(root, [
      ["set_discipline", { rules: ["第三人称有限视角。", "对白不解释读者已知的事。"] }],
      ["set_discipline", { rules: ["第三人称有限视角。"] }],
    ]);
    expect(effects).toEqual([
      { kind: "discipline_updated", version: "a1", count: 2 },
      { kind: "discipline_updated", version: "a2", count: 1 },
    ]);
    expect(new ProjectSession(root).meta.discipline).toEqual({ version: "a2", rules: ["第三人称有限视角。"] });
  });

  it("plan_chapter：引用缺失 / V2 block 都不落盘；合法则 authored + 预算 + 下一章就绪", async () => {
    const root = freshRoot();
    const base = {
      chapterType: "event",
      coreEvent: "主角在集市查到一条线索",
      stageFeedback: "主角确认了一个疑点",
      hook: "对方提到一个不该知道的名字",
      events: [{ kind: "action", summary: "与线人交涉逼出实话", weight: 1, plotLine: "P01" }],
      characters: ["C01"],
      locations: ["S01"],
    };
    const { effects, session } = await turn(root, [
      ["plan_chapter", base], // 人物/场景/情节线都还不存在
      ["upsert_character", { name: "李长风", tier: "protagonist" }],
      ["upsert_location", { name: "集市" }],
      ["define_plotline", { label: "复仇主线", weight: "main" }],
      ["plan_chapter", { ...base, stageFeedback: "继续铺垫主线" }], // V2 block
      ["plan_chapter", { ...base, chapterType: "payoff" }], // 回收章无收束 → block
      ["plan_chapter", base],
      ["plan_chapter", { ...base, chapter: 3, coreEvent: "他先查账，然后追人，接着被伏击" }], // 连接词过多 → warn
    ]);
    const fails = failed(effects);
    expect(fails).toHaveLength(3);
    expect(fails[0]).toMatch(/人物 C01.*场景 S01.*情节线 P01/u);
    expect(fails[1]).toMatch(/铺垫|继续/u);
    expect(fails[2]).toMatch(/payoff/u);
    expect(effects.filter((e) => e.kind === "chapter_planned")).toEqual([
      { kind: "chapter_planned", chapter: 1, chapterType: "event", warnings: 0 },
      { kind: "chapter_planned", chapter: 3, chapterType: "event", warnings: 1 },
    ]);
    expect(session.nextBeat).toMatchObject({ chapter: 1, provenance: "authored" });
    expect(session.nextBeat?.budget?.words.min).toBeGreaterThan(0);
    const back = new ProjectSession(root);
    expect(back.meta.beats.map((b) => b.chapter)).toEqual([1, 3]);
    expect(back.beatFor(1)?.plan.events).toHaveLength(1);
  });

  it("plan_chapter 不能排已有正文的章", async () => {
    const root = freshRoot();
    const seed = new ProjectSession(root);
    seed.putChapter(1, "第一章正文。");
    const { effects } = await turn(root, [
      ["plan_chapter", { chapter: 1, chapterType: "setup", coreEvent: "a", stageFeedback: "b", hook: "c" }],
    ]);
    expect(failed(effects)).toEqual([expect.stringContaining("第 1 章已有正文")]);
  });
});

/** 取某次模型调用入参里最后一条 user 消息的首个 tool_result。 */
function lastToolResult(messages: readonly Anthropic.MessageParam[] | undefined): Anthropic.ToolResultBlockParam {
  const last = messages?.[messages.length - 1];
  if (last === undefined || typeof last.content === "string") throw new Error("最后一条消息不是 tool_result");
  const block = last.content[0];
  if (block === undefined || block.type !== "tool_result") throw new Error("首块不是 tool_result");
  return block;
}
