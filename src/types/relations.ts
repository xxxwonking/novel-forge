import type { ChapterNo, CharacterId } from "./primitives.js";
import type { ForeshadowWeight, RelationKind } from "./events.js";

/**
 * 一条**声明的关系**：来自作者提供的资料（角色档案里的关系表），而不是正文。
 *
 * 与正文里的 `relation_changed` 是同一个投影源的两种形态 —— 区别只在有没有
 * 正文出处。所以它落进事件流时用的是同一个载荷、同一个投影，只是 `anchor` 缺席。
 */
export interface RelationClaim {
  readonly from: CharacterId;
  readonly to: CharacterId;
  readonly fromKind?: RelationKind | null;
  readonly toKind: RelationKind;
  readonly note: string;
}

/**
 * 声明的关系落在哪一章：没有。
 *
 * 章号在事件信封里是必填的，而这类关系不属于任何一章。用 0 而不是 `1` 或者
 * 「最近一章」：前者一眼看得出不是真章号，后者会把它伪装成「那一章发生的事」。
 * 界面对 `declared` 的边不显示章号，所以这个值不会露给作者。
 */
export const NOT_IN_PROSE = 0 as ChapterNo;

/**
 * 一条**规划的伏笔**：模型从作者的资料（大纲、简介）里读出来的安排，而不是正文。
 *
 * 与 `RelationClaim` 是同一种东西的两个例子 —— 都来自资料、都没有正文出处，
 * 落进事件流时共用正文那边的载荷与投影，只是锚点缺席（`quote` 为空）。
 * 所以它同样落在 `NOT_IN_PROSE`，时间线上画虚线，等正文写到那里再变实线。
 *
 * 不带 `id`：编号一律由 `foreshadowAllocator` 分配（§primitives「禁止模型生成随机 ID」）。
 */
export interface ForeshadowClaim {
  readonly label: string;
  readonly intent: string;
  readonly weight: ForeshadowWeight;
  readonly expectedBy: ChapterNo;
}
