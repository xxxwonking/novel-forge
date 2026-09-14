import type { CallOptions, CallResult } from "./claude.js";

/** 章节服务依赖的最小能力；内部快照格式继续兼容已有草稿。 */
export interface ModelClient {
  readonly official: boolean;
  /** 需要完整历史回放的客户端提供目标摘要；不包含密钥或明文端点。 */
  readonly conversationKey?: string;
  call(options: CallOptions): Promise<CallResult>;
}
