import type { OutlineNode } from "../api.js";
import { Chip } from "./Chip.js";
/** 资料出处不是正文锚点，不提供伪造的“跳到原文”。 */
export function OutlineNodes({nodes,lines}: {nodes:readonly OutlineNode[];lines:readonly {id:string;label:string}[]}):React.ReactElement|null {
  if(nodes.length===0) return null;
  return <section className="prep-section outline-nodes" aria-label="大纲剧情节点"><h2>大纲剧情节点 <small>{nodes.length}</small></h2>
    <p className="muted">以下来自上传资料，尚未逐章核对正文；资料未写明的章号保持空白。</p>
    {[...nodes].sort((a,b)=>a.order-b.order).map(n=><article className="prep-place" key={n.id}>
      <div className="row"><Chip color="cyan">资料推断</Chip><span>{n.plotLine===null?"未分线":lines.find(l=>l.id===n.plotLine)?.label??n.plotLine}</span><span className="muted">{n.chapter===null?"未标注章号":`资料标注：第 ${n.chapter} 章`}</span></div>
      <h3>{n.order}. {n.summary}</h3><details><summary>资料出处 · {n.source.file}</summary><blockquote>{n.source.quote}</blockquote></details>
    </article>)}
  </section>;
}
