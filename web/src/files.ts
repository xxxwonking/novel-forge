import { api } from "./api.js";
/** 读本地文本文件。中文 TXT 常是 GBK，所以先按 UTF-8 严格解码，失败再回落 GBK。 */
export async function readTextFile(file: File): Promise<string> {
  const document = /\.(docx|pdf)$/iu.test(file.name);
  if (document && file.size > 8 * 1024 * 1024) throw new Error(`${file.name} 超过文档8MB上限，请拆分后导入。`);
  const buffer = await file.arrayBuffer();
  if (document) {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    return (await api.convertDocument(file.name, btoa(binary))).text;
  }
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch {
    try { return new TextDecoder("gbk").decode(buffer); }
    catch { throw new Error(`无法识别 ${file.name} 的文字编码，请另存为 UTF-8 的 .txt 后重试。`); }
  }
}
