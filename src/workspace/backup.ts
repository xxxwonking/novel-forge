/** 可移植作品包：只负责文件清单、完整性和安全解包，不决定作品放到哪里。 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ChapterWriteError } from "../server/chapter-input.js";

interface StoredFile {
  readonly path: string;
  readonly size: number;
  readonly sha256: string;
  readonly data: string;
}

interface BackupManifest {
  readonly format: "novel-forge-work";
  readonly version: 1;
  readonly sourceId: string;
  readonly createdAt: string;
  readonly files: readonly StoredFile[];
}

export interface BackupFile {
  readonly path: string;
  readonly bytes: Buffer;
  readonly sha256: string;
}

export interface ParsedWorkBackup {
  readonly sourceId: string;
  readonly createdAt: string;
  readonly files: readonly BackupFile[];
}

const sha256 = (bytes: Buffer): string => createHash("sha256").update(bytes).digest("hex");
const VALID_WORK_ID = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,127}$/u;
/** 解压后 JSON 的硬上限，防止极小 gzip 消耗掉整台机器的内存；它不是作品内容阈值。 */
const MAX_BACKUP_MANIFEST_BYTES = 256 * 1024 * 1024;
/** 文件数只用于抵挡恶意清单；正常作品离这个数量级很远。 */
const MAX_BACKUP_FILES = 100_000;

function invalid(message: string): never {
  throw new ChapterWriteError(400, message);
}

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

function validWorkId(id: unknown): id is string {
  return typeof id === "string" && VALID_WORK_ID.test(id) && !/[. ]$/u.test(id);
}

function assertSafePath(path: unknown): asserts path is string {
  if (typeof path !== "string" || path === "" || path.length > 4096 || isAbsolute(path) || path.includes("\\") || /[:\u0000-\u001f\u007f]/u.test(path)) {
    invalid("备份包包含无效文件路径");
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "." || part === ".." || /[. ]$/u.test(part))) {
    invalid("备份包包含越界或不兼容的文件路径");
  }
}

function decodeBase64(value: unknown): Buffer {
  if (typeof value !== "string" || value.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)) {
    invalid("备份包文件内容不是合法 base64");
  }
  return Buffer.from(value, "base64");
}

const excluded = (path: string): boolean => {
  const name = path.split("/").at(-1) ?? "";
  return name === ".env" || name.startsWith(".env.") || name === ".pending-write.json" || name.endsWith(".tmp");
};

function collect(root: string, relative = ""): StoredFile[] {
  const files: StoredFile[] = [];
  for (const entry of readdirSync(join(root, relative), { withFileTypes: true })) {
    const path = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) invalid(`作品目录含有符号链接，无法安全备份：${path}`);
    if (excluded(path)) continue;
    if (entry.isDirectory()) files.push(...collect(root, path));
    if (entry.isFile()) {
      const bytes = readFileSync(join(root, ...path.split("/")));
      files.push({ path, size: bytes.length, sha256: sha256(bytes), data: bytes.toString("base64") });
    }
    if (!entry.isDirectory() && !entry.isFile()) invalid(`作品目录含有不支持的特殊文件：${path}`);
  }
  return files;
}

export function createBackupPackage(root: string, sourceId: string): Buffer {
  const manifest: BackupManifest = {
    format: "novel-forge-work",
    version: 1,
    sourceId,
    createdAt: new Date().toISOString(),
    files: collect(root).sort((a, b) => a.path.localeCompare(b.path)),
  };
  return gzipSync(Buffer.from(JSON.stringify(manifest), "utf8"));
}

export function parseBackupPackage(input: Uint8Array): ParsedWorkBackup {
  let json: string;
  try {
    json = gunzipSync(input, { maxOutputLength: MAX_BACKUP_MANIFEST_BYTES }).toString("utf8");
  } catch {
    invalid("备份包无法解压或解压后过大");
  }
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch { invalid("备份包不是合法 JSON"); }
  if (!record(raw) || raw["format"] !== "novel-forge-work" || raw["version"] !== 1) invalid("备份包格式或版本不受支持");
  if (!validWorkId(raw["sourceId"])) invalid("备份包里的作品 ID 无效");
  if (typeof raw["createdAt"] !== "string" || !Number.isFinite(Date.parse(raw["createdAt"]))) invalid("备份包创建时间无效");
  if (!Array.isArray(raw["files"]) || raw["files"].length > MAX_BACKUP_FILES) invalid("备份包文件清单无效或文件过多");

  const seen = new Set<string>();
  const files: BackupFile[] = raw["files"].map((candidate: unknown) => {
    if (!record(candidate)) invalid("备份包文件条目无效");
    const path = candidate["path"];
    assertSafePath(path);
    const key = path.normalize("NFC").toLocaleLowerCase("en-US");
    if (seen.has(key)) invalid(`备份包含有重复文件路径：${path}`);
    seen.add(key);
    const size = candidate["size"];
    const digest = candidate["sha256"];
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 0) invalid(`备份包文件长度无效：${path}`);
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/u.test(digest)) invalid(`备份包文件校验值无效：${path}`);
    const bytes = decodeBase64(candidate["data"]);
    if (bytes.length !== size) invalid(`备份包文件长度不一致：${path}`);
    if (sha256(bytes) !== digest) invalid(`备份包文件校验失败：${path}`);
    return { path, bytes, sha256: digest };
  });
  const manifest = raw as unknown as BackupManifest;
  return {
    sourceId: manifest.sourceId,
    createdAt: manifest.createdAt,
    files,
  };
}

export function writeBackupFiles(root: string, backup: ParsedWorkBackup): void {
  const absoluteRoot = resolve(root);
  for (const file of backup.files) {
    assertSafePath(file.path);
    const target = resolve(join(absoluteRoot, ...file.path.split("/")));
    const rel = relative(absoluteRoot, target);
    if (rel.startsWith("..") || isAbsolute(rel)) invalid("备份包文件路径越过导入目录");
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.bytes);
  }
}
