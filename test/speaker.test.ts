/**
 * 说话人归属。
 *
 * 这个模块存在的理由是「声音检查得知道是谁在说话」。而它最重要的性质是**保守**：
 * 拿不准就返回 null。所以这里的用例一半在测「归对了」，另一半在测「该不该沉默时
 * 真的沉默」—— 后者才是防住假警告的那一半。
 */

import { describe, expect, it } from "vitest";
import { attributeSpeech, type Speaker } from "../src/text/speaker.js";

const SHEN: Speaker = { id: "C_ShenYan", name: "沈砚", aliases: ["小沈"] };
const GU: Speaker = { id: "C_GuQing", name: "顾青", aliases: [] };
const BOTH = [SHEN, GU];

const VERBS = ["说", "道", "问", "答", "喊", "叫", "笑", "低声道", "开口"];

const speakersOf = (text: string, speakers: readonly Speaker[] = BOTH) =>
  attributeSpeech(text, speakers, VERBS).map((item) => ({ text: item.text, speakerId: item.speakerId }));

describe("说话人归属", () => {
  it("段内只有一个人物时，该段的引号都归他", () => {
    const text = "沈砚翻了两页，眉头皱起来。「这本账对不上。」他把册子推回去。";
    expect(speakersOf(text)).toEqual([{ text: "这本账对不上。", speakerId: "C_ShenYan" }]);
  });

  it("别名与正名一样参与归属", () => {
    expect(speakersOf("小沈把灯挑亮，说：「灯芯潮了。」"))
      .toEqual([{ text: "灯芯潮了。", speakerId: "C_ShenYan" }]);
  });

  it("段内出现多个人物时，只有称呼与引号邻接的那个才归属", () => {
    const after = "沈砚伸出手去。「钥匙在我这儿。」顾青说。";
    expect(speakersOf(after)).toEqual([{ text: "钥匙在我这儿。", speakerId: "C_GuQing" }]);
    const before = "顾青把钥匙推过去，沈砚说：「先记下这一笔。」";
    expect(speakersOf(before)).toEqual([{ text: "先记下这一笔。", speakerId: "C_ShenYan" }]);
    // 引号后面跟着的是动作而不是言说动词 —— 那是下一句的主语，不能算说话人。
    const action = "沈砚伸手指了指。「钥匙在我这儿。」顾青没有接话。";
    expect(speakersOf(action)).toEqual([{ text: "钥匙在我这儿。", speakerId: null }]);
  });

  it("段内多个人物且都够不着这一句时，宁可不归属", () => {
    // 两人同段，引号前后都没有能定住身份的称呼 —— 猜就是把假警告种进检查结果。
    const text = "沈砚与顾青在库房里站了很久。四壁的册子一直堆到梁上。「这里少了三箱。」";
    expect(speakersOf(text)).toEqual([{ text: "这里少了三箱。", speakerId: null }]);
  });

  it("本段以引号起头时，沿用上一段唯一的说话人（连续对话）", () => {
    const text = "沈砚把灯搁下。\n「你数过封存箱吗。」\n「数过。」";
    // 第二段是接着沈砚说的；第三段虽然也是引号起头，但上一段（第二段）里
    // 没有人物名，previousSole 仍是沈砚，于是也接着他 —— 这正是连续对话的形状。
    expect(speakersOf(text)).toEqual([
      { text: "你数过封存箱吗。", speakerId: "C_ShenYan" },
      { text: "数过。", speakerId: "C_ShenYan" },
    ]);
  });

  it("上一段不唯一时，本段的引号不沿用任何人", () => {
    const text = "沈砚和顾青都在。\n「先封库。」";
    expect(speakersOf(text)).toEqual([{ text: "先封库。", speakerId: null }]);
  });

  it("引号前面还有叙述时不算起头，不沿用", () => {
    const text = "沈砚把灯搁下。\n他想了想，「明天再说。」";
    expect(speakersOf(text)).toEqual([{ text: "明天再说。", speakerId: null }]);
  });

  it("段落里没有任何已知人物时不归属，也不顺着上一段一路滑下去", () => {
    const text = "沈砚把灯搁下。\n「数过。」\n库房里安静了很久，只有风从门缝里进来。\n「那就再数一遍。」";
    const result = speakersOf(text);
    expect(result[0]).toEqual({ text: "数过。", speakerId: "C_ShenYan" });
    // 第四段前面隔了一段无人的叙述，previousSole 已被清空。
    expect(result[1]).toEqual({ text: "那就再数一遍。", speakerId: null });
  });

  it("没有已知人物或没有台词时返回空，不抛错", () => {
    expect(speakersOf("沈砚把灯搁下。")).toEqual([]);
    expect(attributeSpeech("「谁。」", [], VERBS)).toEqual([]);
  });

  it("保留台词所在段落，便于结果页定位", () => {
    const [first] = attributeSpeech("沈砚把灯搁下。「封印是新的。」", BOTH, VERBS);
    expect(first?.paragraph).toBe("沈砚把灯搁下。「封印是新的。」");
  });
});
