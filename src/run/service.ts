/**
 * 连续创作：作者授权「连写到第 M 章」后，逐章写、逐章采用，遇到该由作者拍板的事就停。
 *
 * 这是「逐章采用」原则下唯一允许的例外，所以边界写得很死：
 *   - 自动采用只发生在 **检查通过 + 没有关键变化** 时。关键变化由代码判定（见 `keyChanges`），
 *     命中任一项就停在这一章，把它留给作者用结果页确认 —— 与「关键变化打包确认、
 *     普通事件不逐条点」的既定决策同构。
 *   - 每章仍是一次完整的章节任务（复用 `ChapterWriter.write`），不另起图、不并行。
 *     第 N 章的上下文里必须有第 N-1 章的正文，串行是正确性要求，不是省事。
 *   - 停下只在章与章之间生效：当前章跑完、结果保留，作者点了停就不开下一章。
 *
 * 运行状态落 `continuous-run.json`：重启后能看到停在哪、为什么。进程里没有活动循环
 * 而文件还说 running，就是被杀了 —— 报 interrupted，不假装还在跑。
 */

import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import { draftRevisionToken } from "../task/revision.js";
import type { ChapterDraft } from "../task/types.js";
import type { ChapterNo } from "../types/primitives.js";

const FILE = "continuous-run.json";

export type RunStopReason =
  /** 关键变化：人物生死、关系、主线伏笔、新人物/设定建议。 */
  | "key_change"
  | "needs_revision"
  /** 任务没交出可用结果：模型报错、被拒、输出不完整。草稿上区分不了被拒与报错，detail 里说。 */
  | "failed"
  /** 前置条件不满足：缺节拍、依据过期、模型未配置。 */
  | "blocked"
  | "author"
  | "interrupted";

export interface RunStop {
  readonly chapter: ChapterNo;
  readonly reason: RunStopReason;
  readonly detail: string;
  readonly draftId: string | null;
}

interface RunState {
  readonly status: "idle" | "running" | "stopped";
  readonly through: ChapterNo | null;
  readonly startedAt: string | null;
  readonly updatedAt: string;
  readonly adopted: readonly ChapterNo[];
  readonly stopped: RunStop | null;
}

export interface RunView extends RunState {
  readonly current: ChapterNo | null;
  readonly stopRequested: boolean;
  readonly nextChapter: ChapterNo;
  /** 本次能授权到的最远章号（规则上限）。 */
  readonly maxThrough: ChapterNo;
}

export interface RunDeps {
  readonly nextChapter: () => ChapterNo;
  readonly maxBatchChapters: number;
  /** 有稿件在跑、模型没配置时抛 ChapterWriteError。 */
  readonly assertCanStart: () => void;
  readonly writeChapter: (chapter: ChapterNo, requestId: string) => Promise<ChapterDraft>;
  readonly adopt: (chapter: ChapterNo, draft: ChapterDraft) => void;
}

const IDLE: RunState = { status: "idle", through: null, startedAt: null, updatedAt: "", adopted: [], stopped: null };

/**
 * 这一章有没有作者必须亲自看的变化。
 *
 * 判据全是结构声明里的硬字段，不读正文、不问模型：生死状态、关系变化、主线伏笔的埋设、
 * 写作中提出的人物/设定建议。普通事件与状态变化不算 —— 逐条点作者会关掉整个功能。
 */
export function keyChanges(draft: ChapterDraft): readonly string[] {
  const d = draft.declaration;
  if (d === null) return [];
  return [
    ...d.characterStates.filter((s) => s.field === "vital").map((s) => `人物 ${s.characterId} 的生死状态变化：${s.from ?? "未记录"} → ${s.to}`),
    ...d.relationsChanged.map((r) => `关系变化：${r.from} → ${r.to}（${r.toKind}）`),
    ...d.foreshadowPlanted.filter((f) => f.weight === "main").map((f) => `埋下主线伏笔「${f.label}」`),
    ...draft.proposals.map((p) => p.kind === "foreshadow" ? `写作中提出的伏笔建议「${p.label}」` : `写作中提出的人物建议：${p.name} 的 ${p.field}`),
  ];
}

export class ContinuousRunService {
  private active: { readonly promise: Promise<void>; stopRequested: boolean; current: ChapterNo | null } | null = null;

  constructor(private readonly root: string, private readonly deps: RunDeps) {}

  view(): RunView {
    const state = this.load();
    const next = this.deps.nextChapter();
    const base = { current: this.active?.current ?? null, stopRequested: this.active?.stopRequested ?? false, nextChapter: next, maxThrough: next + this.deps.maxBatchChapters - 1 };
    // 文件说在跑、进程里却没有循环：上次的进程没了。
    if (state.status === "running" && this.active === null) {
      return { ...state, ...base, status: "stopped", stopped: { chapter: next, reason: "interrupted", detail: "上次连写被中断（服务重启或异常退出），已写出的草稿仍保留。", draftId: null } };
    }
    return { ...state, ...base };
  }

  start(raw: unknown): RunView {
    const through = parseThrough(raw);
    const next = this.deps.nextChapter();
    if (through < next) throw new ChapterWriteError(400, `连写的目标章号至少是下一章（第 ${next} 章）`);
    if (through > next + this.deps.maxBatchChapters - 1) throw new ChapterWriteError(400, `一次最多连写 ${this.deps.maxBatchChapters} 章，目标章号不能超过第 ${next + this.deps.maxBatchChapters - 1} 章`);
    if (this.active !== null) throw new ChapterWriteError(409, "连写正在进行，请先停下再重新授权");
    this.deps.assertCanStart();

    const now = new Date().toISOString();
    this.save({ status: "running", through, startedAt: now, updatedAt: now, adopted: [], stopped: null });
    const handle = { promise: Promise.resolve(), stopRequested: false, current: null as ChapterNo | null };
    this.active = handle;
    handle.promise = this.loop(through, now).finally(() => { if (this.active === handle) this.active = null; });
    void handle.promise.catch(() => undefined);
    return this.view();
  }

  /** 章与章之间生效；当前章照常跑完并按规则处理。 */
  stop(): RunView {
    if (this.active !== null) this.active.stopRequested = true;
    return this.view();
  }

  /** 作者看过停下的原因：回到空闲。运行中不能清。 */
  acknowledge(): RunView {
    if (this.active !== null) throw new ChapterWriteError(409, "连写正在进行");
    this.save({ ...IDLE, updatedAt: new Date().toISOString() });
    return this.view();
  }

  private async loop(through: ChapterNo, startedAt: string): Promise<void> {
    const handle = this.active!;
    for (let chapter = this.deps.nextChapter(); chapter <= through; chapter = this.deps.nextChapter()) {
      if (handle.stopRequested) return this.finish({ chapter, reason: "author", detail: "作者停下了连写；已写出的章节已采用，这一章没有开始。", draftId: null });
      handle.current = chapter;
      let draft: ChapterDraft;
      try {
        // requestId 只许字母数字：一次授权内每章一个，重启后同一授权不会重复起稿。
        draft = await this.deps.writeChapter(chapter, `run-${startedAt.replace(/\D/gu, "")}-${chapter}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return this.finish({ chapter, reason: "blocked", detail: message, draftId: null });
      }
      const stop = this.judge(draft);
      if (stop !== null) return this.finish(stop);
      try {
        this.deps.adopt(chapter, draft);
      } catch (error) {
        return this.finish({ chapter, reason: "blocked", detail: `采用失败：${error instanceof Error ? error.message : String(error)}`, draftId: draft.draftId });
      }
      const state = this.load();
      this.save({ ...state, adopted: [...state.adopted, chapter], updatedAt: new Date().toISOString() });
    }
    this.save({ ...this.load(), status: "idle", updatedAt: new Date().toISOString() });
  }

  /** 这一章能不能自动采用；不能就说清为什么停。 */
  private judge(draft: ChapterDraft): RunStop | null {
    const { chapter, draftId } = draft;
    if (draft.status === "adopted") return null;
    if (draft.status === "ready" && draft.acceptable) {
      const changes = keyChanges(draft);
      return changes.length === 0 ? null : { chapter, reason: "key_change", detail: `这一章有需要你亲自确认的变化：${changes.join("；")}`, draftId };
    }
    const detail = draft.error?.detail ?? draft.findings.filter((f) => f.level === "block").map((f) => f.message).join("；");
    if (draft.status === "needs_revision") return { chapter, reason: "needs_revision", detail: detail || "检查发现必须处理的问题", draftId };
    if (draft.status === "stale") return { chapter, reason: "blocked", detail: "作品资料或已采用版本发生变化，草稿需要重新核对", draftId };
    return { chapter, reason: "failed", detail: detail || `任务停在 ${draft.status}`, draftId };
  }

  private finish(stop: RunStop): void {
    this.save({ ...this.load(), status: "stopped", stopped: stop, updatedAt: new Date().toISOString() });
  }

  private load(): RunState {
    const text = readProjectFile(this.root, FILE);
    if (text === undefined) return IDLE;
    try {
      const raw = JSON.parse(text) as Partial<RunState> | null;
      if (raw === null || !["idle", "running", "stopped"].includes(raw.status as string) || !Array.isArray(raw.adopted)) throw new Error("结构无效");
      return { ...IDLE, ...raw } as RunState;
    } catch (error) {
      throw new Error(`${FILE} 读取失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  private save(state: RunState): void {
    writeProjectFile(this.root, FILE, `${JSON.stringify(state, null, 2)}\n`);
  }
}

/** 采用要带当前版本令牌 —— 与作者手点采用走同一条校验。 */
export const adoptionToken = (draft: ChapterDraft): string => draftRevisionToken(draft);

function parseThrough(raw: unknown): ChapterNo {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) throw new ChapterWriteError(400, "请求体必须是对象");
  const through = (raw as Record<string, unknown>)["through"];
  if (!Number.isSafeInteger(through) || (through as number) < 1) throw new ChapterWriteError(400, "through 必须是正整数章号");
  return through as ChapterNo;
}
