import { expect, it } from "vitest";
import { quoteCatalog } from "../src/chapter/quote-catalog.js";
const ctx = {
  chapter: 2,
  knownCharacters: new Set(["C01" as const]),
  knownForeshadows: new Set(["F01" as const]),
  knownSettings: new Set<`S${string}`>(),
  knownPlotLines: new Set<`P${string}`>(),
  allocateForeshadowId: () => "F03" as const,
  foreshadows: [
    {
      id: "F01" as const,
      label: "已经埋下",
      status: "open" as const,
      intent: "揭晓来源",
    },
  ],
};
it("写章与修订的C5同样不能把已埋伏笔编号当作待认领规划", () => {
  const s = quoteCatalog("李长风锁上账箱。", ctx).schema as any;
  expect(
    s.properties.foreshadow_planted.items.properties.planned_foreshadow_id,
  ).toBeUndefined();
  expect(
    s.properties.foreshadow_resolved.items.properties.foreshadow_id.enum,
  ).toEqual(["F01"]);
  expect(
    s.properties.character_presence.items.properties.character_id.enum,
  ).toEqual(["C01"]);
});
it("只允许认领已规划编号，空目录不产生Google不接受的空枚举", () => {
  const s = quoteCatalog("李长风锁上账箱。", {
    ...ctx,
    knownCharacters: new Set(),
    knownForeshadows: new Set(),
    foreshadows: [
      ...ctx.foreshadows,
      { id: "F02", label: "待规划", intent: "尚未发生", status: "planned" },
    ],
  }).schema as any;
  expect(
    s.properties.foreshadow_planted.items.properties.planned_foreshadow_id.enum,
  ).toEqual(["F02"]);
  expect(s.properties.foreshadow_resolved.maxItems).toBe(0);
  expect(s.properties.character_presence.maxItems).toBe(0);
  expect(s.properties.events.items.properties.participants.maxItems).toBe(0);
});
