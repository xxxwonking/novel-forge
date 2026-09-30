import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { readProjectFile, recoverFileTransaction, withFileTransaction, writeProjectFile } from "../src/store/transaction.js";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { DraftStore } from "../src/task/draft-store.js";
import { declaration, PROSE, savedDraft, writingSnapshot } from "./writing-fixtures.js";

const fault = vi.hoisted(() => ({ beforeRename: undefined as ((source: string, target: string) => void) | undefined }));
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, renameSync: (source: string, target: string) => { fault.beforeRename?.(String(source), String(target)); fs.renameSync(source, target); } };
});

const roots: string[] = [];
afterEach(() => {
  fault.beforeRename = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function seed() {
  const root = mkdtempSync(join(tmpdir(), "nf-transaction-"));
  roots.push(root);
  const store = new ProjectStore(root);
  store.save(writingSnapshot());
  const drafts = new DraftStore(root);
  drafts.saveDraft(savedDraft({ declaration: { ...declaration(), events: [{
    type: "plot_event", kind: "action", summary: "打开密库", weight: 2, plotLine: "P01", participants: ["C01"],
    anchor: { chapter: 3, quote: "打开了宗门密库", offsetHint: 0, occurrence: 0 },
  }] } }));
  return { root, store, drafts, session: new ProjectSession(root) };
}

describe("文件事务与采用中断恢复", () => {
  it("正式事件实际落盘后正文 rename 失败，仍回滚全部文件与内存，可重试同一稿", () => {
    const { root, store, drafts, session } = seed();
    const before = readFileSync(join(root, "events.jsonl"), "utf8");
    let failedAfterEvents = false;
    fault.beforeRename = (_source, target) => {
      if (target === join(root, "chapters", "ch3.txt")) {
        expect(readFileSync(join(root, "events.jsonl"), "utf8")).not.toBe(before);
        failedAfterEvents = true;
        fault.beforeRename = undefined;
        throw new Error("模拟磁盘写失败");
      }
    };
    expect(() => session.adopt(3, "ch3d1")).toThrow("模拟磁盘写失败");
    expect(failedAfterEvents).toBe(true);
    expect(session.currentChapter).toBe(2);
    expect(readFileSync(join(root, "events.jsonl"), "utf8")).toBe(before);
    expect(store.readChapter(3)).toBeUndefined();
    expect(drafts.workVersion()).toBe(0);
    expect(drafts.loadDraft(3, "ch3d1")?.status).toBe("ready");
    expect(session.adopt(3, "ch3d1").changed).toBe(true);
    expect(store.readChapter(3)).toBe(PROSE);
  });

  it.each(["prepared", "committed"])("子进程在 %s 阶段退出后，重开作品恢复一致状态", (phase) => {
    const { root, store, drafts } = seed();
    const beforeEvents = store.loadEvents();
    const script = `
      import fs from 'node:fs';
      import { syncBuiltinESMExports } from 'node:module';
      import { basename } from 'node:path';
      const [root, moduleUrl, phase] = process.argv.slice(1);
      const rename = fs.renameSync;
      fs.renameSync = (source, target) => {
        rename(source, target);
        if (phase === 'prepared' && basename(String(target)) === 'ch3.txt') process.exit(77);
        if (phase === 'committed' && basename(String(target)) === '.pending-write.json' && JSON.parse(fs.readFileSync(target, 'utf8')).state === 'committed') process.exit(77);
      };
      syncBuiltinESMExports();
      const { ProjectSession } = await import(moduleUrl);
      new ProjectSession(root).adopt(3, 'ch3d1');
    `;
    const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, root, new URL("../src/server/state.ts", import.meta.url).href, phase], { encoding: "utf8", timeout: 15000 });
    expect(child.error).toBeUndefined();
    expect(child.status, child.stderr).toBe(77);
    expect(existsSync(join(root, ".pending-write.json"))).toBe(true);
    // 进程确实在写入之后退出，而不是只手工拼一个日志模拟崩溃。
    expect(readFileSync(join(root, "chapters", "ch3.txt"), "utf8")).toBe(PROSE);
    const reopened = new ProjectSession(root);
    expect(existsSync(join(root, ".pending-write.json"))).toBe(false);
    if (phase === "prepared") {
      expect(reopened.currentChapter).toBe(2);
      expect(store.loadEvents()).toEqual(beforeEvents);
      expect(drafts.workVersion()).toBe(0);
      expect(drafts.loadDraft(3, "ch3d1")?.status).toBe("ready");
      expect(store.readChapter(3)).toBeUndefined();
      expect(reopened.adopt(3, "ch3d1").changed).toBe(true);
    } else {
      expect(reopened.currentChapter).toBe(3);
      expect(drafts.workVersion()).toBe(1);
      expect(drafts.loadDraft(3, "ch3d1")?.status).toBe("adopted");
      expect(store.loadEvents().length).toBe(beforeEvents.length + 1);
      expect(reopened.adopt(3, "ch3d1").changed).toBe(false);
    }
  });

  it("嵌套事务可读到暂存文件；内层异常即使被捕获也不提交部分改动", () => {
    const { root } = seed();
    expect(() => withFileTransaction(root, () => {
      writeProjectFile(root, "draft-note.txt", "first");
      expect(readProjectFile(root, "draft-note.txt")).toBe("first");
      try { withFileTransaction(root, () => { writeProjectFile(root, "draft-note.txt", "second"); throw new Error("nested failure"); }); } catch { /* 外层不能因此提交不完整操作。 */ }
    })).toThrow("nested failure");
    expect(existsSync(join(root, "draft-note.txt"))).toBe(false);
  });

  it("恢复发现作者另行修改的内容时不覆盖，保留日志并明确报错", () => {
    const { root } = seed();
    writeFileSync(join(root, "note.txt"), "author edit", "utf8");
    writeFileSync(join(root, ".pending-write.json"), JSON.stringify({ version: 1, state: "prepared", files: [{ path: "note.txt", before: "before", after: "after" }] }), "utf8");
    expect(() => recoverFileTransaction(root)).toThrow(/恢复冲突/u);
    expect(readFileSync(join(root, "note.txt"), "utf8")).toBe("author edit");
    expect(existsSync(join(root, ".pending-write.json"))).toBe(true);
  });

  it.each(["../outside.txt", "C:\\outside.txt", ".pending-write.json", "chapter.txt:stream"])("日志中的非法路径 %s 不会参与恢复", (path) => {
    const { root } = seed();
    const project = join(root, "isolated");
    mkdirSync(project);
    writeFileSync(join(root, "outside.txt"), "keep", "utf8");
    writeFileSync(join(project, ".pending-write.json"), JSON.stringify({ version: 1, state: "prepared", files: [{ path, before: "replace", after: "keep" }] }), "utf8");
    expect(() => recoverFileTransaction(project)).toThrow(/非法项目文件路径/u);
    expect(readFileSync(join(root, "outside.txt"), "utf8")).toBe("keep");
  });

  /**
   * 中文文件名不能把进程整个打死。
   *
   * Node v24.9.0 / win32 上 `rmSync` 对**不存在且含非 ASCII 字符**的路径会触发
   * `0xC0000409`（STATUS_STACK_BUFFER_OVERRUN）—— **进程当场死掉，没有异常、
   * 没有 stderr、catch 不住**，所以这一条只能开子进程按退出码判，
   * 不能在本进程里 `expect(...).toThrow`。
   *
   * 触发点原先在 `replaceFile` 的 `finally`：临时名是 `.<原文件名>.<uuid>.tmp`，
   * 而 rename 成功后这个路径已经不存在，却仍要 `rmSync` 一次。于是作者一导入
   * 中文名的资料（`人物档案.txt` 这类，§45 那条路）就把服务打死 —— 实测
   * `MaterialStore.save` 必崩，`test/import-chapters.test.ts` 的 worker 也是这么挂的。
   *
   * 是否触发与路径总长有关（所以历史上看起来像偶发）。这里用**三个不同长度**的
   * 中文名一起写，比单个名字更容易压到那条边界上。
   */
  it("中文文件名不会让进程崩掉（Node 24 / win32 的 rmSync 陷阱）", () => {
    const { root } = seed();
    const script = `
      const [root, moduleUrl] = process.argv.slice(1);
      const { writeProjectFile, readProjectFile } = await import(moduleUrl);
      const names = ["人物档案.txt", "目录及简介.txt", "第一卷·雾港封签的设定集与人物小传.txt"];
      for (const name of names) {
        writeProjectFile(root, "materials/" + name, "内容：" + name);
        if (readProjectFile(root, "materials/" + name) !== "内容：" + name) process.exit(70);
      }
      // 覆盖写一次：rename 的目标此时已存在，走的是另一条分支。
      writeProjectFile(root, "materials/人物档案.txt", "改过了");
      if (readProjectFile(root, "materials/人物档案.txt") !== "改过了") process.exit(71);
      process.exit(0);
    `;
    const child = spawnSync(process.execPath,
      ["--import", "tsx", "--input-type=module", "-e", script, root, new URL("../src/store/transaction.ts", import.meta.url).href],
      { encoding: "utf8", timeout: 30000 });
    expect(child.error).toBeUndefined();
    // 0xC0000409 = 3221226505。留在信息里，下次撞见能一眼认出来。
    expect(child.status, `exit=${child.status} (0xC0000409=3221226505 即栈缓冲区溢出) stderr=${child.stderr}`).toBe(0);
    expect(readFileSync(join(root, "materials", "人物档案.txt"), "utf8")).toBe("改过了");
    // 临时文件不能留下来。
    expect(readdirSync(join(root, "materials")).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
