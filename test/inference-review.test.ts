import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { fakeClient, modelText, SINGLE_PASS_RULES, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const chapter = "李长风收起钥匙。钥匙上的红泥已经干透。";
const declaration = (quote = "李长风收起钥匙。") => ({
  events: [{ kind: "action", summary: "李长风收好钥匙", weight: 1, plot_line: "P01", participants: ["C01"], quote }],
  foreshadow_planted: [{ label: "青铜钥匙", intent: "钥匙将打开密库", weight: "main", visibility: "overt", expected_by: 3, quote: "李长风收起钥匙。" }],
  foreshadow_resolved: [], relations_changed: [], character_states: [], character_presence: [{ character_id: "C01", role: "pov" }],
});
async function setup(badQuote = false, unknownCharacter: boolean | string = false, confirmFirst = true) {
  const root = mkdtempSync(join(tmpdir(), "nf-infer-review-")); roots.push(root);
  const store = new ProjectStore(root);
  store.save({ ...writingSnapshot(), chapters: new Map([[1, chapter], [2, chapter]]), beats: [], events: [] });
  const second = declaration(badQuote ? "不存在的引文" : undefined);
  if (unknownCharacter) second.character_presence.push({ character_id: typeof unknownCharacter === "string" ? unknownCharacter : "C_unknown", role: "major" });
  const model = fakeClient([modelText(JSON.stringify(declaration())), modelText(JSON.stringify(second))]);
  const session = new ProjectSession(root, SINGLE_PASS_RULES, { client: model.client });
  await session.inference.infer({ chapter: 1 });
  if (confirmFirst) session.inference.confirm({ chapter: 1 });
  const problem = await session.inference.infer({ chapter: 2 });
  return { root, store, session, problem, model };
}

it("重复声明不走普通确认；作者复核后只确认有效部分并留下排除原因", async () => {
  const { session, problem, model } = await setup();
  expect(problem.state).toBe("problem");
  expect(() => session.inference.confirm({ chapter: 2 })).toThrow();
  expect(problem.review?.declaration.events).toHaveLength(1);
  expect(problem.review?.declaration.foreshadowPlanted).toHaveLength(0);
  const result = session.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token });
  expect(result.committed).toBeGreaterThan(0);
  const current = session.inference.view().chapters[1]!;
  expect(current.state).toBe("confirmed");
  expect(current.warnings.join("")).toContain("青铜钥匙");
  expect(session.chapterText(2)).toBe(chapter);
  expect(model.calls).toHaveLength(2);
});

it("重启保留复核候选；伪造令牌和重复提交不能追加事实", async () => {
  const { root, problem } = await setup();
  const fresh = new ProjectSession(root, SINGLE_PASS_RULES);
  expect(() => fresh.inference.confirmValid({ chapter: 2, reviewToken: "wrong" })).toThrow(/变化|令牌|复核/u);
  fresh.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token });
  const count = fresh.events().length;
  expect(() => fresh.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token })).toThrow();
  expect(fresh.events()).toHaveLength(count);
});

it("正文变化后旧复核令牌失效，不对新稿使用旧候选", async () => {
  const { root, store, problem } = await setup();
  const snap = store.load();
  store.save({ ...snap, chapters: new Map([...snap.chapters, [2, chapter + "新增一句。"]]) });
  const fresh = new ProjectSession(root, SINGLE_PASS_RULES);
  expect(fresh.inference.view().chapters[1]?.review).toBeUndefined();
  expect(() => fresh.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token })).toThrow();
});

it("有效部分仍有失效引用时不给复核放行入口", async () => {
  const { session, problem } = await setup(true);
  expect(problem.review).toBeUndefined();
  expect(() => session.inference.confirmValid({ chapter: 2, reviewToken: "anything" })).toThrow();
});

it("未知人物错误不能借重复伏笔复核入口一并排除", async () => {
  const { session, problem } = await setup(false, true);
  expect(problem.problems.join("")).toContain("C_unknown");
  expect(problem.review).toBeUndefined();
  expect(() => session.inference.confirmValid({ chapter: 2, reviewToken: "anything" })).toThrow();
});

it("未知编号包含重复提示的字样也不能冒充可排除的问题类别", async () => {
  const { problem } = await setup(false, "C_已有同名伏笔");
  expect(problem.review).toBeUndefined();
});

it("前章必须先确认；仅确认相同内容不会无故作废后章复核，避免额外模型调用", async () => {
  const { session, problem, model } = await setup(false, false, false);
  expect(problem.review).toBeDefined();
  expect(() => session.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token })).toThrow(/第 1 章/u);
  session.inference.confirm({ chapter: 1 });
  expect(session.inference.view().chapters[1]?.review?.token).toBe(problem.review?.token);
  session.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token });
  expect(model.calls).toHaveLength(2);
});

it("作者可以取消保留语义仍存疑的记录，选择本身留档而不改正文", async () => {
  const { session, problem } = await setup();
  session.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token, excludedRecords: [{ section: "events", index: 0 }] });
  expect(session.events().filter(e => e.envelope.chapter === 2 && e.payload.type === "plot_event")).toHaveLength(0);
  expect(session.inference.view().chapters[1]?.warnings.join("")).toContain("作者另行排除");
  expect(session.chapterText(2)).toBe(chapter);
});

it("排除全部记录或伪造编辑字段不能确认，也不产生部分写入", async () => {
  const { session, problem } = await setup();
  const count = session.events().length;
  expect(() => session.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token, excludedRecords: [{ section: "events", index: 0 }, { section: "characterPresence", index: 0 }] })).toThrow(/没有|为空|至少/u);
  expect(() => session.inference.confirmValid({ chapter: 2, reviewToken: problem.review?.token, excludedRecords: [{ section: "events", index: 0, value: "伪造替换" }] })).toThrow();
  expect(session.events()).toHaveLength(count);
});
