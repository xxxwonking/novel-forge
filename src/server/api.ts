/**
 * JSON API 的路由与处理。**与 http 传输层分开**（http.ts 负责收发），
 * 这样端点逻辑可以直接在测试里调用，不必起一个真实端口。
 *
 * ⚠ 没有任何鉴权。它绑 127.0.0.1、只供本机开发用。要对外暴露必须先加登录 ——
 * 这些端点能读写用户的全部创作资产。
 */

import { ProjectSession } from "./state.js";
import { Workspace, isGenre, isPlatform } from "./workspace.js";
import { applyActionToBeat, acknowledgeAlert, ignoreAlert, initialAlertState, unacknowledgeAlert } from "../alerts/apply.js";
import { anchorContext, resolveAnchor } from "../anchor/resolve.js";
import { gateChapter } from "../gate/code-channel.js";
import { gateCrossChapter } from "../gate/cross-chapter.js";
import { validatePlan } from "../beat/validate.js";
import { deriveBudget } from "../beat/derive.js";
import type { AlertAction, AlertState } from "../types/projections.js";
import type { AlertId, ChapterNo, TextAnchor } from "../types/primitives.js";
import type { EventWeight } from "../types/events.js";
import type { ChapterDraft } from "../task/types.js";
import { diffDraft } from "../task/diff.js";
import { countWords } from "../text/measure.js";
import { ChapterWriteError } from "./chapter-input.js";
import type { ChapterWriteOptions } from "./chapter-writer.js";
import { prepGaps } from "../agent/system-prompt.js";

export interface ApiRequest {
  readonly method: string;
  readonly path: string;
  readonly query: URLSearchParams;
  readonly body: unknown;
}

export interface ApiResponse {
  readonly status: number;
  readonly body: unknown;
}

const ok = (body: unknown): ApiResponse => ({ status: 200, body });
const bad = (message: string): ApiResponse => ({ status: 400, body: { error: message } });
const missing = (message: string): ApiResponse => ({ status: 404, body: { error: message } });

/** 锚点上下文窗口（字）。布局参数，不是规则常量，所以不进 rules.yaml。 */
const CONTEXT_WINDOW = 60;

/**
 * 工作区入口：/api/works* 直接落在工作区；其余端点作用在「活动作品」上，
 * 无活动作品回 409。既有 handle/handleAsync 与全部端点逻辑零改动。
 */
export async function handleWorkspace(workspace: Workspace, req: ApiRequest): Promise<ApiResponse> {
  if (req.method === "GET" && req.path === "/api/works") return ok(workspace.list());
  if (req.method === "POST" && req.path === "/api/works") return worksCreate(workspace, req.body);
  if (req.method === "POST" && req.path === "/api/works/select") return worksSelect(workspace, req.body);

  const session = workspace.active();
  if (session === null) return { status: 409, body: { error: "未选择作品；先新建或选择一个作品" } };
  return handleAsync(session, req);
}

/** HTTP 的统一入口：写章等待异步任务，其余端点沿用同步处理。 */
export async function handleAsync(session: ProjectSession, req: ApiRequest): Promise<ApiResponse> {
  if (req.method === "POST" && req.path === "/api/chapter/write") {
    return chapterWrite(session, req.body);
  }
  if (req.method === "POST" && req.path === "/api/conversation") {
    return conversationSend(session, req.body);
  }
  return handle(session, req);
}

export function handle(session: ProjectSession, req: ApiRequest): ApiResponse {
  const { method, path } = req;

  if (method === "GET") {
    switch (path) {
      case "/api/overview":
        return ok(overview(session));
      case "/api/prep":
        return ok(prep(session));
      case "/api/conversation":
        return ok({ turns: session.conversationTurns(), ideas: session.listIdeas() });
      case "/api/views":
        return ok(session.derived.views);
      case "/api/alerts":
        return ok(alerts(session));
      case "/api/chapters":
        return ok(chapterList(session));
      case "/api/chapter":
        return chapter(session, req.query);
      case "/api/health":
        return health(session, req.query);
      case "/api/anchor":
        return anchor(session, req.query);
      case "/api/chapter/drafts":
        return chapterDrafts(session, req.query);
      case "/api/chapter/draft":
        return chapterDraft(session, req.query);
      case "/api/chapter/diff":
        return chapterDiff(session, req.query);
      default:
        return missing(`未知端点 ${path}`);
    }
  }

  if (method === "POST") {
    switch (path) {
      case "/api/alerts/action":
        return alertAction(session, req.body);
      case "/api/alerts/ignore":
        return alertStateChange(session, req.body, ignoreAlert);
      case "/api/alerts/acknowledge":
        return alertStateChange(session, req.body, acknowledgeAlert);
      case "/api/alerts/unacknowledge":
        return alertStateChange(session, req.body, unacknowledgeAlert);
      case "/api/chapter/adopt":
        return chapterAdopt(session, req.body);
      case "/api/chapter/discard":
        return chapterDiscard(session, req.body);
      default:
        return missing(`未知端点 ${path}`);
    }
  }

  return { status: 405, body: { error: `不支持 ${method}` } };
}

// ── 只读端点 ────────────────────────────────────────────────────────────

/** 首页：作品元信息 + 三条告警 + 进度。一次请求给完，避免首屏串行等待。 */
function overview(session: ProjectSession): unknown {
  const { setting, profile, currentChapter, nextChapter, chapterCount } = session.meta;
  const { selection, projections } = session.derived;

  return {
    title: setting.title,
    genre: profile.genre,
    platform: profile.platform,
    targetWords: profile.targetWords,
    currentChapter,
    nextChapter,
    chapterCount,
    nextBeat: session.nextBeat ?? null,
    homepage: selection.homepage,
    counts: {
      fullList: selection.fullList.length,
      repairQueue: selection.repairQueue.length,
      // 打开项目时最想知道的三个数（§12.6.7 的界面草图里就是这几项）。
      openForeshadows: projections.foreshadows.filter((f) => f.status === "open").length,
      overdueForeshadows: projections.foreshadows.filter(
        (f) => f.status === "open" && (f.overdueBy as number) > 0,
      ).length,
      brokenPlotLines: projections.plotLines.filter(
        (p) => p.lastAdvancedAt > 0 && (p.currentGap as number) > (p.gapLimit as number),
      ).length,
    },
  };
}

/** 筹备面板（Stage 2·切片 2）：缺项 + 已建资料的只读摘要。写入只经对话工具。 */
function prep(session: ProjectSession): unknown {
  const info = session.agentContextInfo();
  const { setting, discipline, settings, profile, characters, plotLines } = session.meta;
  return {
    gaps: prepGaps(info),
    nextChapter: info.nextChapter,
    nextPlanReady: info.nextPlanReady,
    setting,
    targetWords: profile.targetWords,
    discipline,
    characters: characters.map((c) => ({ id: c.id, name: c.name, tier: c.tier, role: c.profile.role })),
    locations: settings.map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
    plotLines,
  };
}

function alerts(session: ProjectSession): unknown {
  const { selection } = session.derived;
  return {
    homepage: selection.homepage,
    fullList: selection.fullList,
    repairQueue: selection.repairQueue,
    suppressed: selection.suppressed,
  };
}

function chapterList(session: ProjectSession): unknown {
  return session.chapterNumbers().map((n) => ({
    chapter: n,
    words: session.chapterText(n)?.length ?? 0,
    beat: session.beatFor(n)?.plan.coreEvent ?? null,
  }));
}

function chapter(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  if (n === null) return bad("缺少参数 n");
  const text = session.chapterText(n);
  if (text === undefined) return missing(`第 ${n} 章还没有正文`);
  return ok({ chapter: n, text, beat: session.beatFor(n) ?? null });
}

/**
 * 单章体检：V2 节拍校验 + C6 章内 + C6 跨章。
 *
 * 三者放一个端点是因为界面上它们是同一个面板 —— 但注意 C6 章内与首页告警
 * **是两套东西**（§12.6.1），这里给的是"这一章交稿前该清的债"。
 */
function health(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  if (n === null) return bad("缺少参数 n");

  const beat = session.beatFor(n);
  if (beat === undefined) return missing(`第 ${n} 章没有节拍表`);

  const text = session.chapterText(n);
  const { projections } = session.derived;

  const crossChapter = gateCrossChapter(
    {
      currentChapter: n,
      foreshadows: projections.foreshadows,
      plotLines: projections.plotLines,
      arcs: projections.arcs,
    },
    session.rules,
  );

  if (text === undefined) {
    // 还没写正文时只能给规划期的结论。
    return ok({
      chapter: n,
      plan: validatePlan(beat.plan, session.rules),
      chapterGate: null,
      crossChapter,
    });
  }

  const declaredWeights = declaredEventWeights(session, n);
  const gate = gateChapter(
    {
      chapterText: text,
      plan: beat.plan,
      budget: beat.budget ?? deriveBudget(beat.plan, session.meta.profile, session.rules, { now: beat.updatedAt }),
      profile: session.meta.profile,
      declaredEventWeights: declaredWeights,
    },
    session.rules,
  );

  return ok({
    chapter: n,
    plan: validatePlan(beat.plan, session.rules),
    chapterGate: gate,
    crossChapter,
  });
}

/** 该章 C5 声明的事件权重。密度校验的是写出来的东西，不是计划的。 */
function declaredEventWeights(session: ProjectSession, chapter: ChapterNo): readonly EventWeight[] {
  return session
    .events()
    .filter(
      (e) =>
        e.envelope.chapter === chapter &&
        e.payload.type === "plot_event" &&
        e.envelope.provenance !== "rejected",
    )
    .map((e) => (e.payload as { weight: EventWeight }).weight);
}

/** 点击图上元素 → 拿到定位与上下文。stale 时返回降级信息而非 404。 */
function anchor(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "chapter");
  const quote = query.get("quote");
  if (n === null || quote === null) return bad("缺少参数 chapter / quote");

  const target: TextAnchor = {
    chapter: n,
    quote,
    offsetHint: intParam(query, "offsetHint") ?? 0,
    occurrence: intParam(query, "occurrence") ?? 0,
  };
  const text = session.chapterText(n);
  const resolution = resolveAnchor(target, (c) => session.chapterText(c), session.rules.anchor);

  return ok({
    anchor: target,
    resolution,
    context: text === undefined ? null : anchorContext(text, resolution, CONTEXT_WINDOW),
  });
}

// ── 写端点 ──────────────────────────────────────────────────────────────

/**
 * 一键动作（§12.6.7 的闭环）。
 *
 * 三类动作分别落到三处：改节拍表（+V3 重算预算）、追加事件流、改告警状态。
 * 全部做完后**立刻重算**，响应里带上新的首页三条 —— 前端不需要再发一次
 * GET 才知道那条告警消失了。
 */
function alertAction(session: ProjectSession, body: unknown): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const id = body["alertId"];
  const action = body["action"];
  if (typeof id !== "string") return bad("缺少 alertId");
  if (!isRecord(action) || typeof action["kind"] !== "string") return bad("缺少 action.kind");

  const alert = session.derived.candidates.find((c) => c.alert.id === id)?.alert;
  if (alert === undefined) return missing(`告警 ${id} 不在当前候选里`);

  const typed = action as unknown as AlertAction;
  const now = new Date().toISOString();

  switch (typed.kind) {
    case "add_resolution_to_beat":
    case "add_advance_to_beat":
    case "add_character_to_beat": {
      const beat = session.beatFor(typed.targetChapter);
      if (beat === undefined) return missing(`第 ${typed.targetChapter} 章还没有节拍表，先排章`);
      const applied = applyActionToBeat(
        { beat, action: typed, profile: session.meta.profile, now },
        session.rules,
      );
      if (applied.changed) session.putBeat(applied.beat);
      return ok({
        changed: applied.changed,
        promotedToPayoff: applied.promotedToPayoff,
        beat: applied.beat,
        ...refreshed(session),
      });
    }

    case "reschedule": {
      session.appendEvents([
        {
          chapter: session.currentChapter,
          origin: "user_edit",
          provenance: "authored",
          payload: {
            type: "foreshadow_rescheduled",
            foreshadowId: typed.foreshadowId,
            expectedBy: typed.expectedBy,
          },
        },
      ]);
      return ok({ changed: true, ...refreshed(session) });
    }

    case "abandon": {
      session.appendEvents([
        {
          chapter: session.currentChapter,
          origin: "user_edit",
          provenance: "authored",
          payload: {
            type: "foreshadow_abandoned",
            foreshadowId: typed.foreshadowId,
            reason: typeof body["reason"] === "string" ? body["reason"] : "用户在首页告警里废弃",
          },
        },
      ]);
      return ok({ changed: true, ...refreshed(session) });
    }

    case "confirm_exit": {
      // 确认退场落成人物状态变更而不是新事件类型：`vital: missing` 已经能
      // 表达"不再出场"，而 projectCharacterState 会把它投影进人物卡。
      session.appendEvents([
        {
          chapter: session.currentChapter,
          origin: "user_edit",
          provenance: "authored",
          payload: {
            type: "character_state_changed",
            characterId: typed.characterId,
            field: "vital",
            from: "alive",
            to: "missing",
            anchor: { chapter: session.currentChapter, quote: "", offsetHint: 0, occurrence: 0 },
          },
        },
      ]);
      // 同时静音，否则 characterAbsent 还会继续报（missing 不参与 arc 的判定）。
      session.putAlertState(acknowledgeAlert(stateOf(session, id, now)));
      return ok({ changed: true, ...refreshed(session) });
    }

    case "acknowledge": {
      session.putAlertState(acknowledgeAlert(stateOf(session, id, now)));
      return ok({ changed: true, ...refreshed(session) });
    }

    // 纯前端导航，服务端无副作用。
    case "open_view":
    case "jump_to_anchor":
      return ok({ changed: false, ...refreshed(session) });

    default:
      return bad(`不支持的动作 ${String(action["kind"])}`);
  }
}

function alertStateChange(
  session: ProjectSession,
  body: unknown,
  fn: (s: AlertState) => AlertState,
): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const id = body["alertId"];
  if (typeof id !== "string") return bad("缺少 alertId");

  session.putAlertState(fn(stateOf(session, id, new Date().toISOString())));
  return ok({ changed: true, ...refreshed(session) });
}

function stateOf(session: ProjectSession, id: string, now: string): AlertState {
  return session.alertState(id as AlertId) ?? initialAlertState(id as AlertId, now);
}

/** 写操作后的新首页。带上它省掉前端一次往返。 */
function refreshed(session: ProjectSession): { readonly alerts: unknown } {
  session.syncAlertStates();
  const { selection } = session.derived;
  return {
    alerts: {
      homepage: selection.homepage,
      counts: { fullList: selection.fullList.length, repairQueue: selection.repairQueue.length },
    },
  };
}

// ── 章节草稿端点（Stage 1）─────────────────────────────────────────────

/** 草稿的对外视图：剔除内部 C4 会话快照（体积大且属实现细节）。 */
function toDraftView(d: ChapterDraft): unknown {
  const { session: _session, writeContext: _writeContext, ...view } = d;
  return view;
}

async function chapterWrite(session: ProjectSession, body: unknown): Promise<ApiResponse> {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const chapter = body["chapter"];
  if (typeof chapter !== "number") return bad("缺少有效的 chapter");
  const draftId = body["draftId"];
  const newDraft = body["newDraft"];
  const maxOutputTokens = body["maxOutputTokens"];
  if (draftId !== undefined && typeof draftId !== "string") return bad("draftId 必须是字符串");
  if (newDraft !== undefined && typeof newDraft !== "boolean") return bad("newDraft 必须是布尔值");
  if (maxOutputTokens !== undefined && typeof maxOutputTokens !== "number") return bad("maxOutputTokens 必须是正整数");
  const options: ChapterWriteOptions = {
    chapter,
    ...(draftId === undefined ? {} : { draftId }),
    ...(newDraft === undefined ? {} : { newDraft }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
  };
  try {
    return ok(toDraftView(await session.writeChapter(options)));
  } catch (error) {
    if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

/**
 * 对话式主 Agent 的一轮消息（Stage 2·切片 1）。放在 handleAsync：它 await 模型，
 * 可能内含一次写章。未配置模型时 converse 抛 ChapterWriteError(503)。
 */
async function conversationSend(session: ProjectSession, body: unknown): Promise<ApiResponse> {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const text = body["text"];
  if (typeof text !== "string" || text.trim() === "") return bad("缺少 text");
  try {
    return ok(await session.converse(text));
  } catch (error) {
    if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

function chapterDrafts(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  if (n === null) return bad("缺少参数 n");
  return ok(session.listDrafts(n).map(toDraftView));
}

function chapterDraft(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  const id = query.get("id");
  if (n === null || id === null) return bad("缺少参数 n / id");
  const d = session.getDraft(n, id);
  return d === undefined ? missing(`草稿不存在：ch${n}/${id}`) : ok(toDraftView(d));
}

/**
 * 一份草稿第 rev 次自动修订的前后对比（rev 从 1 起，缺省取最后一次）。
 * "后"是下一次修订前的快照，最后一次的"后"就是草稿当前正文。
 */
function chapterDiff(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  const id = query.get("id");
  if (n === null || id === null) return bad("缺少参数 n / id");
  const d = session.getDraft(n, id);
  if (d === undefined) return missing(`草稿不存在：ch${n}/${id}`);
  const total = d.revisions.length;
  if (total === 0) return missing(`草稿 ${id} 未经修订，没有可对比的版本`);
  const rev = query.has("rev") ? intParam(query, "rev") : total;
  const before = rev === null ? undefined : d.revisions[rev - 1];
  if (before === undefined) return bad(`rev 必须在 1 到 ${total} 之间`);
  const after = d.revisions[rev as number]?.body ?? d.body;
  return ok({
    draftId: d.draftId,
    chapter: d.chapter,
    revision: rev,
    total,
    reason: before.reason,
    at: before.at,
    beforeWords: countWords(before.body),
    afterWords: countWords(after),
    ...diffDraft(before.body, after),
  });
}

/** 采用一份草稿。未就绪会抛，归 400（附可读原因）。成功后带上刷新的首页。 */
function chapterAdopt(session: ProjectSession, body: unknown): ApiResponse {
  const ref = draftRef(body);
  if (typeof ref === "string") return bad(ref);
  try {
    const result = session.adopt(ref.chapter, ref.draftId);
    return ok({ result, ...refreshed(session) });
  } catch (e) {
    return bad((e as Error).message);
  }
}

function chapterDiscard(session: ProjectSession, body: unknown): ApiResponse {
  const ref = draftRef(body);
  if (typeof ref === "string") return bad(ref);
  try {
    return session.discardDraft(ref.chapter, ref.draftId)
      ? ok({ changed: true })
      : missing(`草稿不存在：ch${ref.chapter}/${ref.draftId}`);
  } catch (error) {
    if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

/** 解析 {chapter, draftId}，失败返回错误消息字符串。 */
function draftRef(body: unknown): { chapter: ChapterNo; draftId: string } | string {
  if (!isRecord(body)) return "请求体必须是对象";
  const chapter = body["chapter"];
  const draftId = body["draftId"];
  if (typeof chapter !== "number") return "缺少 chapter";
  if (typeof draftId !== "string") return "缺少 draftId";
  return { chapter, draftId };
}

// ── 作品端点（Stage 2·切片 2）──────────────────────────────────────────

/** 新建作品并自动激活。返回新 id + 最新列表/活动，省前端一次往返。 */
function worksCreate(workspace: Workspace, body: unknown): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const { title, genre, platform, targetWords } = body;
  if (typeof title !== "string" || title.trim() === "") return bad("缺少 title");
  if (!isGenre(genre)) return bad("genre 非法");
  if (!isPlatform(platform)) return bad("platform 非法");
  if (targetWords !== undefined && (typeof targetWords !== "number" || !Number.isFinite(targetWords) || targetWords <= 0)) {
    return bad("targetWords 必须是正数");
  }
  try {
    const id = workspace.create({
      title,
      genre,
      platform,
      ...(targetWords === undefined ? {} : { targetWords }),
    });
    return ok({ id, ...workspace.list() });
  } catch (e) {
    return bad((e as Error).message);
  }
}

function worksSelect(workspace: Workspace, body: unknown): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const id = body["id"];
  if (typeof id !== "string") return bad("缺少 id");
  try {
    workspace.select(id);
    return ok(workspace.list());
  } catch (e) {
    return missing((e as Error).message);
  }
}

// ── 小工具 ──────────────────────────────────────────────────────────────

function intParam(query: URLSearchParams, key: string): number | null {
  const raw = query.get(key);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isInteger(n) ? n : null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
