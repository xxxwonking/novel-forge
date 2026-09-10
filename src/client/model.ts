import type { CallOptions, CallResult } from "./claude.js";

/** 章节服务依赖的最小能力；内部快照格式继续兼容已有草稿。 */
export interface ModelClient {
  readonly official: boolean;
  call(options: CallOptions): Promise<CallResult>;
}
