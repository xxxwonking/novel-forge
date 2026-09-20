import { useEffect, useState } from "react";
import { Button, Input } from "antd";
import { api, type EntityHit, type SearchResult } from "../api.js";
import { useFetch } from "../hooks.js";

const KIND_LABELS: Record<EntityHit["kind"], string> = {
  character: "人物", setting: "地点与组织", plotLine: "情节线", volume: "卷", beat: "章节计划", event: "已确认事件",
};
const ORDER: EntityHit["kind"][] = ["character", "setting", "plotLine", "volume", "beat", "event"];

/** 结构命中的去处：资料在资料页改，事件发生在正文里。 */
function destination(hit: EntityHit): { href: string; label: string } {
  return hit.kind === "event" && hit.chapter !== null
    ? { href: `#/chapter/${hit.chapter}`, label: `到第 ${hit.chapter} 章` }
    : { href: "#/preparation", label: "到作品资料" };
}

export function Search({ query }: { query: string }): React.ReactElement {
  const [input, setInput] = useState(query);
  useEffect(() => { setInput(query); }, [query]);
  const result = useFetch<SearchResult | null>(() => (query === "" ? Promise.resolve(null) : api.search(query)), [query]);

  // 检索词进地址栏：结果可以分享、可以后退，刷新也还在。
  const submit = (value: string): void => {
    const q = value.trim();
    window.location.hash = q === "" ? "/search" : `/search?q=${encodeURIComponent(q)}`;
  };

  const data = result.data;
  const nothing = data !== null && data.chapters.length === 0 && data.entities.length === 0;

  return <>
    <div className="page-head">
      <h1>全文检索</h1>
      <p>正文与结构一起搜：人物、地点、情节线、卷、章节计划，以及已确认的事件与伏笔。</p>
    </div>
    <Input.Search
      className="search-box" size="large" allowClear enterButton="检索" placeholder="例如：钥匙"
      value={input} onChange={(e) => setInput(e.target.value)} onSearch={submit} loading={result.loading}
    />
    {result.error !== null && <div className="finding" role="alert" data-level="block">{result.error}</div>}
    {query === "" && <p className="muted">输入一个词，看它在哪几章出现过、在哪条设定里被提到。</p>}
    {nothing && <p className="muted">没有找到「{query}」。检索不做模糊匹配，换个更短的词试试。</p>}
    {data?.truncated === true && <p className="finding" data-level="warn">命中太多，只显示了一部分。换一个更具体的检索词能看到全部。</p>}

    {data !== null && data.chapters.length > 0 && (
      <section className="prep-section">
        <h2>正文 <small>{data.chapters.length} 章</small></h2>
        {data.chapters.map((hit) => (
          <article className="search-chapter" key={hit.chapter}>
            <div className="row">
              <h3>第 {hit.chapter} 章</h3>
              <span className="muted">{hit.count} 处</span>
              {hit.count > hit.snippets.length && <span className="muted">（另有 {hit.count - hit.snippets.length} 处未列出）</span>}
            </div>
            {hit.snippets.map((snippet) => (
              <a className="search-snippet" key={snippet.offset} href={`#/chapter/${hit.chapter}?quote=${encodeURIComponent(snippet.quote)}`}>
                {snippet.quote}
              </a>
            ))}
          </article>
        ))}
      </section>
    )}

    {data !== null && data.entities.length > 0 && (
      <section className="prep-section">
        <h2>结构 <small>{data.entities.length} 条</small></h2>
        {ORDER.filter((kind) => data.entities.some((e) => e.kind === kind)).map((kind) => (
          <div className="search-group" key={kind}>
            <h3>{KIND_LABELS[kind]}</h3>
            {data.entities.filter((e) => e.kind === kind).map((hit) => {
              const to = destination(hit);
              return <div className="search-entity" key={`${hit.kind}-${hit.id}-${hit.field}`}>
                <div><strong>{hit.title}</strong> <span className="muted">{hit.field}</span></div>
                <p>{hit.excerpt}</p>
                <a href={to.href}>{to.label} →</a>
              </div>;
            })}
          </div>
        ))}
      </section>
    )}
    {result.loading && data === null && query !== "" && <div className="empty">检索中…</div>}
    {result.error !== null && <Button size="small" onClick={result.reload}>重试</Button>}
  </>;
}
