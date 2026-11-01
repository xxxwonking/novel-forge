/** 不依赖DOM的导入契约，可用于导入协调器与回归测试。 */
export interface ImportFileInput { name:string;text:string;kind?:"auto"|"chapter"|"outline"|"characters"|"setting"|"material" }
export type ImportSource = {text:string;files?:never}|{files:ImportFileInput[];text?:never};
export interface ImportResult {
  imported:number[];replaced:number[];unchanged:number[];totalWords:number;nextChapter:number;materials:string[];
}
