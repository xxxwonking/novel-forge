import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import { renderManuscriptDocx, renderManuscriptEpub, renderManuscriptText } from "../src/export/manuscript.js";

const manuscript = {
  title: "雨城来信 & 旧地图",
  identifier: "export-fixture",
  chapters: [
    { chapter: 1, title: "第 1 章", body: "雨落下来。\n\n邮差拆开写着 <明天> 的信。" },
    { chapter: 2, title: "第 2 章", body: "他沿着旧地图出城。\n路的尽头没有桥。" },
  ],
} as const;

describe("富格式正文渲染", () => {
  it("TXT 保持 BOM、书名、章标题和原始段落", () => {
    const text = renderManuscriptText(manuscript);
    expect(text.startsWith("\uFEFF")).toBe(true);
    expect(text).toContain("雨城来信 & 旧地图\n\n第 1 章\n\n雨落下来。\n\n邮差拆开写着 <明天> 的信。");
  });

  it.each([
    ["EPUB", renderManuscriptEpub],
    ["DOCX", renderManuscriptDocx],
  ] as const)("%s 对同一份稿件生成稳定 ZIP 字节", (_label, render) => {
    const first = render(manuscript);
    expect(first.subarray(0, 2)).toEqual(Buffer.from("PK"));
    expect(render(manuscript)).toEqual(first);
  });

  it("EPUB 3 的 mimetype 在第一项且不压缩，正文与导航可解包读取", () => {
    const bytes = renderManuscriptEpub(manuscript);
    expect(bytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(bytes.readUInt16LE(8)).toBe(0);
    const nameLength = bytes.readUInt16LE(26);
    expect(bytes.subarray(30, 30 + nameLength).toString("utf8")).toBe("mimetype");
    const entries = unzipSync(bytes);
    expect(strFromU8(entries["mimetype"]!)).toBe("application/epub+zip");
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      "META-INF/container.xml",
      "OEBPS/content.opf",
      "OEBPS/nav.xhtml",
      "OEBPS/title.xhtml",
      "OEBPS/chapter-1.xhtml",
      "OEBPS/chapter-2.xhtml",
      "OEBPS/styles.css",
    ]));
    expect(strFromU8(entries["OEBPS/content.opf"]!)).toContain("雨城来信 &amp; 旧地图");
    expect(strFromU8(entries["OEBPS/nav.xhtml"]!)).toContain("chapter-2.xhtml");
    expect(strFromU8(entries["OEBPS/chapter-1.xhtml"]!)).toContain("邮差拆开写着 &lt;明天&gt; 的信。");
  });

  it("DOCX 包含可编辑正文样式、章节分页与 Letter 纵向页面", () => {
    const entries = unzipSync(renderManuscriptDocx(manuscript));
    expect(Object.keys(entries)).toEqual(expect.arrayContaining([
      "[Content_Types].xml",
      "_rels/.rels",
      "docProps/core.xml",
      "docProps/app.xml",
      "word/document.xml",
      "word/styles.xml",
    ]));
    const document = strFromU8(entries["word/document.xml"]!);
    const styles = strFromU8(entries["word/styles.xml"]!);
    expect(document).toContain("雨城来信 &amp; 旧地图");
    expect(document).toContain("邮差拆开写着 &lt;明天&gt; 的信。");
    expect(document.match(/w:type="page"/gu)).toHaveLength(2);
    expect(document).toContain('<w:pgSz w:w="12240" w:h="15840"/>');
    expect(styles).toContain('w:styleId="Title"');
    expect(styles).toContain('w:styleId="Heading1"');
    expect(styles).toContain('w:firstLine="480"');
    expect(styles).toContain('w:ascii="Arial Unicode MS"');
    expect(styles).toContain('w:eastAsia="Arial Unicode MS"');
  });
});
