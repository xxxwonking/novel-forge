/** 导入分类只决定正文切分，不把资料中的章标题当成正式章节。预览允许作者纠正。 */
export type ImportFileKind = "auto" | "chapter" | "outline" | "characters" | "setting" | "material";
export const IMPORT_FILE_KINDS: readonly string[] = ["auto", "chapter", "outline", "characters", "setting", "material"];
export function materialKind(name: string, text = ""): Exclude<ImportFileKind,"auto"|"chapter"> | null {
  const path = name.replace(/\\/gu,"/");
  const base = path.split("/").at(-1) ?? path;
  // 显式章节文件优先，避免「第34章 人物档案」被误判；资料目录内的文件除外。
  const directory = path.slice(0,-base.length);
  const role = (value:string) => /人物|角色|character|cast/iu.test(value) ? "characters" as const
    : /大纲|细纲|梗概|简介|目录|outline|synopsis/iu.test(value) ? "outline" as const
    : /设定|世界观|设定集|world.?bible|setting/iu.test(value) ? "setting" as const : null;
  const folder = directory.split("/").filter(p=>/^(人物|人物档案|角色|角色档案|大纲|细纲|设定|设定集|世界观|characters|cast|outline|synopsis|settings)$/iu.test(p)).map(role).find(p=>p!==null) ?? null;
  if (folder !== null) return folder;
  if (/^(?:第)?[\d一二三四五六七八九十百千零〇]+[章回节]/u.test(base)) return null;
  return role(base) ?? (/\.json$/iu.test(base) ? "material" : /^(?:[#\s]*)(?:人物档案|角色档案|故事大纲|分章大纲|世界观设定)/u.test(text.trimStart()) ? role(text.split(/\r?\n/u)[0] ?? "") : null);
}
