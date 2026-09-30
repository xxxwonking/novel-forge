/**
 * 余额闸门。
 *
 * 口径（用户拍板）：**只看余额正负，允许小幅超支。** 调用前不预估这一次要花多少 ——
 * 预估就得回答「估少了怎么办、失败了退不退」，这两件事都没有让人满意的答案。
 * 所以规则只有一条：余额 > 0 就放行，≤ 0 就拦下。代价是最后一次放行的调用可能把
 * 余额扣成负数，超出的量以一次调用为上限 —— 下一次调用就会被拦。
 *
 * 拦下时返回 `kind: "error"` 而不是抛出：所有调用点对上游报错都已有成熟的处理 ——
 * 写章保留已有正文、可从未完成的一步恢复；对话照常回一句说明；审查降级为 info；
 * 连写停在这一章并说明原因。余额不足在这些调用点看来就是「这次调用没成」，
 * 不需要为它另开一条路径。
 *
 * 包在计量外面：被拦下的调用根本没发出，也就不进账。
 */

import type { ModelClient } from "../client/model.js";

/** 判据只有这一处；工作区汇总（界面上的「已用完」）与调用前的拦截共用它。 */
export const hasCredit = (balance: number): boolean => balance > 0;

export function gated(client: ModelClient, balance: () => number): ModelClient {
  return {
    ...client,
    call: async (options) => {
      const remaining = balance();
      if (hasCredit(remaining)) return client.call(options);
      return {
        kind: "error",
        error: {
          type: "status", status: 402, retryable: false,
          message: `积分余额不足（剩余 ${format(remaining)} 积分），这次模型调用没有发出，也没有扣费。已有正文、草稿与资料都不受影响；补充额度后可以重试这一步。`,
        },
      };
    },
  };
}

/** NaN 也算余额不足（上面 `> 0` 对它为假），这里只负责把它说清楚。 */
function format(balance: number): string {
  return Number.isFinite(balance) ? balance.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : "未知";
}
