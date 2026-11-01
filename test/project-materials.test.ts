import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { writingSnapshot } from "./writing-fixtures.js";
import { MaterialStore } from "../src/import/materials.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root,{recursive:true,force:true}); });
function fixture() { const root=mkdtempSync(join(tmpdir(),"nf-materials-"));roots.push(root);new ProjectStore(root).save({...writingSnapshot(),events:[],chapters:new Map(),beats:[]});return {root,session:new ProjectSession(root)}; }
describe("完整项目的正文与资料分类",()=>{
 it("大纲里的章号不冒充正文，Markdown人物文件一并保存",()=>{
  const {root,session}=fixture();
  const files=[{name:"正文/第1章.txt",text:"第一章 雨夜\n他走进雨里。"},{name:"资料/分章大纲.md",text:"第一章 雨夜\n调查当铺。\n第二章 线索\n发现旧当票。"},{name:"人物/档案.json",text:'{"林舟":"记者"}'}];
  const preview=session.imports.preview({files});
  expect(preview.problems).toEqual([]);expect(preview.chapters).toHaveLength(1);expect(preview.materials).toHaveLength(2);
  const result=session.imports.apply({files});expect(result.imported).toEqual([1]);expect(new MaterialStore(root).list()).toHaveLength(2);expect(session.chapterText(2)).toBeUndefined();
 });
 it("作品名含人物或大纲字样时，不把正文目录误判成资料",()=>{
  const {session}=fixture();expect(session.imports.preview({files:[{name:"人物失踪案/正文/第一章.txt",text:"第一章 雨夜\n他走进雨里。"}]})).toMatchObject({ready:true,chapters:[{chapter:1}],materials:[]});
 });
 it("纯资料和单份大纲无需伪造正文章节也能导入",()=>{
  const {root,session}=fixture();const files=[{name:"大纲.md",text:"第一章 交易\n主角发现账本。"}];
  expect(session.imports.preview({files})).toMatchObject({ready:true,problems:[],chapters:[],materials:["大纲.md"]});
  expect(session.imports.apply({files}).materials).toEqual(["大纲.md"]);expect(new MaterialStore(root).list()).toHaveLength(1);
 });
 it("Markdown正文章标题可以识别，不能因支持资料格式而把正文都收成资料",()=>{
  const {session}=fixture();expect(session.imports.preview({files:[{name:"第1章.md",text:"# 第一章 雨夜\n\n他走进雨里。"}]})).toMatchObject({ready:true,chapters:[{chapter:1,body:"他走进雨里。"}],materials:[]});
 });
 it("全部资料都无法保存时不返回成功的空导入",()=>{
  const {session}=fixture();expect(()=>session.imports.apply({files:[{name:"空资料.md",text:"  "}]})).toThrow(/没有|为空/u);
 });
 it("预览允许显式纠正资料/正文分类，不靠改文件名",()=>{
  const {session}=fixture();
  expect(session.imports.preview({files:[{name:"notes.md",text:"第一章 线索\n发现账本。",kind:"outline"}]})).toMatchObject({ready:true,chapters:[],materials:["notes.md"]});
 });
});
