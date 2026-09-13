/**
 * 草稿页 —— 对话写出一章后中间区的落点（参考 OpenFic：对话只驱动，正文在编辑区看）。
 *
 * 正文随主区滚动、不限高；「对比上一版」在同一位置切换成红绿 diff。
 * 采用/跳原文/回工作台都交给 App：采用是受控端点，导航是全局的事。
 */

import { useEffect, useState } from "react";
import { adoptable, api, type DraftDiffPayload } from "../api.js";
import { useFetch } from "../hooks.js";
import { draftStatusLabel, draftStatusTone } from "../labels.js";
import { DiffView } from "../components/DiffView.js";

export interface DraftPageProps {
  chapter: number;
  draftId: string;
  refreshKey: number;
  onAdopt: (chapter: number, draftId: string) => void;
  onJump: (chapter: number, quote: string) => void;
  go: (to: string) => void;
}

export function DraftPage({ chapter, draftId, refreshKey, onAdopt, onJump, go }: DraftPageProps): React.ReactElement {
  const draft = useFetch(() => api.chapterDraft(chapter, draftId), [chapter, draftId, refreshKey]);
  const siblings = useFetch(() => api.chapterDrafts(chapter), [chapter, refreshKey]);
  const [diff, setDiff] = useState<DraftDiffPayload | null>(null);
  const [diffError, setDiffError] = useState<string | null>(null);

  useEffect(() => {
    setDiff(null);
    setDiffError(null);
  }, [draftId]);

  const toggleDiff = async (): Promise<void> => {
    if (diff !== null) {
      setDiff(null);
      return;
    }
    try {
      setDiff(await api.chapterDiff(chapter, draftId));
      setDiffError(null);
    } catch (e) {
      setDiffError((e as Error).message);
    }
  };

  if (draft.error !== null) return <div className="empty">{draft.error}</div>;
  if (draft.data === null) return <div className="empty">载入草稿…</div>;

  const d = draft.data;
  const revised = d.revisions.length;

  return (
    <>
      <div className="page-head">
        <h1>第 {chapter} 章 · 草稿 {d.draftId}</h1>
        <div className="row" style={{ marginTop: 6 }}>
          <span className="tag" data-tone={draftStatusTone(d.status)}>{draftStatusLabel(d.status)}</span>
          <span className="muted">
            {d.body.length} 字{revised > 0 ? ` · 自动修订 ${revised} 次` : ""}
          </span>
          <span style={{ flex: 1 }} />
          {revised > 0 && (
            <button data-quiet="true" onClick={() => void toggleDiff()}>
              {diff === null ? "对比上一版" : "看当前正文"}
            </button>
          )}
          {adoptable(d) && (
            <button data-primary="true" onClick={() => onAdopt(chapter, d.draftId)}>采用这一版</button>
          )}
          {d.status === "adopted" && (
            <button data-quiet="true" onClick={() => onJump(chapter, "")}>在正文页打开该章</button>
          )}
          <button data-quiet="true" onClick={() => go("/desk")}>回工作台</button>
        </div>
      </div>

      {siblings.data !== null && siblings.data.length > 1 && (
        <div className="row" style={{ marginBottom: 16 }}>
          <span className="muted">本章各版：</span>
          {siblings.data.map((s) => (
            <a
              key={s.draftId}
              href={`#/draft/${chapter}/${encodeURIComponent(s.draftId)}`}
              className="tag"
              data-tone={s.draftId === d.draftId ? undefined : draftStatusTone(s.status) ?? "done"}
              data-current={s.draftId === d.draftId}
            >
              {s.draftId}
            </a>
          ))}
        </div>
      )}

      {d.error !== null && (
        <div className="finding" data-level="block" style={{ marginBottom: 10 }}>
          <div className="finding-rule">{d.error.step}</div>
          <div className="finding-msg">{d.error.detail}</div>
        </div>
      )}
      {diffError !== null && <div className="finding" data-level="block" style={{ marginBottom: 10 }}>{diffError}</div>}
      {d.findings.length > 0 && (
        <div className="findings" style={{ marginBottom: 16 }}>
          {d.findings.map((f, i) => (
            <div key={i} className="finding" data-level={f.level}>
              <div className="finding-rule">{f.rule} · {f.level}</div>
              <div className="finding-msg">{f.message}</div>
            </div>
          ))}
        </div>
      )}

      {diff !== null ? (
        <DiffView diff={diff} />
      ) : (
        <article className="prose">
          {d.body.split(/\n+/u).map((p, i) => (p.trim() === "" ? null : <p key={i}>{p}</p>))}
        </article>
      )}
    </>
  );
}
