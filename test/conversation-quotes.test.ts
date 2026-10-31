import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { ConversationQuotes, ConversationQuoteStream } from "../src/agent/conversation-quotes.js";

const SOURCE = "他停在巷子尽头，那里本该只有一堵墙。\r\n\r\n“别停。”她说。";
const refs = (text: string) => text.match(/\[\[quote:[^\]]+\]\]/gu) ?? [];

describe("对话原文引用", () => {
  it("草稿中的合法原句仍可讨论，必须标明草稿，且不放行旧版本或 JSON 元数据", () => {
    let body = "她把旧账册放回木箱。";
    const readDraft = (id: string) => JSON.stringify({ draftId: id, body, status: "ready" });
    const q = new ConversationQuotes(() => null, [], readDraft);
    q.draft("ch2d1", readDraft("ch2d1"));
    const reply = q.render("> 她把旧账册放回木箱。");
    expect(reply).toContain(body);
    expect(reply).toContain("草稿 ch2d1");
    expect(q.render("> ready")).toContain("隐藏");
    body = "她把旧账册烧掉了。";
    expect(q.render("> 她把旧账册放回木箱。")).toContain("隐藏");
  });
  it("显式声称原文的行内引句同样核验，假设台词不冒充原文时保留", () => {
    const q = new ConversationQuotes(() => SOURCE);
    q.source(1, "full", SOURCE);
    expect(q.render("原文：“许临川停在巷子尽头。”")).not.toContain("许临川");
    expect(q.render("原文：“他停在巷子尽头，那里本该只有一堵墙。”")).toContain("他停在巷子尽头");
    const hypothetical = "可以试写一句台词：“下雨了，别回头。”";
    expect(q.render(hypothetical)).toBe(hypothetical);
  });
  it("只按编号复制连续原文，保留人物代词、标点与对白", () => {
    const q = new ConversationQuotes(() => SOURCE);
    const catalog = q.source(1, "full", SOURCE);
    expect(catalog).toContain(SOURCE);
    expect(refs(catalog).length).toBeGreaterThan(1);
    const reply = q.render(`事实。\n${refs(catalog)[0]}`);
    expect(reply).toContain("他停在巷子尽头，那里本该只有一堵墙。");
    expect(reply).toContain("第 1 章原文");
    expect(reply).not.toContain("[[quote:");
  });

  it("Markdown 旧式逐字引句可用，改写和拼接不做模糊修补", () => {
    const q = new ConversationQuotes(() => SOURCE);
    q.source(1, "full", SOURCE);
    expect(q.render("> “他停在巷子尽头，那里本该只有一堵墙。”")).toContain("他停在巷子尽头");
    expect(q.render("> “许临川停在巷子尽头，那里本该只有一堵墙。”")).not.toContain("许临川");
    expect(q.render("> 他停在巷子尽头。“别停。”")).toContain("隐藏");
  });

  it("编号绑定章节与节选范围，不能拿另一章或另一节选的同号代替", () => {
    const read = (chapter: number, excerpt: string) => `${chapter === 1 ? "他" : "她"}${excerpt === "head" ? "走来。" : "离开。"}`;
    const q = new ConversationQuotes(read);
    const first = refs(q.source(1, "head", read(1, "head")))[0]!;
    const second = refs(q.source(2, "tail", read(2, "tail")))[0]!;
    expect(q.render(first)).toContain("他走来。");
    expect(q.render(second)).toContain("她离开。");
    expect(q.render(first.replace(":head:", ":tail:"))).toContain("隐藏");
  });

  it("正文换版、删除、跨作品和未颁发的编号不能引用", () => {
    let body: string | null = SOURCE;
    const q = new ConversationQuotes(() => body);
    const ref = refs(q.source(1, "full", SOURCE))[0]!;
    body = "正文已经修改。";
    expect(q.render(ref)).toContain("隐藏");
    body = null;
    expect(q.render(ref)).toContain("隐藏");
    expect(new ConversationQuotes(() => SOURCE).render(ref)).toContain("隐藏");
    expect(q.render("[[quote:999:full:0000000000000000:1]]")).toContain("隐藏");
    expect(q.render("[[quote:1:full:unfinished")).not.toContain("[[quote");
  });

  it("跨回合从成功工具结果恢复出处，再核对当前正文，不信任助手自己伪造的编号", () => {
    const q = new ConversationQuotes(() => SOURCE);
    const catalog = q.source(1, "full", SOURCE);
    const ref = refs(catalog)[0]!;
    const history: Anthropic.MessageParam[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "read1", name: "get_chapter_text", input: { chapter: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "read1", content: catalog }] },
    ];
    expect(new ConversationQuotes(() => SOURCE, history).render(ref)).toContain("他停在巷子尽头");
    expect(new ConversationQuotes(() => "改过的正文。", history).render(ref)).toContain("隐藏");
    expect(new ConversationQuotes(() => SOURCE, [{ role: "assistant", content: ref }]).render(ref)).toContain("隐藏");
  });

  it("没有读过的正文不能因模型声称原文就当作已核验", () => {
    expect(new ConversationQuotes(() => SOURCE).render("> 他停在巷子尽头，那里本该只有一堵墙。")).toContain("隐藏");
  });

  it("失败读工具或复用同名调用 ID 的其他工具结果不能伪造已读出处", () => {
    const history: Anthropic.MessageParam[] = [
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_chapter_text", input: { chapter: 1 } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "读取失败", is_error: true }] },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "get_overview", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: SOURCE }] },
    ];
    expect(new ConversationQuotes(() => SOURCE, history).render("> 他停在巷子尽头，那里本该只有一堵墙。")).toContain("隐藏");
  });

  it("源文本中的保留标记只是数据，不递归展开另一条引用", () => {
    const body = "他写下[[quote:9:full:0000000000000000:1]]。";
    const q = new ConversationQuotes(() => body);
    const ref = refs(q.source(1, "full", body)).find(x => x.startsWith("[[quote:1:"))!;
    expect(q.render(ref)).toContain(body);
  });
});

describe("引用的流式安全出口", () => {
  it("行内原文声明跨 chunk 时先缓冲，不能先流出被改写的内容", () => {
    const q = new ConversationQuotes(() => SOURCE);
    q.source(1, "full", SOURCE);
    const deltas: string[] = [];
    const stream = new ConversationQuoteStream(q, text => deltas.push(text));
    const raw = "原文：“许临川停在巷子尽头。”";
    for (const c of raw) stream.push(c);
    stream.finish(raw);
    expect(deltas.join("")).not.toContain("许临川");
    expect(deltas.join("")).toContain("隐藏");
  });
  it("普通文字仍增量输出，跨 chunk 的错误引文在任何时刻都不泄漏", () => {
    const q = new ConversationQuotes(() => SOURCE);
    q.source(1, "full", SOURCE);
    const emitted: string[] = [];
    const stream = new ConversationQuoteStream(q, text => emitted.push(text));
    stream.push("事实说明。");
    expect(emitted.join("")).toBe("事实说明。");
    for (const c of "\n  > 许临川停在巷子尽头。\n后续解释。") stream.push(c);
    expect(emitted.join("")).not.toContain("许临川");
    stream.finish("事实说明。\n  > 许临川停在巷子尽头。\n后续解释。");
    expect(emitted.join("")).toContain("隐藏");
    expect(emitted.join("")).toContain("后续解释。");
  });

  it("跨 chunk 的编号只在校验并回填原文后流出，编号本身不闪现", () => {
    const q = new ConversationQuotes(() => SOURCE);
    const ref = refs(q.source(1, "full", SOURCE))[0]!;
    const emitted: string[] = [];
    const stream = new ConversationQuoteStream(q, text => emitted.push(text));
    for (const c of `出处：${ref}`) stream.push(c);
    expect(emitted.join("")).toBe("出处：");
    stream.finish(`出处：${ref}`);
    expect(emitted.join("")).toBe(q.render(`出处：${ref}`));
    expect(emitted.join("")).not.toContain("[[quote:");
  });
});
