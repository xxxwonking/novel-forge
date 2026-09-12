/**
 * 草稿新旧对比：段落级配对 + 改动段内的字级高亮。
 *
 * 两层而不是一层：整章直接做字级 LCS 会把「删了一段、加了一段」算成一片犬牙交错的
 * 碎块，作者看不出段落的去留；只做段落级又看不出一段里改了哪几个字。所以先按段落
 * 对齐（LCS），把相邻的「删 + 增」按位配成"改写"，改写段内部再做一次字级 LCS。
 *
 * 纯函数、无依赖。放在 task/ 是因为它服务于草稿修订（DraftRevision）；增删量的字数
 * 口径沿用 text/measure（只计汉字与西文词），与预算、密度用同一个分母。
 */

import { countWords } from "../text/measure.js";

export type DiffOp = "equal" | "insert" | "delete";

export interface DiffSpan {
  readonly op: DiffOp;
  readonly text: string;
}

/** 一个对齐后的段落。`replace` = 旧段被改写为新段，spans 给出段内的字级差异。 */
export interface DiffParagraph {
  readonly op: DiffOp | "replace";
  readonly spans: readonly DiffSpan[];
}

export interface DraftDiff {
  readonly paragraphs: readonly DiffParagraph[];
  /** 新增 / 删除的内容字数，与有改动的段落数。 */
  readonly inserted: number;
  readonly deleted: number;
  readonly changed: number;
}

/**
 * 字级 LCS 的规模上限（DP 表的格子数）。超过即退化为整段替换 —— 一段几千字的
 * 极端情况下逐字高亮既慢又没有可读性。
 */
const MAX_CHAR_CELLS = 1_000_000;

export function diffDraft(before: string, after: string, maxCharCells = MAX_CHAR_CELLS): DraftDiff {
  const paragraphs = pairReplacements(align(paragraphsOf(before), paragraphsOf(after)), maxCharCells);
  let inserted = 0;
  let deleted = 0;
  let changed = 0;
  for (const p of paragraphs) {
    if (p.op === "equal") continue;
    changed += 1;
    for (const s of p.spans) {
      if (s.op === "insert") inserted += countWords(s.text);
      else if (s.op === "delete") deleted += countWords(s.text);
    }
  }
  return { paragraphs, inserted, deleted, changed };
}

function paragraphsOf(text: string): readonly string[] {
  return text
    .split(/\n+/u)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

interface Aligned<T> {
  readonly op: DiffOp;
  readonly item: T;
}

/**
 * 经典 LCS 对齐。同分时优先 delete：两处相同段落之间的空隙会先吐完删除再吐插入，
 * 后面的按位配对与 span 合并都依赖这个顺序。
 */
function align<T>(a: readonly T[], b: readonly T[]): readonly Aligned<T>[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i * width + j] =
        a[i] === b[j]
          ? (table[(i + 1) * width + j + 1] ?? 0) + 1
          : Math.max(table[(i + 1) * width + j] ?? 0, table[i * width + j + 1] ?? 0);
    }
  }
  const out: Aligned<T>[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "equal", item: a[i] as T });
      i += 1;
      j += 1;
    } else if ((table[(i + 1) * width + j] ?? 0) >= (table[i * width + j + 1] ?? 0)) {
      out.push({ op: "delete", item: a[i] as T });
      i += 1;
    } else {
      out.push({ op: "insert", item: b[j] as T });
      j += 1;
    }
  }
  for (; i < n; i++) out.push({ op: "delete", item: a[i] as T });
  for (; j < m; j++) out.push({ op: "insert", item: b[j] as T });
  return out;
}

/** 把每段空隙里的删除与插入按位配成"改写"，多出来的保持整段增删。 */
function pairReplacements(aligned: readonly Aligned<string>[], maxCharCells: number): readonly DiffParagraph[] {
  const out: DiffParagraph[] = [];
  let deletes: string[] = [];
  let inserts: string[] = [];
  const flush = (): void => {
    const pairs = Math.min(deletes.length, inserts.length);
    for (let k = 0; k < pairs; k++) {
      out.push({ op: "replace", spans: diffChars(deletes[k] as string, inserts[k] as string, maxCharCells) });
    }
    for (const text of deletes.slice(pairs)) out.push({ op: "delete", spans: [{ op: "delete", text }] });
    for (const text of inserts.slice(pairs)) out.push({ op: "insert", spans: [{ op: "insert", text }] });
    deletes = [];
    inserts = [];
  };
  for (const { op, item } of aligned) {
    if (op === "equal") {
      flush();
      out.push({ op: "equal", spans: [{ op: "equal", text: item }] });
    } else if (op === "delete") {
      deletes.push(item);
    } else {
      inserts.push(item);
    }
  }
  flush();
  return out;
}

/** 改写段内的字级差异：先剪公共前后缀（绝大多数修订只动中间几句），剩余部分做 LCS。 */
function diffChars(before: string, after: string, maxCells: number): readonly DiffSpan[] {
  const a = Array.from(before);
  const b = Array.from(after);
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;

  const midA = a.slice(head, a.length - tail);
  const midB = b.slice(head, b.length - tail);
  const middle: readonly DiffSpan[] =
    midA.length * midB.length > maxCells
      ? [
          { op: "delete", text: midA.join("") },
          { op: "insert", text: midB.join("") },
        ]
      : cleanupIslands(align(midA, midB).map(({ op, item }) => ({ op, text: item })));

  return mergeSpans([
    { op: "equal", text: a.slice(0, head).join("") },
    ...middle,
    { op: "equal", text: a.slice(a.length - tail).join("") },
  ]);
}

/** 一段连续的改动：被删掉的字与补上的字。 */
interface Edit {
  del: string;
  ins: string;
}

/**
 * 消掉改动之间的「孤岛」：字级 LCS 会把「还在鞘里→已经出鞘」拆成
 * 删"还在" 增"已经出" 留"鞘" 删"里" —— 单个巧合相同的字对读者毫无意义，
 * 反而让一处改写看起来像四处碎改。规则同 diff-match-patch 的语义清理：
 * 夹在两处改动之间、且不长于两侧改动的相同片段并入改动。
 */
function cleanupIslands(spans: readonly DiffSpan[]): readonly DiffSpan[] {
  const chunks: (string | Edit)[] = [];
  for (const s of mergeSpans(spans)) {
    const last = chunks[chunks.length - 1];
    if (s.op === "equal") chunks.push(s.text);
    else if (typeof last === "object") last[s.op === "delete" ? "del" : "ins"] += s.text;
    else chunks.push({ del: s.op === "delete" ? s.text : "", ins: s.op === "insert" ? s.text : "" });
  }

  const size = (e: Edit): number => Math.max(Array.from(e.del).length, Array.from(e.ins).length);
  for (let i = 1; i < chunks.length - 1; ) {
    const island = chunks[i];
    const prev = chunks[i - 1];
    const next = chunks[i + 1];
    if (typeof island !== "string" || typeof prev !== "object" || typeof next !== "object") {
      i += 1;
      continue;
    }
    const len = Array.from(island).length;
    if (len > size(prev) || len > size(next)) {
      i += 1;
      continue;
    }
    prev.del += island + next.del;
    prev.ins += island + next.ins;
    chunks.splice(i, 2);
    // 合并后 prev 变长，它前面的孤岛可能也够条件了 —— 退一步重查。
    i = Math.max(1, i - 2);
  }

  return chunks.flatMap((c): DiffSpan[] =>
    typeof c === "string"
      ? [{ op: "equal", text: c }]
      : [
          { op: "delete", text: c.del },
          { op: "insert", text: c.ins },
        ],
  );
}

/** 合并相邻同类 span、丢弃空 span，让渲染层拿到的是连续的块而不是单字。 */
function mergeSpans(spans: readonly DiffSpan[]): readonly DiffSpan[] {
  const out: DiffSpan[] = [];
  for (const s of spans) {
    if (s.text === "") continue;
    const last = out[out.length - 1];
    if (last !== undefined && last.op === s.op) out[out.length - 1] = { op: s.op, text: last.text + s.text };
    else out.push(s);
  }
  return out;
}
