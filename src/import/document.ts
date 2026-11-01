import { Worker } from "node:worker_threads";
import { ChapterWriteError } from "../server/chapter-input.js";
let activeParsers = 0;
export const DOCUMENT_MAX_BYTES = 8 * 1024 * 1024;
/** 转换发生在独立worker，不写作品文件；失败或超时可终止解析。 */
export async function convertDocument(raw: unknown): Promise<{
  text: string;
}> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new ChapterWriteError(400, "文档请求无效");
  const { name, base64 } = raw as Record<string, unknown>;
  if (typeof name !== "string" || !/\.(docx|pdf)$/iu.test(name))
    throw new ChapterWriteError(400, "仅支持 DOCX 与有文本层的 PDF");
  if (
    typeof base64 !== "string" ||
    base64.length > Math.ceil(DOCUMENT_MAX_BYTES / 3) * 4 ||
    base64.length % 4 !== 0 ||
    /[^A-Za-z0-9+/=]/u.test(base64)
  )
    throw new ChapterWriteError(400, "文档过大或编码无效（上限8MB）");
  const bytes = Buffer.from(base64, "base64");
  if (bytes.toString("base64") !== base64)
    throw new ChapterWriteError(400, "文档编码无效");
  if (!bytes.length || bytes.length > DOCUMENT_MAX_BYTES)
    throw new ChapterWriteError(400, "文档为空或超过8MB上限");
  if (activeParsers >= 2)
    throw new ChapterWriteError(503, "已有文档正在解析，服务繁忙，请稍后重试");
  activeParsers += 1;
  return new Promise((resolve, reject) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL("./document-worker.ts", import.meta.url), {
        workerData: { kind: /\.docx$/iu.test(name) ? "docx" : "pdf", bytes },
        resourceLimits: { maxOldGenerationSizeMb: 256 },
        execArgv: [],
      });
    } catch (error) {
      activeParsers -= 1;
      reject(error);
      return;
    }
    let settled = false;
    const finish = (error: Error | null, text?: string) => {
      if (settled) return;
      settled = true;
      activeParsers -= 1;
      clearTimeout(timer);
      void worker.terminate();
      if (error) reject(error);
      else resolve({ text: text! });
    };
    const timer = setTimeout(
      () =>
        finish(new ChapterWriteError(400, "文档解析超时，请拆分文档后重试")),
      20000,
    );
    worker.once("message", (message: unknown) => {
      const result = message as {
        text?: unknown;
        error?: unknown;
      };
      if (typeof result.text === "string" && result.text.trim())
        finish(null, result.text);
      else
        finish(
          new ChapterWriteError(
            400,
            typeof result.error === "string"
              ? result.error
              : "未读取到可用文本",
          ),
        );
    });
    worker.once("error", (error) =>
      finish(new ChapterWriteError(400, `文档解析失败：${error.message}`)),
    );
    worker.once("exit", (code) => {
      if (!settled)
        finish(new ChapterWriteError(400, `文档解析中止（${code}）`));
    });
  });
}
