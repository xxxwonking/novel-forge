import type { ChapterNo, CharacterId } from "./primitives.js";

/**
 * 代码扫正文得出的出场记录：这个人的名字或别名在哪几章里出现过。
 *
 * 与写章时声明的出场是同一个载荷、同一张视图，区别只在可信度 —— 扫描能确认的
 * 仅仅是「这一章提到了他」，所以一律记 `mentioned`；写章时读懂正文才给得出的
 * `pov`/`major` 比它重，扫描只补缺口，不覆盖。
 */
export interface PresenceScan {
  readonly characterId: CharacterId;
  readonly chapters: readonly ChapterNo[];
}
