/** 资料中的剧情走向独立于正文事件；确认只表示作者接受整理结果。 */
import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { MaterialStore } from "../import/materials.js";
import { parseChapterNumber } from "../import/split.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import type { EventKind } from "../types/events.js";
import { validateOutlineNodes } from "./schema.js";
export interface OutlineNode {
  readonly id: string;
  readonly plotLine: string | null;
  readonly chapter: number | null;
  readonly order: number;
  readonly summary: string;
  readonly kind: EventKind;
  readonly characters: readonly string[];
  readonly source: { readonly file: string; readonly quote: string };
}
export class OutlineStore {
  constructor(private readonly root: string) {}

  list(): readonly OutlineNode[] {
    const text = readProjectFile(this.root, "outline-nodes.json");
    if (text === undefined) return [];
    const value: unknown = JSON.parse(text);
    validateOutlineNodes(value);
    return value as readonly OutlineNode[];
  }

  save(nodes: readonly OutlineNode[]): void {
    validateOutlineNodes(nodes);
    writeProjectFile(this.root, "outline-nodes.json", JSON.stringify(nodes, null, 2) + "\n");
  }

  validateSources(nodes: readonly OutlineNode[]): void {
    const materials = new MaterialStore(this.root);
    const files = new Set(materials.list().map(m=>m.file));
    for (const n of nodes) {
      if (!files.has(n.source.file)) throw new ChapterWriteError(400, `剧情节点 ${n.id} 的资料来源不存在：${n.source.file}`);
      const text = materials.read(n.source.file);
      if(!text?.includes(n.source.quote)) throw new ChapterWriteError(400,`剧情节点 ${n.id} 的资料原句无法逐字核实，请重新读取资料`);
      const heading=/^\s*(?:#{1,6}\s+)?(?:第\s*[\d０-９〇零一二三四五六七八九十百千两]+\s*[章回节]|chapter\s+\d+)\s*(.*)$/iu;
      const lines = n.source.quote.split(/\r?\n/u).filter(line => line.trim() !== "");
      if (lines.length > 0 && lines.every(line => heading.test(line))) {
        const compact = (s: string) => s.replace(/[\s\p{P}]/gu, "");
        const supported = lines.some(line => compact(heading.exec(line)?.[1] ?? "").includes(compact(n.summary)));
        if (!supported) throw new ChapterWriteError(400, `剧情节点 ${n.id} 的出处只有目录标题，不足以支撑具体剧情；请引用有叙事内容的大纲原句，或只保留标题已有的信息`);
      }
      if (n.chapter !== null) {
        const numbers = [...n.source.quote.matchAll(/第\s*([\d０-９〇零一二三四五六七八九十百千两]+)\s*[章回节]|chapter\s+(\d+)/giu)].map(m=>parseChapterNumber(m[1]??m[2]??""));
        if(!numbers.includes(n.chapter)) throw new ChapterWriteError(400,`剧情节点 ${n.id} 的章号没有写在资料原句中，请将 chapter 留为 null，不能推测`);
      }
    }
  }
}
