import { expect, it } from "vitest";
import { zipSync } from "fflate";
import { docx, pdf } from "./document-fixtures.js";
import { convertDocument } from "../src/import/document.js";
it("DOCX仅提取正文，保留中文章节与人物资料段落", async () => {
  const result = await convertDocument({
    name: "人物与正文.docx",
    base64: docx("第一章 雨夜\n秦鹭推门进来。").toString("base64"),
  });
  expect(result.text).toContain("第一章 雨夜");
  expect(result.text).toContain("秦鹭推门进来。");
});
it("PDF文本层可提取，扫描或空文本明确需要OCR", async () => {
  const result = await convertDocument({
    name: "book.pdf",
    base64: pdf("Chapter 1 Rain").toString("base64"),
  });
  expect(result.text).toContain("Chapter 1 Rain");
  await expect(
    convertDocument({ name: "scan.pdf", base64: pdf("").toString("base64") }),
  ).rejects.toThrow(/OCR|文本/);
});
it("扩展名、损坏、压缩包展开超限均拒绝，不产生作品内容", async () => {
  await expect(
    convertDocument({ name: "bad.doc", base64: "eA==" }),
  ).rejects.toThrow(/DOCX|PDF/);
  await expect(
    convertDocument({ name: "bad.docx", base64: "not-base64" }),
  ).rejects.toThrow();
  const bomb = zipSync({
    "word/document.xml": new Uint8Array(33 * 1024 * 1024),
  });
  await expect(
    convertDocument({
      name: "huge.docx",
      base64: Buffer.from(bomb).toString("base64"),
    }),
  ).rejects.toThrow(/过大|上限/);
});
it("并发解析有界，超出并发的请求明确拒绝而不占用更多worker", async () => {
  const input = {
    name: "small.docx",
    base64: docx("第一章 雨夜\n原稿。").toString("base64"),
  };
  const a = convertDocument(input),
    b = convertDocument(input);
  await expect(convertDocument(input)).rejects.toThrow(/正在|繁忙/);
  await Promise.all([a, b]);
});
it("中文CID字体PDF能读取章节标记，不依赖浏览器网络字体", async () => {
  const { pdfCjk } = await import("./document-fixtures.js");
  const converted = await convertDocument({
    name: "中文小说.pdf",
    base64: pdfCjk().toString("base64"),
  });
  expect(converted.text).toContain("第一章");
  expect(converted.text).toContain("雨夜");
});
