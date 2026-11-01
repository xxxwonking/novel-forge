import { BoardPlanEditor } from "../components/BoardPlanEditor.js";
import { Chip } from "../components/Chip.js";
import { Button, Input } from "../components/controls.js";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "../components/ui/sheet.js";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Background, Handle, Position, ReactFlow, applyNodeChanges, type Node, type NodeProps, type ReactFlowInstance, type NodeChange, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, type PlotBoard as BoardData, type PlotBoardNode } from "../api.js";
import { useFetch } from "../hooks.js";
import { boardCards, boardMinZoom, boardStorageKey, chapterKey, groupKey, restoreBoardLayout, type BoardCard, type BoardLayout } from "../plot-board-layout.js";
import "./plot-board.css";

const WEIGHT = { main: "主线", sub: "支线", detail: "细节" };
const KIND = { action: "行动", info: "信息", relation: "关系", resource: "资源", decision: "决定" };
type StoryNode = Node<{ card: BoardCard; groupLabel: string; expand: () => void }, "story">;
const StoryCard = memo(function StoryCard({ data, selected }: NodeProps<StoryNode>) {
  const event = data.card.type === "event" ? data.card.members[0] : undefined;
  return <article className="board-card" data-status={event?.status ?? "folded"} data-selected={selected}>
    <Handle type="target" position={Position.Left} isConnectable={false} />
    <div className="board-card-meta"><span>{data.card.type === "group" ? "情节线" : data.card.title}</span><Chip className="board-badge">{event ? event.status === "written" ? "已写" : event.status === "outlined" ? "资料" : "计划" : "已收起"}</Chip></div>
    <div className="board-card-line">{data.groupLabel}</div>
    <p>{data.card.summary}</p>
    <div className="board-card-foot">{event ? <><span>{KIND[event.kind]}</span><span>{event.characters.map(c => c.name).join("、") || "未标注人物"}</span></>
      : <Button className="board-button nodrag" onClick={e => { e.stopPropagation(); data.expand(); }}>展开{data.card.type === "group" ? "情节线" : "本章"}</Button>}</div>
    <Handle type="source" position={Position.Right} isConnectable={false} />
  </article>;
});
const NODE_TYPES = { story: StoryCard };

export function PlotBoard({ projectId, onJump }: { projectId: string; onJump: (chapter: number, quote: string) => void }): React.ReactElement {
  const result = useFetch(api.plotBoard, [projectId]);
  if (result.error !== null) return <section className="plot-board board-message" role="alert"><h1>剧情白板暂时无法读取</h1><p>{result.error}</p><Button className="board-button" onClick={result.reload}>重新加载</Button></section>;
  if (result.loading || result.data === null) return <section className="plot-board board-message" aria-busy="true"><h1>剧情白板</h1><p role="status">正在整理剧情事件与章计划…</p></section>;
  return <BoardCanvas key={projectId} board={result.data} projectId={projectId} onJump={onJump} reload={result.reload} />;
}

function BoardCanvas({ board, projectId, onJump, reload }: { board: BoardData; projectId: string; onJump: (chapter: number, quote: string) => void; reload: () => void }): React.ReactElement {
  const [planning, setPlanning] = useState<number | "new" | null>(null);
  const planningTrigger = useRef<HTMLElement | null>(null);
  const [mobile, setMobile] = useState(() => window.matchMedia("(max-width: 720px)").matches);
  // 弹层开关是展示状态；选中仍以React Flow为唯一来源，聚焦不触发模态切换。
  const [mobileDetailsOpen, setMobileDetailsOpen] = useState(false);
  const wasMobile = useRef(mobile);
  const canvas = useRef<HTMLDivElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const update = () => setMobile(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const storageKey = boardStorageKey(projectId);
  const [initial] = useState(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      const layout = restoreBoardLayout(raw, board);
      if (raw === null) layout.collapsed = board.groups.map(g => groupKey(g.id));
      return { layout, error: false };
    }
    catch { return { layout: restoreBoardLayout(null, board), error: true }; }
  });
  const [layout, setLayout] = useState<BoardLayout>(initial.layout);
  const [saveFailed, setSaveFailed] = useState(initial.error);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pendingFocus, setPendingFocus] = useState<string | null>(null);
  const [fitOverview, setFitOverview] = useState(false);
  const [zoom, setZoom] = useState(initial.layout.viewport?.zoom ?? 0.8);
  const flow = useRef<ReactFlowInstance<StoryNode, Edge> | null>(null);
  const cards = useMemo(() => boardCards(board, layout.collapsed), [board, layout.collapsed]);
  const minZoom = useMemo(() => boardMinZoom(cards, layout.positions), [cards, layout.positions]);
  const groupLabels = useMemo(() => new Map(board.groups.map(g => [g.id, g.label])), [board.groups]);
  const toggle = useCallback((id: string) => setLayout(old => ({ ...old, collapsed: old.collapsed.includes(id) ? old.collapsed.filter(c => c !== id) : [...old.collapsed, id] })), []);
  const [nodes, setNodes] = useState<StoryNode[]>([]);
  const selectedId = nodes.find(node => node.selected)?.id ?? null;
  useEffect(() => {
    if (wasMobile.current !== mobile) {
      setMobileDetailsOpen(mobile && selectedId !== null);
      wasMobile.current = mobile;
    }
  }, [mobile, selectedId]);
  // 选中状态只存放在 React Flow 节点中，避免详情状态与画布状态相互回写。
  const setSelectedId = useCallback((id: string | null) => setNodes(old => old.map(node => {
    const selected = node.id === id;
    return node.selected === selected ? node : { ...node, selected };
  })), []);
  useEffect(() => {
    setNodes(previous => cards.map(card => ({ ...previous.find(n => n.id === card.id), id: card.id, type: "story", initialWidth: 272, initialHeight: 184, position: layout.positions[card.id] ?? card.position,
      ariaLabel: `${groupLabels.get(card.groupId)} · ${card.title} · ${card.summary}`,
      data: { card, groupLabel: groupLabels.get(card.groupId) ?? "未分线", expand: () => toggle(card.id) } })));
  }, [cards, groupLabels, layout.positions, toggle]);
  useEffect(() => {
    try { window.localStorage.setItem(storageKey, JSON.stringify(layout)); setSaveFailed(false); }
    catch { setSaveFailed(true); }
  }, [layout, storageKey]);
  useEffect(() => {
    if (!fitOverview || nodes.length !== cards.length || nodes.some(n => n.data.card.type !== "group")) return;
    const frame = window.requestAnimationFrame(() => {
      void flow.current?.fitView({ padding: 0.12, minZoom, maxZoom: 0.85 });
      setFitOverview(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [fitOverview, nodes, cards, minZoom]);
  useEffect(() => {
    if (pendingFocus === null) return;
    const card = cards.find(c => c.id === pendingFocus);
    if (!card) return;
    const p = layout.positions[card.id] ?? card.position;
    void flow.current?.setCenter(p.x + 136, p.y + 90, { zoom: 0.85 });
    setSelectedId(card.id);
    setMobileDetailsOpen(true);
    setPendingFocus(null);
    setDirectoryOpen(false);
  }, [pendingFocus, cards, layout.positions, setSelectedId]);

  const edges = useMemo(() => {
    const visible = new Map(cards.flatMap(card => card.members.map(member => [member.id, card.id] as const)));
    const unique = new Set<string>();
    return board.edges.flatMap(edge => {
      const source = visible.get(edge.source), target = visible.get(edge.target);
      if (!source || !target || source === target || unique.has(`${source}:${target}`)) return [];
      unique.add(`${source}:${target}`);
      const planned = board.nodes.find(n => n.id === edge.target)?.status !== "written";
      return [{ id: `sequence:${source}:${target}`, source, target, type: "smoothstep", selectable: false, focusable: false,
        ariaLabel: "同线事件的先后顺序", style: { strokeDasharray: planned ? "5 5" : undefined } }];
    });
  }, [cards, board]);
  const onNodesChange = useCallback((changes: NodeChange<StoryNode>[]) => {
    setNodes(old => applyNodeChanges(changes, old));
    const positions = changes.filter(c => c.type === "position" && c.position && !c.dragging);
    if (positions.length > 0) setLayout(old => {
      const next = { ...old.positions };
      for (const change of positions) if (change.type === "position" && change.position) next[change.id] = change.position;
      return { ...old, positions: next };
    });
  }, []);
  const focus = (card: BoardCard) => {
    setSelectedId(card.id);
    setMobileDetailsOpen(true);
    const position = layout.positions[card.id] ?? card.position;
    void flow.current?.setCenter(position.x + 136, position.y + 90, { zoom: 0.85 });
    setDirectoryOpen(false);
  };
  const selected = cards.find(c => c.id === selectedId);
  const selectedEvent = selected?.type === "event" ? selected.members[0] : undefined;
  const written = board.nodes.filter(n => n.status === "written").length;
  const outlined = board.nodes.filter(n=>n.status === "outlined").length;
  const search = query.trim().toLocaleLowerCase();
  const found = search ? board.nodes.filter(n => `${n.chapter ?? ""} ${n.summary} ${n.characters.map(c => c.name).join(" ")}`.toLocaleLowerCase().includes(search)) : [];
  const details = selectedEvent ? <PlotBoardDetails node={selectedEvent} groupLabel={groupLabels.get(selectedEvent.groupId) ?? "未分线"} onJump={onJump} onClose={() => setSelectedId(null)} showHeader={!mobile} onEditPlan={selectedEvent.status === "planned" && selectedEvent.chapter !== null ? () => { planningTrigger.current = returnFocus.current; setMobileDetailsOpen(false); setPlanning(selectedEvent.chapter!); } : undefined} />
    : selected && <aside className="board-details" aria-label="分组详情">{!mobile && <div className="board-detail-head"><h2>{selected.title}</h2><Button className="board-button" onClick={() => setSelectedId(null)}>关闭</Button></div>}<p>{selected.summary}</p><Button className="board-button board-primary" onClick={() => { toggle(selected.id); setSelectedId(null); }}>展开查看事件</Button></aside>;

  return <section className="plot-board" aria-label="剧情白板">
    {planning !== null && <BoardPlanEditor chapter={planning} onChanged={reload} onClose={() => { setPlanning(null); requestAnimationFrame(() => planningTrigger.current?.isConnected && planningTrigger.current.focus()); }} />}
    <header className="board-header"><div><h1>剧情白板</h1><p>{written} 个已写事件 · {board.nodes.length - written - outlined} 个未来计划 · {outlined} 个资料节点</p></div><div className="board-actions"><Button className="board-button" onClick={event => { planningTrigger.current = event.currentTarget; setPlanning("new"); }}>新增未来章计划</Button>
      {selectedEvent?.status === "planned" && selectedEvent.chapter !== null && <Button className="board-button" onClick={event => { planningTrigger.current = event.currentTarget; setMobileDetailsOpen(false); setPlanning(selectedEvent.chapter!); }}>编辑选中章计划</Button>}
      {selectedEvent?.status === "written" && <a href={`#/inference?chapter=${selectedEvent.chapter}`}>核对本章结构</a>}
    <Button className="board-button board-directory-toggle" aria-expanded={directoryOpen} aria-controls="board-directory" onClick={() => setDirectoryOpen(!directoryOpen)}>情节目录</Button><a className="board-button" href="#/plotlines">章节轨道</a><Button className="board-button" onClick={reload}>刷新数据</Button></div></header>
    <div className="board-toolbar" role="group" aria-label="画布操作">
      <Button className="board-button" onClick={() => void flow.current?.zoomOut()}>缩小</Button><output aria-label="画布缩放">{zoom < 0.01 ? (zoom * 100).toFixed(2) : Math.round(zoom * 100)}%</output><Button className="board-button" onClick={() => void flow.current?.zoomIn()}>放大</Button>
      <Button className="board-button" onClick={() => void flow.current?.fitView({ padding: 0.12, minZoom, maxZoom: 0.85 })}>适配全部</Button>
      <Button className="board-button" disabled={!selected} onClick={() => selected && focus(selected)}>定位选中</Button>
      <Button className="board-button" onClick={() => { setLayout(old => ({ ...old, collapsed: board.groups.map(g => groupKey(g.id)) })); setSelectedId(null); setFitOverview(true); }}>收起全部</Button>
      <Button className="board-button" onClick={() => setLayout(old => ({ ...old, collapsed: [] }))}>展开全部</Button>
      <Button className="board-button" onClick={() => { setLayout({ ...restoreBoardLayout(null, board), collapsed: board.groups.map(g => groupKey(g.id)) }); setSelectedId(null); setFitOverview(true); }}>重置布局</Button>
    </div>
    <div className="board-workspace" data-details={selected !== undefined}>
      <aside className="board-directory" id="board-directory" data-open={directoryOpen} aria-label="情节目录">
        <h2>情节线</h2><label className="board-search">查找剧情或章号<Input value={query} onChange={e => setQuery(e.target.value)} placeholder="摘要、人物、章号" type="search" /></label>
        {search ? <div className="board-search-results"><p>{found.length} 个匹配事件</p>{found.map(event => <Button key={event.id} className="board-result block h-auto w-full whitespace-normal text-left" onClick={() => { setLayout(old => ({ ...old, collapsed: old.collapsed.filter(id => id !== groupKey(event.groupId) && id !== chapterKey(event.groupId, event.chapter)) })); setPendingFocus(event.id); }}>{event.chapter===null?"资料未标注章号":`第 ${event.chapter} 章`} · {event.summary}</Button>)}</div>
          : board.groups.map(group => {
            const members = board.nodes.filter(n => n.groupId === group.id);
            const folded = layout.collapsed.includes(groupKey(group.id));
            const chapters = [...new Set(members.map(n => n.chapter))].sort((a, b) => (a ?? Infinity) - (b ?? Infinity));
            return <section className="board-line" key={group.id}><div className="board-line-title"><Chip className="board-badge">{group.weight === null ? "未分线" : WEIGHT[group.weight]}</Chip><span>{members.length}</span></div><h3>{group.label}</h3>
              <div className="board-actions"><Button className="board-button" aria-expanded={!folded} onClick={() => toggle(groupKey(group.id))}>{folded ? "展开" : "收起"}</Button><Button className="board-button" disabled={members.length === 0} onClick={() => { const card = cards.find(c => c.groupId === group.id); if (card) focus(card); }}>定位</Button></div>
              {!folded && chapters.length > 0 && <details><summary>按章节与资料浏览 · {chapters.filter(c=>c!==null).length} 章{chapters.includes(null)?" + 未标章号资料":""}</summary><div className="board-chapters">{chapters.map(chapter => <div key={chapter??"unassigned"}><Button className="board-chapter-link" onClick={() => { const card = cards.find(c => c.groupId === group.id && c.members.some(n => n.chapter === chapter)); if (card) focus(card); }}>{chapter===null?"未标注章号的资料":`第 ${chapter} 章`}</Button><Button className="board-button" aria-label={`${layout.collapsed.includes(chapterKey(group.id, chapter)) ? "展开" : "收起"}${group.label}${chapter===null?"未标章号资料":`第 ${chapter} 章`}`} aria-expanded={!layout.collapsed.includes(chapterKey(group.id, chapter))} onClick={() => toggle(chapterKey(group.id, chapter))}>{layout.collapsed.includes(chapterKey(group.id, chapter)) ? "展开" : "收起"}</Button></div>)}</div></details>}
            </section>;
          })}
      </aside>
      <div className="board-canvas" role="region" aria-label="剧情画布" tabIndex={-1} ref={canvas} onKeyDownCapture={event => {
        if (!mobile || (event.key !== "Enter" && event.key !== " ")) return;
        const target = event.target as HTMLElement;
        if (!target.classList.contains("react-flow__node") || !target.dataset.id) return;
        event.preventDefault(); event.stopPropagation();
        setSelectedId(target.dataset.id); setMobileDetailsOpen(true);
      }}>
        <ReactFlow<StoryNode> nodes={nodes} edges={edges} nodeTypes={NODE_TYPES} onNodesChange={onNodesChange}
          onNodeClick={(_, node) => { setSelectedId(node.id); setMobileDetailsOpen(true); }}
          onInit={instance => { flow.current = instance; }} defaultViewport={initial.layout.viewport ?? { x: 28, y: 36, zoom: 0.8 }}
          onMove={(_, view) => setZoom(view.zoom)} onMoveEnd={(_, viewport) => setLayout(old => ({ ...old, viewport }))}
          onPaneClick={() => setSelectedId(null)} nodesConnectable={false} edgesReconnectable={false} deleteKeyCode={null}
          minZoom={minZoom} maxZoom={2} onlyRenderVisibleElements colorMode="dark" multiSelectionKeyCode={null}
          ariaLabelConfig={{ "node.a11yDescription.default": "按 Enter 选中剧情节点，方向键移动卡片，Escape 取消选中。", "node.a11yDescription.keyboardDisabled": "剧情节点", "controls.zoomIn.ariaLabel": "放大", "controls.zoomOut.ariaLabel": "缩小" }}>
          <Background color="var(--canvas-grid)" gap={24} size={1} />
        </ReactFlow>
      </div>
      {!mobile && details}
    </div>
    {mobile && selected && <Sheet open={mobileDetailsOpen} onOpenChange={open => { setMobileDetailsOpen(open); if (!open) setSelectedId(null); }}>
      <SheetContent side="bottom" className="board-mobile-details" onOpenAutoFocus={() => {
        returnFocus.current = [...(canvas.current?.querySelectorAll<HTMLElement>(".react-flow__node") ?? [])].find(node => node.dataset.id === selected.id) ?? null;
      }} onCloseAutoFocus={event => {
        event.preventDefault();
        const target = returnFocus.current?.isConnected ? returnFocus.current : canvas.current;
        target?.focus({ preventScroll: true });
      }}>
        <SheetHeader><SheetTitle>{selectedEvent ? "节点详情" : selected.title}</SheetTitle><SheetDescription className="sr-only">查看选中剧情与出处，关闭后返回画布。</SheetDescription></SheetHeader>
        {details}
      </SheetContent>
    </Sheet>}
    <footer className="board-footer"><span>拖动空白平移 · 滚轮缩放 · 连线仅表示同线先后</span><span role="status">{saveFailed ? "布局无法保存；请检查浏览器存储权限" : "布局保存在此浏览器 · 按作品隔离"}</span></footer>
  </section>;
}

export function PlotBoardDetails({ node, groupLabel, onJump, onClose, showHeader = true, onEditPlan }: { node: PlotBoardNode; groupLabel: string; onJump: (chapter: number, quote: string) => void; onClose: () => void; showHeader?: boolean; onEditPlan?: (() => void) | undefined }): React.ReactElement {
  const point = node.status === "written" ? node.point : null;
  return <aside className="board-details" aria-label="剧情节点详情">{showHeader && <div className="board-detail-head"><h2>节点详情</h2><Button className="board-button" onClick={onClose}>关闭</Button></div>}
    <div className="board-actions"><Chip className="board-badge" data-status={node.status}>{node.status === "written" ? "已写事实" : node.status === "outlined" ? "资料推断" : "未来计划"}</Chip><Chip className="board-badge">{KIND[node.kind]}</Chip></div>
    <h3>{node.chapter===null?"资料未标注章号":`第 ${node.chapter} 章`}</h3><p className="board-detail-summary">{node.summary}</p>
    <dl><dt>情节线</dt><dd>{groupLabel}</dd><dt>来源</dt><dd>{node.source}</dd>{node.volume !== null && <><dt>卷</dt><dd>第 {node.volume} 卷</dd></>}<dt>关联人物</dt><dd>{node.characters.map(c => c.name).join("、") || "未标注人物"}</dd></dl>
    {node.materialSource && <section><h3>资料出处 · {node.materialSource.file}</h3><blockquote>{node.materialSource.quote}</blockquote><p className="board-source-note">来自大纲资料，尚未核对正文；不是正文原文定位。</p></section>}
    {point !== null ? <><h3>原文出处</h3><blockquote>{point.anchor.quote}</blockquote>{point.resolution.status === "stale" ? <p role="status">原文已变动或章节不存在，暂时无法定位。请在章节轨道核对。</p> : <Button className="board-button board-primary" onClick={() => onJump(point.chapter, point.anchor.quote)}>打开原文</Button>}</>
      : <p className="board-source-note">{node.status === "outlined" ? "作者已确认这份资料整理结果；正文事件仍需逐章核实。" : node.status === "planned" ? "来自已确认章计划，尚未写入正文。规划调整请前往作品资料。" : "这条事件没有可定位的原文出处。"}</p>}
    {onEditPlan && <Button className="board-button" onClick={onEditPlan}>编辑本章计划</Button>}
  </aside>;
}
