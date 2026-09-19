/** 固定正式版本的多格式导出：产物与清单一起保存，下载不重读当前作品。 */
import { createHash } from "node:crypto";
import { readProjectFile, withFileTransaction, writeProjectFile } from "../store/transaction.js";
import { ChapterWriteError } from "../server/chapter-input.js";
import { stableFingerprint } from "../task/revision.js";
import { countWords } from "../text/measure.js";
import { volumeOf, volumeRanges } from "../beat/volumes.js";
import type { ProjectSession } from "../server/state.js";
import { renderManuscriptDocx, renderManuscriptEpub, renderManuscriptText, type Manuscript } from "./manuscript.js";
import { renderSettingBibleDocx, renderSettingBibleJson } from "./bible.js";
import type {
  ExportArtifact, ExportArtifactFile, ExportArtifactFormat, ExportChapter, ExportKind, ExportSelection,
  TextExportFile, TextExportPreview,
} from "./types.js";

type Source = Pick<ProjectSession, "meta" | "chapterNumbers" | "chapterText" | "currentAdoptedDraftId" | "allDrafts">;
type ManifestV1 = Omit<TextExportPreview, "id" | "filename" | "message" | "createdAt" | "sha256" | "kind" | "artifacts"> & {
  readonly version: 1;
  readonly sha256: string;
};
interface ManifestV2 {
  readonly version: 2;
  readonly kind: ExportKind;
  readonly title: string;
  readonly selection: ExportSelection;
  readonly chapters: readonly ExportChapter[];
  readonly omitted: readonly { readonly from: number; readonly to: number }[];
  readonly pendingDrafts: readonly { readonly chapter: number; readonly count: number }[];
  readonly totalWords: number;
  readonly sha256: string;
  readonly artifacts: readonly ExportArtifact[];
}
type SavedExport = (ManifestV1 | ManifestV2) & { readonly createdAt: string };

const MIME: Readonly<Record<ExportArtifactFormat, string>> = {
  txt: "text/plain; charset=utf-8",
  epub: "application/epub+zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  json: "application/json; charset=utf-8",
};
const hashBytes = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const positive = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) > 0;
const fail = (status: 400 | 404 | 409, message: string): never => { throw new ChapterWriteError(status, message); };
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

function selectionOf(value: unknown): ExportSelection {
  if (!record(value)) return fail(400, "请选择全部正文、连续章号范围或分卷");
  if (value["scope"] === "all" && Object.keys(value).every(key => key === "scope")) return { scope: "all" };
  if (value["scope"] === "range" && positive(value["from"]) && positive(value["to"]) && value["from"] <= value["to"] && Object.keys(value).every(key => ["scope", "from", "to"].includes(key))) {
    return { scope: "range", from: value["from"], to: value["to"] };
  }
  if (value["scope"] === "volume" && positive(value["volume"]) && Object.keys(value).every(key => ["scope", "volume"].includes(key))) {
    return { scope: "volume", volume: value["volume"] };
  }
  return fail(400, "导出范围必须是起止有序的正整数、正整数卷号，或不带额外参数的全部正文");
}

function safeTitle(value: string): string {
  return Array.from(value.replace(/[<>:"/\\|?*\x00-\x1f]/gu, "_").trim()).slice(0, 60).join("") || "小说";
}

function artifactFilename(saved: SavedExport, format: ExportArtifactFormat): string {
  const title = safeTitle(saved.title);
  if (saved.version === 2 && saved.kind === "bible") return `${title}_设定集.${format}`;
  const first = saved.chapters[0]?.chapter ?? 1;
  const last = saved.chapters.at(-1)?.chapter ?? first;
  const volume = saved.selection.scope === "volume" ? `_第${saved.selection.volume}卷` : "";
  return `${title}_正文${volume}_第${first}-${last}章.${format}`;
}

function storedPath(id: string, format: ExportArtifactFormat): string {
  if (format === "txt") return `exports/${id}.txt`;
  if (format === "json") return `exports/${id}.artifact.json`;
  return `exports/${id}.artifact.${format}.b64`;
}

function identity(saved: ManifestV1 | ManifestV2): string { return `export-${stableFingerprint(saved)}`; }

function v1Artifact(saved: SavedExport): ExportArtifact {
  return { format: "txt", filename: artifactFilename(saved, "txt"), mime: MIME.txt, bytes: 0, sha256: saved.sha256 };
}

function toPreview(id: string, saved: SavedExport): TextExportPreview {
  const { version: _version, ...content } = saved;
  const artifacts = saved.version === 2 ? saved.artifacts : [v1Artifact(saved)];
  const kind = saved.version === 2 ? saved.kind : "manuscript";
  const message = kind === "bible"
    ? "已固定当前作品设定。下载使用此次快照；资料更新后请重新预览。"
    : `已固定 ${saved.chapters.length} 章正式正文。下载使用此次选择；需要包含新采用内容时请重新预览。`;
  return { ...content, id, kind, filename: artifacts[0]?.filename ?? null, artifacts, message };
}

function describe(format: ExportArtifactFormat, filename: string, bytes: Buffer): ExportArtifact {
  return { format, filename, mime: MIME[format], bytes: bytes.length, sha256: hashBytes(bytes) };
}

export class TextExportService {
  constructor(private readonly root: string, private readonly source: Source) {}

  prepare(raw: unknown): TextExportPreview {
    if (record(raw) && raw["kind"] === "bible" && Object.keys(raw).every(key => key === "kind")) return this.prepareBible();
    const selection = record(raw) && raw["kind"] === "manuscript" && Object.keys(raw).every(key => ["kind", "selection"].includes(key))
      ? selectionOf(raw["selection"])
      : selectionOf(raw);
    return this.prepareManuscript(selection);
  }

  private prepareManuscript(selection: ExportSelection): TextExportPreview {
    if (selection.scope === "volume" && !volumeRanges(this.source.meta.beats).some(range => range.volume === selection.volume)) {
      return fail(400, `第 ${selection.volume} 卷没有节拍表，无法确定章节边界`);
    }
    const inRange = (chapter: number) => selection.scope === "all"
      || (selection.scope === "range" && chapter >= selection.from && chapter <= selection.to)
      || (selection.scope === "volume" && volumeOf(this.source.meta.beats, chapter) === selection.volume);
    const numbers = this.source.chapterNumbers().filter(inRange).sort((a, b) => a - b);
    const pending = new Map<number, number>();
    for (const draft of this.source.allDrafts()) if (inRange(draft.chapter) && draft.status !== "adopted" && draft.status !== "discarded") {
      pending.set(draft.chapter, (pending.get(draft.chapter) ?? 0) + 1);
    }
    const pendingDrafts = [...pending].sort(([a], [b]) => a - b).map(([chapter, count]) => ({ chapter, count }));
    const chapters: ExportChapter[] = [];
    const manuscriptChapters: Manuscript["chapters"][number][] = [];
    for (const chapter of numbers) {
      const body = this.source.chapterText(chapter);
      if (body === undefined) return fail(409, `第 ${chapter} 章正式正文缺失，请核对后再导出`);
      const draftId = this.source.currentAdoptedDraftId(chapter) ?? null;
      const sha256 = hashBytes(body);
      chapters.push({ chapter, draftId, version: draftId ?? `legacy:${sha256}`, words: countWords(body), sha256 });
      manuscriptChapters.push({ chapter, title: `第 ${chapter} 章`, body });
    }
    const bounds = selection.scope === "range" ? { from: selection.from, to: selection.to }
      : selection.scope === "volume" ? volumeRanges(this.source.meta.beats).find(range => range.volume === selection.volume)!
      : { from: 1, to: Math.max(0, ...numbers, ...pending.keys()) };
    const omitted: { from: number; to: number }[] = [];
    let cursor = bounds.from;
    for (const chapter of numbers) {
      if (chapter > cursor) omitted.push({ from: cursor, to: chapter - 1 });
      cursor = chapter + 1;
    }
    if (cursor <= bounds.to) omitted.push({ from: cursor, to: bounds.to });
    const createdAt = new Date().toISOString();
    const title = this.source.meta.setting.title;
    const totalWords = chapters.reduce((sum, chapter) => sum + chapter.words, 0);
    if (chapters.length === 0) return {
      id: null, filename: null, kind: "manuscript", title, selection, chapters, omitted, pendingDrafts, totalWords, createdAt,
      sha256: null, artifacts: [], message: "所选范围没有已采用正文。请调整范围，或先完成并采用候选稿。",
    };
    const identifier = `urn:novel-forge:${stableFingerprint({ title, selection, chapters })}`;
    const manuscript: Manuscript = { title, identifier, chapters: manuscriptChapters };
    const bytes = new Map<ExportArtifactFormat, Buffer>([
      ["txt", Buffer.from(renderManuscriptText(manuscript), "utf8")],
      ["epub", renderManuscriptEpub(manuscript)],
      ["docx", renderManuscriptDocx(manuscript)],
    ]);
    const placeholder: SavedExport = { version: 2, kind: "manuscript", title, selection, chapters, omitted, pendingDrafts, totalWords, sha256: hashBytes(bytes.get("txt")!), artifacts: [], createdAt };
    const artifacts = (["txt", "epub", "docx"] as const).map(format => describe(format, artifactFilename(placeholder, format), bytes.get(format)!));
    return this.save({ version: 2, kind: "manuscript", title, selection, chapters, omitted, pendingDrafts, totalWords, sha256: artifacts[0]!.sha256, artifacts }, createdAt, bytes);
  }

  private prepareBible(): TextExportPreview {
    const createdAt = new Date().toISOString();
    const title = this.source.meta.setting.title;
    const selection: ExportSelection = { scope: "all" };
    const json = Buffer.from(renderSettingBibleJson(this.source.meta), "utf8");
    const identifier = `urn:novel-forge:${stableFingerprint({ kind: "bible", json: hashBytes(json) })}`;
    const docx = renderSettingBibleDocx(this.source.meta, identifier);
    const bytes = new Map<ExportArtifactFormat, Buffer>([["json", json], ["docx", docx]]);
    const placeholder: SavedExport = { version: 2, kind: "bible", title, selection, chapters: [], omitted: [], pendingDrafts: [], totalWords: 0, sha256: hashBytes(json), artifacts: [], createdAt };
    const artifacts = (["json", "docx"] as const).map(format => describe(format, artifactFilename(placeholder, format), bytes.get(format)!));
    return this.save({ version: 2, kind: "bible", title, selection, chapters: [], omitted: [], pendingDrafts: [], totalWords: 0, sha256: artifacts[0]!.sha256, artifacts }, createdAt, bytes);
  }

  private save(manifest: ManifestV2, createdAt: string, bytes: ReadonlyMap<ExportArtifactFormat, Buffer>): TextExportPreview {
    const id = identity(manifest);
    return withFileTransaction(this.root, () => {
      if (readProjectFile(this.root, `exports/${id}.json`) !== undefined || manifest.artifacts.some(artifact => readProjectFile(this.root, storedPath(id, artifact.format)) !== undefined)) return this.preview(id);
      writeProjectFile(this.root, `exports/${id}.json`, JSON.stringify({ ...manifest, createdAt }, null, 2));
      for (const artifact of manifest.artifacts) {
        const content = bytes.get(artifact.format)!;
        writeProjectFile(this.root, storedPath(id, artifact.format), artifact.format === "txt" || artifact.format === "json" ? content.toString("utf8") : content.toString("base64"));
      }
      return toPreview(id, { ...manifest, createdAt });
    });
  }

  preview(id: unknown): TextExportPreview {
    const { saved } = this.read(id);
    return toPreview(id as string, saved);
  }

  file(id: unknown): TextExportFile {
    const artifact = this.artifact(id, "txt");
    return { filename: artifact.filename, text: artifact.bytes.toString("utf8"), sha256: artifact.sha256 };
  }

  artifact(id: unknown, format: unknown): ExportArtifactFile {
    if (typeof format !== "string" || !(["txt", "epub", "docx", "json"] as const).includes(format as ExportArtifactFormat)) {
      return fail(400, "导出格式无效");
    }
    const { saved, artifacts } = this.read(id);
    const descriptor = (saved.version === 2 ? saved.artifacts : [v1Artifact(saved)]).find(item => item.format === format);
    if (descriptor === undefined) return fail(404, "这份导出没有所选格式，请重新预览");
    const bytes = artifacts.get(format as ExportArtifactFormat);
    if (bytes === undefined) return fail(409, "这份导出的文件已损坏，请重新预览");
    return { filename: descriptor.filename, mime: descriptor.mime, bytes, sha256: descriptor.sha256 };
  }

  private read(id: unknown): { readonly saved: SavedExport; readonly artifacts: ReadonlyMap<ExportArtifactFormat, Buffer> } {
    if (typeof id !== "string" || !/^export-[a-f0-9]{64}$/u.test(id)) return fail(400, "导出编号无效，请从导出预览入口打开");
    const metadata = readProjectFile(this.root, `exports/${id}.json`);
    const legacyText = readProjectFile(this.root, `exports/${id}.txt`);
    if (metadata === undefined && legacyText === undefined) return fail(404, "当前作品没有这份导出，请重新选择范围并预览");
    try {
      const value: unknown = metadata === undefined ? null : JSON.parse(metadata);
      if (!record(value) || (value["version"] !== 1 && value["version"] !== 2) || typeof value["createdAt"] !== "string" || !Number.isFinite(Date.parse(value["createdAt"])) || typeof value["title"] !== "string" || !Array.isArray(value["chapters"]) || !Array.isArray(value["omitted"]) || !Array.isArray(value["pendingDrafts"]) || typeof value["sha256"] !== "string") throw new Error("清单不完整");
      selectionOf(value["selection"]);
      if (value["version"] === 1 && value["chapters"].length === 0) throw new Error("旧清单没有章节");
      if (value["version"] === 2 && ((value["kind"] !== "manuscript" && value["kind"] !== "bible") || !Array.isArray(value["artifacts"]) || value["artifacts"].length === 0)) throw new Error("新清单不完整");
      const { createdAt: _createdAt, ...manifest } = value;
      if (identity(manifest as unknown as ManifestV1 | ManifestV2) !== id) throw new Error("内容指纹不一致");
      const saved = value as unknown as SavedExport;
      const descriptors = saved.version === 2 ? saved.artifacts : [v1Artifact(saved)];
      const artifacts = new Map<ExportArtifactFormat, Buffer>();
      for (const descriptor of descriptors) {
        if (!record(descriptor) || typeof descriptor.format !== "string" || typeof descriptor.sha256 !== "string" || typeof descriptor.filename !== "string" || typeof descriptor.mime !== "string") throw new Error("产物清单损坏");
        const stored = readProjectFile(this.root, storedPath(id, descriptor.format as ExportArtifactFormat));
        if (stored === undefined) throw new Error("产物缺失");
        const bytes = descriptor.format === "txt" || descriptor.format === "json" ? Buffer.from(stored, "utf8") : Buffer.from(stored, "base64");
        if (hashBytes(bytes) !== descriptor.sha256 || (saved.version === 2 && bytes.length !== descriptor.bytes)) throw new Error("产物指纹不一致");
        artifacts.set(descriptor.format as ExportArtifactFormat, bytes);
      }
      return { saved, artifacts };
    } catch {
      return fail(409, "这份导出的清单或文件已损坏，未使用当前内容替换。请核对保存文件或重新预览。");
    }
  }
}
