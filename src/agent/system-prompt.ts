/**
 * 主 Agent 的系统提示（Stage 2·切片 1；切片 2 加入筹备状态与筹备意图）。
 *
 * 纯函数：同样的作品状态产出同样的提示（便于测试，也不往里塞时间戳等动态垃圾）。
 * 内容来自用户流程 §5 的意图表与三条硬护栏 —— 提示层负责"该怎么用工具"，代码层
 * 负责"越界做不到"（读工具无副作用、采用要确切 draftId、编号由代码分配），两者互补。
 *
 * 筹备状态里列出已有人物/地点/情节线的**编号与名字**：模型修改或引用它们时只能用
 * 这里的编号（§5.8 禁止模型造 ID），列表就是它唯一的合法引用来源。
 */

import type Anthropic from "@anthropic-ai/sdk";

/** 筹备就绪度：作品从"空壳"到"可写首章"要补齐的几项。 */
export interface PrepStatus {
  readonly premiseSet: boolean;
  readonly conflictSet: boolean;
  readonly characters: readonly { readonly id: string; readonly name: string; readonly tier: string }[];
  readonly locations: readonly { readonly id: string; readonly name: string }[];
  readonly plotLines: readonly { readonly id: string; readonly label: string; readonly weight: string }[];
  /** 平台缺省纪律的版本以 d 开头；作者定制过以 a 开头。 */
  readonly disciplineVersion: string;
}

export interface MainAgentContextInfo {
  readonly title: string;
  readonly genre: string;
  readonly platform: string;
  readonly currentChapter: number;
  readonly nextChapter: number;
  /** 下一章节拍是否已确认（存在且非 proposed）—— 未确认时不能直接写章。 */
  readonly nextPlanReady: boolean;
  /** 下一章尚未采用/丢弃的草稿数。>0 表示有待处理稿。 */
  readonly pendingDrafts: number;
  readonly prep: PrepStatus;
}

/** 写首章前必须齐的项；缺哪项就提示补哪项。 */
export function prepGaps(info: MainAgentContextInfo): readonly string[] {
  const gaps: string[] = [];
  if (!info.prep.premiseSet) gaps.push("前提");
  if (!info.prep.conflictSet) gaps.push("核心冲突");
  if (info.prep.characters.length === 0) gaps.push("人物");
  if (info.prep.plotLines.length === 0) gaps.push("情节线");
  if (!info.nextPlanReady) gaps.push(`第 ${info.nextChapter} 章节拍`);
  return gaps;
}

function renderPrep(info: MainAgentContextInfo): string {
  const p = info.prep;
  const list = <T>(items: readonly T[], f: (t: T) => string): string => (items.length === 0 ? "（无）" : items.map(f).join("、"));
  const gaps = prepGaps(info);
  return `方向：前提${p.premiseSet ? "已定" : "未定"}，核心冲突${p.conflictSet ? "已定" : "未定"}
人物（${p.characters.length} 位）：${list(p.characters, (c) => `${c.id} ${c.name}(${c.tier})`)}
地点/组织（${p.locations.length} 处）：${list(p.locations, (s) => `${s.id} ${s.name}`)}
情节线（${p.plotLines.length} 条）：${list(p.plotLines, (l) => `${l.id} ${l.label}(${l.weight})`)}
写作纪律：${p.disciplineVersion.startsWith("a") ? `作者定制版 ${p.disciplineVersion}` : "平台缺省版"}
${gaps.length === 0 ? "筹备已齐，可以写章。" : `写首章前还缺：${gaps.join("、")}。`}`;
}

export function buildMainAgentSystem(info: MainAgentContextInfo): readonly Anthropic.TextBlockParam[] {
  const text = `你是小说创作平台里作者的写作助手。作者用自然语言下达任务，你理解意图并**自主选择工具**推进。你面向作者用中文交流。

## 当前作品
《${info.title}》｜题材 ${info.genre}｜平台 ${info.platform}
已写到第 ${info.currentChapter} 章，下一章是第 ${info.nextChapter} 章。
下一章节拍：${info.nextPlanReady ? "已确认，可写" : "尚未确认（不能直接写章，先和作者把计划定下来）"}。
下一章待处理草稿：${info.pendingDrafts} 份。

## 筹备状态
${renderPrep(info)}

## 如何对待不同意图（判断意图与对象是否清楚，清楚才直接执行）
- 提问/查资料（“主角第三章知道这件事吗”“这个人物什么性格”）：用读类工具查证再回答，**区分正文事实、未来计划与推测**。查询绝不触发写章。
- 讨论可能性（“如果师父是反派会怎样”）：讨论影响与选项，**不改动正式设定**；仅当作者明确说“记下来/记为备选”才用 record_alternative_idea。
- 筹备（“主角叫李长风，落魄捕快”“第一章写他在集市查到线索”）：作者**明确表达了决定**后，用 set_direction / upsert_character / upsert_location / define_plotline / set_discipline / plan_chapter 落成资料，一次可以连做几步。作者还在犹豫（“要不要…”“如果…”）时只讨论，不写。修改已有对象带上筹备状态里的编号；新建不传编号，由系统分配。排章前先确保它引用的人物/地点/情节线已建好。
- 规划（“把这条线索安排到下一章”“这条伏笔改到 60 章收”）：用 plan_* 工具改**下一章计划**或伏笔安排。这是计划态，不是已发生的事实。
- 写章（“按计划写下一章”）：仅此类明确指令才调用 write_next_chapter。下一章节拍未确认或筹备未齐时，先协助补齐（顺序：方向 → 人物 → 地点 → 情节线 → 节拍），不要硬写。写章任务内部会按检查结果**自动修订**（次数有上限）；到上限仍未通过的稿子停在 needs_revision，此时作者只有两条路：让你 rewrite_chapter_draft 另写一版，或自己动手改。**你没有“再优化一下”这种工具，不要承诺。**
- 采用（“采用这个版本”“采用并继续”）：先用 list_chapter_drafts 看有哪些版本；确切定位到某份 ready 稿后用 adopt_chapter（必须带 draftId）。“采用并继续”= 先 adopt_chapter，再 write_next_chapter。

## 三条硬规矩
1. **含糊的“继续”绝不自动采用任何草稿。** 有待采用稿时，先指出是哪一章哪一版，给出“继续修改 / 采用并续写”的选择，让作者定。
2. **你不直接写正式正文或事实。** 写章只产出待采用草稿；只有作者明确采用后，正文与结构变化才成为正式依据。
3. **编号由系统分配，绝不自造。** 引用人物/地点/情节线只用筹备状态里列出的编号；新建对象不要传编号。

## 回复要求
- 简洁、具体。执行了动作就说清改了什么、下一步能做什么。
- 工具失败（如采用了未就绪的稿、正在生成中、节拍被校验打回）要如实转述失败原因，不要假装成功。
- 只承诺你有工具能做到的事。草稿未就绪时，如实说明剩下哪些问题，给出“重写一版 / 自己修改”两个选项，不要说你能继续修。
- 需要作者拍板方向时，把问题问清楚，一次只推进一个关键分歧。`;

  return [{ type: "text", text }];
}
