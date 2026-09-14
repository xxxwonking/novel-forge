/**
 * 方案的持久化。
 *
 * 与 `conversation-store` 同一套做法：整份重写、体量小、与对话同域，落在作品目录内的
 * `proposals.json`，**不进事件流** —— 讨论出的方案不等于作品里发生的事。
 *
 * 同一时刻只有一份 open 方案：作者说「这条去掉」，Agent 重提的是同一 id 的下一版，
 * 而不是另起一份。一次讨论只留一份最新方案，作者不用在几份相似方案里挑。
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IsoTimestamp } from "../types/primitives.js";
import type { AgentEffect } from "./types.js";
import type { Proposal, ProposalDraft, ProposalFailure, ProposalScope, ProposalStatus } from "./proposal-types.js";

const FILE = "proposals.json";

interface Persisted {
  readonly proposals: readonly Proposal[];
}

export interface ApplyRecord {
  readonly status: Exclude<ProposalStatus, "open">;
  readonly effects: readonly AgentEffect[];
  readonly at: IsoTimestamp;
  readonly failure?: ProposalFailure;
}

export class ProposalStore {
  constructor(private readonly root: string) {}

  private path(): string {
    return join(this.root, FILE);
  }

  list(): readonly Proposal[] {
    const p = this.path();
    if (!existsSync(p)) return [];
    try {
      const raw = JSON.parse(readFileSync(p, "utf8")) as Partial<Persisted>;
      return Array.isArray(raw.proposals) ? raw.proposals : [];
    } catch {
      return [];
    }
  }

  get(id: string): Proposal | undefined {
    return this.list().find((p) => p.id === id);
  }

  /** 仍待作者拍板的那一份。propose_plan 会就地替换它。 */
  openProposal(): Proposal | undefined {
    return this.list().findLast((p) => p.status === "open");
  }

  private save(proposals: readonly Proposal[]): void {
    mkdirSync(this.root, { recursive: true });
    writeFileSync(this.path(), `${JSON.stringify({ proposals }, null, 2)}\n`, "utf8");
  }

  /** 存一份新方案；已有 open 方案时替换它并把版本 +1。 */
  put(draft: ProposalDraft, scope: ProposalScope, at: IsoTimestamp): Proposal {
    const all = this.list();
    const open = all.findLast((p) => p.status === "open");
    const proposal: Proposal = {
      id: open?.id ?? `p${all.reduce((m, p) => Math.max(m, sequence(p.id)), 0) + 1}`,
      version: (open?.version ?? 0) + 1,
      scope,
      summary: draft.summary,
      impact: draft.impact,
      items: draft.items,
      status: "open",
      at,
    };
    this.save(open === undefined ? [...all, proposal] : all.map((p) => (p.id === open.id ? proposal : p)));
    return proposal;
  }

  /** 记下采纳结果。方案不存在或已处理过时返回 undefined（幂等：重复采纳不叠加）。 */
  markApplied(id: string, record: ApplyRecord): Proposal | undefined {
    const all = this.list();
    const target = all.find((p) => p.id === id);
    if (target === undefined || target.status !== "open") return undefined;
    const updated: Proposal = {
      ...target,
      status: record.status,
      appliedAt: record.at,
      appliedEffects: record.effects,
      ...(record.failure === undefined ? {} : { failure: record.failure }),
    };
    this.save(all.map((p) => (p.id === id ? updated : p)));
    return updated;
  }
}

function sequence(id: string): number {
  return Number(/^p(\d+)$/u.exec(id)?.[1] ?? 0);
}
