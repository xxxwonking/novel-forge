/**
 * 与 /api 的通信。
 *
 * 类型**不从后端 import** —— web 与 src 是两个 tsconfig（DOM lib vs 纯 Node），
 * 而且这一层实际收到的是 JSON，Derived 品牌与 readonly 修饰在网线上都不存在。
 * 在这里重新声明一遍是诚实的：它描述的是报文，不是内存里的对象。
 */

export type ForeshadowWeight = "main" | "sub" | "detail";
export type CharacterTier = "protagonist" | "major" | "minor" | "extra";
export type GateLevel = "block" | "warn" | "info" | "pass";
export type AnchorStatus = "exact" | "shifted" | "stale";

export interface TextAnchor {
  chapter: number;
  quote: string;
  offsetHint: number;
  occurrence: number;
}

export type AnchorResolution =
  | { status: "exact"; offset: number; length: number }
  | { status: "shifted"; offset: number; length: number; shiftedBy: number }
  | { status: "stale"; reason: "quote_not_found" | "chapter_missing" };

export interface AnchorPoint {
  chapter: number;
  anchor: TextAnchor;
  resolution: AnchorResolution;
}

export type AlertAction =
  | { kind: "add_resolution_to_beat"; targetChapter: number; foreshadowId: string; weight: ForeshadowWeight; completeness: "full" | "partial" }
  | { kind: "add_advance_to_beat"; targetChapter: number; plotLine: string }
  | { kind: "add_character_to_beat"; targetChapter: number; characterId: string }
  | { kind: "reschedule"; foreshadowId: string; expectedBy: number }
  | { kind: "abandon"; foreshadowId: string }
  | { kind: "confirm_exit"; characterId: string }
  | { kind: "acknowledge" }
  | { kind: "open_view"; view: "foreshadow" | "plotline" | "arc" | "relation" }
  | { kind: "jump_to_anchor"; anchor: TextAnchor };

export type AlertSubject =
  | { kind: "foreshadow"; id: string }
  | { kind: "plotline"; id: string }
  | { kind: "character"; id: string }
  | { kind: "chapter"; chapter: number }
  | { kind: "anchor"; anchor: TextAnchor };

export interface Alert {
  id: string;
  category: string;
  direction: "forward" | "backward";
  impact: number;
  decay: number;
  score: number;
  title: string;
  detail: string;
  subject: AlertSubject;
  fatigueCount: number;
  acknowledged: boolean;
  migratedTo: "suggest_abandon" | "confirm_exit" | null;
  actions: AlertAction[];
  createdAt: string;
  lastEvaluatedAt: string;
}

export interface ChapterPlan {
  chapterType: "transition" | "setup" | "event" | "payoff" | "climax";
  coreEvent: string;
  secondaryThread: string | null;
  stageFeedback: string;
  hook: string;
  events: { kind: string; summary: string; weight: 1 | 2 | 3; plotLine: string | null }[];
  resolves: { foreshadowId: string; weight: ForeshadowWeight; completeness: "full" | "partial" }[];
  plants: { label: string; weight: ForeshadowWeight }[];
  characters: string[];
  locations: string[];
}

export interface ChapterBeat {
  chapter: number;
  volume: number;
  plan: ChapterPlan;
  budget: {
    words: { min: number; max: number; sweet: number };
    density: { min: number; max: number };
    thresholds: Record<string, number>;
    tier: "fast" | "standard" | "strict";
    splitAdvice: { reason: string; suggestedBreakAfter: string | null; note: string } | null;
  } | null;
}

export interface Overview {
  title: string;
  genre: string;
  platform: string;
  targetWords: number;
  currentChapter: number;
  nextChapter: number;
  chapterCount: number;
  nextBeat: ChapterBeat | null;
  homepage: Alert[];
  counts: {
    fullList: number;
    repairQueue: number;
    openForeshadows: number;
    overdueForeshadows: number;
    brokenPlotLines: number;
  };
}

export interface AlertsPayload {
  homepage: Alert[];
  fullList: Alert[];
  repairQueue: Alert[];
  suppressed: { alert: Alert; reason: "scheduled" | "acknowledged" | "fatigued" }[];
}

export interface ForeshadowLane {
  id: string;
  label: string;
  intent: string;
  weight: ForeshadowWeight;
  visibility: "overt" | "covert";
  status: "planned" | "open" | "resolved" | "abandoned";
  planted: AnchorPoint;
  expectedBy: number;
  resolutions: { completeness: "full" | "partial"; point: AnchorPoint }[];
  overdueSpan: { from: number; to: number } | null;
  lane: number;
}

export interface PlotTrack {
  id: string;
  label: string;
  weight: ForeshadowWeight;
  gapLimit: number;
  lastAdvancedAt: number;
  currentGap: number;
  nodes: {
    summary: string;
    weight: 1 | 2 | 3;
    kind: string;
    planned: boolean;
    point: AnchorPoint;
  }[];
  gapSpan: { from: number; to: number } | null;
}

export interface ArcLane {
  characterId: string;
  name: string;
  tier: CharacterTier;
  introducedAt: number;
  lastSeenAt: number;
  presence: { chapter: number; role: "pov" | "major" | "minor" | "mentioned" }[];
  turningPoints: { field: string; from: string | null; to: string; point: AnchorPoint }[];
  absenceSpan: { from: number; to: number } | null;
}

export interface RelationGraph {
  nodes: { id: string; name: string; tier: CharacterTier; degree: number }[];
  edges: {
    from: string;
    to: string;
    kind: string;
    note: string;
    changedAt: number;
    point: AnchorPoint;
    historyCount: number;
    history: { chapter: number; kind: string; note: string }[];
  }[];
}

export interface Views {
  axis: { from: number; to: number; current: number };
  foreshadows: ForeshadowLane[];
  plotTracks: PlotTrack[];
  arcs: ArcLane[];
  relations: RelationGraph;
}

export interface GateFinding {
  rule: string;
  level: GateLevel;
  message: string;
  passReason?: string;
  measured?: number;
  threshold?: number;
}

export interface HealthPayload {
  chapter: number;
  plan: GateFinding[];
  chapterGate: {
    findings: GateFinding[];
    words: number;
    thresholds: Record<string, number>;
    density: number;
  } | null;
  crossChapter: GateFinding[];
}

export interface ChapterPayload {
  chapter: number;
  text: string;
  beat: ChapterBeat | null;
}

export interface ChapterListItem {
  chapter: number;
  words: number;
  beat: string | null;
}

export interface AnchorPayload {
  anchor: TextAnchor;
  resolution: AnchorResolution;
  context: { before: string; hit: string; after: string } | null;
}

export interface ActionResult {
  changed: boolean;
  /** 主线收束让目标章升级为回收章。要显式告诉用户 —— 一次点击改了两处。 */
  promotedToPayoff?: boolean;
  beat?: ChapterBeat;
  alerts: { homepage: Alert[]; counts: { fullList: number; repairQueue: number } };
}

// ── 对话式主 Agent（Stage 2·切片 1）────────────────────────────────────

/** 一次对话回合里发生的状态变化。与后端 AgentEffect 一一对应（报文层重新声明）。 */
export type AgentEffect =
  | { kind: "chapter_written"; chapter: number; draftId: string; status: string; acceptable: boolean; revisions: number }
  | { kind: "chapter_adopted"; chapter: number; draftId: string; superseded: number; staleMarked: number[] }
  | { kind: "plan_updated"; chapter: number; promotedToPayoff: boolean }
  | { kind: "foreshadow_rescheduled"; foreshadowId: string; expectedBy: number }
  | { kind: "foreshadow_abandoned"; foreshadowId: string }
  | { kind: "idea_recorded"; id: string; text: string }
  | { kind: "setting_updated"; fields: string[] }
  | { kind: "character_upserted"; id: string; name: string; created: boolean }
  | { kind: "location_upserted"; id: string; name: string; created: boolean }
  | { kind: "plotline_defined"; id: string; label: string; created: boolean }
  | { kind: "discipline_updated"; version: string; count: number }
  | { kind: "chapter_planned"; chapter: number; chapterType: string; warnings: number }
  | { kind: "action_failed"; tool: string; message: string };

export interface ConversationTurn {
  role: "user" | "agent";
  text: string;
  at: string;
  effects?: AgentEffect[];
}

export interface AlternativeIdea {
  id: string;
  text: string;
  at: string;
}

export interface ConversationReply {
  text: string;
  effects: AgentEffect[];
  toolRounds: number;
}

export interface ConversationHistory {
  turns: ConversationTurn[];
  ideas: AlternativeIdea[];
}

/** 一次自动修订前的快照（被替换掉的那一版）。 */
export interface DraftRevisionView {
  body: string;
  findings: GateFinding[];
  reason: string;
  at: string;
}

/** 草稿的对外视图（后端剔除了内部会话快照）。只声明 UI 用到的字段。 */
export interface DraftView {
  chapter: number;
  draftId: string;
  status: string;
  body: string;
  acceptable: boolean;
  findings: GateFinding[];
  revisions: DraftRevisionView[];
  error: { step: string; detail: string } | null;
  createdAt: string;
  updatedAt: string;
}

/** 与后端 adopt 的前置条件一致：只有 ready 且过闸的草稿能采用；已采用的不再给按钮。 */
export const adoptable = (d: Pick<DraftView, "status" | "acceptable">): boolean => d.status === "ready" && d.acceptable;

export type DiffOp = "equal" | "insert" | "delete";
export interface DiffSpan { op: DiffOp; text: string }
export interface DiffParagraph { op: DiffOp | "replace"; spans: DiffSpan[] }

/** GET /api/chapter/diff：某次自动修订的前后对比。 */
export interface DraftDiffPayload {
  draftId: string;
  chapter: number;
  revision: number;
  total: number;
  reason: string;
  at: string;
  beforeWords: number;
  afterWords: number;
  paragraphs: DiffParagraph[];
  inserted: number;
  deleted: number;
  changed: number;
}

export interface AdoptResponse {
  result: { changed: boolean; chapter: number; draftId: string; superseded: number; staleMarked: number[] };
  alerts: { homepage: Alert[]; counts: { fullList: number; repairQueue: number } };
}

// ── 作品与筹备（Stage 2·切片 2）────────────────────────────────────────

export type Genre = "xuanhuan" | "xianxia" | "urban" | "scifi" | "mystery" | "rulehorror";
export type Platform = "fanqie" | "feilu" | "qidian" | "unpublished";

export interface WorkSummary {
  id: string;
  title: string;
  genre: Genre;
  platform: Platform;
  currentChapter: number;
  chapterCount: number;
}

export interface WorksPayload {
  works: WorkSummary[];
  activeId: string | null;
}

export interface WorkSeed {
  title: string;
  genre: Genre;
  platform: Platform;
  targetWords?: number;
}

/** 筹备面板：缺项 + 已建资料的只读摘要。写入只经对话。 */
export interface PrepPayload {
  gaps: string[];
  nextChapter: number;
  nextPlanReady: boolean;
  setting: {
    title: string;
    premise: string;
    centralConflict: string;
    pov: string;
    tense: string;
    protagonistTraits: string[];
    protagonistForbidden: string[];
    specialAbility: string;
    abilityLimits: string[];
    worldRules: string[];
    openingSituation: string;
    styleKeywords: string[];
    romanceLine: string;
    taboos: string[];
  };
  targetWords: number;
  discipline: { version: string; rules: string[] };
  characters: { id: string; name: string; tier: CharacterTier; role: string }[];
  locations: { id: string; name: string; kind: "location" | "organization" }[];
  plotLines: { id: string; label: string; weight: ForeshadowWeight }[];
}

// ── 请求 ────────────────────────────────────────────────────────────────

/** 带状态码的请求错误：409（未选择作品）要和其他失败区分开处理。 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export const api = {
  overview: () => request<Overview>("/api/overview"),
  views: () => request<Views>("/api/views"),
  alerts: () => request<AlertsPayload>("/api/alerts"),
  chapters: () => request<ChapterListItem[]>("/api/chapters"),
  chapter: (n: number) => request<ChapterPayload>(`/api/chapter?n=${n}`),
  health: (n: number) => request<HealthPayload>(`/api/health?n=${n}`),
  anchor: (a: TextAnchor) =>
    request<AnchorPayload>(
      `/api/anchor?chapter=${a.chapter}&quote=${encodeURIComponent(a.quote)}&offsetHint=${a.offsetHint}&occurrence=${a.occurrence}`,
    ),

  action: (alertId: string, action: AlertAction) =>
    post<ActionResult>("/api/alerts/action", { alertId, action }),
  ignore: (alertId: string) => post<ActionResult>("/api/alerts/ignore", { alertId }),
  acknowledge: (alertId: string) => post<ActionResult>("/api/alerts/acknowledge", { alertId }),
  unacknowledge: (alertId: string) => post<ActionResult>("/api/alerts/unacknowledge", { alertId }),

  // 对话式主 Agent 与章节草稿
  conversationHistory: () => request<ConversationHistory>("/api/conversation"),
  converse: (text: string) => post<ConversationReply>("/api/conversation", { text }),
  chapterDrafts: (n: number) => request<DraftView[]>(`/api/chapter/drafts?n=${n}`),
  chapterDraft: (n: number, id: string) => request<DraftView>(`/api/chapter/draft?n=${n}&id=${encodeURIComponent(id)}`),
  chapterDiff: (n: number, id: string, rev?: number) =>
    request<DraftDiffPayload>(`/api/chapter/diff?n=${n}&id=${encodeURIComponent(id)}${rev === undefined ? "" : `&rev=${rev}`}`),
  adopt: (chapter: number, draftId: string) => post<AdoptResponse>("/api/chapter/adopt", { chapter, draftId }),
  discard: (chapter: number, draftId: string) => post<{ changed: boolean }>("/api/chapter/discard", { chapter, draftId }),

  // 作品与筹备
  works: () => request<WorksPayload>("/api/works"),
  createWork: (seed: WorkSeed) => post<WorksPayload & { id: string }>("/api/works", seed),
  selectWork: (id: string) => post<WorksPayload>("/api/works/select", { id }),
  prep: () => request<PrepPayload>("/api/prep"),
};

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
