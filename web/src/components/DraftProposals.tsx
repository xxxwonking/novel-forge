import type { DraftView } from "../api.js";

export function DraftProposals({ draft, selected, onSelected, disabled }: {
  draft: DraftView; selected: number[]; onSelected: (indices: number[]) => void; disabled: boolean;
}): React.ReactElement | null {
  if (draft.proposalOptions.length === 0) return null;
  const adopted = draft.status === "adopted";
  return <section className="draft-proposals" aria-label="写作建议的采用选择">
    <h2>写作中补充的建议</h2>
    <p className="muted">{adopted ? "这里保留本版本采用时的选择。确认过的资料与未来规划可在作品资料中查看。" : "勾选你认可的建议，采用本稿时一起确认。未勾选的建议保留，人物当前状态仍以正文记录为准。"}</p>
    {draft.proposalOptions.map(option => <div className="draft-proposal" key={option.index}>
      <label>{!adopted && <input type="checkbox" checked={selected.includes(option.index)} disabled={disabled || !option.available}
        onChange={event => onSelected(event.target.checked ? [...selected, option.index].sort((a, b) => a - b) : selected.filter(index => index !== option.index))} />}
        <strong>{option.index + 1}. {option.title}</strong>
        {adopted && <span className="tag">{option.status === "applied" ? "已随本稿确认" : "本次未采用"}</span>}
      </label>
      {option.kind === "character_update" && <p><span className="muted">原资料：</span>{option.from ?? "未记录"}</p>}
      <p><span className="muted">{option.kind === "character_update" ? "建议改为：" : "规划："}</span>{option.to}</p>
      <small className="muted">{option.reason}</small>
      {!adopted && option.problem && <p className="finding" data-level="warn">{option.problem}</p>}
    </div>)}
    {!adopted && <p role="status">已选择 {selected.length} 条，将与这一版正文一起采用。</p>}
  </section>;
}
