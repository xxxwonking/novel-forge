import {
  forceSimulation,
  forceManyBody,
  forceLink,
  forceCollide,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
interface RelationGraph {
  nodes: readonly { id: string }[];
  edges: readonly { from: string; to: string }[];
}
export interface NetworkNode extends SimulationNodeDatum {
  id: string;
  x: number;
  y: number;
}
export function relationSimulation(graph: RelationGraph) {
  const nodes: NetworkNode[] = [...graph.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((n, i) => ({
      id: n.id,
      x: 260 + Math.cos(i * 2.399) * Math.sqrt(i + 1) * 28,
      y: 260 + Math.sin(i * 2.399) * Math.sqrt(i + 1) * 28,
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const links = graph.edges
    .filter((e) => ids.has(e.from) && ids.has(e.to))
    .map((e) => ({ source: e.from, target: e.to }));
  return forceSimulation(nodes)
    .stop()
    .force("charge", forceManyBody().strength(-650))
    .force(
      "links",
      forceLink<NetworkNode, (typeof links)[number]>(links)
        .id((n) => n.id)
        .distance(125)
        .strength(0.3),
    )
    .force("collision", forceCollide(42))
    .force("x", forceX(260).strength(0.045))
    .force("y", forceY(260).strength(0.045));
}
