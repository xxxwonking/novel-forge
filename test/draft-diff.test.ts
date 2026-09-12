/**
 * 草稿新旧对比（task/diff.ts）：段落级配对、改写段内字级高亮、统计口径与规模兜底。
 */

import { describe, expect, it } from "vitest";
import { diffDraft, type DiffParagraph } from "../src/task/diff.js";

const ops = (paragraphs: readonly DiffParagraph[]): string[] => paragraphs.map((p) => p.op);

describe("diffDraft：段落级", () => {
  it("完全相同：全部 equal，统计为零", () => {
    const text = "第一段。\n\n第二段。";
    const d = diffDraft(text, text);
    expect(ops(d.paragraphs)).toEqual(["equal", "equal"]);
    expect(d).toMatchObject({ inserted: 0, deleted: 0, changed: 0 });
  });

  it("末尾追加一段：insert，字数按内容口径计（标点不算）", () => {
    const d = diffDraft("第一段。", "第一段。\n第二段，补的。");
    expect(ops(d.paragraphs)).toEqual(["equal", "insert"]);
    expect(d.inserted).toBe(5);
    expect(d.deleted).toBe(0);
    expect(d.changed).toBe(1);
  });

  it("中间删一段：delete，其余段落仍对齐", () => {
    const d = diffDraft("甲\n乙\n丙", "甲\n丙");
    expect(ops(d.paragraphs)).toEqual(["equal", "delete", "equal"]);
    expect(d.paragraphs[1]?.spans).toEqual([{ op: "delete", text: "乙" }]);
  });

  it("空行与首尾空白不参与比较", () => {
    const d = diffDraft("甲\n\n\n乙  ", "  甲\n乙");
    expect(ops(d.paragraphs)).toEqual(["equal", "equal"]);
  });
});

describe("diffDraft：改写段内的字级高亮", () => {
  it("改了一句：公共前后缀保持 equal，只有改动处成 delete/insert", () => {
    const before = "他推开门，刀还在鞘里。屋里没有人。";
    const after = "他推开门，刀已经出鞘。屋里没有人。";
    const d = diffDraft(before, after);
    expect(ops(d.paragraphs)).toEqual(["replace"]);
    const spans = d.paragraphs[0]?.spans ?? [];
    expect(spans[0]).toEqual({ op: "equal", text: "他推开门，刀" });
    expect(spans.at(-1)).toEqual({ op: "equal", text: "。屋里没有人。" });
    expect(spans.filter((s) => s.op === "delete").map((s) => s.text).join("")).toBe("还在鞘里");
    expect(spans.filter((s) => s.op === "insert").map((s) => s.text).join("")).toBe("已经出鞘");
    expect(d.changed).toBe(1);
  });

  it("一段空隙里两删一增：按位配一对改写，多出的那段整段删除", () => {
    const d = diffDraft("头\n旧一\n旧二\n尾", "头\n新一\n尾");
    expect(ops(d.paragraphs)).toEqual(["equal", "replace", "delete", "equal"]);
  });

  it("相邻同类 span 合并成连续块，不会拆成单字", () => {
    const d = diffDraft("账本从袖口滑出来", "账本从他的袖口滑出来");
    const spans = d.paragraphs[0]?.spans ?? [];
    expect(spans).toEqual([
      { op: "equal", text: "账本从" },
      { op: "insert", text: "他的" },
      { op: "equal", text: "袖口滑出来" },
    ]);
  });

  it("改动之间巧合相同的单字并入改动，不显示为四处碎改", () => {
    const d = diffDraft("刀还在鞘里。", "刀已经出鞘。");
    expect(d.paragraphs[0]?.spans).toEqual([
      { op: "equal", text: "刀" },
      { op: "delete", text: "还在鞘里" },
      { op: "insert", text: "已经出鞘" },
      { op: "equal", text: "。" },
    ]);
  });

  it("真正保留的句子不会被误并：长于两侧改动的相同片段仍是 equal", () => {
    const d = diffDraft("他走了。夜里风很大，吹得门板直响。她没睡。", "他跑了。夜里风很大，吹得门板直响。她睡了。");
    const spans = d.paragraphs[0]?.spans ?? [];
    expect(spans.some((s) => s.op === "equal" && s.text.includes("夜里风很大，吹得门板直响"))).toBe(true);
  });

  it("按码点切分：emoji 不会被劈成半个代理对", () => {
    const d = diffDraft("他笑了😀。", "他哭了😢。");
    const spans = d.paragraphs[0]?.spans ?? [];
    expect(spans.filter((s) => s.op === "delete").map((s) => s.text).join("")).toBe("笑了😀");
    expect(spans.filter((s) => s.op === "insert").map((s) => s.text).join("")).toBe("哭了😢");
    for (const s of spans) expect(s.text).toBe(Array.from(s.text).join(""));
  });

  it("超过字级规模上限：退化为整段替换（一删一增）", () => {
    const before = "甲".repeat(40);
    const after = "乙".repeat(40);
    const d = diffDraft(before, after, 100);
    expect(d.paragraphs[0]?.spans).toEqual([
      { op: "delete", text: before },
      { op: "insert", text: after },
    ]);
    expect(d.deleted).toBe(40);
    expect(d.inserted).toBe(40);
  });
});
