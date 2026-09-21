/**
 * 随正文一起导入的**资料文件**：角色档案、大纲、设定集这类。
 *
 * 为什么不只是读一遍就丢：那是作者的创作资产，和正文同等；而且「识别人物」要用它 ——
 * 作者手上的角色档案比从几十万字正文里推断可靠得多，也短得多。存下来还意味着
 * 以后再起草一次资料时它仍在场，不必重新选一遍文件。
 *
 * 落盘名与展示名分开：作者的文件名可能带目录前缀（选整个文件夹时浏览器就给这个），
 * 也可能带 `../`。展示用原名让人认得出，落盘只取净化后的文件名 —— 这个进程能读
 * 用户主目录下的一切，路径穿越在这里是必须挡的。
 */

import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { countWords } from "../text/measure.js";

const DIR = "materials";
/** 单份资料的字数上限。角色档案通常几千字，超过这个量级的多半是误把正文当资料选了。 */
export const MATERIAL_MAX_CHARS = 100_000;

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
    if (text.trim() === "") return { reason: "内容是空的" };
    if (text.length > MATERIAL_MAX_CHARS) return { reason: `超过 ${Math.round(MATERIAL_MAX_CHARS / 10000)} 万字的上限` };
    const file = safeName(name);
    if (file === null) return { reason: "文件名不能用" };
    writeProjectFile(this.root, join(DIR, file), text);
    return { saved: { name: basename(name), file, words: countWords(text) } };
  }

  list(): readonly MaterialFile[] {
    return this.index().map(({ name, file, words }) => ({ name, file, words }));
  }

  read(file: string): string | undefined {
    return readProjectFile(this.root, join(DIR, safeName(file) ?? ""));
  }

  /** 索引就是资料目录里的文件本身，不另存一份名单 —— 少一处会对不上的副本。 */
  private index(): readonly MaterialFile[] {
    const directory = join(this.root, DIR);
    if (!existsSync(directory)) return [];
    return readdirSync(directory).sort().map((file) => ({
      name: file, file, words: countWords(readProjectFile(this.root, join(DIR, file)) ?? ""),
    }));
  }
}

/** 只取文件名一段并挡掉越界写法；净化后为空就拒收。 */
function safeName(name: string): string | null {
  const file = basename(name.replace(/\\/gu, "/")).trim();
  if (file === "" || file === "." || file === ".." || file.startsWith(".")) return null;
  if (file.length > 120) return null;
  return file;
}
