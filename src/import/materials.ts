/**
 * 随正文一起导入的**资料文件**：角色档案、大纲、设定集这类。
 *
 * 为什么不只是读一遍就丢：那是作者的创作资产，和正文同等；而且「识别人物」要用它 ——
 * 作者手上的角色档案比从几十万字正文里推断可靠得多，也短得多。存下来还意味着
 * 以后再起草一次资料时它仍在场，不必重新选一遍文件。
 *
 * 落盘名与展示名分开：作者的文件名可能带目录前缀（选整个文件夹时浏览器就给这个），
 * 也可能带 `../`。有效的相对目录会保留，防止不同资料目录的同名文件互相覆盖；越界路径退回净化后的文件名 —— 这个进程能读
 * 用户主目录下的一切，路径穿越在这里是必须挡的。
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { countWords } from "../text/measure.js";

const DIR = "materials";
/** 单份资料的字符上限；长资料通过全文分块读取，普通起草仍明确显示抽样范围。 */
export const MATERIAL_MAX_CHARS = 1_000_000;

export interface MaterialFile {
  /** 作者看到的原名（可能带目录前缀）。 */
  readonly name: string;
  /** 落盘文件名，已净化；读回时用它。 */
  readonly file: string;
  readonly words: number;
}

export class MaterialStore {
  constructor(private readonly root: string) {}

  /**
   * 存一份资料。同名的按最新一份覆盖 —— 那是作者改过的版本，不是新的一本。
   *
   * 拒收时给出理由：作者选了一整个文件夹，里面有图片、有 zip，一句「没成功」
   * 让他不知道是哪一份、为什么。
   */
  save(name: string, text: string): { readonly saved: MaterialFile } | { readonly reason: string } {
    const issue=materialIssue(name,text);
    if(issue!==null) return {reason:issue};
    const file = safeName(name)!;
    writeProjectFile(this.root, join(DIR, file), text);
    return { saved: { name: file, file, words: countWords(text) } };
  }

  list(): readonly MaterialFile[] {
    return this.index().map(({ name, file, words }) => ({ name, file, words }));
  }

  read(file: string): string | undefined {
    const safe = safeName(file);
    return safe === null ? undefined : readProjectFile(this.root, join(DIR,safe));
  }

  /** 索引就是资料目录里的文件本身，不另存一份名单 —— 少一处会对不上的副本。 */
  private index(): readonly MaterialFile[] {
    const directory = join(this.root, DIR);
    if (!existsSync(directory)) return [];
    const visit=(prefix:string):MaterialFile[] => readdirSync(join(directory,prefix),{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(entry=>{
      const file=prefix?`${prefix}/${entry.name}`:entry.name;
      if(entry.isSymbolicLink()) throw new Error(`资料目录含符号链接：${file}`);
      if(entry.isDirectory()) return visit(file);
      if(!entry.isFile()) return [];
      return [{name:file,file,words:countWords(readProjectFile(this.root,join(DIR,file))??"")}];
    });
    return visit("");
  }
}

/** 保留安全的相对路径；越界输入仅使用末段，不允许写到作品之外。 */
function safeName(name:string):string|null {
  const normalized=name.replace(/\\/gu,"/").trim();
  const parts=normalized.split("/");
  const relative= !normalized.startsWith("/") && !/^[A-Za-z]:/u.test(normalized) && parts.every(p=>p!=="" && p!=="." && p!==".." && !p.startsWith(".") && p.length<=120);
  const file=relative?parts.join("/"):basename(normalized).trim();
  if(file==="" || file==="." || file===".." || file.startsWith(".") || file.length>1000 || (!relative && file.length>120)) return null;
  return file;
}

export function materialIssue(name:string,text:string):string|null {
  if(text.trim() === "") return "内容是空的";
  if(text.length > MATERIAL_MAX_CHARS) return `资料过大，超过 ${Math.round(MATERIAL_MAX_CHARS / 10000)} 万字的上限`;
  if(/[\u0000-\u001f]/u.test(name) || safeName(name)===null) return "文件名不能用";
  return null;
}
