/**
 * 把计量挂到客户端层。
 *
 * 为什么不放在写章服务里（它原本就有一份 `TaskUsage`）：那里只看得见写章。
 * 对话、逐章反推、跨章返修定位同样在花钱，留在那一层它们就是黑账，而余额一旦
 * 少算过一次就永远对不回来。`ModelClient` 是所有调用的唯一必经处，包在这里，
 * **以后新增任何调用点都自动进账**。
 *
 * 与 `TaskUsage` 的重复是有意的：那份是任务进度（含未返回用量的在途调用，随草稿
 * 一起恢复），这份是账（append-only、可重建、按用途分组）。两者答的不是一个问题。
 */

import type { ModelClient } from "../client/model.js";
import type { CreditEntry } from "./ledger.js";
import { creditsFor, loadPricing, type EntryTokens, type Pricing } from "./pricing.js";

interface RawUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
}

export function metered(
  client: ModelClient,
  record: (entry: CreditEntry) => void,
  pricing: Pricing = loadPricing(),
  now: () => string = () => new Date().toISOString(),
): ModelClient {
  return {
    ...client,
    call: async (options) => {
      const result = await client.call(options);
      // 抛出与 kind:"error" 都不记账：没拿到用量就不知道花了多少，
      // 「发生过一次没量到的调用」由 TaskUsage.unmeasuredCalls 记着。
      if (result.kind === "error") return result;
      const message = result.message as unknown as { model?: string; usage?: RawUsage };
      const tokens = tokensOf(message.usage);
      const model = message.model ?? "";
      const credits = creditsFor(pricing.models[model], tokens, pricing);
      record({
        at: now(), model, role: options.role, purpose: options.purpose ?? "other",
        tokens, credits: credits ?? 0, priced: credits !== null,
      });
      return result;
    },
  };
}

/** 缺失的档记 null（端点没报），而不是 0（报了但为零）—— 两者在账上不是一回事。 */
function tokensOf(usage: RawUsage | undefined): EntryTokens {
  const count = (value: number | null | undefined): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
  return {
    input: count(usage?.input_tokens) ?? 0,
    output: count(usage?.output_tokens) ?? 0,
    cacheWrite: count(usage?.cache_creation_input_tokens),
    cacheRead: count(usage?.cache_read_input_tokens),
  };
}
