/**
 * 积分账本。
 *
 * 形态照搬 `events.jsonl`：**append-only 的一行一条**，汇总随时可以从它重建。
 * 理由一样 —— 账目一旦能被原地改写，它就不再是账。
 *
 * 放在作品目录下而不是工作区根：作品是这个产品里唯一的存储单元（备份、归档、
 * 迁移都按它整体搬），账目跟着作品走，备份出去的作品自带它自己的消耗记录。
 * 余额是全局的，由工作区把各作品的消耗汇总起来减出来 —— 见 `Workspace.credits()`。
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { EntryTokens } from "./pricing.js";

const FILE = "credits.jsonl";

export interface CreditEntry {
  readonly at: string;
  /** 上游报回来的模型名，不是我们请求的那个 —— 中转会换。 */
  readonly model: string;
  readonly role: string;
  /** 调用点：chapter / conversation / inference / revision …。记账用，不发给模型。 */
  readonly purpose: string;
  readonly tokens: EntryTokens;
  readonly credits: number;
  /** 价格表里有没有这个模型。false 时 credits 为 0，消耗仍照记。 */
  readonly priced: boolean;
}

export interface CreditSummary {
  readonly calls: number;
  readonly credits: number;
  readonly unpricedCalls: number;
  readonly tokens: { readonly input: number; readonly output: number; readonly cacheWrite: number; readonly cacheRead: number };
  readonly byPurpose: Readonly<Record<string, { readonly calls: number; readonly credits: number }>>;
}

/** 直接追加，不走文件事务：账目落盘失败不该把一次已经花掉的调用回滚成没发生。 */
export function appendCreditEntry(root: string, entry: CreditEntry): void {
  const file = join(root, FILE);
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(entry)}\n`, "utf8");
}

/** 坏行跳过而不是抛：一条写坏的账不该让整个用量页起不来。 */
export function readCreditEntries(root: string): readonly CreditEntry[] {
  const file = join(root, FILE);
  if (!existsSync(file)) return [];
  const entries: CreditEntry[] = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    try {
      const entry = JSON.parse(line) as CreditEntry;
      if (typeof entry.at !== "string" || typeof entry.credits !== "number" || typeof entry.purpose !== "string") continue;
      // 未计价的调用不折积分 —— 这条不变量在读入时也守住，手改过的账目不能让余额多扣。
      entries.push(entry.priced ? entry : { ...entry, credits: 0 });
    } catch { continue; }
  }
  return entries;
}

export function summarize(entries: readonly CreditEntry[]): CreditSummary {
  const tokens = { input: 0, output: 0, cacheWrite: 0, cacheRead: 0 };
  const byPurpose: Record<string, { calls: number; credits: number }> = {};
  let credits = 0;
  let unpricedCalls = 0;
  for (const entry of entries) {
    credits += entry.credits;
    if (!entry.priced) unpricedCalls++;
    tokens.input += entry.tokens.input;
    tokens.output += entry.tokens.output;
    tokens.cacheWrite += entry.tokens.cacheWrite ?? 0;
    tokens.cacheRead += entry.tokens.cacheRead ?? 0;
    const slot = byPurpose[entry.purpose] ?? { calls: 0, credits: 0 };
    byPurpose[entry.purpose] = { calls: slot.calls + 1, credits: slot.credits + entry.credits };
  }
  return { calls: entries.length, credits, unpricedCalls, tokens, byPurpose };
}
