/**
 * 跨多章返修（差距第 5 项下半场的界面）。
 *
 * 界面要替作者回答三个问题：**改早章之后哪几章对不上**、**具体是哪几句话**、
 * **改完了怎么销账**。所以主体是一张按章的待办表，不是一份报告。
 *
 * 两处刻意的取舍：
 *
 * 1. **定位受影响段落要花一次模型调用，所以由作者一章一章地点**，不在打开页面时
 *    自动全书扫。硬矛盾是免费算出来的，进页面就在。
 * 2. **产物是建议，不是改稿。** 每条给出引文、为什么、怎么改，落笔仍走那一章的
 *    结果页 —— 与「逐章采用」同一条原则。
 */

import { useState } from "react";
import { Button, InputNumber, Tooltip } from "antd";
import { api, type RevisionChapter } from "../api.js";
import { useFetch, useRouteActive } from "../hooks.js";
import { Chip } from "../components/Chip.js";

const SEVERITY: Record<RevisionChapter["severity"], { label: string; color: string; hint: string }> = {
  conflict: { label: "必须处理", color: "orange", hint: "结构事实已经对不上：不改就是错的。未处理完不能连写。" },
  review: { label: "建议复核", color: "gold", hint: "这一章引用了被改动的东西，值得再读一遍，不一定要改。" },
};

export function Revision({ refresh }: { refresh: () => void }): React.ReactElement {
  const isCurrent = useRouteActive();
  const data = useFetch(() => api.revisionView(), []);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [other, setOther] = useState<number | null>(null);
  /** 默认落在被改那一章的下一章：留空会让按钮恒灰，作者以为功能坏了。 */
  const target = other ?? (data.data?.latest === null ? null : (data.data?.latest.chapter ?? 0) + 1);

  if (data.data === null) return <div className="empty">{data.error ?? "读取返修清单…"} <Button size="small" onClick={data.reload}>重试</Button></div>;
  const view = data.data;

  const run = async (key: string, action: () => Promise<string>): Promise<void> => {
    if (busy !== null) return;
    setBusy(key); setError(null); setNotice(null);
    try {
      const message = await action();
      if (isCurrent()) { setNotice(message); data.reload(); }
      refresh();
    } catch (cause) { if (isCurrent()) setError((cause as Error).message); }
    finally { setBusy(null); }
  };

  const locate = (chapter: number): Promise<void> => run(`locate${chapter}`, async () => {
    const result = await api.locateRevision(chapter);
    return result.passages.length === 0
      ? `第 ${chapter} 章查过了，没找到需要改的段落。${result.notes.join("")}`
      : `第 ${chapter} 章找到 ${result.passages.length} 处要改的地方。`;
  });

  /** 从清单跳到那一章的结果页去改 —— 返修入口在那里，不在这张表上。 */
  const open = (chapter: number): Promise<void> => run(`open${chapter}`, async () => {
    const drafts = await api.chapterDrafts(chapter);
    const adopted = drafts.find((draft) => draft.isCurrentAdopted);
    if (adopted === undefined) throw new Error(`第 ${chapter} 章还没有正式版本，无法返修`);
    window.location.hash = `/draft/${chapter}/${adopted.draftId}`;
    return `已打开第 ${chapter} 章的正式版本。`;
  });

  return <>
    <div className="page-head"><h1>跨章返修</h1><p>改了前面的章之后，后面哪些章对不上了。结构上的硬矛盾是算出来的；正文里的牵连要点「定位受影响段落」让模型读一遍那一章。</p></div>

    {(error ?? data.error) !== null && <div className="finding" data-level="block" role="alert">{error ?? data.error}</div>}
    {notice !== null && <p className="prep-notice" role="status">{notice}</p>}

    <div className="prep-readiness">
      <div>
        <strong>{view.pending === 0 ? "没有待复核的章节" : `${view.pending} 章待复核${view.conflicts > 0 ? `，其中 ${view.conflicts} 章必须处理` : ""}`}</strong>
        <p>{view.latest === null
          ? "还没有改过已采用的章节。改早章之后，这里会列出受牵连的后续章。"
          : `最近一次修订是第 ${view.latest.chapter} 章。${view.conflicts > 0 ? "未处理完不能开始连写 —— 接下来的每一章都会建立在错的基准上。" : ""}`}</p>
      </div>
      {view.latest !== null && <div className="row">
        {/* 代码只圈得出有结构关联的章。正文里的牵连没有编号可查，作者比谁都清楚该看哪一章。 */}
        <label>还担心第 <InputNumber min={view.latest.chapter + 1} value={target} onChange={(value) => setOther(typeof value === "number" ? value : null)} /> 章</label>
        <Button loading={busy === `locate${target ?? 0}`} disabled={busy !== null || target === null} onClick={() => target !== null && void locate(target)}>也查一下</Button>
      </div>}
    </div>

    {view.chapters.length === 0
      ? <p className="muted">清单是空的。修改已采用的章节时，系统会在这里列出受影响的后续章。</p>
      : <section className="prep-section">
        <div className="section-head"><h2>待复核的章节 <small>{view.chapters.length} 章</small></h2></div>
        {view.chapters.map((item) => {
          const severity = SEVERITY[item.severity];
          const done = item.state === "resolved";
          return <article className="prep-beat" key={item.chapter} data-state={item.state}>
            <div className="row">
              <h3>第 {item.chapter} 章</h3>
              {done ? <Chip>已处理</Chip> : <Tooltip title={severity.hint}><Chip color={severity.color}>{severity.label}</Chip></Tooltip>}
              <span className="muted">因第 {item.triggers.map((t) => t.chapter).join("、")} 章的修订</span>
              <span className="push-right row">
                <a href={`#/chapter/${item.chapter}`}>读正文</a>
                <Button size="small" loading={busy === `locate${item.chapter}`} disabled={busy !== null}
                  onClick={() => void locate(item.chapter)}>{item.state === "located" && !item.outdated ? "重新定位" : "定位受影响段落"}</Button>
                <Button size="small" loading={busy === `open${item.chapter}`} disabled={busy !== null} onClick={() => void open(item.chapter)}>去改这一章</Button>
                {!done && <Button size="small" type="text" loading={busy === `resolve${item.chapter}`} disabled={busy !== null}
                  onClick={() => void run(`resolve${item.chapter}`, async () => { await api.resolveRevision(item.chapter); return `第 ${item.chapter} 章已标记处理完毕。`; })}>不用改 / 已改完</Button>}
              </span>
            </div>

            {item.reasons.map((reason, index) => <p className="finding" data-level={reason.severity === "conflict" ? "block" : "warn"} key={index}>{reason.text}</p>)}
            {item.outdated && <p className="finding" data-level="warn">下面这批段落是按上一次修订找的，之后又改过一次 —— 重新定位再看。</p>}
            {item.notes.map((note, index) => <p className="finding" data-level="info" key={`note-${index}`}>{note}</p>)}

            {item.passages.length > 0 && <div className="prep-facts">
              {item.passages.map((passage, index) => <div className="draft-change" key={index}>
                <div>
                  <blockquote>「{passage.quote}」</blockquote>
                  <p className="muted">{passage.why}</p>
                  <p><strong>建议改法：</strong>{passage.suggestion}</p>
                </div>
                <a href={`#/chapter/${item.chapter}?quote=${encodeURIComponent(passage.quote)}`}>在正文里查看 ↗</a>
              </div>)}
            </div>}

            <details>
              <summary>前面改了什么（{item.changes.length} 条）</summary>
              <ul className="muted">{item.changes.map((change, index) => <li key={index}>{change}</li>)}</ul>
            </details>
          </article>;
        })}
      </section>}
  </>;
}
