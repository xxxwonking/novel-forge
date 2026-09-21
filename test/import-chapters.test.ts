/**
 * 导入旧作·第一批：正文入库（差距盘点第 2 项）。
 *
 * 本批**只做正文**，不反推结构 —— 逐章 C5 式反推与跨章伏笔累积留作下一批。
 * 因此这里最要紧的两条断言是：
 *   ① 导入**不产生任何事件**。伏笔时间线为空是诚实状态，不能假装有结构。
 *   ② 导入**不覆盖已有正文**。`data/` 不入库、无 git 可恢复（第 22 节的事故），
 *      所以覆盖必须是作者显式勾选的动作，且带结构事件的章一律拒绝 —— 那些章的
 *      锚点指向现有正文，换掉正文等于让事件流指向不存在的原文。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handleAsync } from "../src/server/api.js";
import { joinChapterFiles, splitChapters } from "../src/import/split.js";
import { countWords } from "../src/text/measure.js";
import { writingSnapshot } from "./writing-fixtures.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

/** 空作品：没有正文也没有事件，导入旧稿的常规场景。 */
function empty(): string {
  const root = mkdtempSync(join(tmpdir(), "nf-import-"));
  roots.push(root);
  const base = writingSnapshot();
  new ProjectStore(root).save({ ...base, events: [], chapters: new Map(), beats: [] });
  return root;
}

/** 已写过两章的作品：第 1、2 章带 committed 结构事件（见 writingSnapshot）。 */
function written(): string {
  const root = mkdtempSync(join(tmpdir(), "nf-import-written-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  return root;
}

const api = (session: ProjectSession, path: string, body: unknown) =>
  handleAsync(session, { method: "POST", path, query: new URLSearchParams(), body });

describe("导入旧作·章节切分", () => {
  it("章号取自标记本身，不按出现顺序重新编号", () => {
    const result = splitChapters("第三章 破庙\n少年在破庙里醒来。\n\n第四章 断剑\n他捡起那把断剑。");
    expect(result.problems).toEqual([]);
    expect(result.chapters.map((c) => c.chapter)).toEqual([3, 4]);
    expect(result.chapters[0]).toMatchObject({ chapter: 3, title: "破庙", body: "少年在破庙里醒来。" });
    // 标记行本身不进正文 —— 它是目录信息，不是作者写的句子。
    expect(result.chapters[0]!.body).not.toContain("第三章");
    expect(result.chapters[0]!.words).toBe(countWords("少年在破庙里醒来。"));
  });

  it("中文数字、全角数字、阿拉伯数字都能解析", () => {
    const text = ["第一章 甲", "子。", "", "第十五章 乙", "丑。", "", "第一百零八章 丙", "寅。", "", "第２０９章 丁", "卯。", "", "第1024章 戊", "辰。"].join("\n");
    const result = splitChapters(text);
    expect(result.problems).toEqual([]);
    expect(result.chapters.map((c) => c.chapter)).toEqual([1, 15, 108, 209, 1024]);
  });

  it("只用一种标记层级：章里的「第N节」不会被二次切分", () => {
    const text = ["第一章 入门", "第一节", "少年拜师。", "第二节", "少年下山。", "", "第二章 离山", "他走了很远。"].join("\n");
    const result = splitChapters(text);
    expect(result.marker).toBe("章");
    expect(result.chapters.map((c) => c.chapter)).toEqual([1, 2]);
    // 小节标记留在正文里，由作者自己决定要不要删；切分器不擅自丢内容。
    expect(result.chapters[0]!.body).toContain("第一节");
    expect(result.chapters[0]!.body).toContain("少年下山。");
  });

  it("整本只用「第N回」时就按回切分", () => {
    const result = splitChapters("第一回 初见\n甲。\n\n第二回 再会\n乙。");
    expect(result.marker).toBe("回");
    expect(result.chapters.map((c) => c.chapter)).toEqual([1, 2]);
  });

  it("第一个标记之前的内容单列为楔子，本次不导入", () => {
    const result = splitChapters("楔子\n三十年前的那场雪。\n\n第一章 破庙\n少年醒来。");
    expect(result.chapters.map((c) => c.chapter)).toEqual([1]);
    expect(result.preface?.words).toBe(countWords("楔子\n三十年前的那场雪。"));
    expect(result.notes.join("")).toMatch(/楔子|开头/u);
    // 提示而不是阻断 —— 大多数文件开头是版权页或书名，作者未必要它。
    expect(result.problems).toEqual([]);
  });

  it("重号、空章、无标记都阻断导入", () => {
    expect(splitChapters("第一章 甲\n子。\n\n第一章 乙\n丑。").problems.join("")).toMatch(/第 1 章出现了两次/u);
    expect(splitChapters("第一章 甲\n\n第二章 乙\n丑。").problems.join("")).toMatch(/第 1 章（第一章 甲）标记下没有正文/u);
    expect(splitChapters("这是一段没有任何章节标记的文字。").problems.join("")).toMatch(/没有识别到章节标记/u);
    expect(splitChapters("   ").problems.length).toBeGreaterThan(0);
  });

  it("以「第三章」开头的正文段落不会被当成标记行劈开一章", () => {
    // 章号后面没有分隔符 —— 这是标记行与正文段落的分界线。
    const text = "第一章 旧事\n少年想起往事。\n第三章的事他一直记得很清楚，那天的雪下得很大。\n他没有再说话。";
    const result = splitChapters(text);
    expect(result.chapters.map((c) => c.chapter)).toEqual([1]);
    expect(result.chapters[0]!.body).toContain("第三章的事他一直记得很清楚");
    // 带了分隔符但长得像一整段的，由长度兜底挡住。
    const spaced = splitChapters(`第一章 旧事\n少年想起往事。\n第三章 ${"的事他一直记得很清楚，那天的雪下得很大".repeat(3)}\n他没有再说话。`);
    expect(spaced.chapters.map((c) => c.chapter)).toEqual([1]);
    // 「第一章节」是个词，不是标记。
    expect(splitChapters("第一章 甲\n第一章节讲的是入门。\n子。").chapters).toHaveLength(1);
  });

  it("缺号只提示不阻断 —— 作者可能分两次导入", () => {
    const result = splitChapters("第一章 甲\n子。\n\n第三章 丙\n寅。");
    expect(result.problems).toEqual([]);
    expect(result.notes.join("")).toMatch(/第 2 章/u);
    expect(result.chapters.map((c) => c.chapter)).toEqual([1, 3]);
  });
});

describe("导入旧作·入库", () => {
  it("落盘为正式正文，下一章顺延，且不产生任何事件", async () => {
    const root = empty();
    const session = new ProjectSession(root);
    const text = "第一章 破庙\n少年在破庙里醒来。\n\n第二章 断剑\n他捡起那把断剑。";
    const preview = session.imports.preview({ text });
    expect(preview.ready).toBe(true);
    expect(preview.conflicts).toEqual([]);

    const result = session.imports.apply({ text });
    expect(result.imported).toEqual([1, 2]);
    expect(result.replaced).toEqual([]);
    expect(result.nextChapter).toBe(3);

    // 内存与磁盘都要对：重开会话读到的是同一份正文。
    expect(session.chapterText(1)).toBe("少年在破庙里醒来。");
    expect(readFileSync(join(root, "chapters", "ch2.txt"), "utf8")).toBe("他捡起那把断剑。");
    const reopened = new ProjectSession(root);
    expect(reopened.currentChapter).toBe(2);
    expect(reopened.nextChapter).toBe(3);

    // 本批只入正文。结构是下一批的事，这里不能凭空长出事件。
    expect(reopened.events()).toEqual([]);
    expect(reopened.derived.projections.foreshadows).toEqual([]);

    // 入库后资料页该提示的是"去起草资料"，而不是"已经就绪"。
    expect(session.preparation.view().readiness.ready).toBe(false);
    void api;
  });

  it("默认不覆盖已有正文；逐字相同时算作已导入，重试幂等", () => {
    const root = empty();
    const session = new ProjectSession(root);
    const text = "第一章 破庙\n少年在破庙里醒来。";
    session.imports.apply({ text });

    // 同一份文件再导一次：不是冲突，是"这一章已经是这个内容"。
    const again = session.imports.preview({ text });
    expect(again.ready).toBe(true);
    expect(again.conflicts).toHaveLength(1);
    expect(again.conflicts[0]).toMatchObject({ chapter: 1, identical: true, locked: false });
    expect(session.imports.apply({ text })).toMatchObject({ imported: [], replaced: [], unchanged: [1] });

    // 换了内容就必须作者明确勾选覆盖。
    const changed = "第一章 破庙\n少年在破庙里醒来，雪还没停。";
    const conflict = session.imports.preview({ text: changed });
    expect(conflict.ready).toBe(false);
    expect(conflict.readyWithOverwrite).toBe(true);
    expect(conflict.conflicts[0]).toMatchObject({ chapter: 1, identical: false, locked: false });
    expect(() => session.imports.apply({ text: changed })).toThrow(/第 1 章/u);
    expect(session.chapterText(1)).toBe("少年在破庙里醒来。");

    expect(session.imports.apply({ text: changed, overwrite: true })).toMatchObject({ imported: [], replaced: [1] });
    expect(session.chapterText(1)).toBe("少年在破庙里醒来，雪还没停。");
  });

  it("已有结构事件的章节即使勾了覆盖也拒绝 —— 换掉正文会让锚点指向不存在的原文", () => {
    const session = new ProjectSession(written());
    const before = session.chapterText(1);
    const text = "第一章 破庙\n完全不同的正文。";
    const preview = session.imports.preview({ text });
    expect(preview.ready).toBe(false);
    expect(preview.readyWithOverwrite).toBe(false);
    expect(preview.conflicts[0]).toMatchObject({ chapter: 1, locked: true });
    expect(preview.conflicts[0]!.reason).toMatch(/结构|修订/u);

    expect(() => session.imports.apply({ text, overwrite: true })).toThrow(/第 1 章/u);
    expect(session.chapterText(1)).toBe(before);
  });

  it("有阻断项时一章都不写 —— 失败的导入不留半本书", () => {
    const root = empty();
    const session = new ProjectSession(root);
    // 第 2 章重号：整批都不该落盘。
    expect(() => session.imports.apply({ text: "第一章 甲\n子。\n\n第二章 乙\n丑。\n\n第二章 丙\n寅。" })).toThrow();
    expect(session.chapterNumbers()).toEqual([]);
    expect(new ProjectSession(root).chapterNumbers()).toEqual([]);

    // 混批更要紧：第 1 章被锁、第 9 章是全新的，不能只写进去一半。
    const busy = written();
    const mixed = new ProjectSession(busy);
    expect(() => mixed.imports.apply({ text: "第一章 甲\n完全不同的正文。\n\n第九章 己\n全新的一章。", overwrite: true })).toThrow(/第 1 章/u);
    expect(mixed.chapterText(9)).toBeUndefined();
    expect(new ProjectSession(busy).chapterNumbers()).toEqual([1, 2]);
  });

  it("只导第 7 章而书里只有 1–3 章时，明说 4–6 章仍是空的", () => {
    const session = new ProjectSession(empty());
    session.imports.apply({ text: "第一章 甲\n子。\n\n第二章 乙\n丑。\n\n第三章 丙\n寅。" });
    // 切分器看不见这件事 —— 文件里只有一章，本来就没有"缺号"。
    expect(splitChapters("第七章 庚\n午。").notes).toEqual([]);
    // 服务层知道书里已有什么，必须替作者把空洞说出来。
    const preview = session.imports.preview({ text: "第七章 庚\n午。" });
    expect(preview.notes.join("")).toMatch(/导入后第 4、5、6 章仍然没有正文/u);
    expect(preview.ready).toBe(true);
    expect(session.imports.apply({ text: "第七章 庚\n午。" }).nextChapter).toBe(8);
  });

  it("两个端点可用，参数不对时报 400", async () => {
    const session = new ProjectSession(empty());
    const text = "第一章 破庙\n少年在破庙里醒来。";
    const preview = await api(session, "/api/import/preview", { text });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ ready: true });

    const applied = await api(session, "/api/import/apply", { text });
    expect(applied.status).toBe(200);
    expect(applied.body).toMatchObject({ imported: [1] });
    expect(session.chapterText(1)).toBe("少年在破庙里醒来。");

    for (const bad of [null, {}, { text: 42 }, { text: "第一章 甲\n子。", overwrite: "yes" }]) {
      expect((await api(session, "/api/import/preview", bad)).status).toBe(400);
    }
    // 切不出章节是 400（作者的输入问题），并给出可操作的说明。
    const none = await api(session, "/api/import/apply", { text: "没有任何标记的一段话。" });
    expect(none.status).toBe(400);
    expect(String((none.body as { error: string }).error)).toMatch(/标记/u);
  });
});

/**
 * 每章一个文件是国内写作工具最常见的存法（真机第一次撞墙就是它：一个目录、
 * 100 个 `N-标题.txt`）。多文件导���要解决的只有两件事：**顺序**与**不该并进去的文件**。
 */
describe("导入旧作·多文件", () => {
  const file = (name: string, text: string) => ({ name, text });
  const chapterFile = (n: number, title: string) => file(`${n}-${title}.txt`, `第${n}章 ${title}\n\n${title}的正文。`);

  it("按文件名里的章号排序，不按字典序：1、2、10、100 而不是 1、10、100、2", () => {
    const files = [chapterFile(10, "十"), chapterFile(100, "百"), chapterFile(2, "二"), chapterFile(1, "一")];
    const joined = joinChapterFiles(files);
    expect(joined.order).toEqual(["1-一.txt", "2-二.txt", "10-十.txt", "100-百.txt"]);
    const split = splitChapters(joined.text);
    expect(split.chapters.map((c) => c.chapter)).toEqual([1, 2, 10, 100]);
    expect(split.notes.some((n) => n.includes("不是递增顺序"))).toBe(false);
  });

  it("选整个文件夹时文件带目录前缀：按文件名而不是整条路径认章号", () => {
    const files = [file("失踪档案/10-十.txt", "第10章 十\n\n正文。"), file("失踪档案/2-二.txt", "第2章 二\n\n正文。"), file("失踪档案/子目录/1-一.txt", "第1章 一\n\n正文。")];
    expect(joinChapterFiles(files).order).toEqual(["失踪档案/子目录/1-一.txt", "失踪档案/2-二.txt", "失踪档案/10-十.txt"]);
  });

  it("文件名里是中文数字也按章号排：第一章、第二章、第十章", () => {
    const files = [file("第十章.txt", "第十章 十\n\n正文。"), file("第一章.txt", "第一章 一\n\n正文。"), file("第二章.txt", "第二章 二\n\n正文。")];
    expect(joinChapterFiles(files).order).toEqual(["第一章.txt", "第二章.txt", "第十章.txt"]);
  });

  it("没有章节标记的文件（大纲、人物档案）跳过并点名，不并进前一章的末尾", () => {
    const files = [chapterFile(1, "一"), file("角色档案.txt", "沈叙：复核室警员。\n程霜：失踪者。"), chapterFile(2, "二"), file("小说大纲.txt", "全书一百章。")];
    const joined = joinChapterFiles(files);
    expect(joined.notes.some((n) => n.includes("角色档案.txt") && n.includes("小说大纲.txt"))).toBe(true);
    const split = splitChapters(joined.text);
    expect(split.chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(split.chapters[0]?.body).not.toContain("沈叙");
    expect(split.chapters[1]?.body).not.toContain("一百章");
  });

  it("某个文件在标记行之前带了未编号内容：不并进前一章，单独说明", () => {
    const files = [chapterFile(1, "一"), file("2-二.txt", "雨中的旧录音\n\n第2章 二\n\n二的正文。")];
    const joined = joinChapterFiles(files);
    const split = splitChapters(joined.text);
    expect(split.chapters[0]?.body).toBe("一的正文。");
    expect(joined.notes.some((n) => n.includes("2-二.txt") && n.includes("标记行之前"))).toBe(true);
  });

  it("目录文件被识别并跳过 —— 它每一行都像标记，但一行正文也没有", () => {
    // 真机撞上的：`目录及简介.txt` 里是一份一百行的目录，长得和一本书一模一样。
    const toc = ["《失踪档案》", "", "【目录】", ...Array.from({ length: 5 }, (_, i) => `第00${i + 1}章 标题${i + 1}`)].join("\n");
    const files = [chapterFile(1, "一"), file("目录及简介.txt", toc), chapterFile(2, "二")];
    const joined = joinChapterFiles(files);
    expect(joined.notes.some((n) => n.includes("目录及简介.txt") && n.includes("目录"))).toBe(true);
    const split = splitChapters(joined.text);
    expect(split.chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(split.problems).toEqual([]);
  });

  it("只有一条标记又没正文的，仍按问题报出来 —— 那是切坏了，不是目录", () => {
    const files = [chapterFile(1, "一"), file("2-二.txt", "第2章 二")];
    const split = splitChapters(joinChapterFiles(files).text);
    expect(split.problems.some((p) => p.includes("没有正文"))).toBe(true);
  });

  it("端点接受 files，预览与导入走同一份拼接；text 与 files 二选一", async () => {
    const session = new ProjectSession(empty(), undefined);
    const files = [chapterFile(2, "二"), chapterFile(1, "一"), file("目录及简介.txt", "《失踪档案》\n\n作品简介。")];
    const preview = await api(session, "/api/import/preview", { files });
    expect(preview.status).toBe(200);
    const body = preview.body as { chapters: { chapter: number }[]; notes: string[]; ready: boolean };
    expect(body.chapters.map((c) => c.chapter)).toEqual([1, 2]);
    expect(body.notes.some((n) => n.includes("目录及简介.txt"))).toBe(true);
    expect(body.ready).toBe(true);
    const applied = await api(session, "/api/import/apply", { files });
    expect(applied.status).toBe(200);
    expect(session.chapterText(1)).toBe("一的正文。");
    expect(session.chapterText(2)).toBe("二的正文。");

    expect((await api(session, "/api/import/preview", { text: "第1章 x\n正文", files })).status).toBe(400);
    expect((await api(session, "/api/import/preview", { files: [] })).status).toBe(400);
    expect((await api(session, "/api/import/preview", { files: [{ name: "a.txt" }] })).status).toBe(400);
    expect((await api(session, "/api/import/preview", { files: [{ name: 3, text: "x" }] })).status).toBe(400);
  });
});
