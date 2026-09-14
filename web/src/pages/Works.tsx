/**
 * 作品页（Stage 2·切片 2）：列出工作区里的作品、切换活动作品、新建作品。
 *
 * 新建只填书名/题材/平台（目标字数可选）—— 前提、人物、首章安排都在对话里逐步
 * 确定，表单不替作者编造内容。题材与平台在新建时定死：它们决定字数预算与检测阈值
 * 的派生，之后不在对话里改。
 */

import { useState } from "react";
import { api, type Genre, type Platform, type WorksPayload } from "../api.js";
import { genreLabel, platformLabel } from "../labels.js";

const GENRES: readonly { value: Genre; label: string }[] = [
  "xuanhuan",
  "xianxia",
  "urban",
  "scifi",
  "mystery",
  "rulehorror",
].map((value) => ({ value: value as Genre, label: genreLabel(value) }));

const PLATFORMS: readonly { value: Platform; label: string }[] = [
  "fanqie",
  "feilu",
  "qidian",
  "unpublished",
].map((value) => ({ value: value as Platform, label: platformLabel(value) }));

export interface WorksProps {
  works: WorksPayload;
  /** 没有活动作品时被强制停在这一页，提示语随之不同。 */
  forced: boolean;
  onChanged: () => void;
  go: (to: string) => void;
}

export function Works({ works, forced, onChanged, go }: WorksProps): React.ReactElement {
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<Genre>("xuanhuan");
  const [platform, setPlatform] = useState<Platform>("fanqie");
  const [targetWords, setTargetWords] = useState("1000000");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
      go("/desk");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const create = (): Promise<void> =>
    run(async () => {
      const words = Number(targetWords);
      await api.createWork({
        title: title.trim(),
        genre,
        platform,
        ...(Number.isFinite(words) && words > 0 ? { targetWords: words } : {}),
      });
      setTitle("");
    });

  return (
    <>
      <div className="page-head">
        <h1>作品</h1>
        <p>
          {forced ? "还没有选择作品。" : ""}
          打开一本继续，或新建一本。新书只需书名、题材与平台 —— 前提、人物、首章安排都在对话里逐步定下来。
        </p>
      </div>

      {works.works.length === 0 ? (
        <div className="empty">工作区里还没有作品。先在下面新建一本。</div>
      ) : (
        <table style={{ marginBottom: 26 }}>
          <thead>
            <tr>
              <th>书名</th>
              <th>题材 / 平台</th>
              <th className="num">进度</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {works.works.map((w) => {
              const active = w.id === works.activeId;
              return (
                <tr key={w.id}>
                  <td>
                    {w.title}
                    {active && <span className="tag" data-tone="done" style={{ marginLeft: 8 }}>当前</span>}
                  </td>
                  <td className="muted">{genreLabel(w.genre)} / {platformLabel(w.platform)}</td>
                  <td className="num">{w.chapterCount === 0 ? "未开始" : `第 ${w.currentChapter} 章 · 共 ${w.chapterCount} 章`}</td>
                  <td>
                    <button disabled={busy} data-primary={!active} onClick={() => void run(() => api.selectWork(w.id))}>
                      {active ? "进入工作台" : "打开"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <section className="section">
        <h2>新建作品</h2>
        <form
          className="form"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label>
            书名
            <input value={title} placeholder="如：青州旧事" disabled={busy} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            题材
            <select value={genre} disabled={busy} onChange={(e) => setGenre(e.target.value as Genre)}>
              {GENRES.map((g) => (
                <option key={g.value} value={g.value}>{g.label}</option>
              ))}
            </select>
          </label>
          <label>
            平台
            <select value={platform} disabled={busy} onChange={(e) => setPlatform(e.target.value as Platform)}>
              {PLATFORMS.map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </label>
          <label>
            目标字数
            <input type="number" min={1} step={10000} value={targetWords} disabled={busy} onChange={(e) => setTargetWords(e.target.value)} />
          </label>
          <button type="submit" data-primary="true" disabled={busy || title.trim() === ""}>
            新建并开始
          </button>
        </form>
      </section>

      {error !== null && <div className="finding" data-level="block">{error}</div>}
    </>
  );
}
