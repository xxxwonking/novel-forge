/** chat 单章实测：新建独立作品，复用写章/采用 API，保留正文和报告。 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ChatClient } from "../client/chat.js";
import type { ModelClient } from "../client/model.js";
import { WRITING_DISCIPLINE } from "../context/discipline.js";
import { ProjectStore, type ProjectSnapshot } from "../store/persist.js";
import { ProjectSession } from "../server/state.js";
import { handle, handleAsync } from "../server/api.js";
import { buildChapterReadSource, buildChapterRunInput } from "../server/chapter-input.js";
import { loadRules } from "../rules/load.js";
import { countWords } from "../text/measure.js";
import type { ChapterDraft } from "../task/types.js";

function snapshot(now: string): ProjectSnapshot {
  const character = (id: "C01" | "C02", name: string, role: string, wants: string): ProjectSnapshot["characters"][number] => ({
    id, name, aliases: [], tier: id === "C01" ? "protagonist" : "major", introducedAt: 1,
    profile: { role, appearance: [], traits: ["谨慎", "重证据"], forbiddenBehaviors: ["不靠直觉断定真凶"], wants, fears: "证据被毁", background: role },
    speech: { sentenceLength: { min: 4, max: 22 }, verbalTics: [], signatureLexicon: [], forbiddenLexicon: [], addressForms: [], syntaxBias: { question: 0.2, imperative: 0.2, elliptical: 0.2 }, register: "neutral", emotionalExpression: "suppressed", exemplars: ["先把日期对上。", "这一页谁动过？"], counterExemplars: [] },
    provenance: "authored", updatedAt: now,
  });
  return {
    setting: {
      title: "雨夜账册", genre: "mystery", platform: "fanqie",
      premise: "年轻账房从失踪的一页账册追查河运银两的去向。", centralConflict: "证据指向熟人，销毁旧账的期限就在眼前。",
      pov: "third_limited", tense: "past", protagonistTraits: ["谨慎", "重证据"], protagonistForbidden: ["不凭直觉定罪"],
      specialAbility: "熟悉账册的装订、墨色和搬运记号。", abilityLimits: ["只能从实物及已知记录推断，不能预知他人内心"],
      worldRules: ["架空近代河港，使用纸质账册，没有超自然力量", "所有调查发现都需要可以看见或核对的依据"],
      openingSituation: "雨夜，旧账库即将腾空，沈砚获准在顾青看守下寻找失踪账页。",
      styleKeywords: ["具体动作", "克制", "线索清楚"], romanceLine: "本段没有感情线。", taboos: ["不借巧合直接揭晓幕后主使"],
    },
    profile: { platform: "fanqie", genre: "mystery", targetWords: 100_000 },
    discipline: { version: `${WRITING_DISCIPLINE.version}-chat-smoke`, rules: [...WRITING_DISCIPLINE.rules, "只输出完整小说正文，不附创作说明。", "仅安排已给出人物档案的人直接出场。"] },
    settings: [{ id: "S01", name: "旧账库", kind: "location", description: "河港账房的砖木库房，雨夜正在清空旧账。", facts: ["库内木架靠墙排列，装订工具留在窗边", "顾青负责看守，沈砚获准查账"] }],
    characters: [character("C01", "沈砚", "年轻账房，负责核对河运账目", "在旧账清空前找到失踪账页"), character("C02", "顾青", "旧账库守夜人", "守住账库并查明有人擅动旧账的缘由")],
    plotLines: [{ id: "P01", label: "失踪账页", weight: "main" }],
    beats: [{ chapter: 1, volume: 1, provenance: "authored", updatedAt: now, budget: null, plan: {
      chapterType: "event", coreEvent: "沈砚在旧账库找到失踪账页，并核实搬运记录被人伪造。", secondaryThread: null,
      stageFeedback: "沈砚取出账页，找到与搬运记录不符的日期。", hook: "账页背面写着顾青父亲的名字。",
      events: [{ kind: "info", summary: "沈砚找到失踪账页并核实搬运记录造假", weight: 2, plotLine: "P01" }],
      resolves: [], plants: [], characters: ["C01", "C02"], locations: ["S01"],
    } }],
    alertStates: [], events: [], chapters: new Map(),
  };
}

export async function runChatSmoke(
  parent: string, client: ModelClient, model: string,
  options: { readonly usage?: () => readonly unknown[]; readonly log?: (message: string) => void } = {},
) {
  const startedAt = new Date().toISOString();
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, `chat-smoke-${startedAt.slice(0, 10)}-`));
  new ProjectStore(root).save(snapshot(startedAt));
  const session = new ProjectSession(root, loadRules(), { client });
  const input = buildChapterRunInput(session, 1);
  const budget = input.assembleInput.volatile.beat.budget!.words;
  options.log?.(`测试作品：${root}\n模型：${model}；目标字数 ${budget.min}–${budget.max}。开始写章。`);
  const response = await handleAsync(session, { method: "POST", path: "/api/chapter/write", query: new URLSearchParams(), body: { chapter: 1 } });
  if (response.status !== 200) throw new Error(`写章准备失败：HTTP ${response.status}`);
  const draft = response.body as ChapterDraft;
  let adopted = false;
  let nextChapterReadsBody = false;
  if (draft.status === "ready") {
    const adoption = handle(session, { method: "POST", path: "/api/chapter/adopt", query: new URLSearchParams(), body: { chapter: 1, draftId: draft.draftId } });
    adopted = adoption.status === 200 && session.chapterText(1) === draft.body;
    if (adopted) {
      const first = session.beatFor(1)!;
      session.putBeat({ ...first, chapter: 2, plan: { ...first.plan, coreEvent: "沈砚与顾青核对账页背面的签名。", stageFeedback: "顾青辨认出父亲的签名，指出可供核对的旧记录。", hook: "记录中的送货地址竟是已经封闭的码头。", events: [{ kind: "info", summary: "顾青指出核对签名的旧记录", weight: 2, plotLine: "P01" }] } });
      buildChapterRunInput(session, 2);
      nextChapterReadsBody = buildChapterReadSource(session, 2).loadChapter(1, "full") === draft.body;
    }
  }
  const report = {
    startedAt, finishedAt: new Date().toISOString(), model, protocol: "chat/completions", status: draft.status,
    draftId: draft.draftId, words: countWords(draft.body), budget, acceptable: draft.acceptable,
    error: draft.error, findings: draft.findings, adopted, nextChapterReadsBody,
    successfulModelCalls: options.usage?.() ?? [],
    scope: "单章真实流程检查；不代表连续创作质量或 Claude 官方缓存验收。",
  };
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  const findings = draft.findings.map((finding) => `- ${finding.level} / ${finding.rule}：${finding.message}`).join("\n") || "无。";
  writeFileSync(join(root, "report.md"), `# Gemini chat 单章测试\n\n模型：${model}\n\n状态：${draft.status}；字数：${report.words}；目标范围：${budget.min}–${budget.max}。\n\n测试作品采用：${adopted}；下一章读取采用正文：${nextChapterReadsBody}。\n\n[查看正文](drafts/ch1/${draft.draftId}.txt)\n\n## 检查结果\n\n${findings}\n\n${draft.error === null ? "" : `失败步骤：${draft.error.step}；${draft.error.detail}\n\n`}${report.scope}\n`, "utf8");
  return { root, report };
}

async function main() {
  if (process.env.NOVEL_MODEL_PROVIDER !== "chat") throw new Error("单章 chat 实测要求 NOVEL_MODEL_PROVIDER=chat");
  const required = (name: string) => {
    const value = process.env[name]?.trim();
    if (!value) throw new Error(`缺少 ${name}`);
    return value;
  };
  const usage: unknown[] = [];
  const model = required("CHAT_MODEL");
  const client = new ChatClient({ baseURL: required("CHAT_BASE_URL"), apiKey: required("CHAT_API_KEY"), model, onUsage: (record) => { usage.push(record); process.stdout.write(`模型调用 ${usage.length} 完成。\n`); } });
  const result = await runChatSmoke(resolve(process.argv[2] ?? "data"), client, model, { usage: () => usage, log: (message) => process.stdout.write(message + "\n") });
  process.stdout.write(JSON.stringify(result, null, 2) + "\n");
  process.exitCode = result.report.adopted && result.report.nextChapterReadsBody ? 0 : result.report.status === "needs_revision" ? 2 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "chat 实测失败";
    const secret = process.env.CHAT_API_KEY;
    process.stderr.write((secret ? message.split(secret).join("[REDACTED]") : message) + "\n");
    process.exitCode = 1;
  });
}
