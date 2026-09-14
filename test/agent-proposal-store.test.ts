/**
 * 方案存储：一次讨论只留一份 open 方案（重提是同一份的下一版），采纳记录不可叠加。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProposalStore } from "../src/agent/proposal-store.js";
import type { ProposalDraft } from "../src/agent/proposal-types.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function store(): { store: ProposalStore; root: string } {
  const root = mkdtempSync(join(tmpdir(), "nf-proposal-"));
  roots.push(root);
  return { store: new ProposalStore(root), root };
}

function draft(summary: string): ProposalDraft {
  return { summary, impact: [], items: [{ tool: "define_plotline", input: { label: summary }, note: summary }] };
}

const AT = "2026-09-14T00:00:00.000Z";

describe("ProposalStore", () => {
  it("首份方案是 p1 第 1 版，状态 open", () => {
    const { store: s } = store();
    const p = s.put(draft("甲"), "preparation", AT);
    expect(p).toMatchObject({ id: "p1", version: 1, status: "open", scope: "preparation" });
    expect(s.list()).toHaveLength(1);
  });

  it("已有 open 方案时再 put 是同一份的下一版，不新建", () => {
    const { store: s } = store();
    s.put(draft("甲"), "revision", AT);
    const second = s.put(draft("乙"), "revision", AT);
    expect(second).toMatchObject({ id: "p1", version: 2, summary: "乙" });
    expect(s.list()).toHaveLength(1);
    expect(s.openProposal()?.summary).toBe("乙");
  });

  it("采纳之后再 put 才新建 p2", () => {
    const { store: s } = store();
    s.put(draft("甲"), "revision", AT);
    s.markApplied("p1", { status: "adopted", effects: [], at: AT });
    const next = s.put(draft("乙"), "revision", AT);
    expect(next).toMatchObject({ id: "p2", version: 1 });
    expect(s.list().map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(s.openProposal()?.id).toBe("p2");
  });

  it("markApplied 落状态、时间与 effects；失败项一并记下", () => {
    const { store: s } = store();
    s.put(draft("甲"), "revision", AT);
    const saved = s.markApplied("p1", {
      status: "partially_applied",
      effects: [{ kind: "plotline_defined", id: "P02", label: "甲", created: true }],
      at: AT,
      failure: { index: 1, tool: "plan_chapter", message: "节拍未通过校验" },
    });
    expect(saved).toMatchObject({
      status: "partially_applied",
      appliedAt: AT,
      failure: { index: 1, tool: "plan_chapter" },
    });
    expect(saved?.appliedEffects).toHaveLength(1);
  });

  it("重复 markApplied 回 undefined —— 采纳是一次性的，不叠加", () => {
    const { store: s } = store();
    s.put(draft("甲"), "revision", AT);
    expect(s.markApplied("p1", { status: "adopted", effects: [], at: AT })).toBeDefined();
    expect(s.markApplied("p1", { status: "adopted", effects: [], at: AT })).toBeUndefined();
    expect(s.markApplied("p9", { status: "adopted", effects: [], at: AT })).toBeUndefined();
  });

  it("文件缺失或损坏时当空态，不抛", () => {
    const { store: s, root } = store();
    expect(s.list()).toEqual([]);
    writeFileSync(join(root, "proposals.json"), "{ not json", "utf8");
    expect(s.list()).toEqual([]);
    expect(s.openProposal()).toBeUndefined();
  });
});
