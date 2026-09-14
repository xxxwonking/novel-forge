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

export interface WorkSummary {
  id: string;
  title: string;
  premise: string;
  genre: string;
  platform: string;
  currentChapter: number;
  chapterCount: number;
  pendingDrafts: number;
  updatedAt: string;
  error: string | null;
}

export interface WorkspacePayload {
  projects: WorkSummary[];
  defaultProjectId: string | null;
}

export interface CreateWorkInput {
  title: string;
  idea: string;
  genre: string;
  platform: string;
  targetWords: number;
  requestId: string;
}

export function selectedProjectId(): string | null {
  return new URLSearchParams(window.location.search).get("work");
}

export function workUrl(id: string, route = "/chat"): string {
  const url = new URL(window.location.href);
  url.searchParams.set("work", id);
  url.hash = route;
  return url.href;
}

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
  | { kind: "preparation_proposed" | "preparation_confirmed"; proposalId: string; summary: string }
  | { kind: "chapter_written" | "chapter_started" | "chapter_revised"; chapter: number; draftId: string; status: string; acceptable: boolean }
  | { kind: "task_updated"; chapter: number; draftId: string; status: string }
  | { kind: "chapter_adopted"; chapter: number; draftId: string; superseded: number; staleMarked: number[] }
  | { kind: "plan_updated"; chapter: number; promotedToPayoff: boolean }
  | { kind: "foreshadow_rescheduled"; foreshadowId: string; expectedBy: number }
  | { kind: "foreshadow_abandoned"; foreshadowId: string }
  | { kind: "idea_recorded"; id: string; text: string }
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

/** 草稿的对外视图（后端剔除了内部会话快照）。只声明 UI 用到的字段。 */
export interface DraftView {
  revisionToken: string;
  isCurrentAdopted: boolean;
  revision?: { kind: string; sourceDraftId: string; summary: string; rebased: boolean };
  review?: { adoptOnSuccess: boolean; adoptionError?: string };
  execution?: TaskExecution;
  preparationProposalId: string | null;
  declaration: {
    events: { kind: string; summary: string; weight: number; plotLine: string | null; participants: string[]; anchor: TextAnchor }[];
    foreshadowPlanted: { foreshadowId: string; label: string; intent: string; weight: string; visibility: string; expectedBy: number; anchor: TextAnchor }[];
    foreshadowResolved: { foreshadowId: string; completeness: string; anchor: TextAnchor }[];
    characterStates: { characterId: string; field: string; from: string | null; to: string; anchor: TextAnchor }[];
    relationsChanged: { from: string; to: string; fromKind: string | null; toKind: string; note: string; anchor: TextAnchor }[];
    characterPresence: { characterId: string; role: string }[];
  } | null;
  proposals: { kind: string; name?: string; field?: string; value?: string; reason?: string; label?: string; intent?: string }[];
  chapter: number;
  draftId: string;
  status: string;
  body: string;
  words: number;
  acceptable: boolean;
  findings: GateFinding[];
  error: { step: string; detail: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskExecution {
  status: "waiting" | "running" | "pausing" | "ending" | "paused" | "ended" | "completed" | "failed" | "interrupted";
  stage: "writing" | "declaring" | "checking";
  startedAt: string;
  updatedAt: string;
  usage: { calls: number; inputTokens: number; outputTokens: number; unmeasuredCalls: number };
}
export interface ChapterTaskView extends TaskExecution {
  isHistory: boolean;
  usageRecorded: boolean;
  chapter: number;
  draftId: string;
  draftStatus: string;
  words: number;
  detail: string | null;
}

export interface AdoptResponse {
  result: { changed: boolean; chapter: number; draftId: string; superseded: number; staleMarked: number[] };
  alerts: { homepage: Alert[]; counts: { fullList: number; repairQueue: number } };
}

export interface PreparationContent {
  setting: { title: string; premise: string; centralConflict: string; openingSituation: string; pov: string; tense: string; protagonistTraits: string[]; protagonistForbidden: string[]; specialAbility: string; abilityLimits: string[]; worldRules: string[]; styleKeywords: string[]; romanceLine: string; taboos: string[] };
  profile: { genre: string; platform: string; targetWords: number };
  discipline: { version: string; rules: string[] };
  characters: { id: string; name: string; aliases: string[]; tier: string; provenance: string; profile: { role: string; wants: string; fears: string; traits: string[]; background: string; forbiddenBehaviors: string[]; appearance: { key: string; value: string }[] }; speech: { exemplars: string[]; verbalTics: string[]; forbiddenLexicon: string[]; register: string } }[];
  settings: { id: string; name: string; kind: string; description: string; facts: string[] }[];
  plotLines: { id: string; label: string; weight: string }[];
  beats: (ChapterBeat & { provenance: string })[];
}

export interface PreparationProposal {
  id: string; summary: string; source: "author" | "assistant"; status: "proposed" | "confirmed" | "rejected";
  stale: boolean; createdAt: string; updatedAt: string;
  content: PreparationContent;
  impacts: { message: string; chapters: number[] }[];
  findings: GateFinding[];
}

export interface PreparationPayload {
  fingerprint: string; confirmed: PreparationContent; nextChapter: number;
  readiness: { ready: boolean; missing: string[] };
  proposals: PreparationProposal[];
  ideas: AlternativeIdea[];
}

// ── 请求 ────────────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // 地址属于当前页面，每次请求捕获自己的作品；另一个标签页切换不会改变它。
  const projectId = selectedProjectId();
  const headers = new Headers(init?.headers);
  if (projectId !== null) headers.set("x-novel-project", encodeURIComponent(projectId));
  const res = await fetch(path, { ...init, headers });
  const body: unknown = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return body as T;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

export const api = {
  preparation: () => request<PreparationPayload>("/api/preparation"),
  confirmPreparation: (proposalId: string) => post<{ changed: boolean; proposal: PreparationProposal }>("/api/preparation/confirm", { proposalId }),
  rejectPreparation: (proposalId: string) => post<PreparationProposal>("/api/preparation/reject", { proposalId }),
  recordAuthorDetails: (input: { summary: string; baseFingerprint: string; changes: unknown }) => post<PreparationProposal>("/api/preparation/author", input),
  writeChapter: (input: { chapter: number; proposalId?: string; draftId?: string; newDraft?: boolean; requestId?: string }) => post<DraftView>("/api/chapter/start", { ...input, requestId: input.requestId ?? crypto.randomUUID() }),
  chapterTasks: () => request<ChapterTaskView[]>("/api/tasks"),
  controlTask: (chapter: number, draftId: string, action: "pause" | "end") => post<ChapterTaskView>("/api/chapter/control", { chapter, draftId, action }),
  workspace: () => request<WorkspacePayload>("/api/workspace"),
  createWork: (input: CreateWorkInput) => post<WorkSummary>("/api/works", input),
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
  editDraft: (input: { chapter: number; draftId: string; revisionToken: string; body: string; summary: string; requestId: string }) => post<DraftView>("/api/chapter/edit", input),
  correctDraft: (input: { chapter: number; draftId: string; revisionToken: string; summary: string; requestId: string; changes: { section: string; index: number; value: unknown; occurrence?: number }[] }) => post<DraftView>("/api/chapter/correct", input),
  checkDraft: (input: { chapter: number; draftId: string; revisionToken: string; adoptOnSuccess: boolean }) => post<DraftView>("/api/chapter/check", input),
  adopt: (chapter: number, draftId: string) => post<AdoptResponse>("/api/chapter/adopt", { chapter, draftId }),
  discard: (chapter: number, draftId: string) => post<{ changed: boolean }>("/api/chapter/discard", { chapter, draftId }),
};

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
