import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectStore } from "../src/store/persist.js";
import { ProjectSession } from "../src/server/state.js";
import { writingSnapshot } from "./writing-fixtures.js";
import { MaterialStore } from "../src/import/materials.js";
import { handle } from "../src/server/api.js";
import { createBackupPackage, parseBackupPackage } from "../src/workspace/backup.js";
const roots:string[]=[];afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
const quote="林舟拿到账本，决定追查旧案。";
const node={id:"N_1",plotLine:"P01",chapter:null,order:1,summary:"林舟取得账本并追查旧案",kind:"info",characters:["C01"],source:{file:"大纲.md",quote}};
function fixture(){const root=mkdtempSync(join(tmpdir(),"nf-outline-"));roots.push(root);new ProjectStore(root).save(writingSnapshot());new MaterialStore(root).save("大纲.md",quote);return {root,session:new ProjectSession(root)};}
function propose(s:ProjectSession,nodes:unknown[]=[node]){return s.preparation.propose({summary:"从大纲整理剧情",baseFingerprint:s.preparation.fingerprint(),changes:{outlineNodes:nodes}},"assistant");}
const get=(s:ProjectSession,path:string)=>handle(s,{method:"GET",path,query:new URLSearchParams(),body:null}).body as any;
describe("有资料出处的剧情节点",()=>{
 it("候选不进入图，确认后未知章号仍为空；重开和备份保留且不制造正文事件",()=>{
  const {root,session}=fixture();const before=session.events();const p=propose(session);
  expect(get(session,"/api/plot-board").nodes.some((n:any)=>n.status==="outlined")).toBe(false);
  session.preparation.confirm(p.id);const reopened=new ProjectSession(root);
  const n=get(reopened,"/api/plot-board").nodes.find((n:any)=>n.status==="outlined");
  expect(n).toMatchObject({chapter:null,point:null,summary:node.summary,materialSource:node.source});expect(reopened.events()).toEqual(before);
  expect(get(reopened,"/api/views").outlineNodes).toEqual([node]);
  expect(parseBackupPackage(createBackupPackage(root,"outline-test")).files.some(f=>f.path==="outline-nodes.json")).toBe(true);
 });
 it.each([{...node,source:{file:"不存在.md",quote}},{...node,source:{file:"大纲.md",quote:"林舟交出了账本。"}},{...node,plotLine:"P_missing"},{...node,characters:["C_missing"]}])("拒绝伪造来源与悬空引用",n=>{expect(()=>propose(fixture().session,[n])).toThrow();});
 it("只有目录标题的出处不能支撑扩写出的剧情细节",()=>{
  const {root,session}=fixture();new MaterialStore(root).save("目录.md","第一章 雨城");
  expect(()=>propose(session,[{...node,chapter:1,summary:"林舟在河边发现谋杀案，并拿走了账本",source:{file:"目录.md",quote:"第一章 雨城"}}])).toThrow(/标题|目录|依据/u);
 });
 it("材料在候选后变动，确认时重新检查，不把旧推断覆盖进去",()=>{
  const {root,session}=fixture();const p=propose(session);new MaterialStore(root).save("大纲.md","作者已改写此处。");expect(()=>session.preparation.confirm(p.id)).toThrow(/资料|来源|原句/u);
 });
 it.each(["characters","plotLines"] as const)("删除仍被资料节点引用的 %s 时要求先处理节点",key=>{
  const {session}=fixture();
  const {introducedAt,updatedAt,provenance,...input}=writingSnapshot().characters[0]!;
  const c={...input,id:"C_Outline",name:"资料人物"};
  const p0=session.preparation.propose({summary:"仅被资料节点引用的人物与线",baseFingerprint:session.preparation.fingerprint(),changes:{characters:[c],plotLines:[{id:"P_Outline",label:"资料情节",weight:"main"}],outlineNodes:[{...node,plotLine:"P_Outline",characters:["C_Outline"]}]}});
  session.preparation.confirm(p0.id);
  const removal=()=>session.preparation.propose({summary:"移除资料",baseFingerprint:session.preparation.fingerprint(),changes:{removals:{[key]:[key==="characters"?"C_Outline":"P_Outline"]}}});
  expect(removal).toThrow();
  const p=session.preparation.propose({summary:"先移除关联节点",baseFingerprint:session.preparation.fingerprint(),changes:{removals:{outlineNodes:[node.id]}}});
  session.preparation.confirm(p.id);expect(session.preparation.outlineNodes()).toEqual([]);
  expect(removal).not.toThrow();
 });
});
