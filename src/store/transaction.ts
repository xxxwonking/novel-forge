/**
 * 单进程内的同步文件事务。多文件写入先记录 before/after 日志，再逐个原子替换；
 * 未写下 committed 标记的操作一律回滚。读取项目之前先恢复遗留日志。
 * 不提供跨进程锁；回滚遇到不属于本事务的文件内容时停止，保留日志供排查。
 */
import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

const JOURNAL = ".pending-write.json";
interface FileChange { readonly path: string; readonly before: string | null; readonly after: string }
interface Journal { readonly version: 1; readonly state: "prepared" | "committed"; readonly files: readonly FileChange[] }
interface Pending { readonly writes: Map<string, string>; failure?: unknown }
const active = new Map<string, Pending>();

/** 不允许路径越界、符号链接、Windows ADS 或把目录当文件覆盖。 */
function targetPath(root: string, path: string, journal = false): string {
  const parts = path.split(/[\\/]/u);
  if (isAbsolute(path) || parts.some((part) => !part || part === "." || part === ".." || /[:\x00-\x1f]|[. ]$/u.test(part)) || (!journal && path === JOURNAL)) {
    throw new Error(`非法项目文件路径：${path}`);
  }
  let current = root;
  for (const [index, part] of parts.entries()) {
    current = join(current, part);
    let stat: ReturnType<typeof lstatSync>;
    try { stat = lstatSync(current); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (stat.isSymbolicLink() || (index === parts.length - 1 ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`项目路径不是普通${index === parts.length - 1 ? "文件" : "目录"}：${path}`);
    }
  }
  return current;
}

function readText(path: string): string | null {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** 同目录临时文件 + rename，避免截断已有文件；flush 保证先落下日志内容。 */
function replaceFile(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, text, { encoding: "utf8", flag: "wx", flush: true });
    renameSync(temporary, path);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function readJournal(root: string): Journal | undefined {
  const text = readText(targetPath(root, JOURNAL, true));
  if (text === null) return undefined;
  try {
    const value = JSON.parse(text) as Partial<Journal> | null;
    if (value === null || value.version !== 1 || (value.state !== "prepared" && value.state !== "committed") || !Array.isArray(value.files)) throw new Error("日志结构无效");
    const paths = new Set<string>();
    for (const file of value.files) {
      if (typeof file !== "object" || file === null || typeof file.path !== "string" || (file.before !== null && typeof file.before !== "string") || typeof file.after !== "string") throw new Error("文件记录无效");
      const key = targetPath(root, file.path).toLowerCase();
      if (paths.has(key)) throw new Error("文件记录重复");
      paths.add(key);
    }
    return value as Journal;
  } catch (error) {
    throw new Error(`${JOURNAL} 无法恢复：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function restoreFiles(root: string, journal: Journal): void {
  // 全部预检后才恢复，不能用旧日志覆盖作者在服务停止后手动修改的文件。
  const files = journal.files.map((file) => {
    const path = targetPath(root, file.path);
    const current = readText(path);
    if (current !== file.before && current !== file.after) throw new Error(`恢复冲突：${file.path} 已被其他操作修改`);
    return { path, current, desired: journal.state === "committed" ? file.after : file.before };
  });
  for (const file of files) {
    if (file.current === file.desired) continue;
    if (file.desired === null) rmSync(file.path, { force: true });
    else replaceFile(file.path, file.desired);
  }
}

export function recoverFileTransaction(root: string): void {
  const directory = resolve(root);
  if (active.has(directory)) return;
  const journal = readJournal(directory);
  if (journal === undefined) return;
  try {
    restoreFiles(directory, journal);
    rmSync(targetPath(directory, JOURNAL, true));
  } catch (error) {
    throw new Error(`项目保存尚未恢复，已保留 ${JOURNAL}：${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}

function commit(root: string, writes: ReadonlyMap<string, string>): void {
  const files = [...writes].map(([absolute, after]): FileChange => {
    const path = relative(root, absolute);
    return { path, before: readText(targetPath(root, path)), after };
  })
    .filter((file) => file.before !== file.after);
  if (files.length === 0) return;
  const journal: Journal = { version: 1, state: "prepared", files };
  const journalPath = targetPath(root, JOURNAL, true);
  replaceFile(journalPath, JSON.stringify(journal));
  try {
    for (const file of files) replaceFile(targetPath(root, file.path), file.after);
    replaceFile(journalPath, JSON.stringify({ ...journal, state: "committed" }));
  } catch (error) {
    try {
      restoreFiles(root, journal);
      rmSync(journalPath);
    } catch (recoveryError) {
      throw new AggregateError([error, recoveryError], `保存失败且尚未恢复，已保留 ${JOURNAL}`);
    }
    throw error;
  }
  // committed 已经落盘；清理失败不能把成功保存当成失败，下一次读取会重做清理。
  try { rmSync(journalPath); } catch { /* 恢复入口负责清理。 */ }
}

/** operation 必须同步；嵌套写操作加入外层事务，任何内层失败都会阻止提交。 */
export function withFileTransaction<T>(root: string, operation: () => T): T {
  const directory = resolve(root);
  const outer = active.get(directory);
  if (outer !== undefined) {
    try { return operation(); } catch (error) { outer.failure = error; throw error; }
  }
  recoverFileTransaction(directory);
  const pending: Pending = { writes: new Map() };
  active.set(directory, pending);
  try {
    const result = operation();
    if (result !== null && typeof result === "object" && "then" in result) throw new Error("文件事务必须同步执行");
    if ("failure" in pending) throw pending.failure;
    commit(directory, pending.writes);
    return result;
  } finally {
    active.delete(directory);
  }
}

/** 同一事务中读取刚写入的值；事务外读取前恢复上一次保存。 */
export function readProjectFile(root: string, path: string): string | undefined {
  const directory = resolve(root);
  recoverFileTransaction(directory);
  const target = targetPath(directory, path);
  return active.get(directory)?.writes.get(target) ?? readText(target) ?? undefined;
}

export function writeProjectFile(root: string, path: string, text: string): void {
  const directory = resolve(root);
  const target = targetPath(directory, path);
  const pending = active.get(directory);
  if (pending === undefined) {
    withFileTransaction(directory, () => writeProjectFile(directory, path, text));
    return;
  }
  // 规范绝对路径消除两种分隔符写法；日志使用相对路径，恢复时再次校验边界。
  pending.writes.set(target, text);
}
