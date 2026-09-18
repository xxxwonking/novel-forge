/**
 * 项目落盘（§12.7）。
 *
 * 两条重点：
 * ① **事件流恢复后 seq 与章内计数要续上** —— 只恢复数组会让下一次 append
 *    从 seq=1 开始，重放顺序被破坏，而那是投影正确性的唯一依赖。
 * ② **坏行报错而非跳过** —— 静默少一个事件会让伏笔清单凭空缺一条，
 *    比整个项目打不开难查得多。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectStore, alertStateMap, type ProjectSnapshot } from "../src/store/persist.js";
import { EventStream, commitDeclaration } from "../src/store/event-stream.js";
import { project } from "../src/store/project.js";
import { initialAlertState } from "../src/alerts/apply.js";
import { loadRules } from "../src/rules/load.js";
import { WRITING_DISCIPLINE } from "../src/context/discipline.js";
import { ProjectSession } from "../src/server/state.js";
import { beat, characters, settings, workProfile, workSetting } from "./fixtures.js";
import type { StructuralEvent } from "../src/types/events.js";
import type { CharacterCard } from "../src/types/character.js";
import type { AlertId, ChapterNo } from "../src/types/primitives.js";

const rules = loadRules();
const NOW = "2026-09-07T00:00:00.000Z";
const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "novel-forge-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

/** 设定块（去掉投影出来的 state）。 */
function settingBlocks(): readonly Omit<CharacterCard, "state">[] {
  return characters.map(({ state: _state, ...rest }) => rest);
}

function seedStream(): EventStream {
  const stream = new EventStream(() => NOW);
  commitDeclaration(stream, 52, {
    events: [
      {
        type: "plot_event",
        kind: "action",
        summary: "李长风在破庙接下第九式",
        weight: 3,
        plotLine: "P01",
        participants: ["C01"],
        anchor: { chapter: 52, quote: "断剑横在膝上", offsetHint: 0, occurrence: 0 },
      },
    ],
    foreshadowPlanted: [
      {
        type: "foreshadow_planted",
        foreshadowId: "F20",
        label: "三叔袖口的灰",
        intent: "灰是后山特有的，证明他那晚上过山。",
        weight: "sub",
        visibility: "covert",
        expectedBy: 70,
        anchor: { chapter: 52, quote: "袖口沾着一层灰", offsetHint: 30, occurrence: 0 },
      },
    ],
    foreshadowResolved: [],
    relationsChanged: [],
    characterStates: [],
    characterPresence: [{ type: "character_presence", characterId: "C01", role: "pov" }],
  });
  stream.decideChapter(52, "committed");
  return stream;
}

function snapshot(): ProjectSnapshot {
  const id = "foreshadow_overdue:F07" as AlertId;
  return {
    setting: workSetting,
    settings,
    discipline: WRITING_DISCIPLINE,
    profile: workProfile,
    characters: settingBlocks(),
    plotLines: [{ id: "P01", label: "复仇主线", weight: "main" }],
    volumes: [],
    beats: [beat],
    alertStates: [initialAlertState(id, NOW)],
    events: seedStream().all(),
    chapters: new Map<ChapterNo, string>([[52, "破庙的门板早烂了。\n断剑横在膝上。"]]),
  };
}

describe("save / load 往返", () => {
  it("全部内容原样回来", () => {
    const store = new ProjectStore(tempRoot());
    const snap = snapshot();
    store.save(snap);
    const back = store.load();

    expect(back.setting).toEqual(snap.setting);
    expect(back.settings).toEqual(snap.settings);
    expect(back.discipline).toEqual(snap.discipline);
    expect(back.profile).toEqual(snap.profile);
    expect(back.characters).toEqual(snap.characters);
    expect(back.plotLines).toEqual(snap.plotLines);
    expect(back.beats).toEqual(snap.beats);
    expect(back.alertStates).toEqual(snap.alertStates);
    expect(back.events).toEqual(snap.events);
    expect([...back.chapters]).toEqual([...snap.chapters]);
  });

  it("派生预算连 Derived 字段一起活着回来（JSON 不带 symbol 品牌，但值在）", () => {
    const store = new ProjectStore(tempRoot());
    store.save(snapshot());
    const budget = store.load().beats[0]?.budget;
    expect(budget?.words.min).toBe(beat.budget!.words.min);
    expect(budget?.tier).toBe(beat.budget!.tier);
  });

  it("exists() 区分空目录与项目", () => {
    const store = new ProjectStore(tempRoot());
    expect(store.exists()).toBe(false);
    store.save(snapshot());
    expect(store.exists()).toBe(true);
  });

  it("正文是纯文本一章一个文件 —— 用户能直接用编辑器打开", () => {
    const root = tempRoot();
    new ProjectStore(root).save(snapshot());
    expect(readFileSync(join(root, "chapters", "ch52.txt"), "utf8")).toContain("破庙的门板");
  });

  it("JSON 带缩进 —— 这些文件用户会手改（§5.8）", () => {
    const root = tempRoot();
    new ProjectStore(root).save(snapshot());
    expect(readFileSync(join(root, "setting.json"), "utf8").split("\n").length).toBeGreaterThan(5);
  });

  it("缺可选文件时给空数组，不抛", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    rmSync(join(root, "beats.json"));
    rmSync(join(root, "alert-states.json"));
    expect(store.load().beats).toEqual([]);
    expect(store.load().alertStates).toEqual([]);
  });

  it("缺必需文件时报出路径", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    rmSync(join(root, "setting.json"));
    expect(() => store.load()).toThrow(/setting\.json/u);
  });
});

describe("写章资料持久化与旧项目兼容", () => {
  const discipline = { version: "author-d2", rules: ["使用第三人称有限视角。", "对话避免重复解释。"] };

  it("地点、组织和作者纪律可落盘并在新会话中读取", () => {
    const root = tempRoot();
    const library = [...settings, { id: "S90" as const, name: "守卷司", kind: "organization" as const, description: "保管旧案卷宗。", facts: ["凭令牌查阅。"] }];
    new ProjectStore(root).save({ ...snapshot(), settings: library, discipline });

    const session = new ProjectSession(root);
    expect(session.meta.settings).toEqual(library);
    expect(session.meta.discipline).toEqual(discipline);
    expect(JSON.parse(readFileSync(join(root, "settings.json"), "utf8"))).toEqual(library);
    expect(JSON.parse(readFileSync(join(root, "discipline.json"), "utf8"))).toEqual(discipline);
  });

  it("旧项目缺文件时提供默认值，读取本身不修改项目", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    rmSync(join(root, "settings.json"));
    rmSync(join(root, "discipline.json"));

    const session = new ProjectSession(root);
    expect(session.meta.settings).toEqual([]);
    expect(session.meta.discipline).toEqual(WRITING_DISCIPLINE);
    expect(existsSync(join(root, "settings.json"))).toBe(false);
    expect(existsSync(join(root, "discipline.json"))).toBe(false);
  });

  it("旧格式 save 调用会保存默认资料", () => {
    const root = tempRoot();
    const { settings: _settings, discipline: _discipline, ...legacy } = snapshot();
    const store = new ProjectStore(root);
    store.save(legacy);
    expect(store.load().settings).toEqual([]);
    expect(store.load().discipline).toEqual(WRITING_DISCIPLINE);
  });

  it("会话更新资料后可重新打开，正式事件与正文保持完整", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    const before = store.load();
    const session = new ProjectSession(root);
    session.putSettings(settings.slice(0, 1));
    session.putDiscipline(discipline);

    expect(session.meta.settings).toEqual(settings.slice(0, 1));
    expect(session.meta.discipline).toEqual(discipline);
    const reopened = store.load();
    expect(reopened.settings).toEqual(session.meta.settings);
    expect(reopened.discipline).toEqual(discipline);
    expect(reopened.events).toEqual(before.events);
    expect(reopened.chapters).toEqual(before.chapters);
  });

  it.each(["settings.json", "discipline.json"])("损坏的 %s 报错，不静默退回默认值", (file) => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    writeFileSync(join(root, file), "{broken", "utf8");
    expect(() => store.load()).toThrow(file);
  });
});

describe("事件流：JSONL append-only", () => {
  it("一行一条事件", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    const events = seedStream().all();
    store.save({ ...snapshot(), events });

    const lines = readFileSync(join(root, "events.jsonl"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(events.length);
    expect(JSON.parse(lines[0]!)).toEqual(events[0]);
  });

  it("appendEvents 是真的追加，不重写已有行", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    const first = seedStream().all();
    store.save({ ...snapshot(), events: first });

    const extra = new EventStream(() => NOW);
    const added = commitDeclaration(extra, 53, {
      events: [],
      foreshadowPlanted: [],
      foreshadowResolved: [],
      relationsChanged: [],
      characterStates: [],
      characterPresence: [{ type: "character_presence", characterId: "C05", role: "minor" }],
    });
    store.appendEvents(added);

    const back = store.loadEvents();
    expect(back).toHaveLength(first.length + 1);
    expect(back.slice(0, first.length)).toEqual(first);
  });

  it("空数组不写出空行", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save({ ...snapshot(), events: [] });
    store.appendEvents([]);
    expect(readFileSync(join(root, "events.jsonl"), "utf8")).toBe("");
    expect(store.loadEvents()).toEqual([]);
  });

  it("坏行报错并指出行号 —— 不静默跳过", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    const text = readFileSync(join(root, "events.jsonl"), "utf8");
    writeFileSync(join(root, "events.jsonl"), `${text}{ 这不是 JSON\n`, "utf8");
    expect(() => store.loadEvents()).toThrow(/第 4 行/u);
  });

  it("rewriteEvents 用于裁决后的信封变更", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    const stream = new EventStream(() => NOW);
    commitDeclaration(stream, 52, {
      events: [],
      foreshadowPlanted: [],
      foreshadowResolved: [],
      relationsChanged: [],
      characterStates: [],
      characterPresence: [{ type: "character_presence", characterId: "C01", role: "pov" }],
    });
    store.rewriteEvents(stream.all());
    expect(store.loadEvents()[0]?.envelope.provenance).toBe("proposed");

    stream.decideChapter(52, "committed");
    store.rewriteEvents(stream.all());
    expect(store.loadEvents()).toHaveLength(1);
    expect(store.loadEvents()[0]?.envelope.provenance).toBe("committed");
  });
});

describe("EventStream.restore", () => {
  it("seq 续上，不从 1 重来", () => {
    const original = seedStream();
    const restored = EventStream.restore(original.all(), () => NOW);
    const appended = restored.append({
      chapter: 53,
      origin: "user_edit",
      provenance: "authored",
      payload: { type: "character_presence", characterId: "C05", role: "minor" },
    });
    const maxSeq = Math.max(...original.all().map((e) => e.envelope.seq));
    expect(appended.envelope.seq).toBe(maxSeq + 1);
  });

  it("章内计数续上 —— 不产生重复的 ch52-1", () => {
    const original = seedStream();
    const restored = EventStream.restore(original.all(), () => NOW);
    const appended = restored.append({
      chapter: 52,
      origin: "user_edit",
      provenance: "authored",
      payload: { type: "character_presence", characterId: "C05", role: "minor" },
    });
    const existing = original.byChapter(52).map((e) => e.envelope.id);
    expect(existing).not.toContain(appended.envelope.id);
    expect(appended.envelope.id).toBe(`ch52-${existing.length + 1}`);
  });

  it("恢复后 effective() 仍只给 committed / authored", () => {
    const stream = seedStream();
    stream.append({
      chapter: 53,
      origin: "C5_declaration",
      provenance: "proposed",
      payload: { type: "character_presence", characterId: "C05", role: "minor" },
    });
    const restored = EventStream.restore(stream.all(), () => NOW);
    expect(restored.all()).toHaveLength(stream.all().length);
    expect(restored.effective()).toHaveLength(stream.effective().length);
    expect(restored.pending()).toHaveLength(1);
  });

  it("空事件流可恢复，seq 从 1 起", () => {
    const restored = EventStream.restore([], () => NOW);
    const e = restored.append({
      chapter: 1,
      origin: "user_edit",
      provenance: "authored",
      payload: { type: "character_presence", characterId: "C01", role: "pov" },
    });
    expect(e.envelope.seq).toBe(1);
    expect(e.envelope.id).toBe("ch1-1");
  });
});

describe("落盘 → 投影 全链路", () => {
  it("存盘再读出来，投影结果与原地投影一致", () => {
    const store = new ProjectStore(tempRoot());
    const snap = snapshot();
    store.save(snap);

    const projectionInput = {
      currentChapter: 52 as ChapterNo,
      characterProfiles: characters.map((c) => ({
        id: c.id,
        name: c.name,
        tier: c.tier,
        introducedAt: c.introducedAt,
      })),
      plotLineDefs: snap.plotLines,
      plotLineGap: rules.crossChapter.plotLineGap,
    };

    const fromMemory = project({ ...projectionInput, events: effective(snap.events) });
    const fromDisk = project({ ...projectionInput, events: effective(store.loadEvents()) });
    expect(fromDisk).toEqual(fromMemory);
    expect(fromDisk.foreshadows.map((f) => f.id)).toEqual(["F20"]);
  });

  it("正文可按章单取，供锚点解析", () => {
    const store = new ProjectStore(tempRoot());
    store.save(snapshot());
    expect(store.readChapter(52)).toContain("断剑");
    expect(store.readChapter(99)).toBeUndefined();
  });

  it("单独写节拍表/告警状态不动其他文件", () => {
    const root = tempRoot();
    const store = new ProjectStore(root);
    store.save(snapshot());
    const before = readFileSync(join(root, "events.jsonl"), "utf8");

    store.writeBeats([]);
    store.writeAlertStates([]);
    expect(store.load().beats).toEqual([]);
    expect(readFileSync(join(root, "events.jsonl"), "utf8")).toBe(before);
  });

  it("新目录直接 append 不报「目录不存在」", () => {
    const store = new ProjectStore(join(tempRoot(), "nested", "proj"));
    store.appendEvents(seedStream().all());
    expect(store.loadEvents()).toHaveLength(3);
  });

  it("写正文会自动建 chapters 目录", () => {
    const root = join(tempRoot(), "fresh");
    new ProjectStore(root).writeChapter(1, "第一章正文。");
    expect(existsSync(join(root, "chapters", "ch1.txt"))).toBe(true);
  });
});

describe("alertStateMap", () => {
  it("数组转 Map，供 computeAlerts 直接用", () => {
    const s = initialAlertState("foreshadow_overdue:F07" as AlertId, NOW);
    const map = alertStateMap([s]);
    expect(map.get("foreshadow_overdue:F07")).toEqual(s);
  });
});

function effective(events: readonly StructuralEvent[]): readonly StructuralEvent[] {
  return events.filter(
    (e) => e.envelope.provenance === "committed" || e.envelope.provenance === "authored",
  );
}
