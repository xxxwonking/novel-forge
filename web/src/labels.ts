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
