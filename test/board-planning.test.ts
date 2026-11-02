import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { handle } from "../src/server/api.js";
import { writingSnapshot, WRITE_BEAT } from "./writing-fixtures.js";
const roots: string[] = [];
afterEach(() =>
  roots
    .splice(0)
    .forEach((root) => rmSync(root, { recursive: true, force: true })),
);
it("白板手工规划记录作者来源，先保存候选而非自动确认，并拒绝过期指纹", () => {
  const root = mkdtempSync(join(tmpdir(), "nf-board-plan-"));
  roots.push(root);
  new ProjectStore(root).save(writingSnapshot());
  const s = new ProjectSession(root);
  const before = s.beatFor(3);
  const input = {
    summary: "作者在白板安排下一章",
    baseFingerprint: s.preparation.fingerprint(),
    changes: {
      beats: [
        {
          chapter: 3,
          volume: 1,
          plan: { ...WRITE_BEAT.plan, coreEvent: "李长风重新核查账本" },
        },
      ],
    },
  };
  const request = {
    method: "POST",
    path: "/api/preparation/author-candidate",
    query: new URLSearchParams(),
    body: input,
  };
  const result = handle(s, request);
  expect(result.status).toBe(200);
  expect(result.body).toMatchObject({ status: "proposed", source: "author" });
  expect(s.beatFor(3)).toEqual(before);
  expect(
    handle(s, {
      ...request,
      body: { ...input, baseFingerprint: "f".repeat(64) },
    }).status,
  ).toBe(409);
});
