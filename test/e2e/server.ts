/** 隔离的合成作品。绝不加载.env、用户书库或真实模型。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { serve } from "../../src/server/http.js";
import { ProjectStore } from "../../src/store/persist.js";
import { MaterialStore } from "../../src/import/materials.js";
import { OutlineStore } from "../../src/preparation/outline.js";
import { workSetting, workProfile, characters, settings } from "../fixtures.js";

const library = mkdtempSync(join(tmpdir(), "nf-browser-"));
const root = join(library, "browser-fixture");
new ProjectStore(root).save({
  setting: { ...workSetting, title: "浏览器回归样本" }, profile: workProfile,
  discipline: { version: "browser-d1", rules: ["只用于自动化验收。"] },
  characters: characters.slice(0, 2).map(({ state, ...card }) => ({ ...card, introducedAt: 1 })),
  settings, plotLines: [{ id: "P01", label: "查账主线", weight: "main" }],
  volumes: [], beats: [], events: [], alertStates: [],
  chapters: new Map([[1, Array.from({ length: 100 }, (_, i) => `李长风翻开第${i + 1}页账本，发现纸上留着一枚红印。`).join("\n\n")], [2, "李长风把账本交给守夜人，继续追查旧案。"]]),
});
const quote = "李长风发现账本，决定追查旧案。";
const quotes = [quote, "守夜人提供线索。", "李长风追查账本的主人。", "李长风归还账本，结束调查。"];
new MaterialStore(root).save("大纲.md", quotes.join("\n\n"));
new OutlineStore(root).save(Array.from({ length: 4 }, (_, i) => ({
  id: `N_${i + 1}`, plotLine: "P01", chapter: null, order: i + 1,
  summary: `资料节点${i + 1}：李长风追查账本`, kind: "info" as const, characters: ["C01"],
  source: { file: "大纲.md", quote: quotes[i]! },
})));
const server = serve({ workspaceRoot: library, port: 5193, staticDir: resolve("web/dist"),
  client: { official: false, call: async () => { throw new Error("浏览器测试不允许调用模型"); } },
});
const stop = () => server.close(() => { rmSync(library, { recursive: true, force: true }); process.exit(0); });
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
