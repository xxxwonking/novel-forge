import { useState } from "react";
import { api, type PreparationProposal } from "../api.js";
import { useFetch } from "../hooks.js";
import { BeatEditor } from "./PreparationEditors.js";
import { Button, DialogFrame, NumberInput } from "./controls.js";
/** 白板只编辑未来章计划；复用资料候选与版本确认，画布布局不参与。 */
export function BoardPlanEditor({
  chapter,
  onClose,
  onChanged,
}: {
  chapter: number | "new";
  onClose: () => void;
  onChanged: () => void;
}): React.ReactElement {
  const data = useFetch(api.preparation);
  const [chosen, setChosen] = useState<number | null>(
    chapter === "new" ? null : chapter,
  );
  const [editing, setEditing] = useState(chapter !== "new");
  const [proposal, setProposal] = useState<PreparationProposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const view = data.data;
  const confirm = async () => {
    if (!proposal || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.confirmPreparation(proposal.id);
      onChanged();
      onClose();
    } catch (cause) {
      setError((cause as Error).message);
    } finally {
      setBusy(false);
    }
  };
  if (proposal)
    return (
      <DialogFrame
        open
        title="确认白板规划"
        onCancel={onClose}
        onOk={() => void confirm()}
        okText="确认规划"
        cancelText="暂不确认"
        confirmLoading={busy}
      >
        <p>
          尚未改变正式计划。确认后才在白板和后续写章中生效；已写正文保持不变。
        </p>
        {proposal.changes.beats?.map((beat) => (
          <section key={beat.chapter}>
            <h3>第 {beat.chapter} 章</h3>
            <p>{beat.plan.coreEvent}</p>
            <p>阶段反馈：{beat.plan.stageFeedback}</p>
            <p>章末钩子：{beat.plan.hook}</p>
            <p>
              人物：
              {beat.plan.characters
                .map(
                  (id) =>
                    view?.confirmed.characters.find((c) => c.id === id)?.name ??
                    id,
                )
                .join("、")}
            </p>
            {beat.plan.events.map((e, i) => (
              <p key={i}>
                {view?.confirmed.plotLines.find(
                  (line) => line.id === e.plotLine,
                )?.label ?? "未分线"}
                ：{e.summary}
              </p>
            ))}
          </section>
        ))}
        {proposal.changes.removals?.beats?.map((n) => (
          <p key={n}>删除第 {n} 章未来计划。</p>
        ))}
        {proposal.findings.map((finding, i) => (
          <p key={i} className="finding" data-level={finding.level}>
            {finding.message}
          </p>
        ))}
        {error && <p role="alert">{error}</p>}
        <a
          href={`#/preparation?proposal=${encodeURIComponent(proposal.id)}`}
          onClick={onClose}
        >
          到资料页查看完整候选
        </a>
      </DialogFrame>
    );
  if (!view)
    return (
      <DialogFrame
        open
        title="读取章计划"
        onCancel={onClose}
        footer={<Button onClick={onClose}>关闭</Button>}
      >
        <p role={data.error ? "alert" : "status"}>
          {data.error ?? "正在读取现有资料与章计划…"}
        </p>
        {data.error && <Button onClick={data.reload}>重试</Button>}
      </DialogFrame>
    );
  const n = chosen ?? view.nextChapter;
  const missing = [
    ...(view.confirmed.characters.length === 0 ? ["人物档案"] : []),
    ...(view.confirmed.settings.length === 0 ? ["地点或组织"] : []),
  ];
  if (editing && n >= view.nextChapter && missing.length === 0)
    return (
      <BeatEditor
        candidate
        base={view.confirmed.beats.find((b) => b.chapter === n) ?? null}
        chapter={n}
        characters={view.confirmed.characters}
        settings={view.confirmed.settings}
        plotLines={view.confirmed.plotLines}
        fingerprint={view.fingerprint}
        onSaved={setProposal}
        onClose={onClose}
      />
    );
  return (
    <DialogFrame
      open
      title="安排未来章计划"
      onCancel={onClose}
      onOk={() => {
        if (missing.length > 0)
          setError(`请先补齐${missing.join("、")}，再安排可执行的章计划`);
        else if (Number.isSafeInteger(n) && n >= view.nextChapter)
          setEditing(true);
        else setError(`请输入第 ${view.nextChapter} 章或之后的整数章号`);
      }}
      okText="编辑章计划"
    >
      <p>
        每章可安排多个具体事件，并关联人物与情节线。章节按故事需要继续扩展。
      </p>
      {missing.length > 0 && (
        <p className="finding" data-level="warn">
          还缺少{missing.join("、")}。
          <a href="#/preparation" onClick={onClose}>
            去作品资料补齐
          </a>
        </p>
      )}
      <label>
        章号
        <NumberInput value={n} min={view.nextChapter} onChange={setChosen} />
      </label>
      <p className="muted">已写正文的剧情请通过结构纠正或返修处理。</p>
      {error && <p role="alert">{error}</p>}
    </DialogFrame>
  );
}
