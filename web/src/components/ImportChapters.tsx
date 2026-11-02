/**
 * 导入旧作（差距盘点第 2 项·第一批）。
 *
 * 正文与资料分开保存；可自动整理人物与大纲为候选，不做逐章正文反推，
 * 也不替作者确认。导入成功与模型整理失败必须分别反馈。
 *
 * 两处值得留意的实现取舍：
 *
 * 1. **文件在浏览器里读**，只把文本发给服务端 —— 服务端因此不需要被授权读任意
 *    本机路径。中文 TXT 常是 GBK，所以先按 UTF-8 严格解码，失败再回落 GBK；
 *    不回落的话作者拿到的是一整页乱码，而且看不出为什么。
 *    可以一次选一批（每章一个文件是最常见的存法）：按文件原样发给服务端，排序、
 *    剔除没有标记的文件都在那边做 —— 什么算「章节标记」只能有一份定义。
 * 2. **预览与导入发两次同样的文本**，服务端不暂存。省一次往返要引入一份有生命周期
 *    的服务端草稿，而本机 1MB 的重复提交是免费的。
 */

import { useRef, useState } from "react";
import { importProject, type CompletedImport, type ImportStage } from "../import-project.js";
import { Button, CheckField, ChoiceSelect, Input, DialogFrame, Textarea } from "./controls.js";
import { api, type ImportPreview, type ImportFileInput } from "../api.js";
import { readTextFile } from "../files.js";

/**
 * 单次提交上限，留在服务端 4MB 请求体之下。
 *
 * 一本完本长篇正好卡在这条线附近，所以必须在提交**之前**说清楚 ——
 * 让服务端返回一句「请求体过大」，作者根本不知道该怎么办。
 */
const MAX_BYTES = 3.5 * 1024 * 1024;

/** 连号折成区间：`[1…100]` → 「1–100」，`[1,2,4]` → 「1–2、4」。导出只为单测。 */
export function ranges(numbers: readonly number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < sorted.length;) {
    let end = i;
    while (end + 1 < sorted.length && sorted[end + 1] === sorted[end]! + 1) end += 1;
    parts.push(i === end ? `${sorted[i]}` : `${sorted[i]}–${sorted[end]}`);
    i = end + 1;
  }
  return parts.join("、");
}
const tooLarge = (payload: unknown): string | null => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  return bytes <= MAX_BYTES ? null
    : `这份内容约 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过单次导入上限 3.5MB（约 130 万字）。请按卷分几次导入 —— 章号取自标记，分批导入不会打乱顺序。`;
};

export function ImportChapters({ onImported, onClose }: {
  onImported: (result: CompletedImport) => void; onClose: () => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<ImportFileInput[]>([]);
  const [ignoredFiles,setIgnoredFiles]=useState<string[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [stage,setStage]=useState<ImportStage>("importing");
  const [autoAnalyze,setAutoAnalyze]=useState(true);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  // 内容一变，上一次的预览和覆盖勾选就不再代表这份内容了。粘贴与选文件互斥。
  const replace = (value: string, name: string | null): void => {
    setIgnoredFiles([]); setText(value); setFiles([]); setFilename(name); setPreview(null); setOverwrite(false); setError(null);
  };

  const pick = async (list: FileList | null): Promise<void> => {
    // 选文件夹时浏览器会把里面所有东西都给过来（含子目录、图片、zip）；只留文本，
    // 剩下的交给服务端按「有没有章节标记」再筛一遍。
    const candidates = list === null ? [] : [...list];
    const chosen = candidates.filter((f) => /\.(txt|md|markdown|json|docx|pdf)$/iu.test(f.name) || f.type.startsWith("text/"));
    if (chosen.length === 0) { setFiles([]);setText("");setPreview(null);setFilename(null);setIgnoredFiles(candidates.map(f=>f.webkitRelativePath||f.name));setError("选中的内容里没有可读取的 TXT、Markdown、JSON、DOCX 或文本 PDF 文件。"); return; }
    setBusy(true); setError(null);
    try {
      const read: ImportFileInput[] = [];
      for (const file of chosen) read.push({ name: file.webkitRelativePath || file.name, text: await readTextFile(file) });
      setText(""); setFiles(read); setFilename(`${read.length} 个文件`); setPreview(null); setOverwrite(false);
      const skipped=candidates.filter(f=>!chosen.includes(f));
      setIgnoredFiles(skipped.map(f=>f.webkitRelativePath||f.name));
    } catch (e) { setFiles([]); setText(""); setPreview(null); setFilename(null); setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const source = (): { text: string } | { files: ImportFileInput[] } => files.length > 0 ? { files } : { text };
  const total = files.length > 0 ? files.reduce((sum, f) => sum + f.text.length, 0) : text.length;
  const hasContent = files.length > 0 || text.trim() !== "";

  const run = async (action: "preview" | "apply"): Promise<void> => {
    if (busy || !hasContent) return;
    const oversized = tooLarge(source());
    if (oversized !== null) { setError(oversized); setPreview(null); return; }
    setBusy(true); setError(null);
    try {
      if (action === "preview") setPreview(await api.importPreview(source()));
      else onImported(await importProject({ ...source(), ...(overwrite ? { overwrite: true } : {}) },api,setStage,autoAnalyze));
    } catch (e) { setError((e as Error).message); setPreview(null); }
    finally { setBusy(false); }
  };

  const blocked = preview !== null && preview.problems.length > 0;
  const canImport = preview !== null && (preview.ready || (overwrite && preview.readyWithOverwrite));
  const replacing = preview?.conflicts.filter((c) => !c.identical && !c.locked) ?? [];
  const skipping = preview?.conflicts.filter((c) => c.identical) ?? [];
  const deciding = preview?.conflicts.filter((c) => !c.identical) ?? [];
  const incoming = preview === null ? 0 : preview.chapters.length - preview.conflicts.filter((c) => c.identical).length;
  /**
   * 主按钮自己会先去预览。
   *
   * 原先它写着「先预览切分」却是灰的，真正能点的是旁边那个次按钮 —— 作者选完
   * 文件看到主按钮不亮，得到的结论是「导入坏了」，而不是「我该先点另一个」。
   * 一个按钮只说一件事：现在该做什么，点它就做什么。
   */
  const primary = preview === null
    ? { label: "预览切分", disabled: !hasContent, action: "preview" as const }
    : { label: incoming > 0 ? `导入 ${incoming} 章` : preview.materials.length > 0 ? `收下 ${preview.materials.length} 份资料` : "确认导入",
      disabled: !canImport, action: "apply" as const };

  return <DialogFrame open className="prep-editor" title="导入正文与项目资料" width={720}
    onCancel={() => { if (!busy) onClose(); }} maskClosable={!busy}
    footer={[
      <Button key="cancel" disabled={busy} onClick={onClose}>取消</Button>,
      <Button key="ok" variant="default" loading={busy} disabled={primary.disabled} onClick={() => void run(primary.action)}>
        {busy && stage === "analyzing" ? "正文和资料已保存，正在整理…" : primary.label}
      </Button>,
    ]}>
    <p className="muted">
      导入整部作品或文件夹，预览会区分正文、大纲、人物档案与设定。正文保持原样；附属资料保存后可自动汇总人物、关系、情节线与剧情节点，<strong>只生成待确认方案</strong>，不会自动确认或写章。
    </p>
    {error !== null && <div className="finding" role="alert" data-level="block">{error}</div>}

    <div className="import-source">
      <p className="muted">支持 TXT、Markdown、JSON、DOCX 与有文本层的 PDF。文档单份不超过8MB，只提取文字；扫描件需先 OCR。请在预览中核对段落与章节标记。</p>
      <input type="file" accept=".txt,.md,.markdown,.json,.docx,.pdf,text/plain,text/markdown,application/json" multiple ref={picker} style={{ display: "none" }}
        onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      {/* webkitdirectory 不在 React 的属性表里，用 ref 挂；每章一个文件的作者手上就是一个文件夹，
          让他进去 ⌘A 全选是把系统对话框的限制推给了作者。 */}
      <input type="file" ref={(el) => { folderPicker.current = el; if (el !== null) el.setAttribute("webkitdirectory", ""); }} style={{ display: "none" }}
        onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      <Button onClick={() => picker.current?.click()} disabled={busy}>选择正文与资料文件</Button>
      <Button onClick={() => folderPicker.current?.click()} disabled={busy}>选择整个文件夹</Button>
      {filename !== null && <span className="muted">已读取 {filename}（{total.toLocaleString()} 字符）</span>}
    </div>
    {ignoredFiles.length>0 && <p role="status" className="finding" data-level="warn">未读取 {ignoredFiles.length} 个不支持的文件：{ignoredFiles.join("、")}。支持TXT、Markdown与JSON，这些文件不会被静默计作已导入。</p>}
    {files.length>0 && <details><summary>查看或纠正文件分类（{files.length}）</summary><div className="import-file-kinds">{files.map((file,index)=><label key={`${file.name}:${index}`} className="import-file-kind"><span>{file.name}</span><ChoiceSelect aria-label={`${file.name}的分类`} value={file.kind??"auto"} disabled={busy} options={[{value:"auto",label:"自动识别"},{value:"chapter",label:"正文"},{value:"outline",label:"大纲／简介／目录"},{value:"characters",label:"人物档案"},{value:"setting",label:"设定"},{value:"material",label:"其他资料"}]} onChange={kind=>{setFiles(files.map((f,i)=>i===index?{...f,kind}:f));setPreview(null);setOverwrite(false);}}/></label>)}</div></details>}
    <CheckField checked={autoAnalyze} disabled={busy} onChange={setAutoAnalyze}>导入资料后自动整理人物与剧情（会调用AI，结果等我确认）</CheckField>
    {busy && stage === "analyzing" && <p role="status">正文与资料已保存，正在先归并人物、再整理大纲剧情，两步完成后交付待确认方案。模型失败不会撤销导入，不会自动重试。</p>}
    <label className="import-paste">直接粘贴正文
      <Textarea rows={6} value={text} disabled={busy} onChange={(e) => replace(e.target.value, null)}
        placeholder={"第一章 破庙\n少年在破庙里醒来……\n\n第二章 断剑\n……"} />
    </label>
    <p className="muted">每章标题独占一行即可：「第一章」「第1章」「第一回」「Chapter 1」都能识别。每章一个文件的，把这一批文件一起选中即可，按文件名里的章号排序；大纲、人物档案这类没有章节标记的文件会收进作品资料，不当正文。</p>

    {preview !== null && <div className="import-preview">
      {preview.problems.map((problem, i) => <div key={i} className="finding" data-level="block">{problem}</div>)}
      {preview.notes.map((note, i) => <div key={i} className="finding" data-level="warn">{note}</div>)}
      {/* 逐字相同的章折成一条。重导一本完本会刷出上百行「本次跳过」，把真正要作者
          拿主意的那几条（锁住的、要覆盖的）埋掉 —— 不需要动作的信息不配占一百行。 */}
      {skipping.length === 1 && <div className="finding" data-level="info">{skipping[0]!.reason}</div>}
      {skipping.length > 1 && <div className="finding" data-level="info">
        第 {ranges(skipping.map((c) => c.chapter))} 章已有逐字相同的正文，共 {skipping.length} 章，本次全部跳过。
      </div>}
      {deciding.map((conflict) => <div key={conflict.chapter} className="finding" data-level={conflict.locked ? "block" : "warn"}>{conflict.reason}</div>)}

      {!blocked && preview.chapters.length > 0 && <>
        <p><strong>按「{preview.marker}」切出 {preview.chapters.length} 章</strong>，共 {preview.totalWords} 字，
          第 {preview.chapters[0]!.chapter}–{preview.chapters.at(-1)!.chapter} 章。请核对下面的切分位置。</p>
        <div className="table-panel"><table><thead><tr><th>章号</th><th>标题</th><th>字数</th><th>开头</th></tr></thead>
          <tbody>{preview.chapters.map((chapter) => <tr key={chapter.chapter}>
            <td>第 {chapter.chapter} 章</td>
            <td>{chapter.title || <span className="muted">无标题</span>}</td>
            <td>{chapter.words}</td>
            <td className="import-excerpt">{chapter.body.slice(0, 30)}…</td>
          </tr>)}</tbody></table></div>
      </>}

      {!blocked && preview.materials.length > 0 && <p className="muted">
        识别为附属资料，将保存并用于人物汇总与大纲剧情整理：{preview.materials.join("、")}。
      </p>}

      {replacing.length > 0 && <CheckField checked={overwrite} disabled={busy} onChange={(e) => setOverwrite(e)}>
        覆盖第 {replacing.map((c) => c.chapter).join("、")} 章已有的正文（原内容不保留，无法撤销）
      </CheckField>}
    </div>}
  </DialogFrame>;
}
