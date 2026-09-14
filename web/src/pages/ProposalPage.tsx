/**
 * 方案页 —— 谋篇模式出方案后中间区的落点。
 *
 * 与草稿页同一个位置、同一套分工：对话只驱动，要拍板的东西在中间区看。
 * 摘要走稿本（这是作者要读进去的字），条目与影响走仪器（这是要核对的清单）。
 *
 * 没有朱批栏：左缘只给"要你处理"的告警与体检项。方案是"未定"，用石青说；
 * 只有执行停在半路那一条例外 —— 它是真的要你处理，走 finding 的 block 档。
 */

import { useState } from "react";
import { api, proposalAdoptable, type Proposal, type ProposalItem } from "../api.js";
import { useFetch } from "../hooks.js";
import { ITEM_GROUP_ORDER, itemGroupLabel } from "../labels.js";
import { RichText } from "../components/RichText.js";

export interface ProposalPageProps {
  id: string;
  refreshKey: number;
  /** 采纳后要刷新全站（方案会改资料、节拍、告警），并把焦点交回对话。 */
  onAdopted: (proposal: Proposal, messages: readonly string[]) => void;
  go: (to: string) => void;
}

export function ProposalPage({ id, refreshKey, onAdopted, go }: ProposalPageProps): React.ReactElement {
  const proposal = useFetch(() => api.proposal(id), [id, refreshKey]);
  const [adopting, setAdopting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const adopt = async (): Promise<void> => {
    setAdopting(true);
    setError(null);
    try {
      const r = await api.adoptProposal(id);
      onAdopted(r.proposal, r.messages);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdopting(false);
    }
  };

  if (proposal.error !== null) return <div className="empty">{proposal.error}</div>;
  if (proposal.data === null) return <div className="empty">载入方案…</div>;

  const p = proposal.data;
  const open = proposalAdoptable(p);

  return (
    <>
      <div className="page-head">
        <h1>{p.scope === "preparation" ? "筹备方案" : "变更方案"} {p.id}</h1>
        {open && <p>这份方案还没有动过作品。点「采纳整案」才按下面的顺序逐条执行；想改就在右栏说，助手会重提一版。</p>}
        {p.status === "adopted" && <p>已按顺序执行完毕，条目都落成了资料。</p>}
        <div className="row" style={{ marginTop: 6 }}>
          <span className="tag" data-tone={statusTone(p.status)}>{STATUS_LABEL[p.status]}</span>
          <span className="muted">
            第 {p.version} 版 · {p.items.length} 条
          </span>
          <span style={{ flex: 1 }} />
          {open && (
            <button data-primary="true" disabled={adopting} onClick={() => void adopt()}>
              {adopting ? "执行中…" : "采纳整案"}
            </button>
          )}
          <button data-quiet="true" onClick={() => go("/desk")}>回工作台</button>
        </div>
      </div>

      {error !== null && <div className="finding" data-level="block" style={{ marginBottom: 10 }}>采纳失败：{error}</div>}
      {p.failure !== undefined && (
        <div className="finding" data-level="block" style={{ marginBottom: 10 }}>
          <div className="finding-rule">停在第 {p.failure.index + 1} 条 · {p.failure.tool}</div>
          <div className="finding-msg">
            {p.failure.message}
            {"\n"}前面的条目已经落下了，这一条起没有执行。让助手针对剩下的部分重提一份方案。
          </div>
        </div>
      )}

      <article className="prose prose-note">
        <RichText text={p.summary} />
      </article>

      {p.impact.length > 0 && (
        <section className="section" style={{ marginTop: "var(--s5)" }}>
          <h2>会牵动什么</h2>
          <ul className="plain-list">
            {p.impact.map((line, i) => (
              <li key={i}>{line}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2>采纳后会做这些（按顺序）</h2>
        {groupItems(p.items).map(([group, entries]) => (
          <div key={group} className="item-group">
            <div className="item-group-title">{group}</div>
            {entries.map(({ item, index }) => (
              <div key={index} className="item" data-done={p.status !== "open" && !failedFrom(p, index)}>
                <span className="item-no">{index + 1}</span>
                <span className="item-note">{item.note}</span>
                {item.ref !== undefined && <span className="tag">新建 {item.ref}</span>}
              </div>
            ))}
          </div>
        ))}
      </section>
    </>
  );
}

const STATUS_LABEL: Record<Proposal["status"], string> = {
  open: "待拍板",
  adopted: "已采纳",
  partially_applied: "部分执行",
};

/** 待拍板＝未定，石青；执行完＝了结，done；停在半路＝要你处理，alarm。 */
function statusTone(status: Proposal["status"]): "calm" | "alarm" | "done" {
  if (status === "adopted") return "done";
  if (status === "partially_applied") return "alarm";
  return "calm";
}

/** 这一条在失败点之后（含失败点本身）—— 没有执行。 */
function failedFrom(p: Proposal, index: number): boolean {
  return p.failure !== undefined && index >= p.failure.index;
}

/** 按对象类别分组，组内保持原顺序；组的先后就是执行的先后。 */
function groupItems(items: readonly ProposalItem[]): readonly [string, { item: ProposalItem; index: number }[]][] {
  const groups = new Map<string, { item: ProposalItem; index: number }[]>();
  items.forEach((item, index) => {
    const key = itemGroupLabel(item.tool);
    groups.set(key, [...(groups.get(key) ?? []), { item, index }]);
  });
  return [...groups].sort(([a], [b]) => order(a) - order(b));
}

function order(group: string): number {
  const i = ITEM_GROUP_ORDER.indexOf(group);
  return i === -1 ? ITEM_GROUP_ORDER.length : i;
}
