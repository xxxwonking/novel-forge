/**
 * `pricing.yaml` 的加载与折算。
 *
 * 与 `rules/load.ts` 同一套做法：启动即校验、加载后冻结缓存。缺字段就抛 ——
 * 价格读成 undefined 会让折算安静地得出 NaN，而 NaN 会通过所有比较，结果是
 * 余额变成 NaN 而没有任何报错。
 *
 * **四档分开计价**是这份表存在的理由：缓存读约为原样输入的十分之一、缓存写
 * 约为 1.25 倍，把它们并成一个 input 数就折不出真实成本。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

export interface ModelPrice {
  /** 美元 / 每百万 token。 */
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number;
  readonly cacheRead: number;
}

export interface Pricing {
  readonly version: string;
  readonly creditsPerUsd: number;
  readonly signupGrant: number;
  readonly models: Readonly<Record<string, ModelPrice>>;
}

/** 端点没报的档记 null —— 那是「不知道」，不是 0。 */
export interface EntryTokens {
  readonly input: number;
  readonly output: number;
  readonly cacheWrite: number | null;
  readonly cacheRead: number | null;
}

const PER = 1_000_000;
const BUCKETS = ["input", "output", "cacheWrite", "cacheRead"] as const;
let cached: Pricing | undefined;

export function loadPricing(file = fileURLToPath(new URL("../../pricing.yaml", import.meta.url))): Pricing {
  if (cached !== undefined) return cached;
  const raw = parse(readFileSync(file, "utf8")) as Record<string, unknown> | null;
  if (raw === null || typeof raw !== "object") throw new Error(`${file}：内容不是对象`);
  const number = (key: string): number => {
    const value = raw[key];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new Error(`${file}：${key} 必须是非负数`);
    return value;
  };
  const version = raw["version"];
  if (typeof version !== "string" || version === "") throw new Error(`${file}：version 必须是非空字符串`);
  const rawModels = raw["models"];
  if (rawModels === null || typeof rawModels !== "object" || Array.isArray(rawModels)) throw new Error(`${file}：models 必须是对象`);
  const models: Record<string, ModelPrice> = {};
  for (const [name, value] of Object.entries(rawModels as Record<string, unknown>)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${file}：models.${name} 必须是对象`);
    const price = value as Record<string, unknown>;
    for (const bucket of BUCKETS) {
      const rate = price[bucket];
      if (typeof rate !== "number" || !Number.isFinite(rate) || rate < 0) throw new Error(`${file}：models.${name}.${bucket} 必须是非负数`);
    }
    models[name] = Object.freeze({ input: price["input"] as number, output: price["output"] as number, cacheWrite: price["cacheWrite"] as number, cacheRead: price["cacheRead"] as number });
  }
  cached = Object.freeze({ version, creditsPerUsd: number("creditsPerUsd"), signupGrant: number("signupGrant"), models: Object.freeze(models) });
  return cached;
}

/** 价格表里没有这个模型时返回 null —— 照记用量、不折积分，比拍一个价格诚实。 */
export function creditsFor(price: ModelPrice | undefined, tokens: EntryTokens, pricing: Pricing): number | null {
  if (price === undefined) return null;
  const usd = (tokens.input * price.input + tokens.output * price.output
    + (tokens.cacheWrite ?? 0) * price.cacheWrite + (tokens.cacheRead ?? 0) * price.cacheRead) / PER;
  return usd * pricing.creditsPerUsd;
}
