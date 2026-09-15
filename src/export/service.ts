/** 导出只创建独立产物；清单和纯文本一起保存，下载不重新读取当前正式版本。 */
import { createHash } from "node:crypto";
import { readProjectFile, withFileTransaction, writeProjectFile } from "../store/transaction.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import { stableFingerprint } from "../task/revision.js";
import { countWords } from "../text/measure.js";
import type { ProjectSession } from "../server/state.js";
import type { ExportChapter, ExportSelection, TextExportFile, TextExportPreview } from "./types.js";

type Source = Pick<ProjectSession, "meta" | "chapterNumbers" | "chapterText" | "currentAdoptedDraftId" | "allDrafts">;
type Manifest = Omit<TextExportPreview, "id" | "filename" | "message" | "createdAt" | "sha256"> & { readonly version: 1; readonly sha256: string };
type SavedExport = Manifest & { readonly createdAt: string };
const hash = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const fail = (status: 400 | 404 | 409, message: string): never => { throw new ChapterWriteError(status, message); };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function selectionOf(value: unknown): ExportSelection {
  if (!record(value)) return fail(400, "请选择全部正文或连续章号范围");
  if (value["scope"] === "all" && Object.keys(value).every(key => key === "scope")) return { scope: "all" };
  if (value["scope"] === "range" && positive(value["from"]) && positive(value["to"]) && value["from"] <= value["to"] && Object.keys(value).every(key => ["scope", "from", "to"].includes(key))) {
    return { scope: "range", from: value["from"], to: value["to"] };
  }
  return fail(400, "导出范围必须是起止有序的正整数；全部正文无需指定章号");
}

function filename(saved: SavedExport): string {
  const title = Array.from(saved.title.replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_").trim()).slice(0, 60).join("") || "小说";
  return `${title}_正文_第${saved.chapters[0]!.chapter}-${saved.chapters.at(-1)!.chapter}章.txt`;
}
function identity(saved: Manifest): string { return `export-${stableFingerprint(saved)}`; }
function toPreview(id: string, saved: SavedExport): TextExportPreview {
  const { version: _version, ...content } = saved;
  return { ...content, id, filename: filename(saved), message: `已固定 ${saved.chapters.length} 章正式正文。下载使用此次选择；需要包含新采用内容时请重新预览。` };
}

export class TextExportService {
  constructor(private readonly root: string, private readonly source: Source) {}

  prepare(raw: unknown): TextExportPreview {
    const selection = selectionOf(raw);
    const inRange = (chapter: number) => selection.scope === "all" || (chapter >= selection.from && chapter <= selection.to);
    // 整个读取和保存同步完成，不在挑选不同章节之间让出当前会话。
    const numbers = this.source.chapterNumbers().filter(inRange).sort((a, b) => a - b);
    const pending = new Map<number, number>();
    for (const draft of this.source.allDrafts()) if (inRange(draft.chapter) && draft.status !== "adopted" && draft.status !== "discarded") {
      pending.set(draft.chapter, (pending.get(draft.chapter) ?? 0) + 1);
    }
    const pendingDrafts = [...pending].sort(([a], [b]) => a - b).map(([chapter, count]) => ({ chapter, count }));
    const chapters: ExportChapter[] = [];
    const parts: string[] = [];
    for (const chapter of numbers) {
      const body = this.source.chapterText(chapter);
      if (body === undefined) return fail(409, `第 ${chapter} 章正式正文缺失，请核对后再导出`);
      const draftId = this.source.currentAdoptedDraftId(chapter) ?? null;
      const sha256 = hash(body);
      chapters.push({ chapter, draftId, version: draftId ?? `legacy:${sha256}`, words: countWords(body), sha256 });
      parts.push(`第 ${chapter} 章\n\n${body}`);
    }
    const from = selection.scope === "range" ? selection.from : 1;
    const to = selection.scope === "range" ? selection.to : Math.max(0, ...numbers, ...pending.keys());
    const omitted: { from: number; to: number }[] = [];
    let cursor = from;
    for (const chapter of numbers) {
      if (chapter > cursor) omitted.push({ from: cursor, to: chapter - 1 });
      cursor = chapter + 1;
    }
    if (cursor <= to) omitted.push({ from: cursor, to });
    const createdAt = new Date().toISOString();
    const title = this.source.meta.setting.title;
    const totalWords = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
    if (chapters.length === 0) return { id: null, filename: null, title, selection, chapters, omitted, pendingDrafts, totalWords, createdAt, sha256: null,
      message: "所选范围没有已采用正文。请调整范围，或先完成并采用候选稿。" };
    const text = `\uFEFF${title}\n\n${parts.join("\n\n")}\n`;
    const manifest: Manifest = { version: 1, title, selection, chapters, omitted, pendingDrafts, totalWords, sha256: hash(text) };
    const id = identity(manifest);
    return withFileTransaction(this.root, () => {
      if (readProjectFile(this.root, `exports/${id}.json`) !== undefined || readProjectFile(this.root, `exports/${id}.txt`) !== undefined) return this.preview(id);
      const saved: SavedExport = { ...manifest, createdAt };
      writeProjectFile(this.root, `exports/${id}.json`, JSON.stringify(saved, null, 2));
      writeProjectFile(this.root, `exports/${id}.txt`, text);
      return toPreview(id, saved);
    });
  }

  preview(id: unknown): TextExportPreview {
    const { saved } = this.read(id);
    return toPreview(id as string, saved);
  }

  file(id: unknown): TextExportFile {
    const { saved, text } = this.read(id);
    return { filename: filename(saved), text, sha256: saved.sha256 };
  }

  private read(id: unknown): { readonly saved: SavedExport; readonly text: string } {
    if (typeof id !== "string" || !/^export-[a-f0-9]{64}$/u.test(id)) return fail(400, "导出编号无效，请从导出预览入口打开");
    const metadata = readProjectFile(this.root, `exports/${id}.json`);
    const text = readProjectFile(this.root, `exports/${id}.txt`);
    if (metadata === undefined && text === undefined) return fail(404, "当前作品没有这份导出，请重新选择范围并预览");
    try {
      const value: unknown = metadata === undefined ? null : JSON.parse(metadata);
      if (!record(value) || value["version"] !== 1 || typeof value["createdAt"] !== "string" || !Number.isFinite(Date.parse(value["createdAt"])) || typeof value["title"] !== "string" || !Array.isArray(value["chapters"]) || value["chapters"].length === 0 || !Array.isArray(value["omitted"]) || !Array.isArray(value["pendingDrafts"]) || text === undefined) throw new Error("清单或正文不完整");
      selectionOf(value["selection"]);
      const { createdAt: _createdAt, ...manifest } = value;
      if (identity(manifest as unknown as Manifest) !== id || hash(text) !== value["sha256"]) throw new Error("内容指纹不一致");
      return { saved: value as unknown as SavedExport, text };
    } catch { return fail(409, "这份导出的清单或文本已损坏，未使用当前正文替换。请核对保存文件或重新选择范围导出。"); }
  }
}
