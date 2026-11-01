import { describe, expect, it, vi } from "vitest";
import { importProject } from "../web/src/import-project.js";
const result={imported:[1],replaced:[],unchanged:[],materials:["人物.md","大纲.md"],totalWords:100,nextChapter:2};
const source={files:[{name:"人物.md",text:"林舟是记者。"}]};
describe("整项目导入后的自动资料汇总",()=>{
 it("先保存正文和资料，再自动汇总为候选，不执行确认",async()=>{
  const calls:string[]=[];
  const r=await importProject(source,{importApply:async()=>{calls.push("saved");return result;},draftPreparation:async input=>{calls.push(input.focus);expect(input.apply).toBe(true);return{proposalId:"proposal-1"};}},s=>calls.push(s));
  expect(calls).toEqual(["importing","saved","analyzing","materials"]);expect(r.analysis).toEqual({proposalId:"proposal-1"});
 });
 it("AI失败仍明确保留成功导入，不把它报成导入失败或自动重试",async()=>{
  const draftPreparation=vi.fn().mockRejectedValue(new Error("中转连接断开"));
  const r=await importProject(source,{importApply:async()=>result,draftPreparation},()=>{});
  expect(r.imported).toEqual([1]);expect(r.analysis).toEqual({error:"中转连接断开"});expect(draftPreparation).toHaveBeenCalledTimes(1);
 });
 it.each([false,true])("无资料或作者关闭自动整理时不产生模型调用（%s）",async enabled=>{
  const draftPreparation=vi.fn();const r=await importProject(source,{importApply:async()=>({...result,materials:enabled?[]:result.materials}),draftPreparation},()=>{},enabled);expect(r.analysis).toBeUndefined();expect(draftPreparation).not.toHaveBeenCalled();
 });
 it("正文导入失败不启动AI",async()=>{
  const draftPreparation=vi.fn();await expect(importProject(source,{importApply:async()=>{throw new Error("正文冲突");},draftPreparation},()=>{})).rejects.toThrow("正文冲突");expect(draftPreparation).not.toHaveBeenCalled();
 });
});
