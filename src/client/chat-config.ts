/** Chat 能力显式配置；预设不选择地址、凭证或模型，也不探测供应商。 */
const PRESETS = ["generic", "deepseek"] as const;
const JSON_MODES = ["json_schema", "json_object", "prompt"] as const;
const THINKING_MODES = ["default", "enabled", "disabled"] as const;
const EFFORTS = ["default", "low", "high", "max"] as const;
const STREAM_MODES = ["auto", "always", "never"] as const;
const MAX_TIMEOUT_MS = 2_147_483_647;

export interface ChatCapabilities {
  readonly jsonMode: typeof JSON_MODES[number];
  /** enabled/disabled 使用 DeepSeek 的 thinking.type 扩展。default 不发送该字段。 */
  readonly thinking: typeof THINKING_MODES[number];
  readonly reasoningEffort: typeof EFFORTS[number];
  readonly stream: typeof STREAM_MODES[number];
  readonly includeUsage: boolean;
  readonly maxOutputTokens?: number;
  readonly timeoutMs: number;
}

export interface ChatConnectionOptions extends Partial<ChatCapabilities> {
  readonly baseURL: string;
  readonly apiKey: string;
  readonly model: string;
  readonly preset?: typeof PRESETS[number];
}

function choice<T extends string>(name: string, value: string | undefined, values: readonly T[], fallback: T): T {
  if (value === undefined) return fallback;
  if (!(values as readonly string[]).includes(value)) throw new Error(`${name} 可用值为 ${values.join(" / ")}`);
  return value as T;
}

function positiveInteger(name: string, value: number, max = Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > max) throw new Error(`${name} 必须是 1–${max} 范围内的整数`);
  return value;
}

export function resolveChatCapabilities(options: Partial<ChatConnectionOptions>): ChatCapabilities {
  const preset = choice("CHAT_PRESET", options.preset, PRESETS, "generic");
  const thinking = choice("CHAT_THINKING", options.thinking, THINKING_MODES, preset === "deepseek" ? "disabled" : "default");
  const reasoningEffort = choice("CHAT_REASONING_EFFORT", options.reasoningEffort, EFFORTS, "default");
  if (reasoningEffort !== "default" && thinking !== "enabled") throw new Error("设置 CHAT_REASONING_EFFORT 需要 CHAT_THINKING=enabled");
  if (options.includeUsage !== undefined && typeof options.includeUsage !== "boolean") throw new Error("CHAT_STREAM_INCLUDE_USAGE 必须是 true 或 false");
  return {
    jsonMode: choice("CHAT_JSON_MODE", options.jsonMode, JSON_MODES, preset === "deepseek" ? "json_object" : "json_schema"),
    thinking,
    reasoningEffort,
    stream: choice("CHAT_STREAM", options.stream, STREAM_MODES, "auto"),
    includeUsage: options.includeUsage ?? true,
    timeoutMs: positiveInteger("CHAT_TIMEOUT_MS", options.timeoutMs ?? 300_000, MAX_TIMEOUT_MS),
    ...(options.maxOutputTokens === undefined ? {} : { maxOutputTokens: positiveInteger("CHAT_MAX_OUTPUT_TOKENS", options.maxOutputTokens) }),
  };
}

/** 服务工厂和真实写章工装共用，避免测试入口忽略兼容参数。空的可选项视为未设置。 */
export function chatOptionsFromEnv(env: Readonly<Record<string, string | undefined>> = process.env): ChatConnectionOptions {
  const optional = (name: string) => env[name]?.trim() || undefined;
  const required = (name: string) => {
    const value = optional(name);
    if (value === undefined) throw new Error(`缺少 ${name}`);
    return value;
  };
  const integer = (name: string, fallback: number | undefined, max = Number.MAX_SAFE_INTEGER) => {
    const value = optional(name);
    if (value === undefined) return fallback;
    if (!/^\d+$/u.test(value)) throw new Error(`${name} 必须是正整数`);
    return positiveInteger(name, Number(value), max);
  };
  const preset = choice("CHAT_PRESET", optional("CHAT_PRESET"), PRESETS, "generic");
  const defaults = resolveChatCapabilities({ preset });
  const maxOutputTokens = integer("CHAT_MAX_OUTPUT_TOKENS", undefined);
  return {
    baseURL: required("CHAT_BASE_URL"), apiKey: required("CHAT_API_KEY"), model: required("CHAT_MODEL"), preset,
    jsonMode: choice("CHAT_JSON_MODE", optional("CHAT_JSON_MODE"), JSON_MODES, defaults.jsonMode),
    thinking: choice("CHAT_THINKING", optional("CHAT_THINKING"), THINKING_MODES, defaults.thinking),
    reasoningEffort: choice("CHAT_REASONING_EFFORT", optional("CHAT_REASONING_EFFORT"), EFFORTS, defaults.reasoningEffort),
    stream: choice("CHAT_STREAM", optional("CHAT_STREAM"), STREAM_MODES, defaults.stream),
    includeUsage: choice("CHAT_STREAM_INCLUDE_USAGE", optional("CHAT_STREAM_INCLUDE_USAGE"), ["true", "false"], "true") === "true",
    timeoutMs: integer("CHAT_TIMEOUT_MS", defaults.timeoutMs, MAX_TIMEOUT_MS)!,
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  };
}
