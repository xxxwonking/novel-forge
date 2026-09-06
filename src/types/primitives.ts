/**
 * 全局标量、ID 约定与文本锚点。
 *
 * ID 约定（§5.8）：主键一律是人类可读的稳定短码，禁止模型生成随机 ID。
 * 生成规则由代码持有，模型只被允许引用已存在的 ID。
 */

/** 章号，从 1 起。0 表示"筹备期，尚无章节"。 */
export type ChapterNo = number;

/** 卷号，从 1 起。 */
export type VolumeNo = number;

/** 事件流单调递增序号，全作品唯一，由存储层分配。 */
export type EventSeq = number;

/** ISO-8601 UTC 时间戳。禁止进入任何 L1/L2 渲染输出（§13.3）。 */
export type IsoTimestamp = string;

/** 人物主键：`C` + 两位序号，如 `C01`。 */
export type CharacterId = `C${string}`;

/** 伏笔主键：`F` + 两位序号，如 `F03`。 */
export type ForeshadowId = `F${string}`;

/** 情节线主键：`P` + 两位序号，如 `P01`。 */
export type PlotLineId = `P${string}`;

/** 地点/设定主键：`S` + 两位序号。 */
export type SettingId = `S${string}`;

/** 结构事件主键：`ch<章号>-<该章内序号>`，如 `ch47-2`。人类可读且天然按章聚簇。 */
export type StructuralEventId = string;

/** 告警主键：`<类别>:<对象 ID>`，如 `foreshadow_overdue:F03`。同一问题永远同一 ID，天生幂等。 */
export type AlertId = string;

// ── 文本锚点 ────────────────────────────────────────────────────────────

/**
 * 文本锚点（§6.3）。quote 是主键，offset 只是提示。
 *
 * 为什么不用 offset 做主键：作者会回头改早期章节，一次插入就让后面所有
 * offset 全错。quote 在文本被改动后仍可重新定位，定位失败则降级为 stale。
 */
export interface TextAnchor {
  readonly chapter: ChapterNo;
  /**
   * 原文片段，8-40 字。锚点的真正身份。
   * 太短会多处命中，太长会因作者微调而失配。
   */
  readonly quote: string;
  /** 章内字符偏移，仅作重定位的搜索起点提示。允许过时。 */
  readonly offsetHint: number;
  /** 同一 quote 在该章命中多次时，取第几次（0 起）。 */
  readonly occurrence: number;
}

/** 锚点解析结果。stale 是一等状态，不是错误（前端要能渲染降级态）。 */
export type AnchorResolution =
  | { readonly status: "exact"; readonly offset: number; readonly length: number }
  /** quote 命中，但位置与 offsetHint 相差较大 —— 作者在前面增删了内容。 */
  | { readonly status: "shifted"; readonly offset: number; readonly length: number; readonly shiftedBy: number }
  /** quote 已找不到 —— 该段被改写或删除。UI 显示"原文已变动"并给出所在章的入口。 */
  | { readonly status: "stale"; readonly reason: "quote_not_found" | "chapter_missing" };

// ── 派生值的编译期护栏 ──────────────────────────────────────────────────

declare const derivedBrand: unique symbol;

/**
 * 标记"由代码派生、绝不接受模型或用户输入"的字段（§10.1）。
 *
 * 用法：`Derived<WordBudget>`。品牌字段只能由 `deriveXxx()` 系列函数
 * 通过内部断言产出，因此模型返回的 JSON 无法直接赋值给它 —— 派生值被
 * 当成模型输出存储这个错误在编译期就断掉。
 *
 * 品牌用 **symbol 键**而非字符串键：字符串键会与索引签名类型冲突
 * （`Derived<Record<string, number>>` 下品牌字段被索引签名要求为 number），
 * 而索引签名只约束字符串键，symbol 品牌可以共存。
 */
export type Derived<T> = T & { readonly [derivedBrand]: true };

/** 模型/用户产出物的三态生命周期（§12.0：一切模型产出先进待接受区）。 */
export type Provenance =
  /** 作者手填。最高可信度，模型不得覆盖。 */
  | "authored"
  /** 模型声明，等待用户接受。 */
  | "proposed"
  /** 用户已接受，进入正式状态。 */
  | "committed"
  /** 用户否决。保留记录以便统计模型准确率，不参与任何投影。 */
  | "rejected";
