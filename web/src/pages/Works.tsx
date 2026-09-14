import { useRef, useState } from "react";
import { api, workUrl, type WorkSummary } from "../api.js";
import { useFetch } from "../hooks.js";

export const GENRE_LABELS: Readonly<Record<string, string>> = {
  xuanhuan: "玄幻", xianxia: "仙侠", urban: "都市", scifi: "科幻", mystery: "悬疑", rulehorror: "规则怪谈",
};
export const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  unpublished: "暂不确定", qidian: "起点", fanqie: "番茄", feilu: "飞卢",
};

export function Works(): React.ReactElement {
  const workspace = useFetch(() => api.workspace(), []);
  const [title, setTitle] = useState("");
  const [idea, setIdea] = useState("");
  const [genre, setGenre] = useState("xuanhuan");
  const [platform, setPlatform] = useState("unpublished");
  const [targetWords, setTargetWords] = useState(300000);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRequest = useRef<{ content: string; id: string } | null>(null);

  const create = async (): Promise<void> => {
    if (busy || idea.trim() === "") return;
    const content = JSON.stringify({ title, idea, genre, platform, targetWords });
    if (lastRequest.current?.content !== content) lastRequest.current = { content, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const work = await api.createWork({ title, idea, genre, platform, targetWords, requestId: lastRequest.current.id });
      window.location.assign(workUrl(work.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="library">
      <div className="library-mast"><strong>novel-forge</strong><span>你的故事，慢慢成形。</span></div>
      <header className="library-intro"><span className="eyebrow">创作工作区</span><h1>每个故事，从一个想法开始。</h1><p>与 Agent 一起搭建世界、推敲人物、逐章创作。每一次采用，都由你决定。</p></header>
      <div className="library-columns">
        <section className="library-books" aria-label="我的作品">
          <div className="section-head"><h2>我的作品 <span>{workspace.data?.projects.length ?? 0}</span></h2><button data-quiet="true" onClick={workspace.reload}>刷新列表</button></div>
          {workspace.error !== null && <p role="alert" className="finding" data-level="block">{workspace.error}</p>}
          {workspace.loading && workspace.data === null && <div className="empty">载入作品…</div>}
          {workspace.data?.projects.length === 0 && <div className="library-empty"><BookIcon /><h3>第一本书，还没有书名也没关系。</h3><p>写下你想讲的故事，就可以开始了。</p></div>}
          <div className="book-grid">{workspace.data?.projects.map((work) => <Book key={work.id} work={work} />)}</div>
        </section>
        <section className="new-work" aria-labelledby="new-work-title">
          <span className="eyebrow">一个新的开始</span><h2 id="new-work-title">新建作品</h2><p className="muted">先保存你的想法，再通过对话完善开篇。</p>
          <form onSubmit={(event) => { event.preventDefault(); void create(); }}>
            <fieldset disabled={busy}>
              <label htmlFor="work-title">暂定书名 <span className="muted">选填</span></label><input id="work-title" value={title} maxLength={100} placeholder="给故事起个名字" onChange={(event) => setTitle(event.target.value)} />
              <label htmlFor="work-idea">你想讲一个怎样的故事？</label><textarea id="work-idea" required rows={5} maxLength={10000} value={idea} placeholder="一个人物、一场意外，或一个你放不下的念头…" onChange={(event) => setIdea(event.target.value)} />
              <div className="form-pair">
                <div><label htmlFor="work-genre">题材</label><select id="work-genre" value={genre} onChange={(event) => setGenre(event.target.value)}>{Object.entries(GENRE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
                <div><label htmlFor="work-platform">发布平台</label><select id="work-platform" value={platform} onChange={(event) => setPlatform(event.target.value)}>{Object.entries(PLATFORM_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div>
              </div>
              <label htmlFor="work-target">全书目标字数</label><input id="work-target" type="number" required min={1} max={10000000} step={1} value={targetWords} onChange={(event) => setTargetWords(Number(event.target.value))} />
              {error !== null && <p role="alert" className="finding" data-level="block">{error}</p>}
              <button className="create-work" data-primary="true" type="submit" disabled={busy || idea.trim() === ""}>{busy ? "正在保存…" : "创建作品 →"}</button>
            </fieldset>
          </form>
        </section>
      </div>
    </main>
  );
}

function Book({ work }: { work: WorkSummary }): React.ReactElement {
  const content = <><div className="book-top"><BookIcon /><span className="tag">{GENRE_LABELS[work.genre] ?? "待检查"}</span></div><h3>{work.title}</h3><p className="book-premise">{work.error ?? work.premise}</p><div className="book-meta"><span>{work.currentChapter === 0 ? "筹备中" : `已采用 ${work.chapterCount} 章`}</span>{work.pendingDrafts > 0 && <span className="pending-count">{work.pendingDrafts} 份草稿待处理</span>}</div><div className="book-bottom"><span>{work.updatedAt === "" ? "资料读取失败" : new Date(work.updatedAt).toLocaleDateString("zh-CN")}</span><span>{work.error === null ? "继续创作 ↗" : "请检查作品文件"}</span></div></>;
  return work.error === null ? <a className="book-card" href={workUrl(work.id)}>{content}</a> : <div className="book-card" data-error="true">{content}</div>;
}

function BookIcon(): React.ReactElement {
  return <svg viewBox="0 0 32 36" width="28" height="32" fill="none" aria-hidden="true"><path d="M7 3h19v29H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.4"/><path d="M7 3v25m-4 0h23M12 10h9m-9 5h6" stroke="currentColor" strokeWidth="1.2"/></svg>;
}
