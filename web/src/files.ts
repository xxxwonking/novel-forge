/** 读本地文本文件。中文 TXT 常是 GBK，所以先按 UTF-8 严格解码，失败再回落 GBK。 */
export async function readTextFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch {
    try { return new TextDecoder("gbk").decode(buffer); }
    catch { throw new Error(`无法识别 ${file.name} 的文字编码，请另存为 UTF-8 的 .txt 后重试。`); }
  }
}
