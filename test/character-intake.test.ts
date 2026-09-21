/**
 * 导入旧稿之后接上人物（差距第 2 项的收尾）。
 *
 * 两条判断：
 *   ① **资料文件是人物信息的主来源。** 作者手上的「角色档案」比正文可靠也更完整，
 *      而且正文动辄几十万字塞不进上下文 —— 资料全文进、正文只取抽样片段。
 *   ② **「他第一次出现在第几章」由代码扫正文得出，不问模型。** 那是一次确定性
 *      的字符串查找，模型给不出更准的答案，却可能给一个错的。
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Anthropic from "@anthropic-ai/sdk";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { MaterialStore } from "../src/import/materials.js";
import { characterSource } from "../src/preparation/sources.js";
import type { CallResult } from "../src/client/claude.js";
import { fakeClient, modelMessage, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

function empty() {
  const root = mkdtempSync(join(tmpdir(), "nf-intake-"));
  roots.push(root);
  const base = writingSnapshot();
  new ProjectStore(root).save({
    ...base, setting: { ...base.setting, centralConflict: "", openingSituation: "" },
    characters: [], settings: [], plotLines: [], beats: [], events: [], chapters: new Map(),
  });
  return { root, session: new ProjectSession(root, undefined) };
}

const file = (name: string, text: string) => ({ name, text });
const chapterFile = (n: number, body: string) => file(`${n}-第${n}章.txt`, `第${n}章 标题${n}\n\n${body}`);

describe("导入时收下资料文件", () => {
  it("没有章节标记的文件落进 materials/，正文照常入库", async () => {
    const { root, session } = empty();
    const result = session.imports.apply({ files: [
      chapterFile(1, "沈叙在复核室里翻旧卷。"),
      file("角色档案.txt", "沈叙：市局复核民警，冷静克制。\n林见秋：一中教师。"),
    ] });
    expect(result.imported).toEqual([1]);
    expect(result.materials).toEqual(["角色档案.txt"]);
    expect(session.chapterText(1)).toBe("沈叙在复核室里翻旧卷。");
    const saved = new MaterialStore(root).read("角色档案.txt");
    expect(saved).toContain("市局复核民警");
    // 资料不是正文：chapterNumbers 不受它影响。
    expect(session.chapterNumbers()).toEqual([1]);
  });

  it("同名资料再导入时按最新一份覆盖 —— 那是作者改过的版本", () => {
    const { root, session } = empty();
    session.imports.apply({ files: [chapterFile(1, "正文。"), file("角色档案.txt", "旧：一版。")] });
    session.imports.apply({ files: [chapterFile(2, "正文二。"), file("角色档案.txt", "沈叙：改过的一版。")] });
    expect(new MaterialStore(root).read("角色档案.txt")).toBe("沈叙：改过的一版。");
    expect(new MaterialStore(root).list().map((m) => m.name)).toEqual(["角色档案.txt"]);
  });

  it("落盘名净化：带路径的文件名不会写到作品目录之外", () => {
    const { root, session } = empty();
    session.imports.apply({ files: [chapterFile(1, "正文。"), file("../../evil.txt", "越界内容")] });
    expect(existsSync(join(root, "evil.txt"))).toBe(false);
    const saved = new MaterialStore(root).list();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.file).not.toContain("/");
    expect(saved[0]?.file).not.toContain("..");
    expect(existsSync(join(root, "materials", saved[0]!.file))).toBe(true);
  });

  it("过大的资料跳过并在 notes 里说明，不影响正文导入", () => {
    const { root, session } = empty();
    const huge = "字".repeat(400_000);
    const files = [chapterFile(1, "正文。"), file("巨型设定.txt", huge)];
    const preview = session.imports.preview({ files });
    expect(preview.chapters).toHaveLength(1);
    expect(preview.notes.some((n) => n.includes("巨型设定.txt") && n.includes("过大"))).toBe(true);
    expect(preview.ready).toBe(true);

    // 说了不收就真的不收 —— 只提示不拦，等于提示是假的。
    const result = session.imports.apply({ files });
    expect(result.imported).toEqual([1]);
    expect(result.materials).toEqual([]);
    expect(new MaterialStore(root).list()).toEqual([]);
  });

  it("资料不进作品列表与摘要 —— 它不是作品内容", () => {
    const { root } = empty();
    new ProjectSession(root, undefined).imports.apply({ files: [chapterFile(1, "正文。"), file("角色档案.txt", "沈叙。")] });
    const store = new ProjectStore(root);
    expect(store.load().chapters.size).toBe(1);
    expect(readdirSync(root)).toContain("materials");
  });
});

describe("人物来源的装配", () => {
  it("资料全文进上下文，正文只取抽样片段", () => {
    const chapters = new Map<number, string>();
    for (let n = 1; n <= 100; n++) chapters.set(n, `第${n}章的正文。${"填充。".repeat(300)}`);
    const source = characterSource({
      materials: [{ name: "角色档案.txt", text: "沈叙：市局复核民警。" }],
      chapterNumbers: [...chapters.keys()],
      chapterText: (n) => chapters.get(n),
    });
    expect(source.text).toContain("沈叙：市局复核民警。");
    expect(source.from).toContain("角色档案.txt");
    // 一百章只取固定几段，且明确说出抽了哪几章 —— 否则作者会以为模型读完了全书。
    expect(source.sampled.length).toBeGreaterThan(0);
    expect(source.sampled.length).toBeLessThan(12);
    expect(source.text).toContain(`第 ${source.sampled[0]} 章`);
    expect(source.text).not.toContain("第 100 章的正文。");
  });

  it("没有资料文件时仍给出抽样正文，取哪几段是确定的", () => {
    const chapters = new Map<number, string>();
    for (let n = 1; n <= 50; n++) chapters.set(n, `第${n}章的正文。`);
    const build = () => characterSource({ materials: [], chapterNumbers: [...chapters.keys()], chapterText: (n) => chapters.get(n) });
    expect(build().sampled).toEqual(build().sampled);
    expect(build().sampled).toContain(1);
    expect(build().from).toEqual([]);
  });

  it("没有正文也没有资料时说明清楚，不编造", () => {
    const source = characterSource({ materials: [], chapterNumbers: [], chapterText: () => undefined });
    expect(source.sampled).toEqual([]);
    expect(source.text).toContain("没有");
  });
});

describe("从正文识别人物", () => {
  const toolUse = (name: string, input: unknown): CallResult => ({
    kind: "ok",
    message: modelMessage([{ type: "tool_use", id: "t1", name, input, caller: { type: "direct" } } as unknown as Anthropic.ContentBlock], "tool_use"),
  });
  const drafted = (id: string, name: string, tier = "major") => ({
    id, name, aliases: [], tier,
    profile: { role: "复核民警", appearance: [], traits: ["冷静"], forbiddenBehaviors: [], wants: "查清旧案", fears: "发现自己是帮凶", background: "借调进专班。" },
    speech: { sentenceLength: { min: 4, max: 14 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [], syntaxBias: { question: 0.1, imperative: 0.2, elliptical: 0.4 }, register: "neutral", emotionalExpression: "suppressed", exemplars: ["先看记录。"], counterExemplars: [] },
  });

  /** 方案必须带正确的 baseFingerprint 才收；脚本要按当时的资料算。 */
  function withText(chapters: Record<number, string>, plan: (fingerprint: string) => CallResult[]) {
    const root = mkdtempSync(join(tmpdir(), "nf-intake-id-"));
    roots.push(root);
    const base = writingSnapshot();
    new ProjectStore(root).save({
      ...base, setting: { ...base.setting, centralConflict: "", openingSituation: "" },
      characters: [], settings: [], plotLines: [], beats: [], events: [],
      chapters: new Map(Object.entries(chapters).map(([n, t]) => [Number(n), t])),
    });
    const fingerprint = new ProjectSession(root, undefined).preparation.view().fingerprint;
    const { client, calls } = fakeClient(plan(fingerprint));
    return { root, calls, session: new ProjectSession(root, undefined, { client }) };
  }

  it("识别人物把资料与抽样正文一起交给模型，产出待确认方案", async () => {
    const { calls, session } = withText(
      { 1: "沈叙在复核室里翻旧卷。", 2: "林见秋走进来。" },
      (fingerprint) => [
        toolUse("propose_preparation", { summary: "从正文与资料识别人物", baseFingerprint: fingerprint, changes: { characters: [drafted("C01", "沈叙", "protagonist"), drafted("C02", "林见秋")] } }),
        modelText("识别完成。"),
      ],
    );
    const result = await session.draftPreparation({ focus: "characters", apply: true });
    const shown = JSON.stringify(calls[0]?.messages);
    expect(shown).toContain("沈叙在复核室里翻旧卷");
    expect(result.proposalId).toBeDefined();
    // 只落方案，不动正式资料。
    expect(session.meta.characters).toEqual([]);
  });

  it("首次出场章由代码扫正文得出，模型不必也不该管", async () => {
    // 沈叙在第 1 章就出现，林见秋到第 3 章才出场。
    const { session } = withText(
      { 1: "沈叙翻旧卷。", 2: "雨还在下。", 3: "林见秋走进来。" },
      (fingerprint) => [
        toolUse("propose_preparation", { summary: "识别人物", baseFingerprint: fingerprint, changes: { characters: [drafted("C01", "沈叙", "protagonist"), drafted("C02", "林见秋")] } }),
        modelText("完成。"),
      ],
    );
    const proposed = await session.draftPreparation({ focus: "characters", apply: true });
    const proposal = session.preparation.get(proposed.proposalId!);
    const at = (name: string) => proposal.content.characters.find((c) => c.name === name)?.introducedAt;
    expect(at("沈叙")).toBe(1);
    expect(at("林见秋")).toBe(3);
  });
});
