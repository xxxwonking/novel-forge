/**
 * 结构事件流的 append-only 存储与 C8 提交（§12.3 C8、§12.7）。
 *
 * 两条不变量：
 *   ① **append-only** —— 写入后的 payload 不可变。改动只能追加新事件。
 *   ② **seq 由存储层分配** —— 模型和调用方都不能指定，保证重放顺序唯一。
 *
 * §12.0：一切模型产出先进待接受区（proposed），用户接受后才 committed。
 * 投影器只消费 committed + authored 的事件。
 */

import type {
  C5Declaration,
  EventEnvelope,
  EventOrigin,
  StructuralEvent,
  StructuralEventPayload,
} from "../types/events.js";
import type {
  ChapterNo,
  EventSeq,
  IsoTimestamp,
  Provenance,
  StructuralEventId,
} from "../types/primitives.js";

export interface AppendInput {
  readonly chapter: ChapterNo;
  readonly origin: EventOrigin;
  readonly provenance: Extract<Provenance, "authored" | "proposed">;
  readonly payload: StructuralEventPayload;
}

/** 时钟注入 —— 测试要能拿到确定的时间戳。 */
export type Clock = () => IsoTimestamp;

export const systemClock: Clock = () => new Date().toISOString();

/**
 * 内存事件流。M1 用它跑通流程，持久化在 M2 接入（接口不变）。
 *
 * 刻意不做成通用仓储 —— §8.3 抽象做薄。真需要换存储时再抽，
 * 那时已经知道要抽什么。
 */
export class EventStream {
  private readonly events: StructuralEvent[] = [];
  private nextSeq: EventSeq = 1;
  /** 每章内的序号，用于生成人类可读的 `ch47-2` 式 ID。 */
  private readonly chapterCounters = new Map<ChapterNo, number>();

  constructor(private readonly clock: Clock = systemClock) {}

  /**
   * 从落盘的事件重建流（M3 持久化）。
   *
   * 关键是把 `nextSeq` 与每章的计数器一起续上 —— 只恢复数组会让下一次
   * append 从 seq=1 开始，重放顺序被破坏，而这是投影正确性的唯一依赖。
   *
   * 不做校验（seq 连续性、id 唯一性）：坏数据在 persist 层解析 JSONL 时就该
   * 拦下，在这里再查一遍等于把同一逻辑放两处。
   */
  static restore(events: readonly StructuralEvent[], clock: Clock = systemClock): EventStream {
    const stream = new EventStream(clock);
    for (const e of events) {
      stream.events.push(e);
      if (e.envelope.seq >= stream.nextSeq) stream.nextSeq = e.envelope.seq + 1;
      const prior = stream.chapterCounters.get(e.envelope.chapter) ?? 0;
      // 章内序号从 id 的后缀取不可靠（用户可能手改过 JSONL），按条数计。
      stream.chapterCounters.set(e.envelope.chapter, prior + 1);
    }
    return stream;
  }

  append(input: AppendInput): StructuralEvent {
    const n = (this.chapterCounters.get(input.chapter) ?? 0) + 1;
    this.chapterCounters.set(input.chapter, n);

    const envelope: EventEnvelope = {
      id: `ch${input.chapter}-${n}` satisfies StructuralEventId,
      seq: this.nextSeq,
      chapter: input.chapter,
      origin: input.origin,
      provenance: input.provenance,
      createdAt: this.clock(),
    };
    this.nextSeq += 1;

    const event: StructuralEvent = { envelope, payload: input.payload };
    this.events.push(event);
    return event;
  }

  /**
   * 裁决一条 proposed 事件。
   *
   * 不修改 payload，只换信封 —— payload 的不可变性是 append-only 的核心，
   * 而 provenance 属于"这条声明怎么来的"，本就在信封里（见 events.ts 的
   * 信封/载荷划分理由）。
   */
  decide(
    id: StructuralEventId,
    decision: Extract<Provenance, "committed" | "rejected">,
    reviewNote?: string,
  ): StructuralEvent | null {
    const idx = this.events.findIndex((e) => e.envelope.id === id);
    if (idx < 0) return null;
    const prev = this.events[idx];
    if (prev === undefined) return null;
    if (prev.envelope.provenance !== "proposed") return prev;

    const updated: StructuralEvent = {
      envelope: {
        ...prev.envelope,
        provenance: decision,
        decidedAt: this.clock(),
        ...(reviewNote === undefined ? {} : { reviewNote }),
      },
      payload: prev.payload,
    };
    this.events[idx] = updated;
    return updated;
  }

  /** 批量裁决一章的全部 proposed 事件 —— C8 的常规路径（用户接受整章）。 */
  decideChapter(
    chapter: ChapterNo,
    decision: Extract<Provenance, "committed" | "rejected">,
  ): readonly StructuralEvent[] {
    const ids = this.events
      .filter((e) => e.envelope.chapter === chapter && e.envelope.provenance === "proposed")
      .map((e) => e.envelope.id);
    const out: StructuralEvent[] = [];
    for (const id of ids) {
      const r = this.decide(id, decision);
      if (r !== null) out.push(r);
    }
    return out;
  }

  /**
   * 作废一章已提交的 C5 声明事件（committed → rejected）—— 修订已采用章时用。
   *
   * 只翻结构声明（`C5_declaration` 与旧稿反推的 `import_inference`）：`user_edit`
   * （改期/废弃/确认退场）和 `P4_outline`（作者规划）是独立的用户决定，不随章节
   * 重写而作废。旧稿反推必须一起翻 —— 否则重写一章旧稿后，反推出的旧事实与新稿
   * 的事实会并存在同一章上。翻成 rejected 后
   * `effective()` 自动过滤，新稿的 committed 事件即取代旧事实，无需改投影器。
   */
  supersedeChapter(chapter: ChapterNo): number {
    let n = 0;
    for (let i = 0; i < this.events.length; i += 1) {
      const e = this.events[i];
      if (e === undefined) continue;
      if (
        e.envelope.chapter === chapter &&
        e.envelope.provenance === "committed" &&
        (e.envelope.origin === "C5_declaration" || e.envelope.origin === "import_inference")
      ) {
        this.events[i] = {
          envelope: {
            ...e.envelope,
            provenance: "rejected",
            decidedAt: this.clock(),
            reviewNote: "章节修订，旧结构事实作废",
          },
          payload: e.payload,
        };
        n += 1;
      }
    }
    return n;
  }

  /** 全部事件，按 seq 有序。 */
  all(): readonly StructuralEvent[] {
    return this.events;
  }

  /** 投影器的输入：只有 committed 和 authored 参与投影（§12.0）。 */
  effective(): readonly StructuralEvent[] {
    return this.events.filter(
      (e) => e.envelope.provenance === "committed" || e.envelope.provenance === "authored",
    );
  }

  pending(chapter?: ChapterNo): readonly StructuralEvent[] {
    return this.events.filter(
      (e) =>
        e.envelope.provenance === "proposed" &&
        (chapter === undefined || e.envelope.chapter === chapter),
    );
  }

  byChapter(chapter: ChapterNo): readonly StructuralEvent[] {
    return this.events.filter((e) => e.envelope.chapter === chapter);
  }
}

/**
 * 把 C5 声明展开为事件流条目（C8 的第一步）。
 *
 * 顺序固定：事件 → 埋伏笔 → 收伏笔 → 关系 → 状态 → 出场。
 * 固定顺序让 `ch47-2` 这类 ID 可预测，也让重放结果确定。
 *
 * 注意这里**不产生 plot_advance** —— 它由投影器从 events 的 plotLine 派生
 * （§11.6：能派生的绝不让模型填）。
 */
export function commitDeclaration(
  stream: EventStream,
  chapter: ChapterNo,
  declaration: C5Declaration,
  origin: EventOrigin = "C5_declaration",
): readonly StructuralEvent[] {
  const payloads: StructuralEventPayload[] = [
    ...declaration.events,
    ...declaration.foreshadowPlanted,
    ...declaration.foreshadowResolved,
    ...declaration.relationsChanged,
    ...declaration.characterStates,
    ...declaration.characterPresence,
  ];
  return payloads.map((payload) =>
    stream.append({ chapter, origin, provenance: "proposed", payload }),
  );
}

/**
 * `commitDeclaration` 的逆向：把一批事件还原成一份声明。
 *
 * 两处要用它 —— 旧稿反推把待确认事件回显给作者看，跨章返修拿「改动前的那一份」
 * 去比差异。逆向是安全的：`commitDeclaration` 只是把六个数组摊平，没有丢字段。
 * `plot_advance` 由投影器派生、不属于声明，这里自然也不会捡回来。
 */
export function declarationOf(events: readonly StructuralEvent[]): C5Declaration {
  const of = <T extends C5Declaration[keyof C5Declaration][number]["type"]>(type: T): Extract<StructuralEventPayload, { type: T }>[] =>
    events.flatMap((e) => e.payload.type === type ? [e.payload as Extract<StructuralEventPayload, { type: T }>] : []);
  return {
    events: of("plot_event"),
    foreshadowPlanted: of("foreshadow_planted"),
    foreshadowResolved: of("foreshadow_resolved"),
    relationsChanged: of("relation_changed"),
    characterStates: of("character_state_changed"),
    characterPresence: of("character_presence"),
  };
}
