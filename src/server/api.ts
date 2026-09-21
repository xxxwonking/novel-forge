/**
 * JSON API 的路由与处理。**与 http 传输层分开**（http.ts 负责收发），
 * 这样端点逻辑可以直接在测试里调用，不必起一个真实端口。
 *
 * ⚠ 没有任何鉴权。它绑 127.0.0.1、只供本机开发用。要对外暴露必须先加登录 ——
 * 这些端点能读写用户的全部创作资产。
 */

import { ProjectSession } from "./state.js";
import { acknowledgeAlert, ignoreAlert, initialAlertState, unacknowledgeAlert } from "../alerts/apply.js";
import { anchorContext, resolveAnchor } from "../anchor/resolve.js";
import { searchWork } from "../search/service.js";
import { gateChapter } from "../gate/code-channel.js";
import { gateCrossChapter } from "../gate/cross-chapter.js";
import { validatePlan } from "../beat/validate.js";
import { deriveBudget } from "../beat/derive.js";
import type { AlertAction, AlertState } from "../types/projections.js";
import type { AlertId, ChapterNo, TextAnchor } from "../types/primitives.js";
import type { EventWeight } from "../types/events.js";
import { ChapterWriteError } from "./chapter-input.js";
import type { ChapterWriteOptions } from "./chapter-writer.js";
import { countWords } from "../text/measure.js";
import { toDraftView } from "./draft-view.js";
import type { StructureCorrection } from "../chapter/c5-correction.js";
import type { DraftRewriteOptions } from "./draft-rewrite.js";
import type { DraftAdoptOptions } from "../task/types.js";
import type { ConversationStreamEvent } from "../agent/types.js";

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

/** HTTP 的统一入口：写章等待异步任务，其余端点沿用同步处理。 */
export async function handleAsync(session: ProjectSession, req: ApiRequest): Promise<ApiResponse> {
  if (req.method === "POST" && (req.path === "/api/chapter/write" || req.path === "/api/chapter/start")) {
    return chapterWrite(session, req.body, req.path === "/api/chapter/start");
  }
  if (req.method === "POST" && req.path === "/api/conversation") {
    return conversationSend(session, req.body);
  }
  // 旧稿反推：逐章读正文补结构。放在 handleAsync —— 它 await 模型。
  if (req.method === "POST" && req.path === "/api/revision/locate") {
    try { return ok(await session.revise.locate(req.body)); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }
  if (req.method === "POST" && req.path === "/api/import/infer") {
    try { return ok(await session.inference.infer(req.body)); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }
  if (req.method === "POST" && req.path === "/api/preparation/draft") {
    return preparationDraft(session, req.body);
  }
  return handle(session, req);
}

export function handle(session: ProjectSession, req: ApiRequest): ApiResponse {
  const { method, path } = req;

  if ((method === "POST" && path === "/api/export/preview") || (method === "GET" && (path === "/api/export" || path === "/api/export/file"))) {
    try { return ok(method === "POST" ? session.exports.prepare(req.body) : path === "/api/export/file" ? session.exports.file(req.query.get("id")) : session.exports.preview(req.query.get("id"))); }
    catch (error) { if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } }; throw error; }
  }

  // 两个 model 审查通道的开关。按作品存，不进来源指纹 —— 改它不作废任何草稿。
  if (path === "/api/review-settings") {
    if (method === "GET") return ok(session.reviewSettings);
    if (method === "POST") {
      if (!isRecord(req.body)) return bad("请求体必须是对象");
      try { return ok(session.setReviewSettings(req.body as never)); }
      catch (error) {
        if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
        throw error;
      }
    }
  }

  // 导入旧作：只入正文，不反推结构。预览与落盘都不调模型，所以走同步入口。
  if (method === "POST" && (path === "/api/import/preview" || path === "/api/import/apply")) {
    try { return ok(path === "/api/import/preview" ? session.imports.preview(req.body) : session.imports.apply(req.body)); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

  // 连写：启动只是登记授权并起后台循环，本身不等模型，留在同步入口。
  if (path === "/api/revision" && method === "GET") return ok(session.revise.view());
  // 清单读坏后的自助恢复。改名留档而不是删除，留档名回给界面说清楚。
  if (path === "/api/revision/rebuild" && method === "POST") {
    try { return ok({ ...session.revise.rebuild(), view: session.revise.view() }); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }
  if (method === "POST" && (path === "/api/revision/preview" || path === "/api/revision/resolve")) {
    try { return ok(path === "/api/revision/preview" ? session.revise.preview(req.body) : session.revise.resolve(req.body)); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }
  if (path === "/api/run" && method === "GET") return ok(session.run.view());
  if (method === "POST" && (path === "/api/run/start" || path === "/api/run/stop" || path === "/api/run/acknowledge")) {
    try { return ok(path.endsWith("start") ? session.run.start(req.body) : path.endsWith("stop") ? session.run.stop() : session.run.acknowledge()); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

  // 反推的进度、确认与丢弃都不调模型，留在同步入口。
  if (path === "/api/import/inference" && method === "GET") return ok(session.inference.view());
  if (method === "POST" && (path === "/api/import/inference/confirm" || path === "/api/import/inference/reject")) {
    try { return ok(path.endsWith("confirm") ? session.inference.confirm(req.body) : session.inference.reject(req.body)); }
    catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

  if (path === "/api/preparation" && method === "GET") return ok({ ...session.preparation.view(), ideas: session.listIdeas() });  if (path.startsWith("/api/preparation/") && method === "POST") {
    try {
      if (path === "/api/preparation/propose") return ok(session.preparation.propose(req.body));
      if (path === "/api/preparation/author") return ok(session.preparation.recordAuthor(req.body));
      if (!isRecord(req.body) || typeof req.body["proposalId"] !== "string") return bad("缺少方案编号 proposalId");
      if (path === "/api/preparation/confirm") return ok(session.preparation.confirm(req.body["proposalId"]));
      if (path === "/api/preparation/reject") return ok(session.preparation.reject(req.body["proposalId"]));
      return missing(`未知端点 ${path}`);
    } catch (error) {
      if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
      throw error;
    }
  }

  if (method === "GET") {
    switch (path) {
      case "/api/overview":
        return ok(overview(session));
      case "/api/tasks":
        return ok(session.chapterTasks());
      case "/api/conversation":
        return ok({ turns: session.conversationTurns(), ideas: session.listIdeas(), mode: session.conversationMode() });
      case "/api/views":
        return ok(session.derived.views);
      case "/api/alerts":
        return ok(alerts(session));
      case "/api/issues":
        return ok(session.storyProgress());
      case "/api/chapters":
        return ok(chapterList(session));
      case "/api/chapter":
        return chapter(session, req.query);
      case "/api/health":
        return health(session, req.query);
      case "/api/anchor":
        return anchor(session, req.query);
      case "/api/search":
        return search(session, req.query);
      case "/api/credits":
        return ok(session.credits());
      case "/api/chapter/drafts":
        return chapterDrafts(session, req.query);
      case "/api/chapter/draft":
        return chapterDraft(session, req.query);
      default:
        return missing(`未知端点 ${path}`);
    }
  }

  if (method === "POST") {
    switch (path) {
      case "/api/alerts/action":
        return alertAction(session, req.body);
      case "/api/planning/action":
        return planningAction(session, req.body);
      case "/api/alerts/ignore":
        return alertStateChange(session, req.body, ignoreAlert);
      case "/api/alerts/acknowledge":
        return alertStateChange(session, req.body, acknowledgeAlert);
      case "/api/alerts/unacknowledge":
        return alertStateChange(session, req.body, unacknowledgeAlert);
      case "/api/chapter/adopt":
        return chapterAdopt(session, req.body);
      case "/api/conversation/mode":
        return conversationMode(session, req.body);
      case "/api/chapter/discard":
        return chapterDiscard(session, req.body);
      case "/api/chapter/restore":
        return chapterRestore(session, req.body);
      case "/api/chapter/edit":
      case "/api/chapter/correct":
      case "/api/chapter/revise":
      case "/api/chapter/check": {
        const ref = draftRef(req.body);
        if (typeof ref === "string") return bad(ref);
        if (!isRecord(req.body) || typeof req.body["revisionToken"] !== "string") return bad("缺少源稿版本凭据 revisionToken");
        const reference = { ...ref, revisionToken: req.body["revisionToken"] };
        try {
          if (path === "/api/chapter/revise") {
            const options = { ...reference, mode: req.body["mode"], instruction: req.body["instruction"], scope: req.body["scope"], requestId: req.body["requestId"] } as DraftRewriteOptions;
            return ok(toDraftView(session.reviseDraft(options), session));
          }
          if (path === "/api/chapter/correct") {
            if (!Array.isArray(req.body["changes"]) || typeof req.body["summary"] !== "string") return bad("缺少纠错记录 changes 或说明 summary");
            const requestId = req.body["requestId"];
            if (requestId !== undefined && typeof requestId !== "string") return bad("requestId 必须是字符串");
            return ok(toDraftView(session.correctDraft({ ...reference, changes: req.body["changes"] as StructureCorrection[], summary: req.body["summary"], ...(requestId === undefined ? {} : { requestId }) }), session));
          }
          if (path === "/api/chapter/check") {
            if (typeof req.body["adoptOnSuccess"] !== "boolean") return bad("adoptOnSuccess 必须是布尔值");
            const selectedProposals = req.body["selectedProposals"] as readonly number[] | undefined;
            return ok(toDraftView(session.checkDraft({ ...reference, adoptOnSuccess: req.body["adoptOnSuccess"], ...(selectedProposals === undefined ? {} : { selectedProposals }) }), session));
          }
          if (typeof req.body["body"] !== "string") return bad("缺少正文 body");
          const summary = req.body["summary"];
          const requestId = req.body["requestId"];
          if (summary !== undefined && typeof summary !== "string") return bad("summary 必须是文字");
          if (requestId !== undefined && typeof requestId !== "string") return bad("requestId 必须是字符串");
          return ok(toDraftView(session.editDraft({ ...reference, body: req.body["body"],
            ...(summary === undefined ? {} : { summary }), ...(requestId === undefined ? {} : { requestId }),
          }), session));
        } catch (error) {
          if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
          throw error;
        }
      }
      case "/api/chapter/control": {
        const ref = draftRef(req.body);
        if (typeof ref === "string") return bad(ref);
        const action = isRecord(req.body) ? req.body["action"] : undefined;
        if (action !== "pause" && action !== "end") return bad("action 必须是 pause 或 end");
        try { return ok(session.controlChapter(ref.chapter, ref.draftId, action)); }
        catch (error) {
          if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
          throw error;
        }
      }
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
  const revision = session.revise.view();

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
      // 改早章之后还没复核的章。放在这里是为了让导航上一眼看得见 —— 它挡着连写。
      revisionPending: revision.pending,
      revisionConflicts: revision.conflicts,
    },
  };
}

function alerts(session: ProjectSession): unknown {
  const { selection } = session.derived;
  return {
    homepage: selection.homepage,
    fullList: selection.fullList,
    repairQueue: selection.repairQueue,
    suppressed: selection.suppressed,
    progress: session.storyProgress(),
  };
}

function chapterList(session: ProjectSession): unknown {
  return session.chapterNumbers().map((n) => ({
    chapter: n,
    words: countWords(session.chapterText(n) ?? ""),
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
        e.envelope.origin !== "P4_outline" &&
        (e.envelope.provenance === "committed" || e.envelope.provenance === "authored"),
    )
    .map((e) => (e.payload as { weight: EventWeight }).weight);
}

/** 点击图上元素 → 拿到定位与上下文。stale 时返回降级信息而非 404。 */
function search(session: ProjectSession, query: URLSearchParams): ApiResponse {
  try { return ok(searchWork(session, query.get("q") ?? "")); }
  catch (error) {
    if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

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
function planningAction(session: ProjectSession, body: unknown): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  try {
    const result = session.planning.apply(body["action"], body["reason"] === undefined ? {} : { reason: body["reason"] as string });
    return ok({ ...result, ...refreshed(session, false) });
  } catch (error) {
    return { status: error instanceof ChapterWriteError ? error.status : 400, body: { error: error instanceof Error ? error.message : String(error) } };
  }
}

function alertAction(session: ProjectSession, body: unknown): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const id = body["alertId"];
  const action = body["action"];
  if (typeof id !== "string") return bad("缺少 alertId");
  if (!isRecord(action) || typeof action["kind"] !== "string") return bad("缺少 action.kind");

  if (["add_resolution_to_beat", "add_advance_to_beat", "add_character_to_beat", "reschedule", "abandon", "confirm_exit"].includes(action["kind"])) {
    try {
      const result = session.planning.apply(action, { alertId: id, ...(body["reason"] === undefined ? {} : { reason: body["reason"] as string }) });
      return ok({ ...result, ...refreshed(session, false) });
    } catch (error) {
      return { status: error instanceof ChapterWriteError ? error.status : 400, body: { error: error instanceof Error ? error.message : String(error) } };
    }
  }

  const alert = session.derived.candidates.find((c) => c.alert.id === id)?.alert;
  if (alert === undefined) return missing(`告警 ${id} 不在当前候选里`);

  const typed = action as unknown as AlertAction;
  const now = new Date().toISOString();

  switch (typed.kind) {
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
function refreshed(session: ProjectSession, sync = true): { readonly alerts: unknown } {
  if (sync) session.syncAlertStates();
  const { selection } = session.derived;
  return {
    alerts: {
      homepage: selection.homepage,
      counts: { fullList: selection.fullList.length, repairQueue: selection.repairQueue.length },
    },
  };
}

// ── 章节草稿端点（Stage 1）─────────────────────────────────────────────

async function chapterWrite(session: ProjectSession, body: unknown, start = false): Promise<ApiResponse> {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const chapter = body["chapter"];
  if (typeof chapter !== "number") return bad("缺少有效的 chapter");
  const draftId = body["draftId"];
  const newDraft = body["newDraft"];
  const maxOutputTokens = body["maxOutputTokens"];
  const proposalId = body["proposalId"];
  const requestId = body["requestId"];
  if (draftId !== undefined && typeof draftId !== "string") return bad("draftId 必须是字符串");
  if (newDraft !== undefined && typeof newDraft !== "boolean") return bad("newDraft 必须是布尔值");
  if (maxOutputTokens !== undefined && typeof maxOutputTokens !== "number") return bad("maxOutputTokens 必须是正整数");
  if (proposalId !== undefined && typeof proposalId !== "string") return bad("proposalId 必须是方案编号");
  if (requestId !== undefined && typeof requestId !== "string") return bad("requestId 必须是字符串");
  const options: ChapterWriteOptions = {
    chapter,
    ...(draftId === undefined ? {} : { draftId }),
    ...(newDraft === undefined ? {} : { newDraft }),
    ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    ...(proposalId === undefined ? {} : { proposalId }),
    ...(requestId === undefined ? {} : { requestId }),
  };
  try {
    return ok(toDraftView(start ? session.startChapter(options) : await session.writeChapter(options), session));
  } catch (error) {
    if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

/**
 * 资料页的「让 AI 起草」。放在 handleAsync：它 await 模型。
 *
 * `apply: false` 是表单里的试填 —— 只把草稿人物交回去，不落任何文件，
 * 所以同一个端点既能产出候选方案，也能只当一次「问 AI 要个草稿」。
 */
async function preparationDraft(session: ProjectSession, body: unknown): Promise<ApiResponse> {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const focus = body["focus"] ?? "characters";
  if (focus !== "characters" && focus !== "full" && focus !== "chapters") return bad("focus 只能是 characters、full 或 chapters");
  const count = body["count"];
  if (count !== undefined && !Number.isSafeInteger(count)) return bad("count 必须是整数");
  const apply = body["apply"] ?? true;
  if (typeof apply !== "boolean") return bad("apply 必须是布尔值");
  const brief = body["brief"];
  if (brief !== undefined && typeof brief !== "string") return bad("brief 必须是字符串");
  try {
    // exactOptionalPropertyTypes：brief 缺省与显式 undefined 不同，缺省时不传这个键。
    return ok(await session.draftPreparation({ focus, apply, ...(brief === undefined ? {} : { brief }), ...(count === undefined ? {} : { count: count as number }) }));
  } catch (error) {
    if (error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    throw error;
  }
}

/** 切换对话模式。纯状态切换，不调模型，所以留在同步 handle 里。 */
function conversationMode(session: ProjectSession, body: unknown): ApiResponse {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const mode = body["mode"];
  if (mode !== "normal" && mode !== "planning") return bad("mode 必须是 normal 或 planning");
  return ok({ mode: session.setConversationMode(mode) });
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

/**
 * 同一轮对话的流式版本：进行中的文本增量与工具进度经 emit 逐条发出，最后是
 * `done`（完整回复）或 `error`。回合在服务端照常保存 —— 观察者断开不影响结果。
 * 在发出任何事件之前失败（参数错误、未配置模型）时返回普通 JSON 响应。
 */
export async function conversationStream(
  session: ProjectSession,
  body: unknown,
  emit: (event: ConversationStreamEvent) => void,
): Promise<ApiResponse | null> {
  if (!isRecord(body)) return bad("请求体必须是对象");
  const text = body["text"];
  if (typeof text !== "string" || text.trim() === "") return bad("缺少 text");
  let started = false;
  try {
    const reply = await session.converse(text, (event) => { started = true; emit(event); });
    emit({ type: "done", reply });
  } catch (error) {
    if (!started && error instanceof ChapterWriteError) return { status: error.status, body: { error: error.message } };
    emit({ type: "error", message: error instanceof Error ? error.message : String(error) });
  }
  return null;
}

function chapterDrafts(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  if (n === null) return bad("缺少参数 n");
  return ok(session.listDrafts(n).map(draft => toDraftView(draft, session)));
}

function chapterDraft(session: ProjectSession, query: URLSearchParams): ApiResponse {
  const n = intParam(query, "n");
  const id = query.get("id");
  if (n === null || id === null) return bad("缺少参数 n / id");
  const d = session.getDraft(n, id);
  return d === undefined ? missing(`草稿不存在：ch${n}/${id}`) : ok(toDraftView(d, session));
}

/** 采用一份草稿。未就绪会抛，归 400（附可读原因）。成功后带上刷新的首页。 */
function chapterAdopt(session: ProjectSession, body: unknown): ApiResponse {
  const ref = draftRef(body);
  if (typeof ref === "string") return bad(ref);
  try {
    const input = body as Record<string, unknown>;
    const options = { ...(input["revisionToken"] === undefined ? {} : { revisionToken: input["revisionToken"] }), ...(input["selectedProposals"] === undefined ? {} : { selectedProposals: input["selectedProposals"] }) } as DraftAdoptOptions;
    const result = session.adopt(ref.chapter, ref.draftId, options);
    return ok({ result, ...refreshed(session) });
  } catch (e) {
    if (e instanceof ChapterWriteError) return { status: e.status, body: { error: e.message } };
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

function chapterRestore(session: ProjectSession, body: unknown): ApiResponse {
  const ref = draftRef(body);
  if (typeof ref === "string") return bad(ref);
  try {
    const restored = session.restoreDraft(ref.chapter, ref.draftId);
    return restored === undefined ? missing(`草稿不存在：ch${ref.chapter}/${ref.draftId}`) : ok(toDraftView(restored, session));
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
