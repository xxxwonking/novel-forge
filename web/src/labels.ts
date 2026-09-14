/** 枚举值 → 中文标签。与后端口径对应；跨 tsconfig 不能 import，所以在前端重新声明。 */

const DRAFT_STATUS: Record<string, string> = {
  writing: "写作中",
  declaring: "声明中",
  checking: "检查中",
  needs_revision: "需修订",
  ready: "可采用",
  adopted: "已采用",
  discarded: "已弃",
  stale: "需重核",
  failed: "失败",
};

export function draftStatusLabel(status: string): string {
  return DRAFT_STATUS[status] ?? status;
}

/** 草稿状态 → tag 语义色。可采用与进行中不上色，需修订=warn，失败/需重核=alarm，已了结=done。 */
export function draftStatusTone(status: string): "warn" | "alarm" | "done" | undefined {
  switch (status) {
    case "needs_revision":
      return "warn";
    case "failed":
    case "stale":
      return "alarm";
    case "adopted":
    case "discarded":
      return "done";
    default:
      return undefined;
  }
}

const CHAPTER_TYPE: Record<string, string> = {
  transition: "过渡章",
  setup: "布局章",
  event: "事件章",
  payoff: "回收章",
  climax: "高潮章",
};

export function chapterTypeLabel(type: string): string {
  return CHAPTER_TYPE[type] ?? type;
}

/** 题材与平台在新建作品时定死，之后只读。作者选的是中文，别再把枚举值显示回去。 */
const GENRE: Record<string, string> = {
  xuanhuan: "玄幻",
  xianxia: "仙侠",
  urban: "都市",
  scifi: "科幻",
  mystery: "悬疑",
  rulehorror: "规则怪谈",
};

const PLATFORM: Record<string, string> = {
  fanqie: "番茄",
  feilu: "飞卢",
  qidian: "起点",
  unpublished: "未定 / 不发布",
};

export function genreLabel(genre: string): string {
  return GENRE[genre] ?? genre;
}

export function platformLabel(platform: string): string {
  return PLATFORM[platform] ?? platform;
}

/** 方案条目按对象类别分组显示。作者关心的是"这份方案动了什么"，不是调了哪个工具。 */
const ITEM_GROUP: Record<string, string> = {
  set_direction: "作品方向",
  set_discipline: "作品方向",
  upsert_character: "人物",
  upsert_location: "场景",
  define_plotline: "情节线",
  plan_chapter: "章节安排",
  plan_add_to_next_chapter: "章节安排",
  plan_reschedule_foreshadow: "伏笔",
  plan_abandon_foreshadow: "伏笔",
};

/** 分组的显示顺序 = 执行的依赖顺序：先立方向，再建对象，最后排章。 */
export const ITEM_GROUP_ORDER: readonly string[] = ["作品方向", "人物", "场景", "情节线", "伏笔", "章节安排"];

export function itemGroupLabel(tool: string): string {
  return ITEM_GROUP[tool] ?? "其他";
}
