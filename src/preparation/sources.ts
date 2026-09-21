/**
 * 「从正文识别人物」要看的材料怎么装配。
 *
 * 一条判断：**资料文件全文进，正文只取抽样片段。**
 * 作者手上的角色档案比从正文里推断可靠，也短得多；而正文动辄几十万字，塞不进
 * 上下文。抽样取哪几段由代码定（可复现、可解释），谁是主角由模型判断 ——
 * 抽取与判断分开，和这条线上其他地方是同一个分工。
 *
 * 抽样规则：**从头取几章，其余均匀取几章。** 人物通常在开头几章就出场了，
 * 所以头部权重更高；均匀那几章用来兜住中途才登场的人。
 */

import type { ChapterNo } from "../types/primitives.js";

/** 抽样章数。整本书一百章也只取这么多 —— 它只是给模型的落脚点。 */
const SAMPLE_CHAPTERS = 6;
/** 从头取几章。 */
const SAMPLE_HEAD = 3;
/** 每段取多少字。取章首：出场与场景交代多在这一段。 */
const SAMPLE_CHARS = 600;
/** 资料合计进上下文的上限。单份已在导入侧限过，这里防的是很多份叠起来。 */
const MATERIAL_MAX_CHARS = 60_000;

export interface CharacterSourceInput {
  readonly materials: readonly { readonly name: string; readonly text: string }[];
  readonly chapterNumbers: readonly ChapterNo[];
  readonly chapterText: (chapter: ChapterNo) => string | undefined;
}

export interface CharacterSource {
  /** 直接拼进提示词的材料全文。 */
  readonly text: string;
  /** 资料文件的名字，供说明口径。 */
  readonly from: readonly string[];
  /** 实际抽了哪几章。要说出来，否则作者会以为模型读完了全书。 */
  readonly sampled: readonly ChapterNo[];
}

/** 均匀取 count 个（含首含尾），章数不足时按实际给。 */
function evenly(numbers: readonly ChapterNo[], count: number): readonly ChapterNo[] {
  if (numbers.length <= count) return numbers;
  const picked: ChapterNo[] = [];
  for (let i = 0; i < count; i += 1) {
    const at = Math.round((i * (numbers.length - 1)) / (count - 1));
    const n = numbers[at];
    if (n !== undefined && !picked.includes(n)) picked.push(n);
  }
  return picked;
}

export function sampleChapters(numbers: readonly ChapterNo[]): readonly ChapterNo[] {
  if (numbers.length === 0) return [];
  const head = numbers.slice(0, Math.min(SAMPLE_HEAD, numbers.length));
  const rest = evenly(numbers.slice(head.length), Math.max(0, SAMPLE_CHAPTERS - head.length));
  return [...head, ...rest];
}

export function characterSource(input: CharacterSourceInput): CharacterSource {
  const materials: string[] = [];
  const from: string[] = [];
  let used = 0;
  for (const material of input.materials) {
    const room = MATERIAL_MAX_CHARS - used;
    if (room <= 0) break;
    const text = material.text.slice(0, room);
    from.push(material.name);
    used += text.length;
    materials.push(`【资料文件：${material.name}】\n${text}`);
  }

  const sampled = sampleChapters(input.chapterNumbers);
  const excerpts = sampled.map((chapter) => {
    const body = input.chapterText(chapter) ?? "";
    return `【第 ${chapter} 章开头】\n${body.slice(0, SAMPLE_CHARS)}`;
  });

  const parts = [
    ...(materials.length > 0 ? ["作者随旧稿一并提供的资料文件：", ...materials] : []),
    ...(excerpts.length > 0
      ? [`从正文里抽样了 ${sampled.length} 章的开头（全书共 ${input.chapterNumbers.length} 章，没有读全文）：`, ...excerpts]
      : []),
  ];
  const text = parts.length > 0 ? parts.join("\n\n") : "这本书还没有正文，作者也没有提供资料文件。请说明这一点，不要编造人物。";
  return { text, from, sampled };
}
