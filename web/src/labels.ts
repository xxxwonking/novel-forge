/**
 * 领域枚举的中文名。
 *
 * 后端存的是稳定标识（`xuanhuan`、`fanqie`），界面不该把它们直接显示给作者 ——
 * 作品列表、首页概览、资料页都要同一套写法，所以放在这里共用。
 */

export const GENRE_LABELS: Readonly<Record<string, string>> = {
  xuanhuan: "玄幻", xianxia: "仙侠", urban: "都市", scifi: "科幻", mystery: "悬疑", rulehorror: "规则怪谈",
};

export const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  unpublished: "暂不确定", qidian: "起点", fanqie: "番茄", feilu: "飞卢",
};

export const genreLabel = (value: string): string => GENRE_LABELS[value] ?? value;
export const platformLabel = (value: string): string => PLATFORM_LABELS[value] ?? value;

/** antd Select 的 options，顺序与映射表一致。 */
export const toOptions = (labels: Readonly<Record<string, string>>): { value: string; label: string }[] =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
