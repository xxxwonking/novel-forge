/**
 * 两条反推路线的费用预估。
 *
 * 为什么要有它：同一件事（把空白的结构补出来）有两条路 —— 读一遍资料，或者逐章读
 * 正文。后者的调用次数等于章数，一百章就是一百次。两者的费用可以差两个量级，而作者
 * 在点下去之前看不到任何数字，只能凭"听起来更仔细"选贵的那条。
 *
 * 四条纪律，都是为了让这个数字可以被当真：
 *
 *   ① **有实测就用实测。** 账本里记着每次调用真实的 token 与积分。同一用途攒够样本
 *      之后，预估 = 实测均价 × 次数，那是测量，不是猜。没有样本才退回上限推算，
 *      并在结果里说明是哪一种 —— 把推算说成"约"，作者第二次就不会再信这个数。
 *
 *   ② **没有实测时只能"估"，不能"最多"。** 输出 token 事前只有声明的 `maxTokens`
 *      可用，而那**不是上限**：真机实测 gemini-3-flash 把思考 token 计进 output 计费，
 *      22/28 次调用超过声明的 4000，最大 8476（2.1 倍）。所以按声明上限推算出来的数
 *      既可能偏高（实际输出短）也可能偏低（供应商另计思考），**方向都不保证**。
 *      `basis` 必须露给界面，且界面不得把它说成"最多"（§58 真机实测低报 1.8 倍）。
 *
 *   ③ **两档要么都按实测、要么都按声明推算。** 两种基准的偏差方向和量级都不同，
 *      一档实测、另一档推算时，差出来的倍数是基准差异而不是真实差异。
 *      这个功能的全部用途就是让两个数可比，混用基准比两边都偏一个方向有害得多。
 *
 *   ④ **次数不确定就给区间。** 逐章反推是一章一次，数得出来；资料反推走智能体循环，
 *      轮数取决于模型自己停在哪一轮，只有下界（读一次、提一次）和上界（轮数上限）是
 *      确定的。把区间压成一个数，无论取哪一端都是在替作者猜。
 *
 *   ⑤ **价格表里没有的模型报 null，不报 0。** 与 `creditsFor` 同一条约定：0 是
 *      "不花钱"，null 是"不知道"。把"不知道"显示成 0 会让作者以为这条路免费。
 */

import type { CreditEntry } from "./ledger.js";
import { creditsFor, type Pricing } from "./pricing.js";

export type InferenceMode = "materials" | "chapters";

/** 攒够多少条同用途记录才敢按实测算。低于这个数，一次异常调用就能把均值带跑。 */
const MIN_SAMPLES = 3;

export interface Range {
  readonly min: number;
  readonly max: number;
}

/**
 * 一条路线的可数事实。由调用方按真实配置与真实文本算出来，这里只做算术。
 *
 * `inputTokens` 要按 `calls.min` 与 `calls.max` 各算一遍，而不是给一个"单次输入"
 * 让这里乘次数：智能体循环每轮重放同一份提示词，还要叠上前几轮的工具结果，
 * 输入随轮数的增长不是线性的。知道这件事的是调用方，不是这里。
 */
export interface ModeFacts {
  readonly key: InferenceMode;
  /**
   * 会发生多少次模型调用，**必须含重试**。
   *
   * 真机踩过：逐章反推按"一章一次"报数，而引文闸门挡掉 35% 的章、每章都要再跑一次，
   * 实际是 1.4 次/章 —— 光这一项就让预估低报四成。次数由调用方按历史实测比例算，
   * 不在这里拍。
   */
  readonly calls: Range;
  /** 按真实配置解析出的模型名。账本里有实测时以账本为准 —— 中转会换模型。 */
  readonly model: string;
  /** 账本里的用途标签，用来找同类实测记录。 */
  readonly purpose: string;
  readonly inputTokens: Range;
  /** 单次调用的输出上限。 */
  readonly maxOutputTokens: number;
}

export interface InferenceEstimate {
  readonly key: InferenceMode;
  readonly calls: Range;
  /** 报价用的模型名。空串表示配置读不出来（也就折不出积分）。 */
  readonly model: string;
  /** 预估积分区间。null = 价格表里没有这个模型，调用照记用量但折不出积分。 */
  readonly credits: Range | null;
  /**
   * measured：按本作品同类调用的实测均价，**含重试**（见 `calls`）。
   * estimated：按声明的 token 上限推算，**偏差方向不保证** —— 界面必须说"估"不说"最多"。
   */
  readonly basis: "measured" | "estimated";
  /** measured 时用了多少条实测记录；estimated 时为 0。 */
  readonly samples: number;
}

export function estimateModes(
  facts: readonly ModeFacts[],
  ledger: readonly CreditEntry[],
  pricing: Pricing,
): readonly InferenceEstimate[] {
  // 只认计过价的记录：未计价那些 credits 记 0，混进来会把均价拉低。
  const samplesOf = (purpose: string) => ledger.filter((e) => e.purpose === purpose && e.priced);
  // 纪律 ③：任一档缺样本，全都退回按声明推算。
  const measurable = facts.every((mode) => samplesOf(mode.purpose).length >= MIN_SAMPLES);

  return facts.map((mode) => {
    const base = { key: mode.key, calls: mode.calls };
    const samples = samplesOf(mode.purpose);
    if (measurable) {
      const perCall = samples.reduce((sum, e) => sum + e.credits, 0) / samples.length;
      return {
        ...base,
        // 模型名取最近一条实测：那是上游真正回答的模型，比我们请求的那个可信。
        model: samples[samples.length - 1]!.model,
        credits: { min: perCall * mode.calls.min, max: perCall * mode.calls.max },
        basis: "measured", samples: samples.length,
      };
    }
    const price = pricing.models[mode.model];
    const declared = (input: number, calls: number): number | null =>
      creditsFor(price, { input, output: mode.maxOutputTokens * calls, cacheWrite: null, cacheRead: null }, pricing);
    const min = declared(mode.inputTokens.min, mode.calls.min);
    const max = declared(mode.inputTokens.max, mode.calls.max);
    return {
      ...base, model: mode.model,
      credits: min === null || max === null ? null : { min, max },
      basis: "estimated", samples: 0,
    };
  });
}
