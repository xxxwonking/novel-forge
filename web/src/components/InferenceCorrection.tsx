import { useState } from "react";
import { api, type InferenceCorrection as Candidate } from "../api.js";
import { useFetch } from "../hooks.js";
import { Button, DialogFrame } from "./controls.js";
import { StructureEditor } from "./StructureEditor.js";
export function InferenceCorrection({
  chapter,
  characters,
  onClose,
  onChanged,
}: {
  chapter: number;
  characters: readonly {
    id: string;
    name: string;
  }[];
  onClose: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const data = useFetch(() => api.inferenceCorrection(chapter), [chapter]);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const source = data.data;
  const confirm = async () => {
    if (!candidate || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmInferenceCorrection(candidate.id);
      onChanged();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <DialogFrame
      open
      title={candidate ? "确认结构纠正" : `纠正第 ${chapter} 章结构`}
      width={760}
      onCancel={onClose}
      confirmLoading={busy}
      {...(candidate
        ? {
            onOk: () => void confirm(),
            okText: "确认纠正结构",
            cancelText: "暂不确认",
          }
        : { footer: <Button onClick={onClose}>关闭</Button> })}
    >
      {candidate ? (
        <>
          <p>
            {candidate.summary}
            。正文保持不变；确认会追加新结构并保留被排除的旧记录。
          </p>
          {candidate.impact.changes.map((change, i) => (
            <p key={i}>{change.text}</p>
          ))}
          <h3>后续影响</h3>
          {candidate.impact.chapters.length === 0 ? (
            <p>未检出可机械判定的后章结构冲突，仍需自行核对语义。</p>
          ) : (
            candidate.impact.chapters.map((impact) => (
              <p key={impact.chapter}>
                第 {impact.chapter} 章 ·{" "}
                {impact.severity === "conflict" ? "结构冲突" : "待复核"}
              </p>
            ))
          )}
          <p className="muted">
            硬冲突会进入返修清单并阻止继续连写，不会替你改后文。
          </p>
        </>
      ) : source ? (
        <>
          {source.candidates.map((p) => (
            <Button
              key={p.id}
              onClick={() => setCandidate(p)}
              disabled={p.sourceToken !== source.sourceToken}
            >
              查看待确认纠正：{p.summary}
            </Button>
          ))}
          <StructureEditor
            draft={{
              chapter,
              draftId: "inference",
              revisionToken: source.sourceToken,
              declaration: source.declaration,
            }}
            characters={characters}
            onSaved={() => undefined}
            onClose={onClose}
            onSubmit={async (payload) => {
              setCandidate(
                await api.proposeInferenceCorrection({
                  chapter,
                  sourceToken: source.sourceToken,
                  summary: payload.summary,
                  changes: payload.changes,
                }),
              );
            }}
          />
        </>
      ) : (
        <p role={data.error ? "alert" : "status"}>
          {data.error ?? "正在读取正式结构与版本…"}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </DialogFrame>
  );
}
