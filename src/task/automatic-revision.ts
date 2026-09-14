/** 自动修订只处理当前写章目标支持的正文缺项，不用改写迎合无依据的结构声明。 */
import type { GateFinding } from "../types/beat.js";
import type { DraftGeneration } from "./types.js";

const REPAIRABLE = new Set(["route_patch", "resolution_missing", "resolution_downgraded"]);

/** 首版上限是一轮，旧草稿没有保存额度时不补授权。 */
export function automaticRevisionLimit(value: number | undefined): 0 | 1 {
  return value !== undefined && Number.isSafeInteger(value) && value > 0 ? 1 : 0;
}

export function canAutomaticallyRevise(findings: readonly GateFinding[]): boolean {
  const blocks = findings.filter(finding => finding.level === "block");
  return blocks.length > 0 && blocks.every(finding => REPAIRABLE.has(finding.rule));
}

export function automaticGeneration(body: string, findings: readonly GateFinding[]): DraftGeneration {
  return {
    mode: "rewrite", originalBody: body, range: null,
    instruction: [
      "这是本次写章唯一的一轮自动修订。根据以下检查补足本章目标，保留已发生事实、核心事件、人物动机和计划结局。",
      "遵守检查给出的补写优先级与禁止项，不能降低规则、改写计划、增加未经授权的设定或改变其他章节。",
      "这是本次初稿的整章修订范围。只修复有正文与本章目标支持的问题；若需要新的方向或扩大作品范围，返回 expand_scope 并说明需要作者决定什么。",
      "不要为了迎合可能错误的结构摘要而编造人物死亡、关系或伏笔兑现。修订后的正文将重新核对结构并执行同样的检查。",
      `本次实际检查：\n${JSON.stringify(findings, null, 2)}`,
    ].join("\n"),
  };
}
