import { afterEach, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { MaterialStore } from "../src/import/materials.js";
const roots:string[]=[];afterEach(()=>{for(const r of roots.splice(0))rmSync(r,{recursive:true,force:true});});
it("完整项目中不同资料目录的同名文件不会互相覆盖，重开保留来源路径",()=>{
 const root=mkdtempSync(tmpdir()+"/nf-material-paths-");roots.push(root);const store=new MaterialStore(root);
 store.save("人物/说明.md","林舟是记者。");store.save("大纲/说明.md","林舟开始查账。");
 const reopened=new MaterialStore(root);expect(reopened.list()).toHaveLength(2);
 expect(reopened.read("人物/说明.md")).toBe("林舟是记者。");expect(reopened.read("大纲/说明.md")).toBe("林舟开始查账。");
});
