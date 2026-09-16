import { useRef, useState } from "react";
import { Button, Form, Input, InputNumber, Select } from "antd";
import { ArrowRightOutlined, ReloadOutlined } from "@ant-design/icons";
import { api, workUrl, type WorkSummary } from "../api.js";
import { useFetch } from "../hooks.js";

export const GENRE_LABELS: Readonly<Record<string, string>> = {
  xuanhuan: "玄幻", xianxia: "仙侠", urban: "都市", scifi: "科幻", mystery: "悬疑", rulehorror: "规则怪谈",
};
export const PLATFORM_LABELS: Readonly<Record<string, string>> = {
  unpublished: "暂不确定", qidian: "起点", fanqie: "番茄", feilu: "飞卢",
};

interface NewWorkForm {
  title: string;
  idea: string;
  genre: string;
  platform: string;
  targetWords: number;
}

const toOptions = (labels: Readonly<Record<string, string>>) => Object.entries(labels).map(([value, label]) => ({ value, label }));

export function Works(): React.ReactElement {
  const workspace = useFetch(() => api.workspace(), []);
  const [form] = Form.useForm<NewWorkForm>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRequest = useRef<{ content: string; id: string } | null>(null);

  const create = async (values: NewWorkForm): Promise<void> => {
    if (busy) return;
    const payload = { title: values.title ?? "", idea: values.idea, genre: values.genre, platform: values.platform, targetWords: values.targetWords };
    const content = JSON.stringify(payload);
    if (lastRequest.current?.content !== content) lastRequest.current = { content, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    try {
      const work = await api.createWork({ ...payload, requestId: lastRequest.current.id });
      window.location.assign(workUrl(work.id));
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  const count = workspace.data?.projects.length ?? 0;

  return (
    <main className="library">
      <div className="library-mast">
        <span className="wordmark"><i aria-hidden="true" />novel-forge</span>
        <span className="library-tagline">你的故事，慢慢成形。</span>
      </div>

      <header className="library-intro">
        <span className="eyebrow">创作工作区</span>
        <h1>每个故事，<em>从一个想法</em>开始。</h1>
        <p>与 Agent 一起搭建世界、推敲人物、逐章创作。每一次采用，都由你决定。</p>
      </header>

      <div className="library-columns">
        <section className="library-books" aria-label="我的作品">
          <div className="section-head">
            <h2>我的作品 <span>{String(count).padStart(2, "0")}</span></h2>
            <Button type="text" size="small" icon={<ReloadOutlined />} loading={workspace.loading && workspace.data !== null} onClick={workspace.reload}>刷新</Button>
          </div>
          {workspace.error !== null && <p role="alert" className="finding" data-level="block">{workspace.error}</p>}
          {workspace.loading && workspace.data === null && <div className="empty">载入作品…</div>}
          {count === 0 && workspace.data !== null && (
            <div className="library-empty">
              <BookIcon />
              <h3>第一本书，还没有书名也没关系。</h3>
              <p>写下你想讲的故事，就可以开始了。</p>
            </div>
          )}
          <div className="book-grid">{workspace.data?.projects.map((work, index) => <Book key={work.id} work={work} index={index} />)}</div>
        </section>

        <section className="new-work" aria-labelledby="new-work-title">
          <span className="eyebrow">一个新的开始</span>
          <h2 id="new-work-title">新建作品</h2>
          <p className="new-work-lead">先保存你的想法，再通过对话完善开篇。</p>
          <Form<NewWorkForm>
            form={form}
            layout="vertical"
            requiredMark={false}
            disabled={busy}
            initialValues={{ title: "", idea: "", genre: "xuanhuan", platform: "unpublished", targetWords: 300000 }}
            onFinish={(values) => { void create(values); }}
          >
            <Form.Item name="title" label={<>暂定书名 <span className="label-hint">选填</span></>}>
              <Input maxLength={100} placeholder="给故事起个名字" />
            </Form.Item>
            <Form.Item name="idea" label="你想讲一个怎样的故事？" rules={[{ required: true, whitespace: true, message: "写一句想法就够了" }]}>
              <Input.TextArea autoSize={{ minRows: 5, maxRows: 12 }} maxLength={10000} placeholder="一个人物、一场意外，或一个你放不下的念头…" />
            </Form.Item>
            <div className="form-pair">
              <Form.Item name="genre" label="题材">
                <Select options={toOptions(GENRE_LABELS)} />
              </Form.Item>
              <Form.Item name="platform" label="发布平台">
                <Select options={toOptions(PLATFORM_LABELS)} />
              </Form.Item>
            </div>
            <Form.Item name="targetWords" label="全书目标字数" rules={[{ required: true, type: "integer", min: 1, max: 10000000, message: "请填 1–10,000,000 之间的整数" }]}>
              <InputNumber<number> style={{ width: "100%" }} min={1} max={10000000} step={10000} formatter={(value) => (value === undefined || value === null ? "" : String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ","))} parser={(value) => Number((value ?? "").replace(/[^\d]/gu, ""))} addonAfter="字" />
            </Form.Item>
            {error !== null && <p role="alert" className="finding" data-level="block">{error}</p>}
            <Button className="create-work" type="primary" size="large" htmlType="submit" block loading={busy} icon={<ArrowRightOutlined />} iconPlacement="end">
              {busy ? "正在保存" : "创建作品"}
            </Button>
          </Form>
        </section>
      </div>
    </main>
  );
}

function Book({ work, index }: { work: WorkSummary; index: number }): React.ReactElement {
  const content = (
    <>
      <div className="book-spine" aria-hidden="true"><span>{String(index + 1).padStart(2, "0")}</span><span>{GENRE_LABELS[work.genre] ?? "待检查"}</span></div>
      <div className="book-body">
        <h3>{work.title}</h3>
        <p className="book-premise">{work.error ?? work.premise}</p>
        <div className="book-meta">
          <span className="book-progress">{work.currentChapter === 0 ? "筹备中" : `已采用 ${work.chapterCount} 章`}</span>
          {work.pendingDrafts > 0 && <span className="pending-count">{work.pendingDrafts} 份草稿待处理</span>}
        </div>
        <div className="book-bottom">
          <span>{work.updatedAt === "" ? "资料读取失败" : new Date(work.updatedAt).toLocaleDateString("zh-CN")}</span>
          <span className="book-cta">{work.error === null ? <>继续创作 <ArrowRightOutlined /></> : "请检查作品文件"}</span>
        </div>
      </div>
    </>
  );
  return work.error === null
    ? <a className="book-card" style={{ animationDelay: `${index * 60}ms` }} href={workUrl(work.id)}>{content}</a>
    : <div className="book-card" data-error="true" style={{ animationDelay: `${index * 60}ms` }}>{content}</div>;
}

function BookIcon(): React.ReactElement {
  return <svg viewBox="0 0 32 36" width="28" height="32" fill="none" aria-hidden="true"><path d="M7 3h19v29H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4Z" stroke="currentColor" strokeWidth="1.4"/><path d="M7 3v25m-4 0h23M12 10h9m-9 5h6" stroke="currentColor" strokeWidth="1.2"/></svg>;
}
