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
    "先选择目录里的不同位置，在尚未展开的行动之前分配补写，不要把已经完成的核对或交接再演一遍。",
    '只交付新增正文，使用 JSON：{"insertions":[{"ref":"@insert:编号","text":"此处新增的完整正文"}]}。可选1–4个不同位置，原段落及其后续由程序保留。不要重复输出原稿、目录或字数说明。',
    "【原稿插入位置目录】",
    ...points.map(point => `${point.ref} 在此段之前：${JSON.stringify(point.before)}`),
  ].join("\n");
}

/** 一次调用内分配多个补写单元，全部校验后从后向前应用；失败不部分写入。 */
export function applyInsertions(body: string, raw: unknown, points: readonly DraftInsertionPoint[]): string {
  validateInsertionPoints(body, points);
  const fail = (): never => { throw new Error("多位置补写格式、位置或内容无效，原文保持不变"); };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw) || Object.keys(raw).join() !== "insertions") return fail();
  const entries = (raw as { insertions?: unknown }).insertions;
  if (!Array.isArray(entries) || entries.length < 1 || entries.length > 4) return fail();
  const used = new Set<string>(), additions = new Set<string>();
  const resolved = entries.map((entry: unknown) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) return fail();
    const item = entry as Record<string, unknown>;
    if (Object.keys(item).length !== 2 || typeof item.ref !== "string" || typeof item.text !== "string") return fail();
    const point = points.find(p => p.ref === item.ref);
    if (!point || used.has(point.ref) || !item.text.trim() || item.text.includes(body) || /@insert:\d+/u.test(item.text)) return fail();
    used.add(point.ref);
    let text = item.text.trim();
    if (text.endsWith(point.before.trim())) text = text.slice(0, -point.before.trim().length).trimEnd();
    if (!text || additions.has(text)) return fail();
    additions.add(text);
    return { offset: point.offset, text };
  });
  let result = body;
  for (const addition of resolved.sort((a,b) => b.offset-a.offset)) result = result.slice(0,addition.offset) + addition.text + "\n\n" + result.slice(addition.offset);
  return result;
}

export function resolveInsertion(text: string, points: readonly DraftInsertionPoint[]) {
  const match = /^\s*(@insert:\d+)[ \t]*\r?\n([\s\S]*)$/u.exec(text);
  const point = match === null ? undefined : points.find(candidate => candidate.ref === match[1]);
  if (point === undefined) throw new Error("缺少有效的补写位置编号，原文保持不变");
  const addition = match![2]!;
  if (/^\s*@insert:\d+/mu.test(addition)) throw new Error("一次补写只能选择一个位置，原文保持不变");
  return { offset: point.offset, boundary: point.before.trim(), addition };
}
