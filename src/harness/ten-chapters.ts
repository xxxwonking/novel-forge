/**
 * M1 验收工装（§13.8）：连续写 10 章，实测缓存命中率。
 *
 * 这不是测试而是可执行脚本 —— 它打真实 API、花真钱。用法：
 *   npx tsx src/harness/ten-chapters.ts [章数]
 *
 * ⚠ 若 ANTHROPIC_BASE_URL 指向非官方端点，报告会标记为「不可验证」：
 * 中转可能不透传 cache_control，或吞掉/伪造 usage 里的缓存字段（§8.2），
 * 此时命中率数字没有意义，不能作为 M1 通过的依据。
 */

import { ClaudeClient } from "../client/claude.js";
import { EventStream } from "../store/event-stream.js";
import { runChapter } from "../chapter/pipeline.js";
import { assemble } from "../context/assemble.js";
import { buildL2Snapshot, shouldRebuildL2 } from "../context/build-l2.js";
import { selectL3 } from "../context/select-l3.js";
import { renderL2 } from "../context/render-l2.js";
import { estimateTokens } from "../context/select-l3.js";
import { WRITING_DISCIPLINE } from "../context/discipline.js";
import { project } from "../store/project.js";
import { evaluateAcceptance, type CacheRecord } from "../metrics/cache.js";
import type { L2AppendEntry } from "../types/l2.js";
import type { ChapterBeat, ChapterBudget } from "../types/beat.js";
import type { CharacterCard } from "../types/character.js";
import type { WorkSetting } from "../types/work.js";
import type {
  ChapterNo,
  Derived,
  ForeshadowId,
  PlotLineId,
  TextAnchor,
} from "../types/primitives.js";
import type { ForeshadowTimelineItem, PlotLineTrack } from "../types/projections.js";

function derived<T>(v: T): Derived<T> {
  return v as Derived<T>;
}

// ── 最小可跑的作品数据 ──────────────────────────────────────────────────

const SETTING: WorkSetting = {
  title: "青州旧事",
  genre: "xuanhuan",
  platform: "fanqie",
  premise: "被逐出师门的少年靠一把断剑查清师父死因。",
  centralConflict: "真凶是抚养他长大的三叔。",
  pov: "third_limited",
  tense: "past",
  protagonistTraits: ["记仇", "谨慎", "护短"],
  protagonistForbidden: ["绝不主动求人", "不在人前示弱"],
  specialAbility: "断剑能存一式对手的招法。",
  abilityLimits: ["存新招覆盖旧招", "吸收时受同等反伤"],
  worldRules: ["修行分炼气、筑基、金丹、元婴四境", "宗门以试剑会定次序", "灵石是通用货币"],
  openingSituation: "青州城外破庙，被逐第三日。",
  styleKeywords: ["冷硬", "克制", "重动作轻抒情"],
  romanceLine: "与苏晚晴不明写，只写并肩。",
  taboos: ["不写师徒恋", "不写主角滥杀无辜"],
};

const PLOT_DEFS = [
  { id: "P01" as PlotLineId, label: "复仇主线", weight: "main" as const },
  { id: "P02" as PlotLineId, label: "师门内应", weight: "sub" as const },
] as const;

function anchor(chapter: ChapterNo, quote: string): TextAnchor {
  return { chapter, quote, offsetHint: 0, occurrence: 0 };
}

function makeCharacters(): CharacterCard[] {
  const base = (
    id: `C${string}`,
    name: string,
    tier: CharacterCard["tier"],
    role: string,
    exemplars: readonly string[],
  ): CharacterCard => ({
    id,
    name,
    aliases: [],
    tier,
    introducedAt: 1,
    profile: {
      role,
      appearance: [{ key: "眼睛颜色", value: "浅褐", establishedAt: 1, immutable: true }],
      traits: ["记仇", "谨慎"],
      forbiddenBehaviors: ["不在人前示弱"],
      wants: "查清师父死因",
      fears: "自己也是帮凶",
      background: "自幼被三叔抚养。",
    },
    speech: {
      sentenceLength: { min: 4, max: 16 },
      verbalTics: [],
      signatureLexicon: [],
      forbiddenLexicon: ["OK", "没问题"],
      addressForms: [],
      syntaxBias: { question: 0.1, imperative: 0.2, elliptical: 0.4 },
      register: "colloquial",
      emotionalExpression: "suppressed",
      exemplars,
      counterExemplars: [],
    },
    state: {
      vital: derived("alive" as const),
      location: derived("S01" as const),
      condition: derived("在青州查探"),
      lastSeenAt: derived(1),
      appearanceCount: derived(1),
    },
    provenance: "committed",
    updatedAt: "2026-09-06T00:00:00.000Z",
  });

  return [
    base("C01", "李长风", "protagonist", "主角", ["剑在我手里。", "你不配问。"]),
    base("C02", "血刀客", "major", "主要反派", ["有意思。", "血债只认刀口。"]),
    base("C03", "苏晚晴", "major", "同门旧识", ["你别绕。", "我记得清楚。"]),
  ];
}

function budgetFor(chapter: ChapterNo): ChapterBudget {
  const climax = chapter % 5 === 0;
  return {
    words: derived(climax ? { min: 3200, max: 4400, sweet: 3800 } : { min: 2100, max: 2650, sweet: 2400 }),
    density: derived(climax ? { min: 0.4, max: 0.8 } : { min: 0.3, max: 0.55 }),
    thresholds: derived({ 比喻: climax ? 15 : 10, 口头感叹词: 4, 高疲劳词: 2 }),
    tier: derived(climax ? ("strict" as const) : ("standard" as const)),
    splitAdvice: null,
    derivedFrom: { platform: "fanqie", genre: "xuanhuan", rulesVersion: "r1" },
    derivedAt: "2026-09-06T00:00:00.000Z",
  };
}

function beatFor(chapter: ChapterNo): ChapterBeat {
  const climax = chapter % 5 === 0;
  return {
    chapter,
    volume: 1,
    plan: {
      chapterType: climax ? "climax" : "event",
      coreEvent: climax
        ? `第 ${chapter} 章：李长风与血刀客在青州正面交手，一方露出底牌`
        : `第 ${chapter} 章：李长风追查一条线索，与人交锋一场`,
      secondaryThread: climax ? "苏晚晴带回师门的消息" : null,
      stageFeedback: climax ? "李长风拿到一件可作证物的东西" : "李长风确认了一个此前的疑点",
      hook: climax ? "证物上刻着三叔的名字" : "对方提到了一个不该知道的名字",
      events: [
        {
          kind: "action",
          summary: climax ? "与血刀客交手，接下一式" : "与线人交涉，逼出一句实话",
          weight: climax ? 3 : 1,
          plotLine: "P01",
        },
        ...(climax
          ? ([{ kind: "info", summary: "证物指向三叔", weight: 2, plotLine: "P02" }] as const)
          : []),
      ],
      resolves: [],
      plants: [],
      characters: climax ? ["C01", "C02", "C03"] : ["C01", "C02"],
      locations: ["S01"],
    },
    budget: budgetFor(chapter),
    provenance: "authored",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────

export interface HarnessResult {
  readonly records: readonly CacheRecord[];
  readonly rebuildChapters: ReadonlySet<ChapterNo>;
  readonly chapterTexts: ReadonlyMap<ChapterNo, string>;
  readonly failures: readonly string[];
}

export async function runTenChapters(chapters = 10): Promise<HarnessResult> {
  const client = ClaudeClient.fromEnv();
  const stream = new EventStream();
  const characters = makeCharacters();

  const records: CacheRecord[] = [];
  const rebuildChapters = new Set<ChapterNo>();
  const chapterTexts = new Map<ChapterNo, string>();
  const failures: string[] = [];

  const synopses: { chapter: ChapterNo; text: string }[] = [];
  let pendingAppend: L2AppendEntry[] = [];
  let pendingChapters = 0;
  let majorEventPending = false;
  let foreshadowResolvedPending = false;
  let previousText: string | null = null;
  let allocated = 0;

  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    const beat = beatFor(chapter);

    // L2 重建判定 —— 重建会让 bp2 及之后冷掉，所以要记录是哪几章
    const pendingTokens = estimateTokens(pendingAppend.map((a) => a.synopsis).join(""));
    if (
      chapter > 1 &&
      shouldRebuildL2({ pendingChapters, pendingTokens, majorEventPending, foreshadowResolvedPending })
    ) {
      rebuildChapters.add(chapter);
      pendingAppend = [];
      pendingChapters = 0;
      majorEventPending = false;
      foreshadowResolvedPending = false;
    }

    const projections = project({
      events: stream.effective(),
      currentChapter: Math.max(1, chapter - 1),
      characterProfiles: characters,
      plotLineDefs: [...PLOT_DEFS],
    });

    const l2 = buildL2Snapshot({
      currentChapter: Math.max(1, chapter - 1),
      characters,
      chapterSynopses: synopses,
      volumeSummaries: [],
      foreshadows: projections.foreshadows as readonly ForeshadowTimelineItem[],
      plotLines: projections.plotLines as readonly PlotLineTrack[],
      pendingAppend,
    });

    const l3 = selectL3({
      beat,
      characters: characters.filter((c) => beat.plan.characters.includes(c.id)),
      settings: [
        {
          id: "S01",
          name: "青州城",
          kind: "location",
          description: "三州交界的商埠，城内不许动武。",
          facts: ["西门有消息市", "夜间闭城"],
        },
      ],
      volumeBoundary: null,
      plantedExcerpts: [],
    });

    const result = await runChapter(client, stream, {
      chapter,
      assembleInput: {
        l1: { setting: SETTING, discipline: WRITING_DISCIPLINE },
        l2,
        l3,
        volatile: {
          previous: previousText === null ? null : { chapter: chapter - 1, headSummary: null, tailText: previousText },
          beat,
          resolves: [],
          avoid: [],
          task: `写出第 ${chapter} 章正文。`,
        },
      },
      parseContextBase: {
        chapter,
        knownCharacters: new Set(characters.map((c) => c.id)),
        knownForeshadows: new Set(projections.foreshadows.map((f) => f.id)),
        knownPlotLines: new Set(PLOT_DEFS.map((p) => p.id)),
        allocateForeshadowId: () => `F${String(++allocated).padStart(2, "0")}` as ForeshadowId,
      },
      promisedResolutions: [],
      maxOutputTokens: 12_000,
    });

    records.push(...result.metrics);

    if (result.kind !== "ok") {
      const detail = result.kind === "refused" ? result.userMessage : result.detail;
      failures.push(`第 ${chapter} 章：${result.kind} — ${detail}`);
      // 拒绝或失败不中断 —— 后续章仍能测缓存，且要看失败是否只在特定章出现
      previousText = null;
      continue;
    }

    // C8：接受整章
    stream.decideChapter(chapter, "committed");
    chapterTexts.set(chapter, result.chapterText);
    previousText = result.chapterText;

    const synopsis = result.chapterText.split("\n")[0]?.slice(0, 40) ?? "";
    synopses.push({ chapter, text: synopsis });
    pendingAppend = [
      ...pendingAppend,
      {
        chapter,
        synopsis,
        foreshadowDelta: result.parse.declaration.foreshadowResolved.map((r) => `${r.foreshadowId} 已收`),
        characterDelta: [],
      },
    ];
    pendingChapters += 1;
    if (result.parse.declaration.events.some((e) => e.weight === 3)) majorEventPending = true;
    if (result.parse.declaration.foreshadowResolved.length > 0) foreshadowResolvedPending = true;

    process.stdout.write(
      `ch${chapter} ${result.chapterText.length}字 命中${result.metrics
        .map((m) => `${(m.hitRatio * 100).toFixed(0)}%`)
        .join("/")}\n`,
    );
  }

  return { records, rebuildChapters, chapterTexts, failures };
}

export function formatReport(r: HarnessResult): string {
  const report = evaluateAcceptance(r.records, r.rebuildChapters);
  const lines = [
    "",
    "═══ M1 验收报告 ═══",
    `章数：${report.chapters}`,
    `平均命中率：${(report.averageHitRatio * 100).toFixed(1)}%（门槛 70%）`,
    `稳态命中率：${(report.steadyStateHitRatio * 100).toFixed(1)}%（门槛 85%）`,
    `L2 重建章命中率：${(report.rebuildChapterHitRatio * 100).toFixed(1)}%（门槛 45%）`,
    `段 0/1 冷掉次数：${report.coldSegment01Count}（门槛 0）`,
    "",
  ];

  if (!report.verifiable) {
    lines.push("⚠ 不可验证：度量来自非官方端点。中转可能不透传 cache_control 或");
    lines.push("  吞掉/伪造 usage 缓存字段，上面的数字不能作为 M1 通过依据。");
    lines.push("  换官方直连 key 后重跑。");
  } else {
    lines.push(report.passed ? "✅ M1 验收通过" : "❌ M1 验收未通过");
  }

  for (const f of report.failures) lines.push(`  - ${f}`);
  if (r.failures.length > 0) {
    lines.push("");
    lines.push("运行中的失败：");
    for (const f of r.failures) lines.push(`  - ${f}`);
  }
  return lines.join("\n");
}

// 直接执行时跑验收
if (process.argv[1]?.endsWith("ten-chapters.ts")) {
  const n = Number(process.argv[2] ?? 10);
  runTenChapters(Number.isFinite(n) && n > 0 ? n : 10)
    .then((r) => {
      process.stdout.write(formatReport(r));
      process.stdout.write("\n");
    })
    .catch((e: unknown) => {
      process.stderr.write(`工装失败：${e instanceof Error ? e.message : String(e)}\n`);
      process.exitCode = 1;
    });
}
