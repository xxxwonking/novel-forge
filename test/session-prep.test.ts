/**
 * Session 筹备写入口（Stage 2·切片 2）：设定/题材/人物/地点/情节线/首章节拍。
 *
 * 每项都验证两件事：① 内存即时反映；② 换一个会话重开同目录能读到（真落盘）。
 * planChapter 额外验证派生了预算、记为 authored（nextBeat 就绪的前提）。
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import { scaffoldSnapshot } from "../src/server/workspace.js";
import type { CharacterCard } from "../src/types/character.js";
import type { ChapterPlan } from "../src/types/beat.js";
import type { SettingCard } from "../src/context/select-l3.js";

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
});

function freshSession(): { root: string; session: ProjectSession } {
  const root = mkdtempSync(join(tmpdir(), "novel-forge-prep-"));
  roots.push(root);
  new ProjectStore(root).save(scaffoldSnapshot({ title: "测试作品", genre: "xuanhuan", platform: "fanqie" }));
  return { root, session: new ProjectSession(root) };
}

const reopen = (root: string): ProjectSession => new ProjectSession(root);

function character(id: `C${string}`, name: string): Omit<CharacterCard, "state"> {
  return {
    id,
    name,
    aliases: [],
    tier: "protagonist",
    introducedAt: 0,
    profile: { role: "主角", appearance: [], traits: [], forbiddenBehaviors: [], wants: "", fears: "", background: "" },
    speech: {
      sentenceLength: { min: 4, max: 20 },
      verbalTics: [],
      signatureLexicon: [],
      forbiddenLexicon: [],
      addressForms: [],
      syntaxBias: { question: 0.2, imperative: 0.2, elliptical: 0.2 },
      register: "neutral",
      emotionalExpression: "direct",
      exemplars: [],
      counterExemplars: [],
    },
    provenance: "authored",
    updatedAt: "2026-09-11T00:00:00.000Z",
  };
}

const location: SettingCard = { id: "S01", name: "集市", kind: "location", description: "三州交界的商埠。", facts: [] };

const validPlan: ChapterPlan = {
  chapterType: "event",
  coreEvent: "主角在集市查到一条线索",
  secondaryThread: null,
  stageFeedback: "主角确认了一个疑点",
  hook: "对方提到一个不该知道的名字",
  events: [{ kind: "action", summary: "与线人交涉逼出实话", weight: 1, plotLine: "P01" }],
  resolves: [],
  plants: [],
  characters: ["C01"],
  locations: ["S01"],
};

describe("Session 筹备写入口", () => {
  it("putSetting / putProfile 落盘并即时反映", () => {
    const { root, session } = freshSession();
    session.putSetting({ ...session.meta.setting, premise: "少年查案", centralConflict: "真凶是三叔" });
    session.putProfile({ ...session.meta.profile, targetWords: 500_000 });
    expect(session.meta.setting.premise).toBe("少年查案");
    const back = reopen(root).meta;
    expect(back.setting.centralConflict).toBe("真凶是三叔");
    expect(back.profile.targetWords).toBe(500_000);
  });

  it("upsertCharacter：新增、按 id 覆盖、排序、落盘", () => {
    const { root, session } = freshSession();
    session.upsertCharacter(character("C02", "苏晚晴"));
    session.upsertCharacter(character("C01", "李长风"));
    session.upsertCharacter({ ...character("C01", "李长风"), tier: "major" }); // 覆盖
    const chars = session.meta.characters;
    expect(chars.map((c) => c.id)).toEqual(["C01", "C02"]); // 按 id 排序
    expect(chars.find((c) => c.id === "C01")?.tier).toBe("major");
    expect(reopen(root).meta.characters).toHaveLength(2);
  });

  it("upsertSetting / putPlotLine 落盘", () => {
    const { root, session } = freshSession();
    session.upsertSetting(location);
    session.putPlotLine({ id: "P01", label: "复仇主线", weight: "main" });
    expect(session.meta.settings).toHaveLength(1);
    expect(session.meta.plotLines[0]?.label).toBe("复仇主线");
    const back = reopen(root).meta;
    expect(back.settings[0]?.name).toBe("集市");
    expect(back.plotLines).toHaveLength(1);
  });

  it("planChapter：派生预算 + authored + nextBeat 就绪", () => {
    const { root, session } = freshSession();
    const beat = session.planChapter(1, validPlan);
    expect(beat.provenance).toBe("authored");
    expect(beat.budget).not.toBeNull();
    expect(beat.budget?.words.min).toBeGreaterThan(0);
    // 下一章（第 1 章）节拍已就绪
    expect(session.nextBeat?.chapter).toBe(1);
    expect(reopen(root).beatFor(1)?.plan.coreEvent).toBe("主角在集市查到一条线索");
  });
});
