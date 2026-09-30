import { useState } from "react";
import { Switch } from "antd";
import { api } from "../api.js";
import { useFetch } from "../hooks.js";

/**
 * 「这本书已经写完」开关（§57）。
 *
 * 放在伏笔规划旁边而不是设置区：它唯一改变的就是伏笔期限的口径。连载中期限必须落在
 * 未来 —— 给一个过去的章号是一条生下来就逾期的规划；已完结的旧稿里伏笔本来就兑现在书里，
 * 逼着期限落在未来，模型只能编出全书之外的章号。
 *
 * 它不进来源指纹，拨一下不作废任何方案或草稿；写新章的规则也不受影响。
 */
export function WorkStatus({ onChanged }: { onChanged?: () => void }): React.ReactElement {
  const data = useFetch(() => api.workStatus(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (data.data === null) return <p className="muted">{data.error ?? "读取作品状态…"}</p>;
  const completed = data.data.completed;
  const toggle = async (next: boolean): Promise<void> => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await api.saveWorkStatus(next); data.reload(); onChanged?.(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  return <>
    <label className="review-toggle">
      <Switch checked={completed} loading={busy} onChange={(next) => void toggle(next)} />
      <span>
        <strong>这本书已经写完</strong>
        <small>{completed
          ? "已标记为完结：伏笔的预期兑现章可以落在已经写好的章节里 —— 从大纲反推旧稿时，它们本来就兑现在书里。改期也可以改到已写的章。"
          : "连载中：伏笔的预期兑现章必须落在还没写的章节。导入的是一本写完的书，就打开它，反推出的期限才会落在书里，而不是编到全书之外。"}</small>
      </span>
    </label>
    {error !== null && <div className="finding" role="alert" data-level="block">{error}</div>}
  </>;
}
