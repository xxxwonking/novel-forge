import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { RelationGraph } from "../api.js";
import { relationSimulation } from "../relation-layout.js";
const initialView = { x: 0, y: 0, size: 520 };
export function useRelationNetwork(graph: RelationGraph, paused: boolean) {
  const svg = useRef<SVGSVGElement>(null);
  const simulation = useMemo(() => relationSimulation(graph).tick(60), [graph]);
  const [revision, redraw] = useState(0);
  const [view, setView] = useState(initialView);
  const [pixels, setPixels] = useState(520);
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      const r = el.getBoundingClientRect();
      setPixels(Math.max(1, Math.min(r.width, r.height)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const moved = useRef(false);
  const pointers = useRef(
    new Map<number, { x: number; y: number; node: string | null }>(),
  );
  const reduced = useRef(false);
  const positions = new Map(
    simulation.nodes().map((n) => [n.id, { x: n.x, y: n.y }]),
  );
  const fit = () => {
    const nodes = simulation.nodes();
    if (!nodes.length) {
      setView(initialView);
      return;
    }
    const xs = nodes.map((n) => n.x),
      ys = nodes.map((n) => n.y);
    const left = Math.min(...xs),
      right = Math.max(...xs),
      top = Math.min(...ys),
      bottom = Math.max(...ys);
    const size = Math.max(400, right - left + 140, bottom - top + 140);
    setView({
      x: (left + right - size) / 2,
      y: (top + bottom - size) / 2,
      size,
    });
  };
  useEffect(() => {
    fit();
    redraw((n) => n + 1);
    return () => {
      simulation.stop();
      pointers.current.clear();
    };
  }, [simulation]);
  useEffect(() => {
    const media = matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => {
      reduced.current = media.matches;
      if (paused || document.hidden || media.matches) simulation.stop();
      else simulation.restart();
    };
    simulation.on("tick", () => redraw((n) => n + 1));
    update();
    media.addEventListener("change", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      simulation.stop();
      simulation.on("tick", null);
      media.removeEventListener("change", update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [simulation, paused]);
  const point = (x: number, y: number) => {
    const matrix = svg.current?.getScreenCTM();
    return matrix
      ? new DOMPoint(x, y).matrixTransform(matrix.inverse())
      : new DOMPoint(x, y);
  };
  const zoomAt = (factor: number, x?: number, y?: number) => {
    const rect = svg.current?.getBoundingClientRect();
    if (!rect) return;
    const p = point(
      x ?? rect.x + rect.width / 2,
      y ?? rect.y + rect.height / 2,
    );
    setView((v) => {
      const size = Math.max(160, Math.min(4000, v.size * factor));
      const f = size / v.size;
      return { x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, size };
    });
  };
  const zoomRef = useRef(zoomAt);
  zoomRef.current = zoomAt;
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomRef.current(
        Math.exp(Math.max(-100, Math.min(100, e.deltaY)) * 0.002),
        e.clientX,
        e.clientY,
      );
    };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);
  const down = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const node =
      (e.target as Element)
        .closest("[data-person]")
        ?.getAttribute("data-person") ?? null;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY, node });
    if (pointers.current.size === 1) moved.current = false;
    else {
      moved.current = true;
      for (const pointer of pointers.current.values()) pointer.node = null;
    }
    (
      (e.target as Element).closest<SVGElement>("[data-person]") ??
      (e.target as SVGElement)
    ).setPointerCapture(e.pointerId);
  };
  const move = (e: ReactPointerEvent<SVGSVGElement>) => {
    const old = pointers.current.get(e.pointerId);
    if (!old) return;
    const next = { ...old, x: e.clientX, y: e.clientY };
    const delta = Math.hypot(next.x - old.x, next.y - old.y);
    if (delta < (moved.current ? 1 : 4)) return;
    moved.current = true;
    if (pointers.current.size === 2) {
      const other = [...pointers.current.entries()].find(
        ([id]) => id !== e.pointerId,
      )![1];
      const before = Math.hypot(old.x - other.x, old.y - other.y),
        after = Math.hypot(next.x - other.x, next.y - other.y);
      if (before > 5 && after > 5)
        zoomAt(before / after, (next.x + other.x) / 2, (next.y + other.y) / 2);
    } else if (old.node) {
      const node = simulation.nodes().find((n) => n.id === old.node);
      if (node) {
        const p = point(next.x, next.y);
        node.fx = node.x = p.x;
        node.fy = node.y = p.y;
        redraw((n) => n + 1);
        if (!paused && !reduced.current) simulation.alpha(0.35).restart();
      }
    } else {
      const a = point(old.x, old.y),
        b = point(next.x, next.y);
      setView((v) => ({ ...v, x: v.x - (b.x - a.x), y: v.y - (b.y - a.y) }));
    }
    pointers.current.set(e.pointerId, next);
  };
  const up = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const reset = () => {
    for (const n of simulation.nodes()) {
      n.fx = null;
      n.fy = null;
    }
    simulation.alpha(1);
    if (paused || reduced.current) {
      simulation.tick(240);
      redraw((n) => n + 1);
      fit();
    } else simulation.restart();
  };
  return {
    unitsPerPixel: view.size / pixels,
    svg,
    positions,
    revision,
    view,
    fit,
    reset,
    zoom: (factor: number) => zoomAt(factor),
    moved,
    handlers: {
      onPointerDown: down,
      onPointerMove: move,
      onPointerUp: up,
      onPointerCancel: up,
      onLostPointerCapture: up,
    },
  };
}
