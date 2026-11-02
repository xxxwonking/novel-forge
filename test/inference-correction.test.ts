import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectSession } from "../src/server/state.js";
import { ProjectStore } from "../src/store/persist.js";
import {
  fakeClient,
  modelText,
  SINGLE_PASS_RULES,
  writingSnapshot,
} from "./writing-fixtures.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const prose = "李长风收好钥匙。钥匙上的红泥已经干透。";
async function setup() {
  const root = mkdtempSync(join(tmpdir(), "nf-correction-"));
  roots.push(root);
  new ProjectStore(root).save({
    ...writingSnapshot(),
    chapters: new Map([[1, prose]]),
    events: [],
  });
  const session = new ProjectSession(root, SINGLE_PASS_RULES, {
    client: fakeClient([
      modelText(
        JSON.stringify({
          events: [
            {
              kind: "action",
              summary: "误读为归还钥匙",
              weight: 1,
              plot_line: "P01",
              participants: ["C01"],
              quote: "李长风收好钥匙。",
            },
          ],
          foreshadow_planted: [],
          foreshadow_resolved: [],
          relations_changed: [],
          character_states: [],
          character_presence: [{ character_id: "C01", role: "pov" }],
        }),
      ),
    ]).client,
  });
  await session.inference.infer({ chapter: 1 });
  session.inference.confirm({ chapter: 1 });
  return { root, session };
}
const change = {
  section: "events",
  index: 0,
  value: {
    kind: "action",
    summary: "李长风收好钥匙",
    weight: 1,
    plotLine: "P01",
    participants: ["C01"],
    quote: "李长风收好钥匙。",
  },
};
it("已确认反推可提出结构纠正候选，确认前事实不变，确认后原文不变且旧记录留审计", async () => {
  const { session } = await setup();
  const source = session.inferenceCorrections.view(1);
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: source.sourceToken,
    summary: "纠正收好而非归还",
    changes: [change],
  });
  expect(session.revise.adoptedDeclaration(1).events[0]?.summary).toContain(
    "误读",
  );
  session.inferenceCorrections.confirm({ id: p.id });
  expect(session.revise.adoptedDeclaration(1).events[0]?.summary).toBe(
    "李长风收好钥匙",
  );
  expect(session.chapterText(1)).toBe(prose);
  expect(
    session
      .events()
      .some(
        (e) =>
          e.envelope.provenance === "rejected" &&
          e.payload.type === "plot_event" &&
          e.payload.summary.includes("误读"),
      ),
  ).toBe(true);
});
it("换版、假令牌和无效引文不能改正式结构", async () => {
  const { session } = await setup();
  const source = session.inferenceCorrections.view(1);
  expect(() =>
    session.inferenceCorrections.propose({
      chapter: 1,
      sourceToken: "bad",
      summary: "纠正",
      changes: [change],
    }),
  ).toThrow();
  expect(() =>
    session.inferenceCorrections.propose({
      chapter: 1,
      sourceToken: source.sourceToken,
      summary: "纠正",
      changes: [{ ...change, value: { ...change.value, quote: "假的引用" } }],
    }),
  ).toThrow();
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: source.sourceToken,
    summary: "纠正",
    changes: [change],
  });
  session.putChapter(1, prose + "新增正文。");
  expect(() => session.inferenceCorrections.confirm({ id: p.id })).toThrow(
    /变化/,
  );
});
it("重启可恢复候选；同一确认重复提交不追加事件", async () => {
  const { session, root } = await setup();
  const v = session.inferenceCorrections.view(1);
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: v.sourceToken,
    summary: "纠正",
    changes: [change],
  });
  const fresh = new ProjectSession(root, SINGLE_PASS_RULES);
  fresh.inferenceCorrections.confirm({ id: p.id });
  const count = fresh.events().length;
  fresh.inferenceCorrections.confirm({ id: p.id });
  expect(fresh.events()).toHaveLength(count);
});
it("候选文件损坏不能绕过确认时的记录校验", async () => {
  const { session, root } = await setup();
  const v = session.inferenceCorrections.view(1);
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: v.sourceToken,
    summary: "纠正",
    changes: [change],
  });
  const { readFileSync, writeFileSync } = await import("node:fs");
  const file = join(root, "inference-corrections", `${p.id}.json`);
  const raw = JSON.parse(readFileSync(file, "utf8"));
  raw.declaration.events[0].participants = ["C_UNKNOWN"];
  writeFileSync(file, JSON.stringify(raw));
  expect(() => session.inferenceCorrections.confirm({ id: p.id })).toThrow(
    /损坏|校验|变化/,
  );
  expect(session.revise.adoptedDeclaration(1).events[0]?.summary).toContain(
    "误读",
  );
});
it("移除被后章兑现的伏笔会先预览硬冲突并进入原返修清单", async () => {
  const { session } = await setup();
  const original = session.revise.adoptedDeclaration(1);
  session.applyInferenceCorrection(1, {
    ...original,
    foreshadowPlanted: [
      {
        type: "foreshadow_planted",
        foreshadowId: "F01",
        label: "钥匙来源",
        intent: "揭晓来源",
        weight: "sub",
        visibility: "overt",
        expectedBy: 2,
        anchor: {
          chapter: 1,
          quote: "李长风收好钥匙。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
  });
  session.putChapter(2, "李长风查明了钥匙来源。");
  session.replaceInference(2, {
    events: [],
    foreshadowPlanted: [],
    foreshadowResolved: [
      {
        type: "foreshadow_resolved",
        foreshadowId: "F01",
        completeness: "full",
        anchor: {
          chapter: 2,
          quote: "李长风查明了钥匙来源。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
    characterStates: [],
    characterPresence: [],
    relationsChanged: [],
  });
  session.decideInference(2, "committed");
  const v = session.inferenceCorrections.view(1);
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: v.sourceToken,
    summary: "排除误报伏笔",
    changes: [{ section: "foreshadowPlanted", index: 0, value: null }],
  });
  expect(p.impact.chapters.map((c) => c.chapter)).toContain(2);
  session.inferenceCorrections.confirm({ id: p.id });
  expect(session.revise.view().conflicts).toBeGreaterThan(0);
});
it("历史完整兑现改为部分后，后章纠正按有效事件重放，不被已排除的旧兑现挡住", async () => {
  const { session } = await setup();
  const empty = {
    events: [],
    foreshadowPlanted: [],
    foreshadowResolved: [],
    characterStates: [],
    characterPresence: [],
    relationsChanged: [],
  } as const;
  session.applyInferenceCorrection(1, {
    ...session.revise.adoptedDeclaration(1),
    foreshadowPlanted: [
      {
        type: "foreshadow_planted",
        foreshadowId: "F01",
        label: "来源",
        intent: "查明来源",
        weight: "sub",
        visibility: "overt",
        expectedBy: 3,
        anchor: {
          chapter: 1,
          quote: "李长风收好钥匙。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
  });
  session.putChapter(2, "他听到一部分来源。");
  session.replaceInference(2, {
    ...empty,
    foreshadowResolved: [
      {
        type: "foreshadow_resolved",
        foreshadowId: "F01",
        completeness: "full",
        anchor: {
          chapter: 2,
          quote: "他听到一部分来源。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
  });
  session.decideInference(2, "committed");
  let v = session.inferenceCorrections.view(2);
  const p = session.inferenceCorrections.propose({
    chapter: 2,
    sourceToken: v.sourceToken,
    summary: "只知部分",
    changes: [
      {
        section: "foreshadowResolved",
        index: 0,
        value: {
          foreshadowId: "F01",
          completeness: "partial",
          quote: "他听到一部分来源。",
        },
      },
    ],
  });
  session.inferenceCorrections.confirm({ id: p.id });
  session.putChapter(3, "来源终于查明。");
  session.replaceInference(3, {
    ...empty,
    characterPresence: [
      { type: "character_presence", characterId: "C01", role: "pov" },
    ],
  });
  session.decideInference(3, "committed");
  v = session.inferenceCorrections.view(3);
  expect(() =>
    session.inferenceCorrections.propose({
      chapter: 3,
      sourceToken: v.sourceToken,
      summary: "查明来源",
      changes: [
        {
          section: "foreshadowResolved",
          index: 0,
          value: {
            foreshadowId: "F01",
            completeness: "full",
            quote: "来源终于查明。",
          },
        },
      ],
    }),
  ).not.toThrow();
});
it("修正早章摘要后，保留的伏笔仍按故事章序被后章兑现，不因追加顺序变回未兑现", async () => {
  const { session } = await setup();
  const v1 = session.revise.adoptedDeclaration(1);
  session.applyInferenceCorrection(1, {
    ...v1,
    foreshadowPlanted: [
      {
        type: "foreshadow_planted",
        foreshadowId: "F01",
        label: "来源",
        intent: "查明来源",
        weight: "sub",
        visibility: "overt",
        expectedBy: 2,
        anchor: {
          chapter: 1,
          quote: "李长风收好钥匙。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
  });
  session.putChapter(2, "来源查明。");
  session.replaceInference(2, {
    events: [],
    foreshadowPlanted: [],
    foreshadowResolved: [
      {
        type: "foreshadow_resolved",
        foreshadowId: "F01",
        completeness: "full",
        anchor: {
          chapter: 2,
          quote: "来源查明。",
          offsetHint: 0,
          occurrence: 0,
        },
      },
    ],
    relationsChanged: [],
    characterPresence: [],
    characterStates: [],
  });
  session.decideInference(2, "committed");
  const v = session.inferenceCorrections.view(1);
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: v.sourceToken,
    summary: "只改事件摘要",
    changes: [change],
  });
  session.inferenceCorrections.confirm({ id: p.id });
  expect(
    session.derived.projections.foreshadows.find((f) => f.id === "F01")?.status,
  ).toBe("resolved");
});
it("排除全部误判记录仍记为已复核，不会被连续反推重跑；换正文后标记失效", async () => {
  const { session } = await setup();
  const v = session.inferenceCorrections.view(1);
  const p = session.inferenceCorrections.propose({
    chapter: 1,
    sourceToken: v.sourceToken,
    summary: "本章原记录均为误判，清除结构而不改正文",
    changes: [
      { section: "events", index: 0, value: null },
      { section: "characterPresence", index: 0, value: null },
    ],
  });
  session.inferenceCorrections.confirm({ id: p.id });
  expect(session.inference.view().chapters[0]?.state).toBe("confirmed");
  expect(session.inferenceCorrections.view(1).declaration.events).toHaveLength(
    0,
  );
  session.putChapter(1, prose + "新增一句。");
  expect(session.inference.view().chapters[0]?.state).toBe("none");
});
it("正文换版后只修改出场记录，不能夹带失效的原剧情引文通过", async () => {
  const { session } = await setup();
  session.putChapter(1, "完全不同的正文。");
  const v = session.inferenceCorrections.view(1);
  expect(() =>
    session.inferenceCorrections.propose({
      chapter: 1,
      sourceToken: v.sourceToken,
      summary: "只调整出场",
      changes: [
        {
          section: "characterPresence",
          index: 0,
          value: { characterId: "C01", role: "minor" },
        },
      ],
    }),
  ).toThrow(/出处|引文|定位/);
});
it("相同来源与修改的重发复用候选，不重复追加待确认项", async () => {
  const { session } = await setup();
  const v = session.inferenceCorrections.view(1);
  const input = {
    chapter: 1,
    sourceToken: v.sourceToken,
    summary: "纠正摘要",
    changes: [change],
  };
  const first = session.inferenceCorrections.propose(input),
    second = session.inferenceCorrections.propose(input);
  expect(second.id).toBe(first.id);
});
