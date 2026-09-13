/**
 * 工作台 —— 默认落点，中间区在没有产物可看时显示的东西：筹备状态 + 下一章的草稿。
 *
 * 写入一律经右栏对话（正式事实边界在后端），所以这里没有任何可编辑控件 ——
 * 缺项列在最前，让作者知道下一句该说什么。
 */

import { adoptable, api, type PrepPayload } from "../api.js";
import { useFetch } from "../hooks.js";
import { draftStatusLabel, draftStatusTone } from "../labels.js";

export interface DeskProps {
  prep: PrepPayload | null;
  prepError: string | null;
  refreshKey: number;
  onOpenDraft: (chapter: number, draftId: string) => void;
  onAdopt: (chapter: number, draftId: string) => void;
}

export function Desk({ prep, prepError, refreshKey, onOpenDraft, onAdopt }: DeskProps): React.ReactElement {
  const next = prep?.nextChapter ?? 0;
  const drafts = useFetch(() => (next === 0 ? Promise.resolve([]) : api.chapterDrafts(next)), [next, refreshKey]);

  return (
    <>
      <div className="page-head">
        <h1>工作台</h1>
        <p>
          在右侧对话里把这本书定下来：方向、人物、地点、情节线、首章安排。
          说清一件事我就落成资料；还在犹豫时只讨论，不写。
          写出的章节是<strong>待采用草稿</strong>，会在这里打开 —— 你确认采用后才成为正式进度。
        </p>
      </div>

      {prepError !== null ? (
        <div className="empty">读取筹备状态失败：{prepError}</div>
      ) : prep === null ? (
        <div className="empty">载入中</div>
      ) : (
        <PrepPanel prep={prep} />
      )}

      {next > 0 && (
        <section className="section">
          <h2>第 {next} 章的草稿</h2>
          {drafts.data === null ? (
            <div className="empty">{drafts.error ?? "载入中"}</div>
          ) : drafts.data.length === 0 ? (
            <div className="empty">还没有草稿。在右侧说「写第 {next} 章」。</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>草稿</th>
                  <th>状态</th>
                  <th className="num">字数</th>
                  <th className="num">修订</th>
                  <th className="num">问题</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {drafts.data.map((d) => (
                  <tr key={d.draftId}>
                    <td>{d.draftId}</td>
                    <td>
                      <span className="tag" data-tone={draftStatusTone(d.status)}>{draftStatusLabel(d.status)}</span>
                    </td>
                    <td className="num">{d.body.length}</td>
                    <td className="num">{d.revisions.length === 0 ? "—" : d.revisions.length}</td>
                    <td className="num">{d.findings.filter((f) => f.level === "block" || f.level === "warn").length}</td>
                    <td>
                      <div className="row" style={{ justifyContent: "flex-end" }}>
                        <button data-quiet="true" onClick={() => onOpenDraft(d.chapter, d.draftId)}>查看</button>
                        {adoptable(d) && (
                          <button data-primary="true" onClick={() => onAdopt(d.chapter, d.draftId)}>采用</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      )}
    </>
  );
}

const POV_LABEL: Record<string, string> = {
  first: "第一人称",
  third_limited: "第三人称限知",
  third_omniscient: "第三人称全知",
};

const TIER_LABEL: Record<string, string> = {
  protagonist: "主角",
  major: "主要",
  minor: "次要",
  extra: "龙套",
};

function PrepPanel({ prep }: { prep: PrepPayload }): React.ReactElement {
  const { setting, characters, locations, plotLines, gaps } = prep;
  const list = (items: readonly string[]): React.ReactNode =>
    items.length === 0 ? <span className="muted">未定</span> : items.join("、");

  return (
    <div className="prep">
      <div className="row">
        <span className="tag" data-tone={gaps.length === 0 ? "done" : "warn"}>
          {gaps.length === 0 ? "筹备已齐" : `还缺 ${gaps.length} 项`}
        </span>
        {gaps.length === 0 ? (
          <span className="muted">可以写第 {prep.nextChapter} 章了。</span>
        ) : (
          <span className="muted">{gaps.join("、")} —— 在右侧说清即可，我会落成资料。</span>
        )}
        <span style={{ flex: 1 }} />
        <span className="muted">目标 {Math.round(prep.targetWords / 10000)} 万字 · 纪律 {prep.discipline.version}（{prep.discipline.rules.length} 条）</span>
      </div>

      <dl>
        <dt>前提</dt>
        <dd>{setting.premise === "" ? <span className="muted">未定</span> : setting.premise}</dd>
        <dt>核心冲突</dt>
        <dd>{setting.centralConflict === "" ? <span className="muted">未定</span> : setting.centralConflict}</dd>
        <dt>视角</dt>
        <dd className="muted">{POV_LABEL[setting.pov] ?? setting.pov} · {setting.tense === "past" ? "过去时" : "现在时"}</dd>
        <dt>人物 {characters.length}</dt>
        <dd>
          {characters.length === 0 ? (
            <span className="muted">未建</span>
          ) : (
            characters.map((c) => (
              <span key={c.id} style={{ marginRight: 10 }}>
                <span className="tag">{c.id}</span> {c.name}
                <span className="muted">（{TIER_LABEL[c.tier] ?? c.tier}{c.role === "" ? "" : `·${c.role}`}）</span>
              </span>
            ))
          )}
        </dd>
        <dt>地点/组织 {locations.length}</dt>
        <dd>
          {locations.length === 0 ? (
            <span className="muted">未建</span>
          ) : (
            locations.map((s) => (
              <span key={s.id} style={{ marginRight: 10 }}>
                <span className="tag">{s.id}</span> {s.name}
              </span>
            ))
          )}
        </dd>
        <dt>情节线 {plotLines.length}</dt>
        <dd>
          {plotLines.length === 0 ? (
            <span className="muted">未定</span>
          ) : (
            plotLines.map((p) => (
              <span key={p.id} style={{ marginRight: 10 }}>
                <span className="tag" data-w={p.weight}>{p.id}</span> {p.label}
              </span>
            ))
          )}
        </dd>
        <dt>世界观</dt>
        <dd>{list(setting.worldRules)}</dd>
        <dt>禁忌</dt>
        <dd>{list(setting.taboos)}</dd>
      </dl>
    </div>
  );
}
