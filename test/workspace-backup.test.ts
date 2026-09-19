import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { ProjectStore } from "../src/store/persist.js";
import { createBackupPackage, parseBackupPackage, writeBackupFiles } from "../src/workspace/backup.js";
import { Workspace } from "../src/workspace/service.js";
import type { CallResult } from "../src/client/claude.js";
import { C5_JSON, PROSE, modelText, writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function directory(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  roots.push(root);
  return root;
}

function manifest(bytes: Uint8Array): any {
  return JSON.parse(gunzipSync(bytes).toString("utf8"));
}

function encoded(value: unknown): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(value), "utf8"));
}

function packageFixture(): { root: string; bytes: Buffer; value: any } {
  const root = directory("nf-backup-fixture");
  writeFileSync(join(root, "setting.json"), "{}\n", "utf8");
  const bytes = createBackupPackage(root, "book-a");
  return { root, bytes, value: manifest(bytes) };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("作品备份包", () => {
  it("往返保留所有普通文件的原始字节，但不携带凭据和事务临时文件", () => {
    const source = directory("nf-backup-source");
    mkdirSync(join(source, "chapters"), { recursive: true });
    mkdirSync(join(source, "drafts", "ch3"), { recursive: true });
    mkdirSync(join(source, "future"), { recursive: true });
    writeFileSync(join(source, "setting.json"), "{\n  \"title\": \"雨城来信\"\n}\n", "utf8");
    writeFileSync(join(source, "chapters", "ch1.txt"), "第一章\n雨落下来。\n", "utf8");
    writeFileSync(join(source, "drafts", "ch3", "raw.bin"), Buffer.from([0, 1, 2, 255]));
    writeFileSync(join(source, "future", "unknown.data"), "未来版本的数据", "utf8");
    writeFileSync(join(source, ".env.local"), "ANTHROPIC_API_KEY=secret\n", "utf8");
    writeFileSync(join(source, ".pending-write.json"), "{}\n", "utf8");
    writeFileSync(join(source, "setting.json.tmp"), "partial", "utf8");

    const bytes = createBackupPackage(source, "rain-city");
    const parsed = parseBackupPackage(bytes);
    const target = directory("nf-backup-target");
    writeBackupFiles(target, parsed);

    expect(parsed.sourceId).toBe("rain-city");
    expect(parsed.files.map((file) => file.path)).toEqual([
      "chapters/ch1.txt",
      "drafts/ch3/raw.bin",
      "future/unknown.data",
      "setting.json",
    ]);
    for (const file of parsed.files) {
      expect(readFileSync(join(target, ...file.path.split("/")))).toEqual(readFileSync(join(source, ...file.path.split("/"))));
    }
    expect(existsSync(join(target, ".env.local"))).toBe(false);
    expect(existsSync(join(target, ".pending-write.json"))).toBe(false);
    expect(existsSync(join(target, "setting.json.tmp"))).toBe(false);
  });

  it.each([
    "../outside",
    "chapters/../../outside",
    "/absolute",
    "C:/outside",
    "C:\\outside",
    "chapters\\ch1.txt",
    "chapters//ch1.txt",
    "chapters/./ch1.txt",
    "chapters/../ch1.txt",
  ])("拒绝危险的包内路径 %s", (path) => {
    const { value } = packageFixture();
    value.files[0].path = path;
    expect(() => parseBackupPackage(encoded(value))).toThrow(/路径/u);
  });

  it("拒绝大小写不同但会落到同一文件的重复路径", () => {
    const { value } = packageFixture();
    value.files.push({ ...value.files[0], path: "SETTING.json" });
    expect(() => parseBackupPackage(encoded(value))).toThrow(/重复/u);
  });

  it.each([".env", ".env.local", "nested/.env.production", ".pending-write.json", ".setting.json.id.tmp"])("拒绝第三方包重新塞入凭据或事务临时文件 %s", (path) => {
    const { value } = packageFixture();
    value.files[0].path = path;
    expect(() => parseBackupPackage(encoded(value))).toThrow(/凭据|临时/u);
  });

  it.each([
    ["format", "another-format"],
    ["version", 2],
    ["sourceId", "../outside"],
  ])("拒绝不兼容或不安全的清单字段 %s", (key, replacement) => {
    const { value } = packageFixture();
    value[key] = replacement;
    expect(() => parseBackupPackage(encoded(value))).toThrow();
  });

  it("拒绝不是 gzip 或不是 JSON 的输入", () => {
    expect(() => parseBackupPackage(Buffer.from("plain text"))).toThrow(/备份/u);
    expect(() => parseBackupPackage(gzipSync(Buffer.from("not json")))).toThrow(/备份/u);
  });

  it("拒绝被篡改的文件长度、哈希和 base64", () => {
    const changedSize = packageFixture().value;
    changedSize.files[0].size += 1;
    expect(() => parseBackupPackage(encoded(changedSize))).toThrow(/长度/u);

    const changedHash = packageFixture().value;
    changedHash.files[0].sha256 = "0".repeat(64);
    expect(() => parseBackupPackage(encoded(changedHash))).toThrow(/校验/u);

    const changedData = packageFixture().value;
    changedData.files[0].data = "%%%";
    expect(() => parseBackupPackage(encoded(changedData))).toThrow(/base64/u);
  });

  it("源目录出现符号链接时拒绝打包，不静默漏掉或跟随到目录外", () => {
    const root = directory("nf-backup-symlink");
    writeFileSync(join(root, "setting.json"), "{}\n", "utf8");
    symlinkSync(join(root, "setting.json"), join(root, "linked.json"));
    expect(() => createBackupPackage(root, "book-a")).toThrow(/符号链接/u);
  });
});

describe("工作区备份与迁移", () => {
  it("活动作品可备份并用新 ID 原子导入，未知文件也完整保留", () => {
    const root = directory("nf-backup-workspace");
    const original = join(root, "book-a");
    new ProjectStore(original).save(writingSnapshot());
    mkdirSync(join(original, "future"), { recursive: true });
    writeFileSync(join(original, "future", "extension.bin"), Buffer.from([9, 8, 7, 0]));
    const workspace = new Workspace(root);

    const artifact = workspace.backup({ id: "book-a" });
    const imported = workspace.importBackup(artifact.bytes, { targetId: "book-b" });

    expect(artifact).toMatchObject({ sourceId: "book-a", filename: expect.stringMatching(/\.nforge$/u), sha256: expect.stringMatching(/^[0-9a-f]{64}$/u) });
    expect(imported).toMatchObject({ id: "book-b", title: writingSnapshot().setting.title });
    expect(readFileSync(join(root, "book-b", "future", "extension.bin"))).toEqual(readFileSync(join(original, "future", "extension.bin")));
    expect(new ProjectStore(join(root, "book-b")).load()).toEqual(new ProjectStore(original).load());
  });

  it("回收站归档使用同一套包格式，导入不需要先恢复", () => {
    const root = directory("nf-backup-archive");
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());
    const workspace = new Workspace(root);
    const removed = workspace.remove({ id: "book-a" });

    const artifact = workspace.backup({ archive: removed.archive });
    const imported = workspace.importBackup(artifact.bytes, {});

    expect(artifact.sourceId).toBe("book-a");
    expect(imported.id).toBe("book-a");
    expect(existsSync(join(root, ".trash", removed.archive, "setting.json"))).toBe(true);
    expect(new ProjectStore(join(root, "book-a")).load()).toEqual(writingSnapshot());
  });

  it("默认沿用原 ID；位置被占用时拒绝且不改原作品", () => {
    const sourceRoot = directory("nf-backup-collision-source");
    new ProjectStore(join(sourceRoot, "book-a")).save(writingSnapshot());
    const bytes = new Workspace(sourceRoot).backup({ id: "book-a" }).bytes;
    const targetRoot = directory("nf-backup-collision-target");
    const base = writingSnapshot();
    const occupied = { ...base, setting: { ...base.setting, title: "不要覆盖我" } };
    new ProjectStore(join(targetRoot, "book-a")).save(occupied);
    const workspace = new Workspace(targetRoot);

    expect(() => workspace.importBackup(bytes, {})).toThrow(/占用/u);
    expect(new ProjectStore(join(targetRoot, "book-a")).load().setting.title).toBe("不要覆盖我");
    expect(readdirNames(targetRoot).filter((name) => name.startsWith(".importing-"))).toEqual([]);
  });

  it("无效目标 ID 或无效作品内容不留下目标和临时目录", () => {
    const source = directory("nf-backup-invalid-source");
    writeFileSync(join(source, "setting.json"), "{}\n", "utf8");
    const bytes = createBackupPackage(source, "book-a");
    const root = directory("nf-backup-invalid-target");
    const workspace = new Workspace(root);

    expect(() => workspace.importBackup(bytes, { targetId: "../outside" })).toThrow(/ID/u);
    expect(() => workspace.importBackup(bytes, { targetId: "book-a" })).toThrow();
    expect(existsSync(join(root, "book-a"))).toBe(false);
    expect(readdirNames(root).filter((name) => name.startsWith(".importing-"))).toEqual([]);
  });

  it("章节任务仍可能落盘时拒绝备份，真正结束后才放行", async () => {
    const root = directory("nf-backup-running");
    new ProjectStore(join(root, "book-a")).save(writingSnapshot());
    const waiting = deferred<CallResult>();
    let calls = 0;
    const workspace = new Workspace(root, {
      client: { official: false, call: async () => ++calls === 1 ? waiting.promise : modelText(C5_JSON) },
    });
    const session = workspace.project("book-a");
    const started = session.startChapter({ chapter: 3 });

    expect(() => workspace.backup({ id: "book-a" })).toThrow(/尚未停稳/u);
    expect(session.controlChapter(3, started.draftId, "pause").status).toBe("pausing");
    expect(() => workspace.backup({ id: "book-a" })).toThrow(/尚未停稳/u);
    expect(session.controlChapter(3, started.draftId, "end").status).toBe("ending");
    expect(() => workspace.backup({ id: "book-a" })).toThrow(/尚未停稳/u);

    const completed = session.writeChapter({ chapter: 3, draftId: started.draftId });
    waiting.resolve(modelText(PROSE));
    await completed.catch(() => undefined);
    expect(() => workspace.backup({ id: "book-a" })).not.toThrow();
  });
});

function readdirNames(root: string): string[] {
  return existsSync(root) ? readdirSync(root) : [];
}
