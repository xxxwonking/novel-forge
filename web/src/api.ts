/**
 * 与 /api 的通信。
 *
 * 类型**不从后端 import** —— web 与 src 是两个 tsconfig（DOM lib vs 纯 Node），
 * 而且这一层实际收到的是 JSON，Derived 品牌与 readonly 修饰在网线上都不存在。
 * 在这里重新声明一遍是诚实的：它描述的是报文，不是内存里的对象。
 */

import type { CharacterInput, CharacterRecord, PlotLineInput, RelationClaim, Removals, SettingInput } from "./preparation-changes.js";

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
  credits: number;
  calls: number;
  error: string | null;
}

/** 模型消耗汇总。credits 是折算后的积分，tokens 是四档原始用量。 */
export interface CreditSummary {
  calls: number;
  credits: number;
  unpricedCalls: number;
  tokens: { input: number; output: number; cacheWrite: number; cacheRead: number };
  byPurpose: Record<string, { calls: number; credits: number }>;
}

export interface WorkspaceCredits { granted: number; spent: number; balance: number; unpricedCalls: number }

export interface RemovedWork extends WorkSummary {
  /** 回收站里的目录名（`data/.trash/` 下），作者在磁盘上按它就能找到这本书。 */
  archive: string;
  deletedAt: string;
}

export interface WorkspacePayload {
  projects: WorkSummary[];
  defaultProjectId: string | null;
  removed: RemovedWork[];
  credits: WorkspaceCredits;
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

export type PlanningAction = Extract<AlertAction, { kind: "add_resolution_to_beat" | "add_advance_to_beat" | "add_character_to_beat" | "reschedule" | "abandon" | "confirm_exit" }>;

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
  events: { kind: "action" | "info" | "relation" | "resource" | "decision"; summary: string; weight: 1 | 2 | 3; plotLine: string | null }[];
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
  characterCount: number;
  nextBeat: ChapterBeat | null;
  homepage: Alert[];
  counts: {
    fullList: number;
    repairQueue: number;
    openForeshadows: number;
    overdueForeshadows: number;
    brokenPlotLines: number;
    /** 改早章之后还没复核的后续章；conflicts 是其中的硬矛盾，挡着连写。 */
    revisionPending: number;
    revisionConflicts: number;
  };
}

// ── 跨多章返修 ─────────────────────────────────────────────────────────

/** 一条被改动的结构事实。与后端 FactChange 一一对应。 */
export interface FactChange {
  kind: "foreshadow_planted" | "foreshadow_resolved" | "character_state" | "relation" | "plot_event" | "prose";
  direction: "removed" | "added" | "changed";
  subject: string;
  text: string;
}

export interface ImpactReason {
  severity: "conflict" | "review";
  rule: string;
  text: string;
}

export interface RevisionPassage {
  quote: string;
  why: string;
  suggestion: string;
}

export interface RevisionChapter {
  chapter: number;
  state: "pending" | "located" | "resolved";
  severity: "conflict" | "review";
  triggers: { chapter: number; at: string }[];
  changes: string[];
  reasons: ImpactReason[];
  passages: RevisionPassage[];
  notes: string[];
  outdated: boolean;
  at: string;
}

export interface RevisionView {
  chapters: RevisionChapter[];
  pending: number;
  conflicts: number;
  latest: { chapter: number; at: string; changes: string[] } | null;
  /** 清单文件读不出来时的原因；非 null 时上面几项都是空值。 */
  error: string | null;
}

/** 采用前的只读预览：这一稿会牵连到哪些章。 */
export interface RevisionImpact {
  source: number;
  changes: FactChange[];
  chapters: { chapter: number; severity: "conflict" | "review"; reasons: ImpactReason[] }[];
}

export interface AlertsPayload {
  homepage: Alert[];
  fullList: Alert[];
  repairQueue: Alert[];
  suppressed: { alert: Alert; reason: "scheduled" | "acknowledged" | "fatigued" }[];
  progress: StoryProgress[];
}

export interface StoryProgress {
  id: string;
  kind: "foreshadow" | "plotline" | "character";
  title: string;
  state: "planned" | "pending" | "scheduled" | "rescheduled" | "partial" | "resolved" | "abandoned" | "exited";
  detail: string;
  expectedBy?: number;
  arrangements: { chapter: number; goal: string }[];
  evidence: { chapter: number; label: string; anchor?: TextAnchor }[];
  history: { chapter: number; state: StoryProgress["state"]; detail: string }[];
  actions?: PlanningAction[];
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
    /** 没有正文出处时为 null —— 不是"解析失败"，而是"还没写进正文"。 */
    point: AnchorPoint | null;
    declared: boolean;
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
  message?: string;
  adjustedChapters?: number[];
  /** 主线收束让目标章升级为回收章。要显式告诉用户 —— 一次点击改了两处。 */
  promotedToPayoff?: boolean;
  beat?: ChapterBeat;
  alerts: { homepage: Alert[]; counts: { fullList: number; repairQueue: number } };
}

// ── 对话式主 Agent（Stage 2·切片 1）────────────────────────────────────

/** 一次对话回合里发生的状态变化。与后端 AgentEffect 一一对应（报文层重新声明）。 */
export type AgentEffect =
  | { kind: "export_prepared"; exportId: string; chapters: number }
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

/** 对话模式。planning（谋篇）下后端把工具集裁成只读，写入只能经候选方案。 */
export type ConversationMode = "normal" | "planning";

export interface ConversationReply {
  text: string;
  effects: AgentEffect[];
  toolRounds: number;
  mode: ConversationMode;
}

export interface ConversationHistory {
  turns: ConversationTurn[];
  ideas: AlternativeIdea[];
  mode: ConversationMode;
}

/** 流式对话事件，与服务端 ConversationStreamEvent 一一对应。 */
export type ConversationStreamEvent =
  | { type: "round"; round: number }
  | { type: "delta"; text: string }
  | { type: "tool"; name: string; status: "started" | "finished"; ok: boolean }
  | { type: "done"; reply: ConversationReply }
  | { type: "error"; message: string };

/**
 * 逐事件读取 SSE 响应。响应体在 fetch 处即以流的形式读取，不等整段结束；
 * 服务端开始前失败时仍是 JSON，沿用普通错误处理。
 */
async function streamRequest(path: string, body: unknown, onEvent: (event: ConversationStreamEvent) => void): Promise<ConversationReply> {
  const projectId = selectedProjectId();
  const headers = new Headers({ "content-type": "application/json", accept: "text/event-stream" });
  if (projectId !== null) headers.set("x-novel-project", encodeURIComponent(projectId));
  const res = await fetch(path, { method: "POST", headers, body: JSON.stringify(body) });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const payload: unknown = await res.json().catch(() => ({}));
    throw new Error(isRecord(payload) && typeof payload["error"] === "string" ? payload["error"] : `HTTP ${res.status}`);
  }
  if (res.body === null) throw new Error("服务端没有返回事件流");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply: ConversationReply | null = null;
  const consume = (frame: string): void => {
    const data = frame.split("\n").filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /u, "")).join("\n");
    if (data === "") return;
    const event = JSON.parse(data) as ConversationStreamEvent;
    if (event.type === "done") reply = event.reply;
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
  };
  for (;;) {
    const next = await reader.read();
    buffer += next.done ? decoder.decode() : decoder.decode(next.value, { stream: true });
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      consume(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 2);
    }
    if (next.done) break;
  }
  if (buffer.trim() !== "") consume(buffer);
  if (reply === null) throw new Error("对话在完成前中断，请刷新查看是否已保存");
  return reply;
}

/** 草稿的对外视图（后端剔除了内部会话快照）。只声明 UI 用到的字段。 */
export interface DraftView {
  proposalOptions: { index: number; title: string; kind: string; from: string | null; to: string; reason: string; available: boolean; problem: string | null; status: "suggested" | "applied" | "not_selected"; foreshadowId?: string }[];
  autoRevisionsUsed?: number;
  automaticResultDraftId?: string;
  revisionToken: string;
  isCurrentAdopted: boolean;
  canContinueBody: boolean;
  revision?: { kind: string; sourceDraftId: string; summary: string; rebased: boolean; resultSummary?: string; scopeAdvice?: string; scope?: { quote: string; occurrence: number; start: number; end: number } | null };
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

export type RunStopReason = "key_change" | "needs_revision" | "failed" | "blocked" | "author" | "interrupted";
export interface RunView {
  status: "idle" | "running" | "stopped";
  through: number | null;
  startedAt: string | null;
  updatedAt: string;
  adopted: number[];
  stopped: { chapter: number; reason: RunStopReason; detail: string; draftId: string | null } | null;
  current: number | null;
  stopRequested: boolean;
  nextChapter: number;
  maxThrough: number;
}

export interface TaskExecution {
  status: "waiting" | "awaiting_input" | "running" | "pausing" | "ending" | "paused" | "ended" | "completed" | "failed" | "interrupted";
  stage: "writing" | "revising" | "declaring" | "checking";
  startedAt: string;
  updatedAt: string;
  usage: { calls: number; inputTokens: number; outputTokens: number; unmeasuredCalls: number };
}
export interface ChapterTaskView extends TaskExecution {
  autoRevisionLimit: number;
  autoRevisionsUsed: number;
  automaticResultDraftId: string | null;
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

/**
 * 人物卡与说话方式的形状定义在 `preparation-changes.ts` —— 那份类型同时是
 * "编辑后要发出去的载荷" 的契约，两边共用一个定义才不会各写一份走样。
 */
export type { CharacterRecord, CharacterAttribute, SpeechProfile, CharacterInput, SettingInput, PlotLineInput, BeatInput, BeatRecord, ChapterPlanInput, PreparationChanges, Removals, RelationClaim, RelationKind } from "./preparation-changes.js";
export type CharacterCard = CharacterRecord;

/** 卷名与卷纲。章号范围不在这里 —— 由节拍表的 volume 推出。 */
export interface VolumeCard {
  volume: number;
  title: string;
  summary: string;
  updatedAt: string;
}

export interface PreparationContent {
  setting: { title: string; genre: string; platform: string; premise: string; centralConflict: string; openingSituation: string; pov: string; tense: string; protagonistTraits: string[]; protagonistForbidden: string[]; specialAbility: string; abilityLimits: string[]; worldRules: string[]; styleKeywords: string[]; romanceLine: string; taboos: string[] };
  profile: { genre: string; platform: string; targetWords: number };
  discipline: { version: string; rules: string[] };
  characters: CharacterRecord[];
  settings: SettingInput[];
  plotLines: PlotLineInput[];
  volumes: VolumeCard[];
  beats: (ChapterBeat & { provenance: string })[];
}

export interface PreparationProposal {
  id: string; summary: string; source: "author" | "assistant"; status: "proposed" | "confirmed" | "rejected";
  stale: boolean; createdAt: string; updatedAt: string;
  /** 只声明界面要读的那部分：删除在 content 预览里是隐形的，必须单独说出来。 */
  changes: { removals?: Removals; relations?: RelationClaim[] };
  content: PreparationContent;
  impacts: { message: string; chapters: number[] }[];
  findings: GateFinding[];
}

/** 全文检索：正文命中带可直接当锚点用的片段，结构命中说清命中在哪个字段。 */
export interface SearchSnippet { quote: string; offset: number }
export interface ChapterHit { chapter: number; count: number; snippets: SearchSnippet[] }
export interface EntityHit {
  kind: "character" | "setting" | "plotLine" | "volume" | "beat" | "event";
  id: string; title: string; field: string; excerpt: string; chapter: number | null;
}
export interface SearchResult { query: string; chapters: ChapterHit[]; entities: EntityHit[]; truncated: boolean }

/** 两个 model 审查通道的开关，按作品保存。 */
export interface ReviewSettings {
  voice: boolean;
  semantics: boolean;
}

/** 起草的范围：人物 / 情节线 / 整份资料 / 后面几章的章计划。 */
export type DraftFocus = "characters" | "plotlines" | "full" | "chapters";

export interface PreparationDraftResult {
  /** 起草回合的说明：补了什么、哪里还需要作者拿主意。 */
  reply: string;
  /** apply: true 时的候选方案编号。 */
  proposalId?: string;
  summary?: string;
  /** apply: false 时的草稿人物，供表单填入。 */
  characters: CharacterInput[];
}

export interface PreparationPayload {
  plannedForeshadows: { id: string; label: string; intent: string; weight: string; expectedBy: number }[];
  taskPolicy: { autoRevisionLimit: number };
  fingerprint: string; confirmed: PreparationContent; nextChapter: number;
  readiness: { ready: boolean; missing: string[] };
  proposals: PreparationProposal[];
  ideas: AlternativeIdea[];
}

// ── 请求 ────────────────────────────────────────────────────────────────

/** 正文来源二选一：粘贴/单文件的整本，或每章一个文件。 */
export type ImportSource = { text: string } | { files: { name: string; text: string }[] };

export type ExportSelection = { scope: "all" } | { scope: "range"; from: number; to: number } | { scope: "volume"; volume: number };
export type ExportKind = "manuscript" | "bible";
export type ExportArtifactFormat = "txt" | "epub" | "docx" | "json";
export interface ExportArtifact {
  format: ExportArtifactFormat; filename: string; mime: string; bytes: number; sha256: string;
}
export interface TextExportPreview {
  id: string | null; kind: ExportKind; title: string; filename: string | null; selection: ExportSelection;
  chapters: { chapter: number; draftId: string | null; version: string; words: number; sha256: string }[];
  omitted: { from: number; to: number }[];
  pendingDrafts: { chapter: number; count: number }[];
  totalWords: number; createdAt: string; sha256: string | null; artifacts: ExportArtifact[]; message: string;
}

export interface ImportChapter { chapter: number; title: string; heading: string; body: string; words: number }
export interface ImportConflict { chapter: number; existingWords: number; identical: boolean; locked: boolean; reason: string }
export interface ImportPreview {
  marker: string | null;
  chapters: ImportChapter[];
  preface: { words: number; excerpt: string } | null;
  problems: string[];
  notes: string[];
  conflicts: ImportConflict[];
  totalWords: number;
  ready: boolean;
  readyWithOverwrite: boolean;
}
export interface InferenceDeclaration {
  events: { summary: string; participants: string[]; anchor: TextAnchor }[];
  foreshadowPlanted: { foreshadowId: string; label: string; intent: string; expectedBy: number; anchor: TextAnchor }[];
  foreshadowResolved: { foreshadowId: string; completeness: "full" | "partial"; anchor: TextAnchor }[];
  relationsChanged: { from: string; to: string; fromKind: string | null; toKind: string; note: string; anchor: TextAnchor }[];
  characterStates: { characterId: string; field: string; from: string | null; to: string; anchor: TextAnchor }[];
  characterPresence: { characterId: string; role: string }[];
}
export interface InferenceChapter {
  chapter: number; words: number;
  state: "written" | "confirmed" | "pending" | "problem" | "failed" | "skipped" | "none";
  problems: string[]; warnings: string[]; at: string | null;
  declaration: InferenceDeclaration | null;
}
export interface InferenceView {
  chapters: InferenceChapter[];
  nextChapter: number | null;
  pending: number[];
  blocked: string | null;
}
export interface ImportResult {
  imported: number[]; replaced: number[]; unchanged: number[];
  totalWords: number; nextChapter: number;
  /** 随正文一并收下的资料文件名（角色档案、大纲这类）。 */
  materials: string[];
}

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

const BACKUP_MIME = "application/vnd.novel-forge.backup";

async function responseError(res: Response): Promise<never> {
  const body: unknown = await res.json().catch(() => ({}));
  const message = isRecord(body) && typeof body["error"] === "string" ? body["error"] : `HTTP ${res.status}`;
  throw new Error(message);
}

async function downloadWorkBackup(source: { id: string } | { archive: string }): Promise<{ blob: Blob; filename: string }> {
  const query = new URLSearchParams(source);
  const res = await fetch(`/api/works/backup?${query.toString()}`);
  if (!res.ok) return responseError(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
  let filename = "novel-forge-backup.nforge";
  if (encoded !== undefined) {
    try { filename = decodeURIComponent(encoded); }
    catch { /* 保留安全的默认文件名。 */ }
  }
  return { blob: await res.blob(), filename };
}

async function importWorkBackup(file: File, targetId?: string): Promise<WorkSummary> {
  const query = new URLSearchParams();
  if (targetId !== undefined) query.set("targetId", targetId);
  const suffix = query.size === 0 ? "" : `?${query.toString()}`;
  const res = await fetch(`/api/works/import${suffix}`, { method: "POST", headers: { "content-type": BACKUP_MIME }, body: file });
  if (!res.ok) return responseError(res);
  return await res.json() as WorkSummary;
}

async function downloadExportArtifact(id: string, format: ExportArtifactFormat): Promise<{ blob: Blob; filename: string }> {
  const projectId = selectedProjectId();
  const headers = new Headers();
  if (projectId !== null) headers.set("x-novel-project", encodeURIComponent(projectId));
  const query = new URLSearchParams({ id, format });
  const res = await fetch(`/api/export/download?${query.toString()}`, { headers });
  if (!res.ok) return responseError(res);
  const disposition = res.headers.get("content-disposition") ?? "";
  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1];
  let filename = `novel-forge-export.${format}`;
  if (encoded !== undefined) {
    try { filename = decodeURIComponent(encoded); }
    catch { /* 保留安全的默认文件名。 */ }
  }
  return { blob: await res.blob(), filename };
}

export const api = {
  /** 导入旧作：只入正文，不反推结构。预览与落盘用同一份文本，服务端不暂存。 */
  importPreview: (input: ImportSource) => post<ImportPreview>("/api/import/preview", input),
  importApply: (input: ImportSource & { overwrite?: boolean }) => post<ImportResult>("/api/import/apply", input),
  /** 逐章反推结构：一次一章，落盘即生效，所以中断只是停下来。 */
  inferenceView: () => request<InferenceView>("/api/import/inference"),
  inferChapter: (chapter: number) => post<InferenceChapter>("/api/import/infer", { chapter }),
  confirmInference: (chapter: number) => post<{ chapter: number; committed: number }>("/api/import/inference/confirm", { chapter }),
  rejectInference: (chapter: number) => post<{ chapter: number; rejected: number }>("/api/import/inference/reject", { chapter }),
  exportPreview: (input: { kind: "manuscript"; selection: ExportSelection } | { kind: "bible" }) => post<TextExportPreview>("/api/export/preview", input),
  getExport: (id: string) => request<TextExportPreview>(`/api/export?id=${encodeURIComponent(id)}`),
  downloadExport: (id: string) => request<{ filename: string; text: string; sha256: string }>(`/api/export/file?id=${encodeURIComponent(id)}`),
  downloadExportArtifact,
  planningAction: (action: PlanningAction, reason?: string) => post<ActionResult>("/api/planning/action", { action, ...(reason === undefined ? {} : { reason }) }),
  preparation: () => request<PreparationPayload>("/api/preparation"),
  reviewSettings: () => request<ReviewSettings>("/api/review-settings"),
  saveReviewSettings: (value: ReviewSettings) => post<ReviewSettings>("/api/review-settings", value),
  confirmPreparation: (proposalId: string) => post<{ changed: boolean; proposal: PreparationProposal }>("/api/preparation/confirm", { proposalId }),
  rejectPreparation: (proposalId: string) => post<PreparationProposal>("/api/preparation/reject", { proposalId }),
  recordAuthorDetails: (input: { summary: string; baseFingerprint: string; changes: unknown }) => post<PreparationProposal>("/api/preparation/author", input),
  /** 让 AI 起草资料。apply=false 只交回草稿供表单试填，不落任何文件。 */
  draftPreparation: (input: { focus: DraftFocus; apply: boolean; brief?: string; count?: number }) =>
    post<PreparationDraftResult>("/api/preparation/draft", input),
  /** 跨章返修：清单只读；定位要花一次模型调用，所以由作者一章一章地点。 */
  revisionView: () => request<RevisionView>("/api/revision"),
  rebuildRevision: () => post<{ archived: string | null; view: RevisionView }>("/api/revision/rebuild", {}),
  previewRevision: (chapter: number, draftId: string) => post<RevisionImpact>("/api/revision/preview", { chapter, draftId }),
  locateRevision: (chapter: number) => post<RevisionChapter>("/api/revision/locate", { chapter }),
  resolveRevision: (chapter: number) => post<RevisionChapter>("/api/revision/resolve", { chapter }),
  /** 连写：启动登记授权并起后台循环；停下在章与章之间生效；知道了把停下状态清回空闲。 */
  run: () => request<RunView>("/api/run"),
  startRun: (through: number) => post<RunView>("/api/run/start", { through }),
  stopRun: () => post<RunView>("/api/run/stop", {}),
  acknowledgeRun: () => post<RunView>("/api/run/acknowledge", {}),
  writeChapter: (input: { chapter: number; proposalId?: string; draftId?: string; newDraft?: boolean; requestId?: string }) => post<DraftView>("/api/chapter/start", { ...input, requestId: input.requestId ?? crypto.randomUUID() }),
  chapterTasks: () => request<ChapterTaskView[]>("/api/tasks"),
  controlTask: (chapter: number, draftId: string, action: "pause" | "end") => post<ChapterTaskView>("/api/chapter/control", { chapter, draftId, action }),
  workspace: () => request<WorkspacePayload>("/api/workspace"),
  createWork: (input: CreateWorkInput) => post<WorkSummary>("/api/works", input),
  removeWork: (id: string) => post<RemovedWork>("/api/works/delete", { id }),
  restoreWork: (archive: string) => post<WorkSummary>("/api/works/restore", { archive }),
  downloadWorkBackup,
  importWorkBackup,
  overview: () => request<Overview>("/api/overview"),
  views: () => request<Views>("/api/views"),
  alerts: () => request<AlertsPayload>("/api/alerts"),
  chapters: () => request<ChapterListItem[]>("/api/chapters"),
  chapter: (n: number) => request<ChapterPayload>(`/api/chapter?n=${n}`),
  health: (n: number) => request<HealthPayload>(`/api/health?n=${n}`),
  credits: () => request<CreditSummary>("/api/credits"),
  materials: () => request<{ materials: { name: string; file: string; words: number }[] }>("/api/materials"),
  uploadMaterials: (files: { name: string; text: string }[]) => post<{ saved: string[]; skipped: { name: string; reason: string }[] }>("/api/materials", { files }),
  search: (q: string) => request<SearchResult>(`/api/search?q=${encodeURIComponent(q)}`),
  anchor: (a: TextAnchor) =>
    request<AnchorPayload>(
      `/api/anchor?chapter=${a.chapter}&quote=${encodeURIComponent(a.quote)}&offsetHint=${a.offsetHint}&occurrence=${a.occurrence}`,
    ),

  action: (alertId: string, action: AlertAction, reason?: string) =>
    post<ActionResult>("/api/alerts/action", { alertId, action, ...(reason === undefined ? {} : { reason }) }),
  ignore: (alertId: string) => post<ActionResult>("/api/alerts/ignore", { alertId }),
  acknowledge: (alertId: string) => post<ActionResult>("/api/alerts/acknowledge", { alertId }),
  unacknowledge: (alertId: string) => post<ActionResult>("/api/alerts/unacknowledge", { alertId }),

  // 对话式主 Agent 与章节草稿
  conversationHistory: () => request<ConversationHistory>("/api/conversation"),
  converse: (text: string) => post<ConversationReply>("/api/conversation", { text }),
  converseStream: (text: string, onEvent: (event: ConversationStreamEvent) => void) => streamRequest("/api/conversation/stream", { text }, onEvent),
  setConversationMode: (mode: ConversationMode) => post<{ mode: ConversationMode }>("/api/conversation/mode", { mode }),
  chapterDrafts: (n: number) => request<DraftView[]>(`/api/chapter/drafts?n=${n}`),
  chapterDraft: (n: number, id: string) => request<DraftView>(`/api/chapter/draft?n=${n}&id=${encodeURIComponent(id)}`),
  editDraft: (input: { chapter: number; draftId: string; revisionToken: string; body: string; summary: string; requestId: string }) => post<DraftView>("/api/chapter/edit", input),
  reviseDraft: (input: { chapter: number; draftId: string; revisionToken: string; mode: "rewrite" | "continue"; instruction: string; scope: { quote: string; occurrence?: number } | null; requestId: string }) => post<DraftView>("/api/chapter/revise", input),
  correctDraft: (input: { chapter: number; draftId: string; revisionToken: string; summary: string; requestId: string; changes: { section: string; index: number; value: unknown; occurrence?: number }[] }) => post<DraftView>("/api/chapter/correct", input),
  checkDraft: (input: { chapter: number; draftId: string; revisionToken: string; adoptOnSuccess: boolean; selectedProposals?: number[] }) => post<DraftView>("/api/chapter/check", input),
  adopt: (chapter: number, draftId: string, options?: { revisionToken: string; selectedProposals: number[] }) => post<AdoptResponse>("/api/chapter/adopt", { chapter, draftId, ...options }),
  discard: (chapter: number, draftId: string) => post<{ changed: boolean }>("/api/chapter/discard", { chapter, draftId }),
  restoreDraft: (chapter: number, draftId: string) => post<DraftView>("/api/chapter/restore", { chapter, draftId }),
};

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
