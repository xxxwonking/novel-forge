/**
 * 段 1 渲染：L1 常驻层（§13.3）。
 *
 * 单参数纯函数。预算 2500 token，硬上限 3500 —— 超了要压缩而非放宽，
 * 因为 L1 越大，它变一次的代价越高。
 *
 * 三条硬禁令由 CI 测试把关（§13.8 第二个测试）：无时间戳、无章号计数、
 * 无用户标识。这个模块因此只接受 WorkSetting + WritingDiscipline，
 * 拿不到任何能违反禁令的数据。
 */

import type { WorkSetting, WritingDiscipline } from "../types/work.js";
import type { Genre, Platform } from "../types/beat.js";

const GENRE_LABEL: Readonly<Record<Genre, string>> = {
  xuanhuan: "玄幻",
  xianxia: "仙侠",
  urban: "都市",
  scifi: "科幻",
  mystery: "悬疑",
  rulehorror: "规则怪谈",
};

const PLATFORM_LABEL: Readonly<Record<Platform, string>> = {
  fanqie: "番茄",
  feilu: "飞卢",
  qidian: "起点",
  unpublished: "不发布",
};

const POV_LABEL = {
  first: "第一人称",
  third_limited: "第三人称限制视角",
  third_omniscient: "第三人称全知视角",
} as const;

const TENSE_LABEL = { past: "过去时", present: "现在时" } as const;

/** 列表渲染：一项一行，带前缀。空列表输出「无」，保证格式恒定。 */
function bullets(items: readonly string[]): string {
  return items.length === 0 ? "无" : items.map((s) => `\n  - ${s}`).join("");
}

/** 顿号连接。空列表输出「无」。 */
function inline(items: readonly string[]): string {
  return items.length === 0 ? "无" : items.join("、");
}

export interface L1Input {
  readonly setting: WorkSetting;
  readonly discipline: WritingDiscipline;
}

/**
 * 渲染 L1。输出逐字节稳定 —— 无排序、无过滤、无格式化决策，
 * 全部字段按固定顺序直出。
 */
export function renderL1(input: L1Input): string {
  const { setting: s, discipline: d } = input;
  const lines = [
    "# 作品设定",
    "",
    `书名：${s.title}`,
    `题材：${GENRE_LABEL[s.genre]}`,
    `发布平台：${PLATFORM_LABEL[s.platform]}`,
    `叙事视角：${POV_LABEL[s.pov]}`,
    `时态：${TENSE_LABEL[s.tense]}`,
    "",
    `一句话立意：${s.premise}`,
    `核心冲突：${s.centralConflict}`,
    `故事起点：${s.openingSituation}`,
    `感情线：${s.romanceLine}`,
    `风格关键词：${inline(s.styleKeywords)}`,
    "",
    "## 主角",
    `性格标签：${inline(s.protagonistTraits)}`,
    `禁止行为：${bullets(s.protagonistForbidden)}`,
    `特殊能力：${s.specialAbility}`,
    `能力限制：${bullets(s.abilityLimits)}`,
    "",
    "## 世界观",
    `${bullets(s.worldRules)}`,
    "",
    "## 本作禁忌",
    `${bullets(s.taboos)}`,
    "",
    "# 写作纪律",
    "",
    ...d.rules.map((r, i) => `${i + 1}. ${r}`),
  ];
  return lines.join("\n");
}

/** §13.3 硬上限。超限时由调用方决定压缩哪部分，本函数不自动裁剪。 */
export const L1_TOKEN_BUDGET = { target: 2500, hardLimit: 3500 } as const;

/**
 * L1 动态内容检测（§13.8 CI 测试用）。
 *
 * 命中即说明有人往 L1 里加了会变的东西 —— 这是最经典的缓存静默失效源，
 * 必须在 CI 里挡住而不是等命中率掉了才查。
 */
export const L1_FORBIDDEN_PATTERN =
  /\d{4}-\d{2}-\d{2}|\d{4}年\d{1,2}月|第\s*\d+\s*章|共\s*\d+\s*[人条章]|\d+%|更新于|当前进度/;
