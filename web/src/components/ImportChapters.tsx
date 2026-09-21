/**
 * 导入旧作（差距盘点第 2 项·第一批）。
 *
 * **只入正文，不反推结构。** 逐章反推事件与伏笔是下一批的事，所以这里的文案
 * 必须把话说清楚：导入完成后伏笔时间线仍是空的，接着要走「让 AI 起草资料」。
 * 让作者以为导进来就什么都有了，比不做这个功能更糟。
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
import { Button, Checkbox, Input, Modal } from "antd";
import { api, type ImportPreview, type ImportResult } from "../api.js";
import { readTextFile } from "../files.js";

/**
 * 单次提交上限，留在服务端 4MB 请求体之下。
 *
 * 一本完本长篇正好卡在这条线附近，所以必须在提交**之前**说清楚 ——
 * 让服务端返回一句「请求体过大」，作者根本不知道该怎么办。
 */
const MAX_BYTES = 3.5 * 1024 * 1024;
const tooLarge = (payload: unknown): string | null => {
  const bytes = new TextEncoder().encode(JSON.stringify(payload)).length;
  return bytes <= MAX_BYTES ? null
    : `这份内容约 ${(bytes / 1024 / 1024).toFixed(1)}MB，超过单次导入上限 3.5MB（约 130 万字）。请按卷分几次导入 —— 章号取自标记，分批导入不会打乱顺序。`;
};

export function ImportChapters({ onImported, onClose }: {
  onImported: (result: ImportResult) => void; onClose: () => void;
}): React.ReactElement {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<{ name: string; text: string }[]>([]);
  const [filename, setFilename] = useState<string | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);

  // 内容一变，上一次的预览和覆盖勾选就不再代表这份内容了。粘贴与选文件互斥。
  const replace = (value: string, name: string | null): void => {
    setText(value); setFiles([]); setFilename(name); setPreview(null); setOverwrite(false); setError(null);
  };

  const pick = async (list: FileList | null): Promise<void> => {
    // 选文件夹时浏览器会把里面所有东西都给过来（含子目录、图片、zip）；只留文本，
    // 剩下的交给服务端按「有没有章节标记」再筛一遍。
    const chosen = (list === null ? [] : [...list]).filter((f) => /\.txt$/iu.test(f.name) || f.type === "text/plain");
    if (chosen.length === 0) { setError("选中的内容里没有 .txt 文件。"); return; }
    setBusy(true); setError(null);
    try {
      const read = await Promise.all(chosen.map(async (file) => ({ name: file.name, text: await readTextFile(file) })));
      // 只有一个文件时沿用整本文本那条路，粘贴框里能看到内容；多个才按文件提交。
      if (read.length === 1) replace(read[0]!.text, read[0]!.name);
      else { setText(""); setFiles(read); setFilename(`${read.length} 个文件`); setPreview(null); setOverwrite(false); }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const source = (): { text: string } | { files: { name: string; text: string }[] } => files.length > 0 ? { files } : { text };
  const total = files.length > 0 ? files.reduce((sum, f) => sum + f.text.length, 0) : text.length;
  const hasContent = files.length > 0 || text.trim() !== "";

  const run = async (action: "preview" | "apply"): Promise<void> => {
    if (busy || !hasContent) return;
    const oversized = tooLarge(source());
    if (oversized !== null) { setError(oversized); setPreview(null); return; }
    setBusy(true); setError(null);
    try {
      if (action === "preview") setPreview(await api.importPreview(source()));
      else onImported(await api.importApply({ ...source(), ...(overwrite ? { overwrite: true } : {}) }));
    } catch (e) { setError((e as Error).message); setPreview(null); }
    finally { setBusy(false); }
  };

  const blocked = preview !== null && preview.problems.length > 0;
  const canImport = preview !== null && (preview.ready || (overwrite && preview.readyWithOverwrite));
  const replacing = preview?.conflicts.filter((c) => !c.identical && !c.locked) ?? [];

  return <Modal open className="prep-editor" title="导入已有正文" width={720}
    onCancel={() => { if (!busy) onClose(); }} maskClosable={!busy}
    footer={[
      <Button key="cancel" disabled={busy} onClick={onClose}>取消</Button>,
      <Button key="preview" disabled={busy || !hasContent} onClick={() => void run("preview")}>预览切分</Button>,
      <Button key="ok" type="primary" loading={busy} disabled={!canImport} onClick={() => void run("apply")}>
        {preview === null ? "先预览切分" : `导入 ${preview.chapters.length - preview.conflicts.filter((c) => c.identical).length} 章`}
      </Button>,
    ]}>
    <p className="muted">
      把已经写好的稿子放进来，接着往下写。<strong>正文之外的文件会被收进作品资料</strong>（角色档案、大纲、设定这类），
      识别人物时会用上；人物、伏笔、情节线仍不会自动生效，要走「让 AI 起草资料」并逐条核对。
      章号取自文件里的标记，不会重新编号。
    </p>
    {error !== null && <div className="finding" role="alert" data-level="block">{error}</div>}

    <div className="import-source">
      <input type="file" accept=".txt,text/plain" multiple ref={picker} style={{ display: "none" }}
        onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      {/* webkitdirectory 不在 React 的属性表里，用 ref 挂；每章一个文件的作者手上就是一个文件夹，
          让他进去 ⌘A 全选是把系统对话框的限制推给了作者。 */}
      <input type="file" ref={(el) => { folderPicker.current = el; if (el !== null) el.setAttribute("webkitdirectory", ""); }} style={{ display: "none" }}
        onChange={(e) => { void pick(e.target.files); e.target.value = ""; }} />
      <Button onClick={() => picker.current?.click()} disabled={busy}>选择 .txt 文件</Button>
      <Button onClick={() => folderPicker.current?.click()} disabled={busy}>选择整个文件夹</Button>
      {filename !== null && <span className="muted">已读取 {filename}（{total.toLocaleString()} 字符）</span>}
    </div>
    <label className="import-paste">直接粘贴正文
      <Input.TextArea rows={6} value={text} disabled={busy} onChange={(e) => replace(e.target.value, null)}
        placeholder={"第一章 破庙\n少年在破庙里醒来……\n\n第二章 断剑\n……"} />
    </label>
    <p className="muted">每章标题独占一行即可：「第一章」「第1章」「第一回」「Chapter 1」都能识别。每章一个文件的，把这一批文件一起选中即可，按文件名里的章号排序；大纲、人物档案这类没有章节标记的文件会被跳过并列出来。</p>

    {preview !== null && <div className="import-preview">
      {preview.problems.map((problem, i) => <div key={i} className="finding" data-level="block">{problem}</div>)}
      {preview.notes.map((note, i) => <div key={i} className="finding" data-level="warn">{note}</div>)}
      {preview.conflicts.map((conflict) => <div key={conflict.chapter} className="finding" data-level={conflict.locked ? "block" : conflict.identical ? "info" : "warn"}>{conflict.reason}</div>)}

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

      {replacing.length > 0 && <Checkbox checked={overwrite} disabled={busy} onChange={(e) => setOverwrite(e.target.checked)}>
        覆盖第 {replacing.map((c) => c.chapter).join("、")} 章已有的正文（原内容不保留，无法撤销）
      </Checkbox>}
    </div>}
  </Modal>;
}
