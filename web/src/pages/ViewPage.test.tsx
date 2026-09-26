import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Views } from "../api.js";
import { ViewPage } from "./ViewPage.js";

const fixture = vi.hoisted(() => ({ views: null as Views | null }));
vi.mock("../hooks.js", async (importOriginal) => ({
  ...await importOriginal<typeof import("../hooks.js")>(),
  useFetch: () => ({ data: fixture.views, error: null, loading: false, reload: () => {} }),
}));

describe("情节线表格的断线状态", () => {
  it("从未推进的轨道显示未开始，已推进的轨道显示实际间隔", () => {
    fixture.views = {
      axis: { from: 1, to: 100, current: 100 },
      foreshadows: [], arcs: [], relations: { nodes: [], edges: [] },
      plotTracks: [
        { id: "P01", label: "旧案", weight: "main", gapLimit: 3, lastAdvancedAt: 0, currentGap: 100, gapSpan: null, nodes: [] },
        { id: "P02", label: "追踪", weight: "sub", gapLimit: 12, lastAdvancedAt: 96, currentGap: 4, gapSpan: { from: 96, to: 100 },
          nodes: [{ summary: "找到线索", weight: 1, kind: "info", planned: false,
            point: { chapter: 96, anchor: { chapter: 96, quote: "线索", offsetHint: 0, occurrence: 0 }, resolution: { status: "exact", offset: 0, length: 2 } } }] },
      ],
    } as Views;
    const html = renderToStaticMarkup(createElement(ViewPage, {
      kind: "/plotlines", title: "情节线", onJump: () => {}, highlight: null, refresh: () => {},
    }));
    const rows = [...html.matchAll(/<tr>(.*?)<\/tr>/gs)].map(match => match[1]!);
    const unstarted = rows.find(row => row.includes("尚未推进"));
    const started = rows.find(row => row.includes("找到线索"));

    expect(unstarted).toMatch(/<td class="num">—<\/td><td class="num">—<\/td>/);
    expect(unstarted).not.toContain("var(--alarm)");
    expect(started).toMatch(/<td class="num">96<\/td><td class="num">4<\/td>/);
  });
});
