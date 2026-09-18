/**
 * 跨章返修清单的落盘。
 *
 * **事实仍在事件流，这里只有待办。** 一条记录说的是「第 K 章因为第 N 章的修订需要
 * 复核」，以及作者处理到哪一步了 —— 这些是事件流装不下的东西。
 *
 * 一个受影响章只有一条记录：同一章被多次修订牵连时**合并**，而不是攒成一摞。
 * 作者面对的问题始终是「第 K 章现在要不要改」，不是「它欠了几笔账」。合并态算一个
 * `fingerprint`，作者标「已处理」记的就是那个指纹 —— **再来一次修订指纹就变，
 * 这一章自动重新亮起**，不需要谁记得去清标记。
 *
 * 落盘布局：`revision-impact.json` { chapters: { "8": ImpactRecord } }，跟 data/ 一起不入 git。
 * 读坏了直接报错，不静默当空 —— 空态会把「有未处理的返修」变成「没有」，作者会在
 * 错误的事实上继续往下写。
 */

import { existsSync, renameSync } from "node:fs";
import { join } from "node:path";
import { readProjectFile, writeProjectFile } from "../store/transaction.js";
import { stableFingerprint } from "../task/revision.js";
import type { ImpactReason } from "./impact.js";
import type { RevisionPassage } from "./locate.js";
import type { ChapterNo, IsoTimestamp } from "../types/primitives.js";

const FILE = "revision-impact.json";

/** 哪一章的哪一次修订牵连到了这里。 */
export interface ImpactTrigger {
  readonly chapter: ChapterNo;
  readonly at: IsoTimestamp;
}

export interface ImpactRecord {
  readonly chapter: ChapterNo;
  readonly triggers: readonly ImpactTrigger[];
  /** 合并后的变化清单（人读），进界面也进模型提示。 */
  readonly changes: readonly string[];
  readonly reasons: readonly ImpactReason[];
  /** triggers/changes/reasons 的稳定指纹。变了就意味着这是一次新的影响。 */
  readonly fingerprint: string;
  readonly passages: readonly RevisionPassage[];
  readonly notes: readonly string[];
  /** 定位时的指纹；与当前指纹不符即这批段落已过时。 */
  readonly locatedFor: string | null;
  readonly resolvedFor: string | null;
  readonly at: IsoTimestamp;
}

/**
 * 最近一次修订。留着它是为了让作者能**主动点查任意后续章** —— 代码只圈得出
 * 有结构关联的章，正文里的牵连（「上次他答应过的事」）没有编号可查，作者比谁都
 * 清楚该去看哪一章。
 */
export interface LatestRevision {
  readonly chapter: ChapterNo;
  readonly at: IsoTimestamp;
  readonly changes: readonly string[];
}

interface ImpactFile {
  readonly chapters: Readonly<Record<string, ImpactRecord>>;
  readonly latest: LatestRevision | null;
}

export interface ImpactFileView {
  readonly chapters: ReadonlyMap<ChapterNo, ImpactRecord>;
  readonly latest: LatestRevision | null;
}

export class ImpactStore {
  constructor(private readonly root: string) {}

  load(): ImpactFileView {
    const text = readProjectFile(this.root, FILE);
    if (text === undefined) return { chapters: new Map(), latest: null };
    try {
      const raw = JSON.parse(text) as Partial<ImpactFile> | null;
      if (raw === null || typeof raw.chapters !== "object" || raw.chapters === null) throw new Error("chapters 结构无效");
      const chapters = new Map(Object.entries(raw.chapters).map(([key, value]) => {
        const chapter = Number(key);
        if (!Number.isSafeInteger(chapter) || chapter < 1 || !valid(value)) throw new Error(`第 ${key} 章的记录无效`);
        return [chapter, value] as const;
      }));
      return { chapters, latest: raw.latest ?? null };
    } catch (error) {
      throw new Error(`${FILE} 读取失败：${error instanceof Error ? error.message : String(error)}`, { cause: error });
    }
  }

  get(chapter: ChapterNo): ImpactRecord | undefined {
    return this.load().chapters.get(chapter);
  }

  /**
   * 把读不动的文件改名留档，返回留档后的文件名（没有文件则 null）。
   *
   * **不删。** 清单是「已处理」标记与触发历史的唯一载体，静默清掉等于把作者的进度
   * 一并抹掉，而且他看不到发生了什么。所以换个名字让它躺在原地，再由界面把名字说出去。
   */
  moveAside(): string | null {
    const target = join(this.root, FILE);
    if (!existsSync(target)) return null;
    const stamp = new Date().toISOString().replace(/[:.]/gu, "-");
    for (let n = 1; ; n += 1) {
      const name = n === 1 ? `${FILE}.broken-${stamp}` : `${FILE}.broken-${stamp}-${n}`;
      if (existsSync(join(this.root, name))) continue;
      renameSync(target, join(this.root, name));
      return name;
    }
  }

  /** 一次写完：`latest` 省略则保持原值。 */
  save(records: readonly ImpactRecord[], latest?: LatestRevision): void {
    const current = this.load();
    const chapters = Object.fromEntries([...current.chapters.entries()].map(([n, value]) => [String(n), value]));
    for (const record of records) chapters[String(record.chapter)] = record;
    const file: ImpactFile = { chapters, latest: latest ?? current.latest };
    writeProjectFile(this.root, FILE, `${JSON.stringify(file, null, 2)}\n`);
  }
}

/** 合并态的指纹。只取决定「这是不是同一次影响」的三项，不含定位结果与时间。 */
export function impactFingerprint(record: Pick<ImpactRecord, "triggers" | "changes" | "reasons">): string {
  return stableFingerprint({
    triggers: record.triggers.map((t) => `${t.chapter}@${t.at}`),
    changes: record.changes,
    reasons: record.reasons.map((r) => `${r.severity}|${r.rule}|${r.text}`),
  });
}

function valid(value: unknown): value is ImpactRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Partial<ImpactRecord>;
  const strings = (items: unknown): boolean => Array.isArray(items) && items.every((item) => typeof item === "string");
  return Number.isSafeInteger(record.chapter)
    && Array.isArray(record.triggers) && record.triggers.every((t) => Number.isSafeInteger(t.chapter) && typeof t.at === "string")
    && strings(record.changes) && strings(record.notes)
    && Array.isArray(record.reasons) && record.reasons.every((r) => typeof r?.rule === "string" && (r.severity === "conflict" || r.severity === "review"))
    && Array.isArray(record.passages) && record.passages.every((p) => typeof p?.quote === "string")
    && typeof record.fingerprint === "string" && typeof record.at === "string"
    && (record.locatedFor === null || typeof record.locatedFor === "string")
    && (record.resolvedFor === null || typeof record.resolvedFor === "string");
}
