import type { DraftInsertionPoint } from "./types.js";

/** 每个非空原段落前都是候选点；重复段落仍以不同编号和精确偏移区分。 */
export function insertionPoints(body: string): readonly DraftInsertionPoint[] {
  return [...body.matchAll(/[^\r\n]+/gu)].filter(match => match[0].trim() !== "")
    .map((match, index) => ({ ref: `@insert:${index + 1}`, offset: match.index, before: match[0] }));
}

export function validateInsertionPoints(body: string, points: readonly DraftInsertionPoint[]): void {
  if (points.length === 0 || JSON.stringify(points) !== JSON.stringify(insertionPoints(body))) {
    throw new Error("保存的补写位置目录与原稿不一致，请重新核对源稿");
  }
}

export function insertionInstruction(points: readonly DraftInsertionPoint[]): string {
  return [
    "在目录中选择一个尚未展开的行动之前补写，不要把已经完成的核对或交接再演一遍。",
    "第一行只写所选 @insert:编号，换行后只输出新增正文。原段落及其后续由程序保留，不要重复输出。",
    "【原稿插入位置目录】",
    ...points.map(point => `${point.ref} 在此段之前：${JSON.stringify(point.before)}`),
  ].join("\n");
}

export function resolveInsertion(text: string, points: readonly DraftInsertionPoint[]) {
  const match = /^\s*(@insert:\d+)[ \t]*\r?\n([\s\S]*)$/u.exec(text);
  const point = match === null ? undefined : points.find(candidate => candidate.ref === match[1]);
  if (point === undefined) throw new Error("缺少有效的补写位置编号，原文保持不变");
  const addition = match![2]!;
  if (/^\s*@insert:\d+/mu.test(addition)) throw new Error("一次补写只能选择一个位置，原文保持不变");
  return { offset: point.offset, boundary: point.before.trim(), addition };
}
