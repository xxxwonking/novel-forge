/**
 * 度量原语（src/text/measure.ts）。
 *
 * 这一层的正确性决定了整个 M2 —— 所有阈值都缩放于字数，口径错一次，
 * 每条规则都错。所以这里的测试比阈值本身更值得写细。
 */

import { describe, expect, it } from "vitest";
import {
  countEach,
  countOccurrences,
  countTotal,
  countWords,
  interjectionRepeats,
  lastParagraphs,
  paragraphs,
  parallelRuns,
  speechAndThought,
} from "../src/text/measure.js";

describe("countWords —— 只计汉字与西文词，剔除标点空白", () => {
  it("纯汉字逐字计", () => {
    expect(countWords("李长风把断剑横在膝上")).toBe(10);
  });

  it("标点不计入", () => {
    expect(countWords("剑在我手里。")).toBe(5);
    expect(countWords("「你不配问。」")).toBe(4);
    expect(countWords("他停住了——手还按在剑柄上")).toBe(11);
  });

  it("空白与换行不计入", () => {
    expect(countWords("  断剑\n\n横在  膝上 ")).toBe(6);
  });

  it("西文按词计，不按字母计", () => {
    expect(countWords("他说 OK 就走了")).toBe(6); // 他说+OK+就走了 = 2+1+3
    expect(countWords("Chapter 47")).toBe(2);
  });

  it("与平台口径的差距 —— 对话密集的段落差得最多", () => {
    const dialogue = "「你别绕，」她说，「我问的是三叔那晚在哪。」";
    // 平台按含标点的字符数算会明显更多，这就是不能用平台口径做分母的理由
    expect(countWords(dialogue)).toBeLessThan([...dialogue].length);
  });

  it("空串为 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("。，！？「」")).toBe(0);
  });
});

describe("paragraphs / lastParagraphs", () => {
  const text = "第一段。\n第二段。\n\n第三段。\n   \n第四段。";

  it("按换行切，去空段", () => {
    expect(paragraphs(text)).toEqual(["第一段。", "第二段。", "第三段。", "第四段。"]);
  });

  it("取末 N 段", () => {
    expect(lastParagraphs(text, 2)).toEqual(["第三段。", "第四段。"]);
  });

  it("N 大于总段数时返回全部", () => {
    expect(lastParagraphs(text, 99)).toHaveLength(4);
  });
});

describe("speechAndThought —— §10.7 scope 限定的实现", () => {
  it("抽出直角引号内的对白", () => {
    const out = speechAndThought("他看了一眼，「三叔那晚在哪。」然后坐下。");
    expect(out).toContain("三叔那晚在哪。");
  });

  it("认弯引号与双引号", () => {
    expect(speechAndThought("“剑在我手里。”")).toContain("剑在我手里。");
    expect(speechAndThought("『你不配问。』")).toContain("你不配问。");
  });

  it("抽出心理活动到句末", () => {
    const out = speechAndThought("他想这事必有内情。风从门缝里灌进来。");
    expect(out.some((s) => s.includes("这事必有内情"))).toBe(true);
    // 不该把后面那句环境描写也吞进来
    expect(out.some((s) => s.includes("风从门缝"))).toBe(false);
  });

  it("**叙述部分不进结果** —— 这是不误报的关键", () => {
    const out = speechAndThought("作者在青州城开了间书铺，卖些闲书。");
    expect(out).toEqual([]);
  });

  it("多条对白各自成段，不拼接（拼接会造出正文里没有的相邻关系）", () => {
    const out = speechAndThought("「在山上。」老丈说。「天没亮。」");
    expect(out).toContain("在山上。");
    expect(out).toContain("天没亮。");
    expect(out.some((s) => s.includes("在山上。天没亮"))).toBe(false);
  });

  it("空引号不产出条目", () => {
    expect(speechAndThought("「」他没说话。")).toEqual([]);
  });
});

describe("countOccurrences / countEach / countTotal", () => {
  it("子串计数不受正则元字符影响", () => {
    expect(countOccurrences("a.b.c", ".")).toBe(2);
    expect(countOccurrences("价值七位数，价值七位数", "价值七位数")).toBe(2);
  });

  it("空 needle 返回 0，不死循环", () => {
    expect(countOccurrences("任意文本", "")).toBe(0);
  });

  it("countEach 逐词计数并按次数降序", () => {
    const text = "瞳孔骤缩。瞳孔骤缩。心中一凛。";
    expect(countEach(text, ["瞳孔骤缩", "心中一凛", "没出现的词"])).toEqual([
      { word: "瞳孔骤缩", count: 2 },
      { word: "心中一凛", count: 1 },
    ]);
  });

  it("countTotal 求和", () => {
    expect(countTotal("啊，呀，啊。", ["啊", "呀"])).toBe(3);
  });
});

describe("parallelRuns —— 复读式排比（§10.7）", () => {
  it("连续 3 行同主语加破折号即命中", () => {
    const text = [
      "他知道——这事没那么简单。",
      "他明白——三叔不会认。",
      "他清楚——账本才是关键。",
    ].join("\n");
    const runs = parallelRuns(text, 3);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.length).toBe(3);
    expect(runs[0]?.start).toBe(0);
  });

  it("只有 2 行不命中（minRun=3）", () => {
    const text = "他知道——这事不简单。\n他明白——三叔不会认。";
    expect(parallelRuns(text, 3)).toEqual([]);
  });

  it("主语不同则不算复读", () => {
    const text = [
      "他知道——这事没那么简单。",
      "她明白——三叔不会认。",
      "老丈清楚——账本才是关键。",
    ].join("\n");
    expect(parallelRuns(text, 3)).toEqual([]);
  });

  it("中间插入普通句会打断连续", () => {
    const text = [
      "他知道——这事没那么简单。",
      "他明白——三叔不会认。",
      "风从门缝里灌进来。",
      "他清楚——账本才是关键。",
    ].join("\n");
    expect(parallelRuns(text, 3)).toEqual([]);
  });

  it("认单个破折号与英文双连字符", () => {
    const single = ["他知道—这事不简单。", "他明白—三叔不认。", "他清楚—账本关键。"].join("\n");
    expect(parallelRuns(single, 3)).toHaveLength(1);
  });

  it("破折号在行首不算（没有主语）", () => {
    const text = ["——这事不简单。", "——三叔不认。", "——账本关键。"].join("\n");
    expect(parallelRuns(text, 3)).toEqual([]);
  });
});

describe("interjectionRepeats —— 感叹词连写（§10.7）", () => {
  const words = ["啊", "哼"];

  it("相邻行重复同一感叹词即命中", () => {
    const text = "「啊，是你。」\n他退了半步。\n「啊，你怎么在这。」";
    const hits = interjectionRepeats(text, words, 2);
    expect(hits).toHaveLength(1);
    expect(hits[0]?.word).toBe("啊");
  });

  it("隔得够远不命中", () => {
    const text = "「啊，是你。」\nA\nB\nC\n「啊，又是你。」";
    expect(interjectionRepeats(text, words, 2)).toEqual([]);
  });

  it("不同感叹词各自独立判断", () => {
    const text = "「啊。」\n「哼。」";
    expect(interjectionRepeats(text, words, 2)).toEqual([]);
  });

  it("同一词连续三行给出两条命中", () => {
    const text = "「啊。」\n「啊。」\n「啊。」";
    expect(interjectionRepeats(text, words, 2)).toHaveLength(2);
  });
});
