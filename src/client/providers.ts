/** 工作区级模型配置；密钥只在服务端，文件位于作品目录之外。 */
import { randomUUID } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  renameSync,
  rmSync,
  existsSync,
  lstatSync,
} from "node:fs";
import { join } from "node:path";
import { readProjectFile } from "../store/transaction.js";
import { createModelClient, resolveModelName } from "./create.js";
import { ChatClient } from "./chat.js";
import { ClaudeClient, type ModelRole } from "./claude.js";
import { GeminiClient } from "./gemini.js";
import {
  chatOptionsFromEnv,
  resolveChatCapabilities,
  type ChatCapabilities,
} from "./chat-config.js";
import { isRecord } from "./chat-wire.js";
import type { ModelClient } from "./model.js";
export type ProviderProtocol = "chat" | "claude" | "gemini";
interface Profile extends ChatCapabilities {
  id: string;
  name: string;
  protocol: ProviderProtocol;
  baseURL: string;
  apiKey: string;
  model: string;
  judgeModel?: string;
}
export type PublicProvider = Omit<Profile, "apiKey"> & { hasApiKey: boolean };
interface State {
  activeId: string;
  profiles: Profile[];
}
const FILE = ".model-providers.json";
export class ProviderStore {
  private cached: { key: string; client: ModelClient } | undefined;
  constructor(
    private readonly root: string,
    private readonly env: Readonly<
      Record<string, string | undefined>
    > = process.env,
  ) {}
  private load(): State {
    const text = readProjectFile(this.root, FILE);
    if (text === undefined) return { activeId: "environment", profiles: [] };
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw new Error("模型配置文件损坏，请核对本地配置");
    }
    if (
      !isRecord(raw) ||
      typeof raw.activeId !== "string" ||
      !Array.isArray(raw.profiles)
    )
      throw new Error("模型配置文件损坏，请核对本地配置");
    const profiles = raw.profiles.map((p) => this.parse(p));
    if (
      new Set(profiles.map((p) => p.id)).size !== profiles.length ||
      (raw.activeId !== "environment" &&
        !profiles.some((p) => p.id === raw.activeId))
    )
      throw new Error("默认供应商配置不存在或编号重复");
    return { activeId: raw.activeId, profiles };
  }
  private save(state: State) {
    mkdirSync(this.root, { recursive: true });
    const path = join(this.root, FILE);
    if (
      existsSync(path) &&
      (!lstatSync(path).isFile() || lstatSync(path).isSymbolicLink())
    )
      throw new Error("模型配置路径必须是普通文件");
    const temp = join(this.root, `.provider-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, JSON.stringify(state, null, 2), {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
        flush: true,
      });
      renameSync(temp, path);
    } finally {
      if (existsSync(temp)) rmSync(temp);
    }
    this.cached = undefined;
  }
  view() {
    const state = this.load();
    const provider = this.env.NOVEL_MODEL_PROVIDER ?? "claude";
    const base =
      provider === "chat"
        ? this.env.CHAT_BASE_URL
        : provider === "gemini"
          ? (this.env.GEMINI_BASE_URL ??
            "https://generativelanguage.googleapis.com/v1beta")
          : (this.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com");
    let baseURL = "";
    try {
      const u = new URL(base ?? "");
      baseURL = u.origin + u.pathname;
    } catch {}
    return {
      ...state,
      profiles: state.profiles.map((p) => this.public(p)),
      environment: {
        id: "environment",
        name: "环境变量配置",
        protocol: provider,
        baseURL,
        model: resolveModelName("creative", this.env),
        configured:
          provider === "chat"
            ? Boolean(
                this.env.CHAT_API_KEY &&
                this.env.CHAT_BASE_URL &&
                this.env.CHAT_MODEL,
              )
            : provider === "gemini"
              ? Boolean(this.env.GEMINI_API_KEY && this.env.GEMINI_MODEL)
              : provider === "claude" &&
                Boolean(
                  this.env.ANTHROPIC_API_KEY || this.env.ANTHROPIC_AUTH_TOKEN,
                ),
      },
    };
  }
  copyEnvironment(): PublicProvider {
    const protocol = this.env.NOVEL_MODEL_PROVIDER ?? "claude";
    if (protocol === "chat")
      return this.upsert({
        ...chatOptionsFromEnv(this.env),
        name: "环境配置副本",
        protocol,
      });
    if (protocol === "gemini")
      return this.upsert({
        name: "环境配置副本",
        protocol,
        baseURL:
          this.env.GEMINI_BASE_URL ??
          "https://generativelanguage.googleapis.com/v1beta",
        apiKey: this.env.GEMINI_API_KEY,
        model: this.env.GEMINI_MODEL,
      });
    if (protocol === "claude")
      return this.upsert({
        name: "环境配置副本",
        protocol,
        baseURL: this.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com",
        apiKey: this.env.ANTHROPIC_API_KEY ?? this.env.ANTHROPIC_AUTH_TOKEN,
        model: resolveModelName("creative", this.env),
        judgeModel: resolveModelName("judge", this.env),
      });
    throw new Error("环境变量指定了未知供应商协议");
  }
  private public({ apiKey, ...profile }: Profile): PublicProvider {
    return { ...profile, hasApiKey: apiKey.length > 0 };
  }
  private parse(raw: unknown, previous?: Profile): Profile {
    if (!isRecord(raw)) throw new Error("供应商配置必须是对象");
    const required = (key: string, max: number) => {
      const v = raw[key];
      if (typeof v !== "string" || !v.trim() || v.length > max)
        throw new Error(`${key}不能为空且不能超过${max}字符`);
      return v.trim();
    };
    const protocol = required("protocol", 20);
    if (!["chat", "claude", "gemini"].includes(protocol))
      throw new Error("不支持的供应商协议");
    const baseURL = required("baseURL", 2048);
    let url: URL;
    try {
      url = new URL(baseURL);
    } catch {
      throw new Error("API地址无效");
    }
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error("API地址必须是无凭证、查询或片段的HTTP(S)地址");
    const id = raw.id === undefined ? randomUUID() : required("id", 80);
    if (!/^[a-zA-Z0-9_-]+$/u.test(id) || id === "environment")
      throw new Error("供应商编号无效");
    if (raw.apiKey !== undefined && typeof raw.apiKey !== "string")
      throw new Error("密钥必须是字符串");
    const apiKey =
      (typeof raw.apiKey === "string" ? raw.apiKey.trim() : "") ||
      previous?.apiKey ||
      "";
    if (!apiKey || apiKey.length > 8192) throw new Error("请填写API密钥");
    const caps = resolveChatCapabilities({
      ...(raw.jsonMode === undefined
        ? {}
        : { jsonMode: raw.jsonMode as ChatCapabilities["jsonMode"] }),
      ...(raw.thinking === undefined
        ? {}
        : { thinking: raw.thinking as ChatCapabilities["thinking"] }),
      ...(raw.reasoningEffort === undefined
        ? {}
        : {
            reasoningEffort:
              raw.reasoningEffort as ChatCapabilities["reasoningEffort"],
          }),
      ...(raw.stream === undefined
        ? {}
        : { stream: raw.stream as ChatCapabilities["stream"] }),
      ...(raw.includeUsage === undefined
        ? {}
        : { includeUsage: raw.includeUsage as boolean }),
      ...(raw.maxOutputTokens === undefined || raw.maxOutputTokens === null
        ? {}
        : { maxOutputTokens: raw.maxOutputTokens as number }),
      ...(raw.timeoutMs === undefined
        ? {}
        : { timeoutMs: raw.timeoutMs as number }),
    });
    const model = required("model", 200);
    if (protocol === "gemini" && !/^[-\w.]+$/u.test(model))
      throw new Error("Gemini模型ID不能包含models/前缀或路径");
    return {
      id,
      name: required("name", 80),
      protocol: protocol as ProviderProtocol,
      baseURL,
      apiKey,
      model,
      ...(typeof raw.judgeModel === "string" && raw.judgeModel.trim()
        ? { judgeModel: raw.judgeModel.trim() }
        : {}),
      ...caps,
    };
  }
  upsert(raw: unknown): PublicProvider {
    const state = this.load();
    const previous = isRecord(raw)
      ? state.profiles.find((p) => p.id === raw.id)
      : undefined;
    if (isRecord(raw) && raw.id !== undefined && !previous)
      throw new Error("供应商不存在，请重新加载");
    const profile = this.parse(raw, previous);
    this.save({
      ...state,
      profiles: [...state.profiles.filter((p) => p.id !== profile.id), profile],
    });
    return this.public(profile);
  }
  select(id: string): void {
    const state = this.load();
    if (id !== "environment" && !state.profiles.some((p) => p.id === id))
      throw new Error("供应商不存在");
    this.save({ ...state, activeId: id });
  }
  remove(id: string): void {
    const state = this.load();
    if (state.activeId === id)
      throw new Error("请先切换默认供应商，再删除当前配置");
    if (!state.profiles.some((p) => p.id === id))
      throw new Error("供应商不存在");
    this.save({
      ...state,
      profiles: state.profiles.filter((p) => p.id !== id),
    });
  }
  createClient(id?: string): ModelClient {
    const state = this.load(),
      selected = id ?? state.activeId;
    const profile = state.profiles.find((p) => p.id === selected);
    if (selected !== "environment" && !profile) throw new Error("供应商不存在");
    const key = profile === undefined ? "environment" : JSON.stringify(profile);
    if (this.cached?.key === key) return this.cached.client;
    const client =
      profile === undefined
        ? createModelClient(this.env)
        : profile.protocol === "chat"
          ? new ChatClient(profile)
          : profile.protocol === "gemini"
            ? new GeminiClient(profile)
            : new ClaudeClient({
                apiKey: profile.apiKey,
                baseURL: profile.baseURL,
                official:
                  new URL(profile.baseURL).origin ===
                  "https://api.anthropic.com",
                model: profile.model,
                judgeModel: profile.judgeModel ?? profile.model,
                timeoutMs: profile.timeoutMs,
                maxRetries: 0,
                ...(profile.maxOutputTokens === undefined
                  ? {}
                  : { maxOutputTokens: profile.maxOutputTokens }),
              });
    this.cached = { key, client };
    return client;
  }
  modelName(role: ModelRole): string {
    const state = this.load();
    if (state.activeId === "environment")
      return resolveModelName(role, this.env);
    const p = state.profiles.find((p) => p.id === state.activeId)!;
    return role === "judge" ? (p.judgeModel ?? p.model) : p.model;
  }
}
