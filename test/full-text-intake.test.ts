import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FullTextIntake,
  fullTextChunks,
} from "../src/preparation/full-text.js";
import { fakeClient, modelText } from "./writing-fixtures.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
const sources = [
  {
    id: "chapter:1",
    title: "第1章",
    text: "甲".repeat(8050) + "秦鹭从门后走出来。",
  },
];
const item = {
  name: "秦鹭",
  aliases: [],
  role: "从门后走出的角色",
  source: "chapter:1",
  quote: "秦鹭从门后走出来。",
};
function setup(outputs: unknown[], read = () => sources) {
  const root = mkdtempSync(join(tmpdir(), "nf-fulltext-"));
  roots.push(root);
  const model = fakeClient(
    outputs.map((o) => modelText(JSON.stringify({ characters: o }))),
  );
  const deps = { sources: read, known: () => [], client: () => model.client };
  return { root, model, deps, service: new FullTextIntake(root, deps) };
}
it("完整分块覆盖章尾和长资料，每个字符均被读取且请求有界", () => {
  const chunks = fullTextChunks(sources);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks.every((c) => c.text.length <= 8000)).toBe(true);
  expect(chunks.map((c) => c.text).join("")).toContain(item.quote);
  expect(chunks[0]?.offset).toBe(0);
  expect(chunks.at(-1)!.offset + chunks.at(-1)!.text.length).toBe(
    sources[0]!.text.length,
  );
});
it("逐批持久化，重启继续而不重复调用，不修改作品资料", async () => {
  const { service, root, deps, model } = setup([[], [item]]);
  let view = service.view();
  await service.next({ cursor: 0, fingerprint: view.fingerprint });
  const fresh = new FullTextIntake(root, deps);
  expect(fresh.view().completed).toBe(1);
  view = await fresh.next({ cursor: 1, fingerprint: view.fingerprint });
  expect(view.done).toBe(true);
  expect(view.characters[0]?.name).toBe("秦鹭");
  expect(view.characters[0]?.evidence[0]?.quote).toBe(item.quote);
  expect(model.calls).toHaveLength(2);
  await expect(
    fresh.next({ cursor: 1, fingerprint: view.fingerprint }),
  ).rejects.toThrow(/进度/);
  expect(model.calls).toHaveLength(2);
});
it("错引文不能推进进度，明确失败后可重试当前块", async () => {
  const read = () => [{ id: "chapter:1", title: "第1章", text: item.quote }];
  const { service } = setup(
    [[{ ...item, quote: "秦鹭凭空出现。" }], [item]],
    read,
  );
  const v = service.view();
  await expect(
    service.next({ cursor: 0, fingerprint: v.fingerprint }),
  ).rejects.toThrow(/出处|引文/);
  expect(service.view().completed).toBe(0);
  expect(
    (await service.next({ cursor: 0, fingerprint: v.fingerprint })).done,
  ).toBe(true);
});
it("正文换版后拒绝旧请求和旧候选，不把旧进度冒充新稿覆盖", async () => {
  let text = item.quote;
  const { service } = setup([[item]], () => [
    { id: item.source, title: "第一章", text },
  ]);
  const old = service.view();
  await service.next({ cursor: 0, fingerprint: old.fingerprint });
  text += "新增内容";
  const changed = service.view();
  expect(changed.stale).toBe(true);
  expect(changed.characters).toHaveLength(0);
  await expect(
    service.next({ cursor: 0, fingerprint: old.fingerprint }),
  ).rejects.toThrow(/变化/);
});
it("不凭别名自动合并两个同名可能冲突的人物", async () => {
  const text = "秦鹭看向阿鹭。邱淮也被称为阿鹭。";
  const { service } = setup(
    [
      [
        { ...item, aliases: ["阿鹭"], quote: "秦鹭看向阿鹭。" },
        {
          name: "邱淮",
          aliases: ["阿鹭"],
          role: "另一个角色",
          source: item.source,
          quote: "邱淮也被称为阿鹭。",
        },
      ],
    ],
    () => [{ id: item.source, title: "第一章", text }],
  );
  const v = service.view();
  const done = await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(done.characters).toHaveLength(2);
  expect(done.conflicts.join("")).toContain("阿鹭");
});
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { writingSnapshot } from "./writing-fixtures.js";
import { handle, handleAsync } from "../src/server/api.js";
it("作品API逐块读取并返回出处，正式人物与正文保持不变", async () => {
  const root = mkdtempSync(join(tmpdir(), "nf-fulltext-api-"));
  roots.push(root);
  const base = writingSnapshot();
  new ProjectStore(root).save({
    ...base,
    chapters: new Map([[1, item.quote]]),
  });
  const model = fakeClient([modelText(JSON.stringify({ characters: [item] }))]);
  const session = new ProjectSession(root, undefined, { client: model.client });
  const req = {
    method: "GET",
    path: "/api/preparation/full-text",
    query: new URLSearchParams(),
    body: undefined,
  };
  const v = handle(session, req).body as {
    fingerprint: string;
  };
  expect(v.fingerprint).toBeTypeOf("string");
  const result = await handleAsync(session, {
    ...req,
    method: "POST",
    body: { cursor: 0, fingerprint: v.fingerprint },
  });
  expect(result.status).toBe(200);
  expect(
    (
      result.body as {
        characters: unknown[];
      }
    ).characters,
  ).toHaveLength(1);
  expect(session.meta.characters).toEqual(base.characters);
  expect(session.chapterText(1)).toBe(item.quote);
});
it("全文发现仅按作者选择生成新增档案候选，保留出处且不捏造台词", async () => {
  const root = mkdtempSync(join(tmpdir(), "nf-fulltext-propose-"));
  roots.push(root);
  new ProjectStore(root).save({
    ...writingSnapshot(),
    chapters: new Map([[1, item.quote]]),
  });
  const model = fakeClient([modelText(JSON.stringify({ characters: [item] }))]);
  const session = new ProjectSession(root, undefined, { client: model.client });
  const view = session.fullTextCharacters.view();
  await session.fullTextCharacters.next({
    cursor: 0,
    fingerprint: view.fingerprint,
  });
  const proposal = session.proposeFullTextCharacters({
    fingerprint: view.fingerprint,
    names: ["秦鹭"],
  });
  expect(proposal.status).toBe("proposed");
  expect(proposal.changes.characters?.[0]?.speech.exemplars).toEqual([]);
  expect(proposal.changes.characters?.[0]?.profile.background).toContain(
    item.quote,
  );
  expect(session.meta.characters.some((c) => c.name === "秦鹭")).toBe(false);
  session.preparation.confirm(proposal.id);
  expect(session.meta.characters.some((c) => c.name === "秦鹭")).toBe(true);
  expect(() =>
    session.proposeFullTextCharacters({
      fingerprint: view.fingerprint,
      names: ["不存在"],
    }),
  ).toThrow();
});
it("模型选择逐字出处编号，由程序复制原句，未知编号不能放行", async () => {
  const read = () => [{ id: item.source, title: "第一章", text: item.quote }];
  const { service } = setup(
    [[{ ...item, quote: "@quote:99" }], [{ ...item, quote: "@quote:1" }]],
    read,
  );
  const v = service.view();
  await expect(
    service.next({ cursor: 0, fingerprint: v.fingerprint }),
  ).rejects.toThrow(/出处|引文/);
  const done = await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(done.characters[0]?.evidence[0]?.quote).toBe(item.quote);
});
it("明确重试时带回上次引文失败原因，不静默跳块", async () => {
  const { service, model } = setup(
    [[{ ...item, quote: "不在原稿" }], [item]],
    () => [{ id: item.source, title: "第一章", text: item.quote }],
  );
  const v = service.view();
  await expect(
    service.next({ cursor: 0, fingerprint: v.fingerprint }),
  ).rejects.toThrow();
  await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(JSON.stringify(model.calls[1]?.messages)).toContain("上次校验");
  expect(JSON.stringify(model.calls[1]?.messages)).toContain("引文");
});
it("人物名字和动作分在相邻句时，保留两份逐字依据，不强迫模型拼接引文", async () => {
  const text = "秦鹭推门进来。她把证件放在桌上。";
  const { service } = setup(
    [[{ ...item, quote: "她把证件放在桌上。" }]],
    () => [{ id: item.source, title: "第一章", text }],
  );
  const v = service.view();
  const done = await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(done.characters[0]?.evidence.map((e) => e.quote)).toEqual(
    expect.arrayContaining(["她把证件放在桌上。", "秦鹭推门进来。"]),
  );
});
it("模型概括出的称谓有出处但非原句姓名时，保留待核对项并阻止自动建卡", async () => {
  const { service } = setup(
    [[{ ...item, name: "夜班热线朋友", quote: "值夜班的朋友打来了电话。" }]],
    () => [
      { id: item.source, title: "第一章", text: "值夜班的朋友打来了电话。" },
    ],
  );
  const v = service.view();
  const done = await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(done.done).toBe(true);
  expect(done.conflicts.join("")).toContain("姓名未逐字出现");
  expect(done.characters[0]?.evidence[0]?.quote).toBe(
    "值夜班的朋友打来了电话。",
  );
});
it("无逐字依据的别名保留提示而不作为可自动建卡的同义身份", async () => {
  const { service } = setup(
    [[{ ...item, aliases: ["并未出现的称谓"] }]],
    () => [{ id: item.source, title: "第一章", text: item.quote }],
  );
  const v = service.view();
  const done = await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(done.conflicts.join("")).toContain("别名未逐字出现");
});
it("姓名是其他存疑称谓的子串时，不误拦已有精确出处的人物候选", async () => {
  const root = mkdtempSync(join(tmpdir(), "nf-fulltext-names-"));
  roots.push(root);
  const text = "秦鹭推门进来。她的师父没有出现。";
  new ProjectStore(root).save({
    ...writingSnapshot(),
    chapters: new Map([[1, text]]),
  });
  const model = fakeClient([
    modelText(
      JSON.stringify({
        characters: [
          { ...item, quote: "秦鹭推门进来。" },
          { ...item, name: "秦鹭的师父", quote: "她的师父没有出现。" },
        ],
      }),
    ),
  ]);
  const session = new ProjectSession(root, undefined, { client: model.client });
  const v = session.fullTextCharacters.view();
  await session.fullTextCharacters.next({
    cursor: 0,
    fingerprint: v.fingerprint,
  });
  expect(() =>
    session.proposeFullTextCharacters({
      fingerprint: v.fingerprint,
      names: ["秦鹭"],
    }),
  ).not.toThrow();
  expect(() =>
    session.proposeFullTextCharacters({
      fingerprint: v.fingerprint,
      names: ["秦鹭的师父"],
    }),
  ).toThrow();
});
it("超出旧十万字符限额的长资料完整保存，全文分块不静默截尾", async () => {
  const root = mkdtempSync(join(tmpdir(), "nf-long-material-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const { MaterialStore } = await import("../src/import/materials.js");
  const text = "前情。".repeat(40000) + "秦鹭在最后一页出现。";
  const saved = new MaterialStore(root).save("超长人物资料.md", text);
  expect("saved" in saved).toBe(true);
  const session = new ProjectSession(root);
  expect(session.fullTextCharacters.view().total).toBeGreaterThan(15);
  expect(new MaterialStore(root).read("超长人物资料.md")).toBe(text);
});
it("长段落引文可持久化，不能在保存后变成损坏的读取进度", async () => {
  const text = "秦鹭" + "甲".repeat(7998);
  const { service } = setup([[{ ...item, quote: "@quote:1" }], []], () => [
    { id: item.source, title: "长段落", text },
  ]);
  const v = service.view();
  await service.next({ cursor: 0, fingerprint: v.fingerprint });
  expect(service.view().characters[0]?.evidence[0]?.quote).toBe(text);
  expect(
    (await service.next({ cursor: 1, fingerprint: v.fingerprint })).done,
  ).toBe(true);
});
