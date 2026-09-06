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
