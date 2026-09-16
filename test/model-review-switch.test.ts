/**
 * 两个 model 通道的开关（`rules.review`）。
 *
 * 它们是整条检查链上唯一发网络请求的部分：每章各一次调用。长篇对成本敏感，
 * 所以要有一个按作品关掉的旋钮 —— 这个文件钉住它**真的省下了调用**，
 * 而不只是少出一条 finding。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { deriveBudget } from "../src/beat/derive.js";
import { loadRules } from "../src/rules/load.js";
import { countWords } from "../src/text/measure.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, PROSE, SEMANTIC_OK, VOICE_OK, WRITE_BEAT, fakeClient, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

const base = loadRules();
const target = deriveBudget(WRITE_BEAT.plan, writingSnapshot().profile, base).words.sweet;
// 正文补到预算内，免得字数不足触发自动修订多出一次改写调用 —— 那会盖住本文件要测的东西。
// 末行是一句可归属的台词，否则声音通道本来就跳过（没有台词可判）。
const BODY = `${PROSE}\n李长风说：「钥匙在我这儿。」\n${"风".repeat(target - countWords(PROSE))}`;

/**
 * 跑一次写章，返回用掉的脚本应答条数。
 * 关掉自动修订：本文件测的是 model 通道开不开，不是修订额度。
 */
async function writes(review: { voice: boolean; semantics: boolean }, script: readonly CallResult[]) {
  const root = mkdtempSync(join(tmpdir(), "nf-review-switch-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const model = fakeClient(script);
  const rules = { ...base, review, task: { ...base.task, maxAutoRevisions: 0 } };
  await new ProjectSession(root, rules, { client: model.client }).writeChapter({ chapter: 3 });
  return model.calls.length;
}

describe("model 通道的开关", () => {
  it("默认开着：声明之后追加声音判定与语义核对两次调用", async () => {
    expect(loadRules().review).toEqual({ voice: true, semantics: true });
    // C5 声明收束了伏笔，正文里也有可归属的台词 —— 两边的判定前提都成立。
    const used = await writes({ voice: true, semantics: true }, [modelText(BODY), modelText(C5_JSON), VOICE_OK, SEMANTIC_OK]);
    expect(used).toBe(4);
  });

  it("关掉时不发那两次调用，代码通道的结论照常", async () => {
    const used = await writes({ voice: false, semantics: false }, [modelText(BODY), modelText(C5_JSON)]);
    expect(used).toBe(2);
  });

  it("两个开关各管各的", async () => {
    expect(await writes({ voice: true, semantics: false }, [modelText(BODY), modelText(C5_JSON), VOICE_OK])).toBe(3);
    expect(await writes({ voice: false, semantics: true }, [modelText(BODY), modelText(C5_JSON), SEMANTIC_OK])).toBe(3);
  });
});
