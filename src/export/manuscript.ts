/** 固定正文快照的 TXT、EPUB 3 与 Word OOXML 渲染。 */
import { createArchive, escapeXml, proseBlocks } from "./archive.js";

export interface ManuscriptChapter {
  readonly chapter: number;
  readonly title: string;
  readonly body: string;
}

export interface Manuscript {
  readonly title: string;
  readonly identifier: string;
  readonly chapters: readonly ManuscriptChapter[];
}

const XML = '<?xml version="1.0" encoding="UTF-8"?>';

export function renderManuscriptText(manuscript: Manuscript): string {
  const chapters = manuscript.chapters.map((chapter) => `${chapter.title}\n\n${chapter.body}`).join("\n\n");
  return `\uFEFF${manuscript.title}\n\n${chapters}\n`;
}

function xhtmlPage(title: string, body: string): string {
  return `${XML}
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN" lang="zh-CN">
<head><meta charset="utf-8"/><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="styles.css"/></head>
<body>${body}</body>
</html>`;
}

export function renderManuscriptEpub(manuscript: Manuscript): Buffer {
  const title = escapeXml(manuscript.title);
  const identifier = escapeXml(manuscript.identifier);
  const chapterEntries = manuscript.chapters.map((chapter, index) => ({
    path: `OEBPS/chapter-${chapter.chapter}.xhtml`,
    content: xhtmlPage(chapter.title, `<main><h1>${escapeXml(chapter.title)}</h1>${proseBlocks(chapter.body).map((block) => `<p>${escapeXml(block).replace(/\n/gu, "<br/>")}</p>`).join("")}</main>`),
    id: `chapter-${index + 1}`,
    href: `chapter-${chapter.chapter}.xhtml`,
  }));
  const manifest = [
    '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
    '<item id="css" href="styles.css" media-type="text/css"/>',
    '<item id="title" href="title.xhtml" media-type="application/xhtml+xml"/>',
    ...chapterEntries.map((chapter) => `<item id="${chapter.id}" href="${chapter.href}" media-type="application/xhtml+xml"/>`),
  ].join("");
  const spine = ['<itemref idref="title"/>', ...chapterEntries.map((chapter) => `<itemref idref="${chapter.id}"/>`)].join("");
  const navigation = chapterEntries.map((chapter, index) => `<li><a href="${chapter.href}">${escapeXml(manuscript.chapters[index]!.title)}</a></li>`).join("");
  const opf = `${XML}
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${identifier}</dc:identifier><dc:title>${title}</dc:title><dc:language>zh-CN</dc:language><meta property="dcterms:modified">2000-01-01T00:00:00Z</meta></metadata>
<manifest>${manifest}</manifest><spine>${spine}</spine>
</package>`;
  const nav = xhtmlPage(`${manuscript.title} 目录`, `<nav epub:type="toc" xmlns:epub="http://www.idpf.org/2007/ops"><h1>目录</h1><ol>${navigation}</ol></nav>`);
  const css = `html { color: #111; background: #fff; } body { margin: 5%; font-family: serif; line-height: 1.8; } h1 { text-align: center; margin: 2em 0; } p { margin: 0.8em 0; text-indent: 2em; } nav ol { line-height: 2; } .title-page { min-height: 80vh; display: flex; align-items: center; justify-content: center; } .title-page h1 { font-size: 2em; }`;
  return createArchive([
    { path: "mimetype", content: "application/epub+zip", store: true },
    { path: "META-INF/container.xml", content: `${XML}<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>` },
    { path: "OEBPS/content.opf", content: opf },
    { path: "OEBPS/nav.xhtml", content: nav },
    { path: "OEBPS/title.xhtml", content: xhtmlPage(manuscript.title, `<main class="title-page"><h1>${title}</h1></main>`) },
    { path: "OEBPS/styles.css", content: css },
    ...chapterEntries.map(({ path, content }) => ({ path, content })),
  ]);
}

function wordRun(text: string): string {
  const lines = text.split("\n");
  return lines.map((line, index) => `${index === 0 ? "" : "<w:br/>"}<w:t xml:space="preserve">${escapeXml(line)}</w:t>`).join("");
}

function paragraph(text: string, style?: string): string {
  return `<w:p>${style === undefined ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`}<w:r>${wordRun(text)}</w:r></w:p>`;
}

export function renderManuscriptDocx(manuscript: Manuscript): Buffer {
  const content = [
    paragraph(manuscript.title, "Title"),
    ...manuscript.chapters.flatMap((chapter) => [
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>',
      paragraph(chapter.title, "Heading1"),
      ...proseBlocks(chapter.body).map((block) => paragraph(block)),
    ]),
  ].join("");
  const document = `${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${content}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const styles = `${XML}<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial Unicode MS" w:hAnsi="Arial Unicode MS" w:eastAsia="Arial Unicode MS"/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="000000"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="360" w:lineRule="auto"/><w:ind w:firstLine="480"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:jc w:val="center"/><w:spacing w:before="2880" w:after="480"/><w:ind w:firstLine="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="52"/><w:szCs w:val="52"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:jc w:val="center"/><w:spacing w:before="720" w:after="480"/><w:ind w:firstLine="0"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:color w:val="000000"/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr></w:style>
</w:styles>`;
  return createArchive([
    { path: "[Content_Types].xml", content: `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { path: "_rels/.rels", content: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>` },
    { path: "word/_rels/document.xml.rels", content: `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { path: "word/document.xml", content: document },
    { path: "word/styles.xml", content: styles },
    { path: "docProps/core.xml", content: `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(manuscript.title)}</dc:title><dc:creator>novel-forge</dc:creator></cp:coreProperties>` },
    { path: "docProps/app.xml", content: `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>novel-forge</Application></Properties>` },
  ]);
}
