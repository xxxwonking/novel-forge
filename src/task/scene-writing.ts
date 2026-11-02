/** 分场只细化本章已确认计划；检查点仍是候选正文，不直接写正式事件。 */
import type { ModelClient } from "../client/model.js";
import type { ChapterRunInput } from "../chapter/pipeline.js";
import { textOf } from "../chapter/pipeline.js";
import { assemble } from "../context/assemble.js";
import { countWords } from "../text/measure.js";
import type { DraftScenes, ScenePart } from "./types.js";
import { runToolLoop, type ToolContext } from "./tool-exec.js";
import type { WriteResult } from "./steps.js";

export const sceneBody = (state: DraftScenes): string => [...state.completed, ...(state.partial ? [state.partial] : [])].join("\n\n");

function readPlan(text: string, count: number, events: number): readonly ScenePart[] {
  const raw = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")) as { scenes?: ScenePart[] };
  if (!Array.isArray(raw.scenes) || raw.scenes.length !== count || raw.scenes.some(s => !s || typeof s.title !== "string" || !s.title.trim() || s.title.length > 200 || typeof s.goal !== "string" || !s.goal.trim() || s.goal.length > 2000 || !Array.isArray(s.eventIndices))) throw new Error("分场计划结构无效");
  const indices = raw.scenes.flatMap(s => s.eventIndices);
  if (new Set(indices).size !== events || indices.some(i => !Number.isInteger(i) || i < 0 || i >= events)) throw new Error("分场计划遗漏了原章计划事件或引用了未知事件");
  if (new Set(raw.scenes.map(s => s.goal.trim())).size !== count) throw new Error("分场目标重复");
  return raw.scenes;
}

export async function writeScenes(client: ModelClient, input: ChapterRunInput, ctx: ToolContext, maxToolRounds: number,
  saved: DraftScenes | null, onProgress: (state: DraftScenes) => void, stop: () => boolean): Promise<WriteResult> {
  const req = assemble(input.assembleInput);
  const beat = input.assembleInput.volatile.beat;
  if (beat.budget === null) return { kind: "failed", detail: "分场写章需要已派生的章节字数预算" };
  const count = Math.max(2, Math.min(6, Math.ceil(beat.budget.words.sweet / 900)));
  let state = saved;
  if (state === null) {
    const planned = await client.call({ purpose: "chapter", role: "creative", effort: "medium", maxTokens: 3000,
      system: req.system, messages: [...req.messages, { role: "user", content: `先不要写正文。把本章已确认计划拆成恰好${count}个连续场景。只细化本章，不新增未来章剧情或改变既定结局；末场完成阶段反馈与章末落点。原事件按0起始索引，每项至少覆盖一次。同一事件可以在不同场景分阶段推进并重复引用索引，但不得重复叙述已完成行动；也可有无新增事件的承接场。每场提供不同的具体行动目标。原章计划：${JSON.stringify(beat.plan)}。输出JSON {"scenes":[{"title":"场景名","goal":"目标、行动、阻力和结果","eventIndices":[0]}]}。` }],
      outputSchema: { type: "object", required: ["scenes"], additionalProperties: false, properties: { scenes: { type: "array", minItems: count, maxItems: count,
        items: { type: "object", required: ["title", "goal", "eventIndices"], additionalProperties: false, properties: { title: { type: "string" }, goal: { type: "string" }, eventIndices: { type: "array", items: { type: "integer", minimum: 0 } } } } } } },
    });
    if (planned.kind === "error") return { kind: "failed", detail: planned.error.message };
    if (planned.kind !== "ok" || !["end_turn", "stop_sequence"].includes(planned.message.stop_reason ?? "")) return { kind: "failed", detail: "分场计划未完整结束，未开始正文" };
    try { state = { plan: readPlan(textOf(planned.message), count, beat.plan.events.length), completed: [], partial: "" }; }
    catch (error) { return { kind: "failed", detail: error instanceof Error ? error.message : String(error) }; }
    onProgress(state);
  }
  // 检查点必须与当前计划一致；不猜测损坏状态，也不把片段当完整场景。
  try { readPlan(JSON.stringify({ scenes: state.plan }), count, beat.plan.events.length); }
  catch { return { kind: "failed", detail: "已保存分场计划无效，请保留现稿并另建任务" }; }
  if (state.completed.length > count || state.completed.some(body => typeof body !== "string" || !body.trim()) || typeof state.partial !== "string") return { kind: "failed", detail: "已保存分场正文无效" };
  for (let i = state.completed.length; i < count; i++) {
    if (stop()) return { kind: "incomplete", body: sceneBody(state), detail: "分场任务已停止，已完成场景保留" };
    const completed = state.completed.join("\n\n");
    const target = Math.max(1, Math.ceil((beat.budget.words.sweet - countWords(completed)) / (count - i)));
    const prompt = `现在只写本章第${i + 1}/${count}场的新增正文，不输出标题、提纲或说明，不重复前文。场景安排：${JSON.stringify(state.plan)}\n当前场景：${JSON.stringify(state.plan[i])}\n本场内容字数目标约${target}字，内容字指汉字与西文词，不是token。通过行动、对话、阻力和反馈展开，禁止重复灌水。${i === count - 1 ? "这是末场，落实本章计划的阶段反馈和章末落点。" : "后面还有场景，不提前总结全章或兑现后续场景。"}\n已完成正文（保持不变，接着向前推进）：\n${completed || "（本章尚未开始）"}`;
    const loop = await runToolLoop(client, { purpose: "chapter", role: "creative", effort: "xhigh", thinking: true,
      maxTokens: input.maxOutputTokens ?? 16000, tools: req.tools, system: req.system,
      messages: [...req.messages, { role: "user", content: prompt }] }, ctx, maxToolRounds);
    const r = loop.result;
    const body = r.kind === "error" ? r.partialText ?? "" : textOf(r.message);
    if (r.kind !== "ok" || !["end_turn", "stop_sequence"].includes(r.message.stop_reason ?? "") || !body.trim()) {
      state = { ...state, partial: body || state.partial }; onProgress(state);
      return { kind: "incomplete", body: sceneBody(state), detail: r.kind === "error" ? r.error.message : r.kind === "refusal" ? r.userMessage : "场景响应不完整或为空，已完成场景与片段已保留" };
    }
    if (state.completed.some(old => old.trim() === body.trim())) return { kind: "incomplete", body: sceneBody(state), detail: "新场景重复已有正文，未追加，等待作者处理" };
    state = { ...state, completed: [...state.completed, body], partial: "" }; onProgress(state);
  }
  return { kind: "ok", body: sceneBody(state), req, c4Response: null, sessionMessages: req.messages, declarationBody: true, hitToolCap: false };
}
