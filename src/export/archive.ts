/** EPUB 与 DOCX 共用的确定性 ZIP/XML 基础设施。 */
import { strToU8, zipSync, type Zippable } from "fflate";

export interface ArchiveEntry {
  readonly path: string;
  readonly content: string | Uint8Array;
  /** EPUB 的 mimetype 必须原样存储，不能 deflate。 */
  readonly store?: boolean;
}

/** ZIP 时间最早只能到 1980；固定时间让相同内容得到完全相同的字节。 */
const ARCHIVE_TIME = new Date("1980-01-01T00:00:00.000Z");

export function createArchive(entries: readonly ArchiveEntry[]): Buffer {
  const files: Zippable = {};
  for (const entry of entries) {
    const bytes = typeof entry.content === "string" ? strToU8(entry.content) : entry.content;
    files[entry.path] = [bytes, { level: entry.store === true ? 0 : 9, mtime: ARCHIVE_TIME }];
  }
  return Buffer.from(zipSync(files, { level: 9, mtime: ARCHIVE_TIME }));
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&apos;");
}

export function proseBlocks(body: string): readonly string[] {
  return body.replace(/\r\n?/gu, "\n").split(/\n[\t ]*\n+/u).map((block) => block.trim()).filter(Boolean);
}
