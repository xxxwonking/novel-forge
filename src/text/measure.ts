/**
 * 中文正文的度量原语。
 *
 * 这个模块的唯一职责是把正文变成可数的东西，不含任何阈值判断 ——
 * 阈值全在 rules.yaml，判断在 gate/。分开的理由是度量口径一旦确定就极少变，
 * 而阈值需要持续校准（§10.15），两者混在一起会让校准动到度量。
 *
 * **字数口径（§10.14）：只计汉字与西文单词，剔除标点与空白。**
 * 与平台显示的字数不同（番茄/起点通常算含标点的总字符数，比这个口径多
 * 15-20%），但密度的分母必须是实际内容量 —— 一段全是短句加标点的对话
 * 按平台口径看字数不少，按内容量看很稀，而检测阈值要防的正是后者。
 */

/** 汉字（含扩展区）。 */
const HAN = /\p{Script=Han}/gu;
/** 西文词：连续的拉丁字母或数字算一个词。 */
const LATIN_WORD = /[A-Za-z0-9]+/g;

/**
 * 内容字数。汉字逐字计，西文按词计。
 *
 * 不用 `[...text].length` 的理由：那会把标点、空白、emoji 全算进去，
 * 而中文对话的标点占比可达 20%，直接污染所有按千字缩放的阈值。
 */
export function countWords(text: string): number {
  const han = text.match(HAN)?.length ?? 0;
  const latin = text.match(LATIN_WORD)?.length ?? 0;
  return han + latin;
}

/** 段落：按空行或换行切，去掉空段。中文小说一行即一段。 */
export function paragraphs(text: string): readonly string[] {
  return text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p !== "");
}

/** 章末最后 N 段。用于 scope 为 last_paragraphs 的规则。 */
export function lastParagraphs(text: string, n: number): readonly string[] {
  const ps = paragraphs(text);
  return n >= ps.length ? ps : ps.slice(ps.length - n);
}

// ── 对白与内心活动的抽取（§10.7 的 scope 限定，判定口径见 §10.13）────────

/** 中文小说的引号形式。直角引号与弯引号都要认。 */
const QUOTED = /[「『“"]([^」』”"]*)[」』”"]/gu;

/**
 * 心理活动的标记词。命中后取到句末。
 *
 * 这份清单决定了元层穿帮检测的覆盖面。宁可漏检不可误报（§10.10 同一逻辑）：
 * 穿帮写在纯叙述里会漏掉，但"作者"作为小说里的一个角色出现在叙述中时
 * 不会误报 —— 用户面对一个消不掉的假警报只会关掉整个检查器。
 */
const THOUGHT_MARKERS = ["他想", "她想", "心里想", "心中想", "暗道", "心道", "自忖", "念头", "心想"];

/** 句末标点。心理活动从标记词延伸到最近的句末。 */
const SENTENCE_END = /[。！？…；]/u;

/**
 * 抽出所有"角色说的话"与"角色想的事"。
 *
 * 返回的是片段数组而非拼接文本 —— 拼接会在片段边界造出正文里不存在的
 * 相邻关系，让跨句正则误命中。
 */
export function speechAndThought(text: string): readonly string[] {
  const out: string[] = [];

  for (const m of text.matchAll(QUOTED)) {
    const inner = m[1];
    if (inner !== undefined && inner.trim() !== "") out.push(inner);
  }

  for (const marker of THOUGHT_MARKERS) {
    let from = 0;
    for (;;) {
      const idx = text.indexOf(marker, from);
      if (idx === -1) break;
      const rest = text.slice(idx);
      const end = rest.search(SENTENCE_END);
      out.push(end === -1 ? rest : rest.slice(0, end + 1));
      from = idx + marker.length;
    }
  }

  return out;
}

// ── 计数 ────────────────────────────────────────────────────────────────

/** 子串出现次数。不用正则，避免词表里的字符被当成元字符。 */
export function countOccurrences(text: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  let from = 0;
  for (;;) {
    const idx = text.indexOf(needle, from);
    if (idx === -1) return count;
    count += 1;
    from = idx + needle.length;
  }
}

/** 词表里每个词各自的出现次数。只返回出现过的词。 */
export function countEach(
  text: string,
  words: readonly string[],
): readonly { readonly word: string; readonly count: number }[] {
  return words
    .map((word) => ({ word, count: countOccurrences(text, word) }))
    .filter((x) => x.count > 0)
    .sort((a, b) => b.count - a.count || a.word.localeCompare(b.word));
}

/** 词表总计出现次数。 */
export function countTotal(text: string, words: readonly string[]): number {
  return words.reduce((sum, w) => sum + countOccurrences(text, w), 0);
}

// ── 复读式结构 ──────────────────────────────────────────────────────────

/** 破折号。中文用 `——`，也有人用单个 `—` 或 `--`。 */
const DASH = /——|—|--/u;

/**
 * 找出「同主语 + 破折号」连续 ≥minRun 行的段落区间（§10.7、判据见 §10.13）。
 *
 * 主语的近似判定：**取行首第一个字**。真正的主语分析需要分词，而这里要抓的
 * 句式是"他知道——" / "他明白——" / "他清楚——" —— 主语相同、谓语换词，
 * 正是复读式水字数的形状。取更长的前缀会把谓语也算进主语，让这类命中不了
 * （"他知道" ≠ "他明白"），而这恰恰是最该抓的一种。
 *
 * 误判风险由另外两个条件压住：每行都必须有破折号，且必须连续 ≥minRun 行。
 * 真有意的排比修辞会命中，所以这条规则的处理方式是允许 pass 放行（§10.15）。
 *
 * 返回起始段落序号与长度，供 finding 指出位置。
 */
export function parallelRuns(
  text: string,
  minRun: number,
): readonly { readonly start: number; readonly length: number; readonly subject: string }[] {
  const ps = paragraphs(text);
  const out: { start: number; length: number; subject: string }[] = [];

  let runStart = -1;
  let runSubject = "";

  const flush = (endExclusive: number): void => {
    if (runStart !== -1 && endExclusive - runStart >= minRun) {
      out.push({ start: runStart, length: endExclusive - runStart, subject: runSubject });
    }
    runStart = -1;
    runSubject = "";
  };

  for (let i = 0; i < ps.length; i += 1) {
    const line = ps[i] ?? "";
    const dashAt = line.search(DASH);
    if (dashAt <= 0) {
      flush(i);
      continue;
    }
    const subject = [...line][0] ?? "";
    if (runStart !== -1 && subject === runSubject) continue;
    flush(i);
    runStart = i;
    runSubject = subject;
  }
  flush(ps.length);

  return out;
}

/**
 * 同一感叹词在相邻 windowLines 段内重复（§10.7）。
 *
 * 逐段扫描而非全章计数：全章计数已由密度阈值管，这条要抓的是**紧邻重复**
 * 的那种听感上的复读，它跟总量无关 —— 一章两次但挨着写就是问题。
 */
export function interjectionRepeats(
  text: string,
  interjections: readonly string[],
  windowLines: number,
): readonly { readonly word: string; readonly line: number }[] {
  const ps = paragraphs(text);
  const out: { word: string; line: number }[] = [];

  for (const word of interjections) {
    let lastHit = -1;
    for (let i = 0; i < ps.length; i += 1) {
      if (!(ps[i] ?? "").includes(word)) continue;
      if (lastHit !== -1 && i - lastHit <= windowLines) {
        out.push({ word, line: i });
      }
      lastHit = i;
    }
  }

  return out.sort((a, b) => a.line - b.line || a.word.localeCompare(b.word));
}
