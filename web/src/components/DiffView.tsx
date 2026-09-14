/**
 * 草稿新旧对比：段落级去留 + 改写段内的字级高亮。
 *
 * 红绿是刻意的破例（见 styles.css 开头）：删除=红底、新增=绿底是通用的增删语义，
 * 与行情涨跌无关。连续未改动的段落折叠，只留首尾各一段做上下文。
 */

import { useState } from "react";
import type { DiffParagraph, DraftDiffPayload } from "../api.js";

/** 连续未改动的段落超过这个数就折叠。布局参数，不是规则常量。 */
const FOLD_THRESHOLD = 3;

type DiffBlock = { kind: "para"; index: number } | { kind: "fold"; from: number; to: number };

function foldUnchanged(paragraphs: readonly DiffParagraph[]): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let i = 0;
  while (i < paragraphs.length) {
    if (paragraphs[i]?.op !== "equal") {
      blocks.push({ kind: "para", index: i });
      i += 1;
      continue;
    }
    let j = i;
    while (j < paragraphs.length && paragraphs[j]?.op === "equal") j += 1;
    if (j - i > FOLD_THRESHOLD) {
      blocks.push({ kind: "para", index: i }, { kind: "fold", from: i + 1, to: j - 1 }, { kind: "para", index: j - 1 });
    } else {
      for (let k = i; k < j; k++) blocks.push({ kind: "para", index: k });
    }
    i = j;
  }
  return blocks;
}

export function DiffView({ diff }: { diff: DraftDiffPayload }): React.ReactElement {
  const [opened, setOpened] = useState<ReadonlySet<number>>(new Set());
  const blocks = foldUnchanged(diff.paragraphs);

  const para = (index: number): React.ReactNode => {
    const p = diff.paragraphs[index];
    if (p === undefined) return null;
    return (
      <p key={index} data-op={p.op}>
        {p.op === "replace"
          ? p.spans.map((s, i) => (s.op === "equal" ? s.text : <span key={i} data-op={s.op}>{s.text}</span>))
          : p.spans.map((s) => s.text).join("")}
      </p>
    );
  };

  return (
    <div className="diff">
      <div className="row diff-head">
        <span className="tag" data-tone="warn">第 {diff.revision}/{diff.total} 次修订</span>
        <span className="muted">{diff.reason} · {diff.beforeWords} → {diff.afterWords} 字</span>
        <span className="diff-stat" data-op="insert">+{diff.inserted}</span>
        <span className="diff-stat" data-op="delete">−{diff.deleted}</span>
        <span className="muted">改动 {diff.changed} 段</span>
      </div>
      <article className="prose diff-body">
        {blocks.map((b) =>
          b.kind === "para" ? (
            para(b.index)
          ) : opened.has(b.from) ? (
            Array.from({ length: b.to - b.from }, (_, k) => para(b.from + k))
          ) : (
            <button
              key={`fold-${b.from}`}
              className="diff-fold"
              onClick={() => setOpened((prev) => new Set(prev).add(b.from))}
            >
              … {b.to - b.from} 段未改动，点开查看
            </button>
          ),
        )}
      </article>
    </div>
  );
}
