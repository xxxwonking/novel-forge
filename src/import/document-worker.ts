import { fileURLToPath } from "node:url";
import { parentPort, workerData } from "node:worker_threads";
import { unzipSync } from "fflate";
const MAX_TEXT = 3000000;
async function extract(): Promise<string> {
  const data = workerData as {
    kind: "docx" | "pdf";
    bytes: Uint8Array;
  };
  const bytes = new Uint8Array(data.bytes);
  if (data.kind === "docx") {
    let total = 0;
    const files = unzipSync(bytes, {
      filter: (entry) => {
        total += entry.originalSize;
        if (total > 32 * 1024 * 1024) throw Error("文档解压过大，超过32MB上限");
        return /\.xml$/iu.test(entry.name);
      },
    });
    if (!files["word/document.xml"]) throw Error("DOCX缺少正文，或文件已损坏");
    for (const file of Object.values(files))
      if (/<!DOCTYPE|<!ENTITY/iu.test(new TextDecoder().decode(file)))
        throw Error("DOCX包含不支持的XML声明");
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  }
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({
    data: bytes,
    cMapUrl: fileURLToPath(
      new URL("./cmaps/", import.meta.resolve("pdfjs-dist/package.json")),
    ),
    cMapPacked: true,
    wasmUrl: fileURLToPath(
      new URL("./wasm/", import.meta.resolve("pdfjs-dist/package.json")),
    ),
    standardFontDataUrl: fileURLToPath(
      new URL(
        "./standard_fonts/",
        import.meta.resolve("pdfjs-dist/package.json"),
      ),
    ),
    useSystemFonts: false,
    disableFontFace: true,
    stopAtErrors: true,
  });
  const pdf = await task.promise;
  try {
    if (pdf.numPages > 1200) throw Error("PDF页数超过1200页上限，请拆分后导入");
    const pages: string[] = [];
    let length = 0;
    for (let page = 1; page <= pdf.numPages; page++) {
      const content = await (await pdf.getPage(page)).getTextContent();
      const text = content.items
        .flatMap((item) =>
          "str" in item ? [item.str + (item.hasEOL ? "\n" : " ")] : [],
        )
        .join("")
        .trim();
      if (!text)
        throw Error(
          `PDF第${page}页没有可读取的文本层，扫描页或图片页需要先OCR；本次未导入`,
        );
      length += text.length;
      if (length > MAX_TEXT) throw Error("文档文本超过300万字符上限");
      pages.push(text);
    }
    return pages.join("\n\n");
  } finally {
    await task.destroy();
  }
}
extract()
  .then((text) => {
    if (!text.trim()) throw Error("文档中未读取到文本；扫描件需要OCR");
    if (text.length > MAX_TEXT) throw Error("文档文本超过300万字符上限");
    parentPort?.postMessage({ text });
  })
  .catch((error) =>
    parentPort?.postMessage({
      error:
        error instanceof Error && error.name === "PasswordException"
          ? "PDF已加密或需要密码，请先解密后导入"
          : `无法读取文档：${error instanceof Error ? error.message : String(error)}`,
    }),
  );
