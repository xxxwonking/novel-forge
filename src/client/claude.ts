/**
 * Claude 客户端封装（§8.2、附录 API 坑）。
 *
 * 只处理三件事（§8.3 抽象做薄）：调用模型 / 执行工具 / 记账。
 * **不做 provider 抽象** —— 只接 Claude，直接用官方 SDK 的类型。
 *
 * 这里集中处理五个坑：
 *   ① 拒绝不是报错 —— HTTP 200 + stop_reason: "refusal"，读 content 前先查
 *   ② effort 在 output_config 里，不在 top-level
 *   ③ Opus 5 用 thinking: { type: "adaptive" }，budget_tokens 会 400
 *   ④ 大 max_tokens 必须 streaming，否则 HTTP 超时
 *   ⑤ 错误 catch 从具体到宽泛：NotFound → RateLimit → APIStatus → APIConnection
 */

import Anthropic, {
  APIConnectionError,
  APIError,
  NotFoundError,
  RateLimitError,
} from "@anthropic-ai/sdk";

/** §8.2 固定分工表里用到的两个模型。用户不选、不知道。 */
export const MODELS = {
  /** 创作型：P1/V1/C3/C4/C5。 */
  creative: "claude-opus-5",
  /** 判定型：C2/C6/异步诊断。输入密集输出短。 */
  judge: "claude-haiku-4-5",
} as const;

export type ModelRole = keyof typeof MODELS;

/** §9.4 effort 调档。默认 high。 */
export type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface ClientOptions {
  readonly apiKey: string;
  readonly baseURL?: string;
  /**
   * 该端点是否为 Anthropic 官方直连。
   * false 时 usage 里的缓存字段不可信（§8.2），命中率不能作为验收依据。
   */
  readonly official: boolean;
}

export interface CallOptions {
  readonly role: ModelRole;
  readonly maxTokens: number;
  readonly effort?: Effort;
  /** 仅 creative 角色支持。Opus 5 用 adaptive，不给 budget_tokens。 */
  readonly thinking?: boolean;
  readonly tools?: readonly Anthropic.Tool[];
  readonly system?: readonly Anthropic.TextBlockParam[];
  readonly messages: readonly Anthropic.MessageParam[];
  /** 结构化输出 schema。C5 用它约束声明格式。 */
  readonly outputSchema?: Record<string, unknown>;
}

/** 调用结果。refusal 是一等状态而非异常 —— 它会带着可展示的文案回来。 */
export type CallResult =
  | { readonly kind: "ok"; readonly message: Anthropic.Message }
  | {
      readonly kind: "refusal";
      readonly message: Anthropic.Message;
      readonly category: string | null;
      readonly explanation: string | null;
      /** 给用户看的文案。空白页面是最差的处理方式（§2）。 */
      readonly userMessage: string;
    }
  | { readonly kind: "max_tokens"; readonly message: Anthropic.Message }
  | { readonly kind: "error"; readonly error: ClientError };

export interface ClientError {
  readonly type: "not_found" | "rate_limit" | "status" | "connection" | "unknown";
  readonly status: number | null;
  readonly message: string;
  readonly retryable: boolean;
}

/** 超过这个值必须走 streaming（§9.5）。 */
const STREAMING_THRESHOLD = 8192;

export class ClaudeClient {
  private readonly sdk: Anthropic;
  readonly official: boolean;

  constructor(opts: ClientOptions) {
    this.sdk = new Anthropic({
      apiKey: opts.apiKey,
      ...(opts.baseURL === undefined ? {} : { baseURL: opts.baseURL }),
    });
    this.official = opts.official;
  }

  /**
   * 从环境变量构造。`ANTHROPIC_BASE_URL` 非官方域名时 official 置 false，
   * 让 CacheRecord 带上不可信标记。
   */
  static fromEnv(env: Readonly<Record<string, string | undefined>> = process.env): ClaudeClient {
    const apiKey = env["ANTHROPIC_API_KEY"] ?? env["ANTHROPIC_AUTH_TOKEN"] ?? "";
    if (apiKey === "") {
      throw new Error("缺少 ANTHROPIC_API_KEY 或 ANTHROPIC_AUTH_TOKEN");
    }
    const baseURL = env["ANTHROPIC_BASE_URL"];
    return new ClaudeClient({
      apiKey,
      ...(baseURL === undefined ? {} : { baseURL }),
      official: isOfficialEndpoint(baseURL),
    });
  }

  async call(opts: CallOptions): Promise<CallResult> {
    const params = buildParams(opts);
    try {
      const message =
        opts.maxTokens > STREAMING_THRESHOLD
          ? await this.sdk.messages.stream(params).finalMessage()
          : await this.sdk.messages.create(params);
      return classify(message);
    } catch (err) {
      return { kind: "error", error: toClientError(err) };
    }
  }
}

/** 官方端点白名单。其余一律视为中转。 */
export function isOfficialEndpoint(baseURL: string | undefined): boolean {
  if (baseURL === undefined || baseURL === "") return true;
  try {
    const host = new URL(baseURL).host;
    return host === "api.anthropic.com";
  } catch {
    return false;
  }
}

function buildParams(opts: CallOptions): Anthropic.MessageCreateParamsNonStreaming {
  const params: Record<string, unknown> = {
    model: MODELS[opts.role],
    max_tokens: opts.maxTokens,
    messages: opts.messages as Anthropic.MessageParam[],
  };
  if (opts.system !== undefined) params["system"] = opts.system;
  if (opts.tools !== undefined) params["tools"] = opts.tools;

  // effort 在 output_config 里，不是 top-level（附录）。
  const outputConfig: Record<string, unknown> = {};
  if (opts.effort !== undefined) outputConfig["effort"] = opts.effort;
  if (opts.outputSchema !== undefined) {
    outputConfig["format"] = { type: "json_schema", schema: opts.outputSchema };
  }
  if (Object.keys(outputConfig).length > 0) params["output_config"] = outputConfig;

  // Opus 5 用 adaptive，给 budget_tokens 会 400（附录）。
  if (opts.thinking === true) params["thinking"] = { type: "adaptive" };

  return params as unknown as Anthropic.MessageCreateParamsNonStreaming;
}

/**
 * 分类响应。**先查 stop_reason，再读 content** —— 拒绝是 HTTP 200，
 * 直接读 content 会给用户一片空白（§2）。
 */
function classify(message: Anthropic.Message): CallResult {
  const stopReason: string | null = message.stop_reason;

  if (stopReason === "refusal") {
    // stop_details 只在 refusal 时非空，其他情况为 null，读前要 guard。
    const details = (message as { stop_details?: { category?: string; explanation?: string } | null })
      .stop_details;
    const category = details?.category ?? null;
    const explanation = details?.explanation ?? null;
    return {
      kind: "refusal",
      message,
      category,
      explanation,
      userMessage: refusalCopy(category),
    };
  }

  if (stopReason === "max_tokens") {
    return { kind: "max_tokens", message };
  }

  return { kind: "ok", message };
}

/** §2：给用户的文案远好于空白。按拒绝类别给出可操作的下一步。 */
function refusalCopy(category: string | null): string {
  switch (category) {
    case "violence":
      return "这段涉及的暴力描写超出了模型的生成范围。试试把冲突写得更间接——用后果和反应代替过程细节。";
    case "sexual":
      return "这段的亲密描写模型无法生成。可以改为场景转换或留白处理。";
    case "self_harm":
      return "这段内容模型无法生成。若情节需要，可以改为侧写他人的反应而不直接描述行为。";
    default:
      return "这段内容模型无法生成。换一种表述方式再试，或调整这一场的写法。";
  }
}

/**
 * §附录：按 NotFound → RateLimit → APIError → APIConnection 从具体到宽泛。
 *
 * 顺序不能颠倒 —— NotFoundError 和 RateLimitError 都是 APIError 的子类，
 * 先判 APIError 会把它们全吞掉，重试策略就退化成一刀切。
 * APIConnectionError 必须放在 APIError 之前判：它不是 APIError 的子类，
 * 但放后面会让"无 status 的网络错误"落到 unknown 分支而丢掉 retryable。
 */
export function toClientError(err: unknown): ClientError {
  if (err instanceof NotFoundError) {
    return { type: "not_found", status: err.status ?? 404, message: err.message, retryable: false };
  }
  if (err instanceof RateLimitError) {
    return { type: "rate_limit", status: err.status ?? 429, message: err.message, retryable: true };
  }
  if (err instanceof APIConnectionError) {
    return { type: "connection", status: null, message: err.message, retryable: true };
  }
  if (err instanceof APIError) {
    const status = err.status ?? 0;
    return { type: "status", status, message: err.message, retryable: status >= 500 };
  }
  return {
    type: "unknown",
    status: null,
    message: err instanceof Error ? err.message : String(err),
    retryable: false,
  };
}

/**
 * §附录：追加**整个 response.content**，不能只取 text。
 * 压缩块必须保留，API 靠它替换被压缩的历史；只取字符串会静默丢掉压缩状态。
 *
 * 同理，工具结果必须在**单条 user message 里返回全部 tool_result** ——
 * 分多条返回会静默训练模型不再并行调用工具。
 */
export function appendTurn(
  messages: readonly Anthropic.MessageParam[],
  response: Anthropic.Message,
  toolResults: readonly Anthropic.ToolResultBlockParam[],
): readonly Anthropic.MessageParam[] {
  const next: Anthropic.MessageParam[] = [
    ...messages,
    { role: "assistant", content: response.content },
  ];
  if (toolResults.length > 0) {
    next.push({ role: "user", content: [...toolResults] });
  }
  return next;
}
