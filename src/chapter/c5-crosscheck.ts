/**
 * §11.5 第二道防线：代码交叉验证。**最有效的一条。**
 *
 * 模型倾向多报事件（把"他握紧拳头"报成行动事件），因为它想显得这章内容
 * 丰富。但**虚报的事件往往没有对应的状态变更** —— 模型编不出具体的状态
 * 变化。用自洽性抓虚报，比让模型自查有效。
 *
 * 全部纯代码，零成本。
 */

import type { C5Declaration } from "../types/events.js";
import type { GateFinding } from "../types/beat.js";

export interface CrossCheckInput {
  readonly declaration: C5Declaration;
  /** 本章正文，用于校验锚点是否真的能定位。 */
  readonly chapterText: string;
}

/**
 * 交叉验证规则（§11.5）：
 *   声明「资源」事件 → 应有对应 character_state 变更
 *   声明「关系」事件 → 应有对应 relation_changed
 *   声明「信息」事件 → 检查是否对应某条伏笔收束
 *   声明 weight-3    → 应影响 ≥2 条情节线
 *
 * 全部产出 warn 而非 block —— 不自洽是"可能虚报"的信号，不是确证。
 * 作者有权保留一条系统认为可疑的声明。
 */
export function crossCheckC5(input: CrossCheckInput): readonly GateFinding[] {
  const d = input.declaration;
  const findings: GateFinding[] = [];

  const hasStateChange = d.characterStates.length > 0;
  const hasRelationChange = d.relationsChanged.length > 0;
  const hasResolution = d.foreshadowResolved.length > 0;

  for (const e of d.events) {
    if (e.kind === "resource" && !hasStateChange) {
      findings.push({
        rule: "c5_resource_without_state",
        level: "warn",
        message: `声明了资源类事件「${e.summary}」但没有任何人物状态变更 —— 可能是虚报`,
      });
    }
    if (e.kind === "relation" && !hasRelationChange) {
      findings.push({
        rule: "c5_relation_without_change",
        level: "warn",
        message: `声明了关系类事件「${e.summary}」但没有任何关系变更记录 —— 可能是虚报`,
      });
    }
    if (e.kind === "info" && !hasResolution) {
      findings.push({
        rule: "c5_info_without_resolution",
        level: "info",
        message: `信息类事件「${e.summary}」未对应任何伏笔收束 —— 确认这条信息是新线索而非旧伏笔的兑现`,
      });
    }
  }

  // weight-3 应影响 ≥2 条情节线
  const w3 = d.events.filter((e) => e.weight === 3);
  if (w3.length > 0) {
    const lines = new Set(d.events.map((e) => e.plotLine).filter((l) => l !== null));
    if (lines.size < 2) {
      findings.push({
        rule: "c5_weight3_single_line",
        level: "warn",
        message: `声明了 ${w3.length} 个 weight-3 事件，但本章事件只涉及 ${lines.size} 条情节线 —— weight-3 应改变全书格局并影响多条线，考虑降为 2`,
        measured: lines.size,
        threshold: 2,
      });
    }
  }

  // 锚点可定位性 —— 模型偶尔会"引用"自己没写过的句子
  const allAnchors = [
    ...d.events.map((e) => e.anchor),
    ...d.foreshadowPlanted.map((f) => f.anchor),
    ...d.foreshadowResolved.map((f) => f.anchor),
    ...d.relationsChanged.map((r) => r.anchor),
    ...d.characterStates.map((s) => s.anchor),
  ];
  const unresolvable = allAnchors.filter((a) => a.offsetHint < 0);
  if (unresolvable.length > 0) {
    findings.push({
      rule: "c5_anchor_unresolvable",
      level: "warn",
      message: `${unresolvable.length} 条声明的原文片段在本章正文里找不到 —— 模型引用了未写出的内容，这些锚点将无法跳读`,
      measured: unresolvable.length,
      threshold: 0,
    });
  }

  // 出场声明缺失：事件的参与者应当在 presence 里
  const present = new Set(d.characterPresence.map((p) => p.characterId));
  const participants = new Set(d.events.flatMap((e) => e.participants));
  const missing = [...participants].filter((p) => !present.has(p));
  if (missing.length > 0) {
    findings.push({
      rule: "c5_participant_not_present",
      level: "warn",
      message: `${missing.join("、")} 参与了本章事件但未出现在出场声明里 —— 人物弧线视图会漏掉这一章`,
    });
  }

  // POV 声明：一章应恰有一个 pov（§L1 的 POV 纪律）
  const povCount = d.characterPresence.filter((p) => p.role === "pov").length;
  if (povCount !== 1 && d.characterPresence.length > 0) {
    findings.push({
      rule: "c5_pov_count",
      level: povCount === 0 ? "warn" : "block",
      message:
        povCount === 0
          ? "本章没有声明视角人物 —— 无法做 POV 合法性检查"
          : `本章声明了 ${povCount} 个视角人物，违反 POV 纪律`,
      measured: povCount,
      threshold: 1,
    });
  }

  return findings;
}

/**
 * 校验节拍表承诺的收束是否都被声明（§12.3 C7 的收束完整性）。
 *
 * 与 crossCheckC5 分开的理由：这条需要节拍表，而交叉验证只需要声明本身。
 * 分开后交叉验证可以在没有节拍表的场景（快速档）单独跑。
 */
export function checkPromisedResolutions(
  declaration: C5Declaration,
  promised: readonly { readonly foreshadowId: string; readonly completeness: "full" | "partial" }[],
): readonly GateFinding[] {
  const findings: GateFinding[] = [];
  const declared = new Map(declaration.foreshadowResolved.map((r) => [r.foreshadowId as string, r]));

  for (const p of promised) {
    const actual = declared.get(p.foreshadowId);
    if (actual === undefined) {
      findings.push({
        rule: "resolution_missing",
        level: "block",
        message: `节拍表承诺本章收束 ${p.foreshadowId}，但结构声明里没有 —— 补写该条收束 300-400 字，或把节拍表改为不收`,
      });
      continue;
    }
    if (p.completeness === "full" && actual.completeness === "partial") {
      findings.push({
        rule: "resolution_downgraded",
        level: "warn",
        message: `${p.foreshadowId} 计划完全收束，实际只做到部分收束 —— 补写或把计划降级为部分`,
      });
    }
  }

  // 声明了收束但节拍表没安排：合法但值得记录（模型顺手收了一条）
  const promisedIds = new Set(promised.map((p) => p.foreshadowId));
  for (const r of declaration.foreshadowResolved) {
    if (!promisedIds.has(r.foreshadowId as string)) {
      findings.push({
        rule: "resolution_unplanned",
        level: "info",
        message: `本章额外收束了 ${r.foreshadowId}（节拍表未安排）—— 确认这是有意的`,
      });
    }
  }

  return findings;
}
