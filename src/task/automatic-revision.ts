/** 自动修订只处理当前写章目标支持的正文缺项，不用改写迎合无依据的结构声明。 */
import type { GateFinding, WordBudget } from "../types/beat.js";
import type { DraftGeneration } from "./types.js";
import { countWords } from "../text/measure.js";
import { insertionPoints } from "./expansion-scope.js";

const REPAIRABLE = new Set(["route_patch", "resolution_missing", "resolution_downgraded"]);

/** 首版上限是一轮，旧草稿没有保存额度时不补授权。 */
export function automaticRevisionLimit(value: number | undefined): 0 | 1 {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? 1 : 0;
}

export function canAutomaticallyRevise(findings: readonly GateFinding[]): boolean {
  const blocks = findings.filter(finding => finding.level === "block");
  return blocks.length > 0 && blocks.every(finding => REPAIRABLE.has(finding.rule));
}

export function automaticGeneration(body: string, findings: readonly GateFinding[], budget?: WordBudget): DraftGeneration {
  const words = countWords(body);
  const short = findings.find(f => f.rule === "route_patch" && f.level === "block"
    && typeof f.threshold === "number" && f.threshold > words);
  const insertOnly = short !== undefined && findings.filter(f => f.level === "block").every(f => f.rule === "route_patch");
  const points = insertOnly ? insertionPoints(body) : undefined;
  return {
    mode: "rewrite", originalBody: body, range: null,
    ...(points === undefined ? {} : { insertionPoints: points }),
    instruction: [
      "这是本次写章唯一的一轮自动修订。根据以下检查补足本章目标，保留已发生事实、核心事件、人物动机和计划结局。",
      "遵守检查给出的本章目标与禁止项，不能降低规则、改写计划、增加未经授权的设定或改变其他章节。",
      "这是本次初稿的整章修订范围。只修复有正文与本章目标支持的问题；若需要新的方向或扩大作品范围，返回 expand_scope 并说明需要作者决定什么。",
      "不要为了迎合可能错误的结构摘要而编造人物死亡、关系或伏笔兑现。修订后的正文将重新核对结构并执行同样的检查。",
      ...(short === undefined ? [] : [`原稿实测 ${words} 字，正文下限 ${short.threshold} 字，至少增加 ${short.threshold! - words} 个内容字。${budget === undefined ? "" : `完整正文目标 ${budget.sweet} 字，新增篇幅目标 ${Math.max(budget.sweet - words, 0)} 字。`}不能只润色或补几句；汉字逐字计，西文按词计，标点与空白不计。先在内部为已有行动的过程、阻力和反馈安排新增篇幅，保持原有结局，不增加计划外事件。`]),
      points === undefined ? "replacement 交付修改后的完整正文。" : "本轮改用保留原稿的补写：先选择目录里的插入位置，随后只交付新增正文。原稿和结尾由程序逐字保留，不要重复输出或包装成 JSON。只展开本章计划内、尚未充分展开的行动与具体判断，不推进新的事件或改写结局。",
      `本次实际检查：\n${JSON.stringify(findings, null, 2)}`,
    ].join("\n"),
  };
}
