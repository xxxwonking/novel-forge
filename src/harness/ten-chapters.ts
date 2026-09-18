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
import { deriveBudget } from "../beat/derive.js";
import { validatePlan } from "../beat/validate.js";
import { loadRules } from "../rules/load.js";
import type { Rules } from "../rules/schema.js";
import type { L2AppendEntry } from "../types/l2.js";
import type { ChapterBeat, ChapterPlan, GateFinding, WorkProfile } from "../types/beat.js";
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

/** 大章的间隔。工装每 N 章排一个多事件重头章，用来同时测两种预算形态。 */
const BIG_CHAPTER_EVERY = 5;

const PROFILE: WorkProfile = {
  platform: SETTING.platform,
  genre: SETTING.genre,
  targetWords: 1_000_000,
};

/**
 * 节拍表的规划部分。
 *
 * 大章刻意用「事件章 + 多事件」而不是高潮章：高潮章按 V2 必须有伏笔收束
 * （beat_payoff_without_resolution），而工装是从零开始连续写，前几章还没有
 * 伏笔可收。多事件的事件章同样能测出更宽的预算与更高的密度区间。
 */
function planFor(chapter: ChapterNo): ChapterPlan {
  const big = chapter % BIG_CHAPTER_EVERY === 0;
  return {
    chapterType: "event",
    coreEvent: big
      ? `第 ${chapter} 章：李长风与血刀客在青州正面交手，一方露出底牌`
      : `第 ${chapter} 章：李长风追查一条线索，与人交锋一场`,
    secondaryThread: big ? "苏晚晴带回师门的消息" : null,
    stageFeedback: big ? "李长风拿到一件可作证物的东西" : "李长风确认了一个此前的疑点",
    hook: big ? "证物上刻着三叔的名字" : "对方提到了一个不该知道的名字",
    events: [
      {
        kind: "action",
        summary: big ? "与血刀客交手，接下一式" : "与线人交涉，逼出一句实话",
        weight: big ? 3 : 1,
        plotLine: "P01",
      },
      ...(big
        ? ([{ kind: "info", summary: "证物指向三叔", weight: 2, plotLine: "P02" }] as const)
        : []),
    ],
    resolves: [],
    plants: [],
    characters: big ? ["C01", "C02", "C03"] : ["C01", "C02"],
    locations: ["S01"],
  };
}

/**
 * 节拍表 + V3 派生预算。
 *
 * 预算走 deriveBudget 而不是写死 —— 工装写死预算等于绕过 §10.1，且会让
 * 「模型知道自己有多少字空间」这件事在实测里失真。
 */
function beatFor(chapter: ChapterNo, rules: Rules): ChapterBeat {
  const plan = planFor(chapter);
  return {
    chapter,
    volume: 1,
    plan,
    budget: deriveBudget(plan, PROFILE, rules, { now: "2026-09-06T00:00:00.000Z" }),
    provenance: "authored",
    updatedAt: "2026-09-06T00:00:00.000Z",
  };
}

// ── 主流程 ──────────────────────────────────────────────────────────────

/** 一章的 M2 度量。用来看派生预算是否被真实生成命中（§10.15 的校准输入）。 */
export interface ChapterGateSummary {
  readonly chapter: ChapterNo;
  readonly words: number;
  readonly budget: readonly [number, number];
  readonly inBudget: boolean;
  readonly density: number;
  readonly densityRange: readonly [number, number];
  readonly action: string;
  readonly blocks: readonly string[];
  readonly warns: readonly string[];
  readonly acceptable: boolean;
}

export interface HarnessResult {
  readonly records: readonly CacheRecord[];
  readonly rebuildChapters: ReadonlySet<ChapterNo>;
  readonly chapterTexts: ReadonlyMap<ChapterNo, string>;
  readonly failures: readonly string[];
  readonly gates: readonly ChapterGateSummary[];
  /** V2 在排章阶段就打回的章。工装的节拍表是写死的，这里非空即工装本身有问题。 */
  readonly planRejections: readonly string[];
}

export async function runTenChapters(chapters = 10): Promise<HarnessResult> {
  const client = ClaudeClient.fromEnv();
  const stream = new EventStream();
  const characters = makeCharacters();
  const rules = loadRules();

  const records: CacheRecord[] = [];
  const rebuildChapters = new Set<ChapterNo>();
  const chapterTexts = new Map<ChapterNo, string>();
  const failures: string[] = [];
  const gates: ChapterGateSummary[] = [];
  const planRejections: string[] = [];

  const synopses: { chapter: ChapterNo; text: string }[] = [];
  let pendingAppend: L2AppendEntry[] = [];
  let pendingChapters = 0;
  let majorEventPending = false;
  let foreshadowResolvedPending = false;
  let previousText: string | null = null;
  let allocated = 0;

  for (let chapter = 1; chapter <= chapters; chapter += 1) {
    const beat = beatFor(chapter, rules);

    // V2：节拍表不合规就不该往下走（§12.2 有 block 回 V1 重排）。
    const planFindings = validatePlan(beat.plan, rules);
    for (const f of planFindings.filter((x) => x.level === "block")) {
      planRejections.push(`第 ${chapter} 章：${f.rule} — ${f.message}`);
    }

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
      plotLineGap: rules.crossChapter.plotLineGap,
    });

    const l2 = buildL2Snapshot({
      currentChapter: Math.max(1, chapter - 1),
      characters,
      chapterSynopses: synopses,
      volumeSummaries: [],
      foreshadows: projections.foreshadows as readonly ForeshadowTimelineItem[],
      plotLines: projections.plotLines as readonly PlotLineTrack[],
      pendingAppend,
      dueSoonWindow: loadRules().crossChapter.foreshadowDueSoon,
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
      patchWords: loadRules().resolutionPatchWords,
      maxOutputTokens: 12_000,
      gate: { profile: PROFILE, rules },
    });

    records.push(...result.metrics);

    if (result.kind !== "ok") {
      const detail = result.kind === "refused" ? result.userMessage : result.detail;
      failures.push(`第 ${chapter} 章：${result.kind} — ${detail}`);
      // 拒绝或失败不中断 —— 后续章仍能测缓存，且要看失败是否只在特定章出现
      previousText = null;
      continue;
    }

    if (result.gate !== null && result.route !== null && beat.budget !== null) {
      const levels = (level: GateFinding["level"]): readonly string[] =>
        result.findings.filter((f) => f.level === level).map((f) => f.rule);
      gates.push({
        chapter,
        words: result.gate.words,
        budget: [beat.budget.words.min, beat.budget.words.max],
        inBudget:
          result.gate.words >= beat.budget.words.min && result.gate.words <= beat.budget.words.max,
        density: Math.round(result.gate.density * 100) / 100,
        densityRange: [beat.budget.density.min, beat.budget.density.max],
        action: result.route.action.action,
        blocks: levels("block"),
        warns: levels("warn"),
        acceptable: result.acceptable,
      });
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

  return { records, rebuildChapters, chapterTexts, failures, gates, planRejections };
}

/**
 * M2 验收（§12.9）：**字数落在派生区间、block 零漏检。**
 *
 * 与 M1 的关键区别：这份结论**不依赖端点是否官方** —— 它测的是字数与规则，
 * 不读 usage 的缓存字段，中转吞掉缓存度量也不影响它的有效性。
 */
export interface M2Report {
  readonly chapters: number;
  readonly inBudget: number;
  readonly inBudgetRatio: number;
  readonly inDensity: number;
  readonly blockedChapters: number;
  readonly passedChapters: number;
  readonly planRejections: number;
  readonly failures: readonly string[];
  readonly passed: boolean;
}

export function evaluateM2(r: HarnessResult): M2Report {
  const n = r.gates.length;
  const inBudget = r.gates.filter((g) => g.inBudget).length;
  const inDensity = r.gates.filter(
    (g) => g.density >= g.densityRange[0] && g.density <= g.densityRange[1],
  ).length;
  const blockedChapters = r.gates.filter((g) => !g.acceptable).length;
  const passedChapters = r.gates.filter((g) => g.action === "pass").length;
  const failures: string[] = [];

  if (n === 0) failures.push("没有任何章跑到质量闸门 —— 无法评估 M2");
  if (r.planRejections.length > 0) {
    failures.push(`V2 在排章阶段打回 ${r.planRejections.length} 章（工装节拍表本身不合规）`);
  }
  // 门槛定在 8 成而非全中：派生系数尚未实测校准（§10.15），此时要求 100%
  // 落区间等于把未校准的系数当成真值。
  const ratio = n === 0 ? 0 : inBudget / n;
  if (n > 0 && ratio < 0.8) {
    failures.push(`仅 ${inBudget}/${n} 章字数落在派生区间（门槛 80%）`);
  }
  for (const g of r.gates.filter((x) => !x.acceptable)) {
    failures.push(`第 ${g.chapter} 章 block 未清：${g.blocks.join("、")}`);
  }

  return {
    chapters: n,
    inBudget,
    inBudgetRatio: ratio,
    inDensity,
    blockedChapters,
    passedChapters,
    planRejections: r.planRejections.length,
    failures,
    passed: failures.length === 0,
  };
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

  // ── M2 部分。与 M1 分开报，因为它不受端点影响 ──
  const m2 = evaluateM2(r);
  lines.push("");
  lines.push("═══ M2 验收报告 ═══");
  lines.push(`过闸章数：${m2.chapters}`);
  lines.push(
    `字数落在派生区间：${m2.inBudget}/${m2.chapters}（${(m2.inBudgetRatio * 100).toFixed(0)}%，门槛 80%）`,
  );
  lines.push(`密度落在派生区间：${m2.inDensity}/${m2.chapters}`);
  lines.push(`block 未清的章：${m2.blockedChapters}（门槛 0）`);
  lines.push(`主动放行（pass）的章：${m2.passedChapters}`);
  lines.push(`V2 排章打回：${m2.planRejections}（门槛 0）`);
  lines.push("");
  lines.push(m2.passed ? "✅ M2 验收通过" : "❌ M2 验收未通过");
  for (const f of m2.failures) lines.push(`  - ${f}`);

  if (r.gates.length > 0) {
    lines.push("");
    lines.push("逐章明细（章 | 字数/区间 | 密度/区间 | 动作 | block）：");
    for (const g of r.gates) {
      const mark = g.inBudget ? " " : "✗";
      lines.push(
        `  ${mark} ch${g.chapter} ${g.words}/${g.budget[0]}-${g.budget[1]} | ` +
          `${g.density}/${g.densityRange[0]}-${g.densityRange[1]} | ${g.action} | ` +
          `${g.blocks.length === 0 ? "-" : g.blocks.join("、")}`,
      );
    }
  }

  if (r.planRejections.length > 0) {
    lines.push("");
    lines.push("V2 排章打回：");
    for (const f of r.planRejections) lines.push(`  - ${f}`);
  }

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
