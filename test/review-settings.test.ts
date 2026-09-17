/**
 * 按作品的模型审查开关。
 *
 * 两个 model 通道（声音判定、语义核对）是整条检查链上唯一发网络请求的部分，
 * 每章各一次。旋钮必须交到作者手上，而不是只躺在 `rules.yaml` 里。
 *
 * 这个文件最要紧的一条是**改开关不作废草稿**：来源指纹里含整个 `rules`，
 * 所以开关不能走 rules 那条路 —— 关掉一项建议性审查，不应该影响正文的生成依据。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { chapterInputFingerprint } from "../src/server/chapter-input.js";
import { deriveBudget } from "../src/beat/derive.js";
import { loadRules } from "../src/rules/load.js";
import { countWords } from "../src/text/measure.js";
import { handleAsync } from "../src/server/api.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, PROSE, SEMANTIC_OK, VOICE_OK, WRITE_BEAT, fakeClient, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const base = loadRules();
const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, base).words.sweet;
// 补到预算内避免触发自动修订；末行是可归属的台词，否则声音通道本来就跳过。
const BODY = `${PROSE}\n李长风说：「钥匙在我这儿。」\n${"风".repeat(target - countWords(PROSE))}`;
const noAuto = { ...base, task: { ...base.task, maxAutoRevisions: 0 } };

function fresh() {
  const root = mkdtempSync(join(tmpdir(), "nf-review-settings-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return root;
}
const open = (root: string, script: readonly CallResult[] = []) => {
  const model = fakeClient(script);
  return { model, session: new ProjectSession(root, noAuto, { client: model.client }) };
};
const api = (session: ProjectSession, method: "GET" | "POST", body?: unknown) =>
  handleAsync(session, { method, path: "/api/review-settings", query: new URLSearchParams(), body });

describe("按作品的模型审查开关", () => {
  it("新作品没有设置文件时回落到 rules 的全局默认", () => {
    const { session } = open(fresh());
    expect(session.reviewSettings).toEqual(base.review);
    expect(base.review).toEqual({ voice: true, semantics: true });
  });

  it("保存后重开仍然生效，且按作品各存各的", () => {
    const first = fresh();
    const second = fresh();
    open(first).session.setReviewSettings({ voice: false, semantics: true });
    expect(new ProjectSession(first).reviewSettings).toEqual({ voice: false, semantics: true });
    // 另一本书不受影响 —— 这正是"按作品"的意义。
    expect(new ProjectSession(second).reviewSettings).toEqual(base.review);
  });

  it("改开关不改变来源指纹 —— 关掉一项建议性审查不该作废任何草稿", () => {
    const root = fresh();
    const { session } = open(root);
    const before = chapterInputFingerprint(session, 3);
    session.setReviewSettings({ voice: false, semantics: false });
    expect(chapterInputFingerprint(session, 3)).toBe(before);
    // 重开的会话读到的也是同一个指纹（同一套 rules —— 指纹本来就含 rules，
    // 这里要隔离的是"开关"这一个变量）。
    expect(chapterInputFingerprint(new ProjectSession(root, noAuto), 3)).toBe(before);
  });

  it("关掉后写章真的省下那两次调用", async () => {
    const root = fresh();
    open(root).session.setReviewSettings({ voice: false, semantics: false });
    const { model, session } = open(root, [modelText(BODY), modelText(C5_JSON)]);
    await session.writeChapter({ chapter: 3 });
    expect(model.calls).toHaveLength(2);
  });

  it("开着时照常追加两次调用", async () => {
    const root = fresh();
    open(root).session.setReviewSettings({ voice: true, semantics: true });
    const { model, session } = open(root, [modelText(BODY), modelText(C5_JSON), VOICE_OK, SEMANTIC_OK]);
    await session.writeChapter({ chapter: 3 });
    expect(model.calls).toHaveLength(4);
  });

  it("API 能读能写，拒绝非布尔值", async () => {
    const { session } = open(fresh());
    expect((await api(session, "GET")).body).toEqual(base.review);
    const saved = await api(session, "POST", { voice: false, semantics: true });
    expect(saved.status).toBe(200);
    expect(saved.body).toEqual({ voice: false, semantics: true });
    expect((await api(session, "GET")).body).toEqual({ voice: false, semantics: true });
    for (const bad of [null, "nope", { voice: "yes", semantics: true }, { voice: true }]) {
      expect((await api(session, "POST", bad)).status).toBe(400);
    }
    // 被拒的请求不能改掉已保存的值。
    expect(session.reviewSettings).toEqual({ voice: false, semantics: true });
  });

  it("设置文件损坏时明确报错，不静默当成默认值", () => {
    const root = fresh();
    writeFileSync(join(root, "review.json"), "{broken", "utf8");
    expect(() => new ProjectSession(root).reviewSettings).toThrow(/review\.json/u);
  });

  it("只读浏览不写文件 —— 没碰过开关的作品不该凭空多出一个文件", () => {
    const root = fresh();
    const { session } = open(root);
    expect(session.reviewSettings).toEqual(base.review);
    expect(existsSync(join(root, "review.json"))).toBe(false);
  });
});
