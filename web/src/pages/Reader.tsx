import { Tabs } from "radix-ui";
import { SelectableProse } from "../components/SelectableProse.js";
import { PassageAssistant, type PassageRequest } from "../components/PassageAssistant.js";
/**
 * 正文页 —— 「点击看原文」的落点（§12.9 M3）。
 *
 * 阅读区与体检栏各自滚动：读长章时右侧的检查结论不会跟着跑掉，回到结构视图
 * 也不必先把正文滚回去。正文列在可用宽度里居中，不贴着左边。
 *
 * 高亮用后端解析出的 offset 切分，不在前端再搜一遍 quote —— 两处搜索的
 * occurrence 处理一旦有分歧，用户点的点和跳到的位置就不是一处。
 */

import { useEffect, useRef, useState } from "react";
import { ActionLink, Button, ChoiceSelect, HelpTooltip } from "../components/controls.js";
import { ChevronLeft as LeftOutlined, ChevronRight as RightOutlined } from "lucide-react";
import { api, type GateFinding, type HealthPayload, type TextAnchor } from "../api.js";
import { useFetch } from "../hooks.js";

const LEVEL_LABEL: Record<string, string> = {
  block: "必须处理",
  warn: "建议",
  info: "提示",
  pass: "放行",
};

export interface ReaderProps {
  chapter: number;
  source: TextAnchor | null;
  onJump: (chapter: number, quote: string) => void;
}

export function Reader({ chapter, source }: ReaderProps): React.ReactElement {
  const quote = source?.quote ?? null;
  const text = useFetch(() => api.chapter(chapter), [chapter]);
  const health = useFetch(() => api.health(chapter), [chapter]);
  const list = useFetch(() => api.chapters(), []);
  const anchor = useFetch(
    () =>
      source === null
        ? Promise.resolve(null)
        : api.anchor(source),
    [chapter, quote, source?.offsetHint, source?.occurrence],
  );

  const markRef = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);
  const [selection, setSelection] = useState<PassageRequest | null>(null);
  const [panel, setPanel] = useState("assistant");
  const [assisting, setAssisting] = useState(false);
  const selectionId = useRef(0);

  useEffect(() => {
    markRef.current?.scrollIntoView({ block: "center" });
  }, [anchor.data, text.data]);

  // 换章从头读起；滚动进度写进本地 state，供顶部细条显示读到哪了。
  useEffect(() => {
    if (quote === null && scroller.current !== null) scroller.current.scrollTop = 0;
    setProgress(0);
  }, [chapter, quote]);

  const onScroll = (): void => {
    const el = scroller.current;
    if (el === null) return;
    const total = el.scrollHeight - el.clientHeight;
    setProgress(total <= 0 ? 1 : Math.min(1, el.scrollTop / total));
  };

  if (text.error !== null) return <div className="empty">{text.error}</div>;
  if (text.data === null) return <div className="empty">载入中</div>;

  const resolution = anchor.data?.resolution ?? null;
  const hit =
    resolution !== null && resolution.status !== "stale"
      ? { offset: resolution.offset, length: resolution.length }
      : null;

  const chapters = list.data ?? [];
  const index = chapters.findIndex((c) => c.chapter === chapter);
  const prev = index > 0 ? chapters[index - 1] : undefined;
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1] : undefined;
  const go = (n: number): void => { window.location.hash = `/chapter/${n}`; };

  return (
    <div className="reader-page">
      <div className="reader-bar">
        <div className="reader-bar-main">
          <h1>第 {chapter} 章</h1>
          <ChoiceSelect
            aria-label="选择章节"
            value={chapter}
            className="reader-picker"

            onChange={go}
            options={chapters.map((c) => ({
              value: c.chapter,
              label: `第 ${c.chapter} 章${c.beat === null ? "" : ` · ${c.beat.slice(0, 14)}`}`,
            }))}
          />
        </div>
        <div className="reader-bar-side">
          <HelpTooltip title={prev === undefined ? "已是最前一章" : `第 ${prev.chapter} 章`}>
            <Button variant="ghost" icon={<LeftOutlined />} disabled={prev === undefined} onClick={() => prev && go(prev.chapter)} aria-label="上一章" />
          </HelpTooltip>
          <HelpTooltip title={next === undefined ? "已是最后一章" : `第 ${next.chapter} 章`}>
            <Button variant="ghost" icon={<RightOutlined />} disabled={next === undefined} onClick={() => next && go(next.chapter)} aria-label="下一章" />
          </HelpTooltip>
          <ActionLink href="#/export">导出作品</ActionLink>
        </div>
        <div className="reader-progress" aria-hidden="true"><i style={{ transform: `scaleX(${progress})` }} /></div>
      </div>

      {resolution?.status === "stale" && (
        <p className="reader-notice" data-tone="warn">
          原文已变动，无法定位那一段（{resolution.reason === "chapter_missing" ? "章节不存在" : "引文已被改写"}）。
          锚点用原文片段做主键，作者改写后就失效 —— 这是正常状态，不是错误。
        </p>
      )}
      {resolution?.status === "shifted" && (
        <p className="reader-notice">位置比记录的偏移了 {resolution.shiftedBy} 字（前面增删过内容），已按引文重新定位。</p>
      )}

      <div className="reader-body">
        <div className="reader-scroll" ref={scroller} onScroll={onScroll}>
          <SelectableProse className="prose" text={text.data.text} hit={selection ? { offset: selection.start, length: selection.quote.length } : hit} markRef={markRef} disabled={assisting}
            onSelect={(range, intent) => { setSelection({ ...range, intent, id: ++selectionId.current }); setPanel("assistant"); }}>
            <div className="reader-end">
              {next === undefined ? <span className="muted">已是最后一章</span> : <Button onClick={() => go(next.chapter)}>继续读第 {next.chapter} 章 →</Button>}
            </div>
          </SelectableProse>
        </div>

        <aside className="reader-side chapter-assistance" aria-label="章节辅助">
          <Tabs.Root value={panel} onValueChange={setPanel} className="chapter-tabs-root">
            <Tabs.List className="chapter-assistance-tabs" aria-label="章节辅助功能">
              <Tabs.Trigger value="assistant">段落助手</Tabs.Trigger><Tabs.Trigger value="health">章节检查</Tabs.Trigger>
            </Tabs.List>
            <Tabs.Content value="assistant" forceMount hidden={panel !== "assistant"} className="chapter-assistant-panel">
              <PassageAssistant source={{ chapter }} selection={selection} onClear={() => setSelection(null)} onBusy={setAssisting} />
            </Tabs.Content>
            <Tabs.Content value="health" forceMount hidden={panel !== "health"} className="chapter-health-panel">
              <p className="chapter-check-intro">体检会检查疲劳词、感叹词、套话与重复结构；有计划和已确认结构记录时，再核对预算、事件密度与跨章关联。无需调用 AI，也不会修改正文。</p>
              {health.loading ? <p role="status">正在读取章节检查…</p> : health.error ? <div role="alert"><p>检查暂时无法读取：{health.error}</p><Button onClick={health.reload}>重试检查</Button></div> : <Health health={health.data} />}
            </Tabs.Content>
          </Tabs.Root>
        </aside>
      </div>
    </div>
  );
}

function Health({ health }: { health: HealthPayload | null }): React.ReactElement {
  if (health === null) {
    return (
      <>
        <h2>章节检查</h2>
        <p className="muted">尚未读取到检查结果。</p>
      </>
    );
  }

  const groups: readonly { title: string; findings: GateFinding[]; unavailable: string | null; note?: string }[] = [
    { title: "基础正文检查", findings: health.textGate?.findings ?? [], unavailable: health.textGate === null ? "尚无正文，暂不能进行文本检查。" : health.textGate.words === 0 ? "正文没有可计数的内容，暂不能评估文本质量。" : null },
    { title: "章节计划与预算", findings: [...health.plan, ...(health.chapterGate?.findings.filter(finding => /^(word_count|density)_/.test(finding.rule)) ?? [])], unavailable: health.unavailable.plan,
      ...(health.unavailable.density === null ? {} : { note: health.unavailable.density }) },
    { title: "跨章关联检查", findings: health.crossChapter, unavailable: health.unavailable.crossChapter, note: "仅依据截至本章的已确认结构记录，不代表未记录的情节也已核对。" },
  ];

  return (
    <>
      <h2>章节检查</h2>
      {health.textGate !== null && (
        <div className="reader-metrics">
          <div><span>{health.textGate.words}</span><small>字（只计汉字与西文词）</small></div>
          {health.chapterGate?.density != null && <div><span>{health.chapterGate.density.toFixed(2)}</span><small>加权事件密度 / 千字</small></div>}
        </div>
      )}

      {groups.map((g) => (
        <div key={g.title} className="reader-group">
          <h3>{g.title}</h3>
          {g.note && <p className="muted">{g.note}</p>}
          {g.unavailable !== null ? <p className="muted reader-none">暂不可检查：{g.unavailable}</p> : g.findings.length === 0 ? (
            <p className="muted reader-none">本次已执行的规则未发现问题。</p>
          ) : (
            <div className="findings">
              {g.findings.map((f, i) => (
                <div key={i} className="finding" data-level={f.level}>
                  <div className="finding-rule">
                    {LEVEL_LABEL[f.level] ?? f.level} · {f.rule}
                    {f.measured !== undefined && f.threshold !== undefined && ` · ${f.measured}/${f.threshold}`}
                  </div>
                  <div className="finding-msg">{f.message}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </>
  );
}
