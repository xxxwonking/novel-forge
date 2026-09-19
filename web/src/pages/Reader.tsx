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
import { Button, Select, Tooltip } from "antd";
import { LeftOutlined, RightOutlined } from "@ant-design/icons";
import { api, type GateFinding, type HealthPayload } from "../api.js";
import { useFetch } from "../hooks.js";

const LEVEL_LABEL: Record<string, string> = {
  block: "必须处理",
  warn: "建议",
  info: "提示",
  pass: "放行",
};

export interface ReaderProps {
  chapter: number;
  quote: string | null;
  onJump: (chapter: number, quote: string) => void;
}

export function Reader({ chapter, quote }: ReaderProps): React.ReactElement {
  const text = useFetch(() => api.chapter(chapter), [chapter]);
  const health = useFetch(() => api.health(chapter).catch(() => null), [chapter]);
  const list = useFetch(() => api.chapters(), []);
  const anchor = useFetch(
    () =>
      quote === null
        ? Promise.resolve(null)
        : api.anchor({ chapter, quote, offsetHint: 0, occurrence: 0 }),
    [chapter, quote],
  );

  const markRef = useRef<HTMLElement | null>(null);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [progress, setProgress] = useState(0);

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
          <Select
            aria-label="选择章节"
            value={chapter}
            className="reader-picker"
            popupMatchSelectWidth={false}
            onChange={go}
            options={chapters.map((c) => ({
              value: c.chapter,
              label: `第 ${c.chapter} 章${c.beat === null ? "" : ` · ${c.beat.slice(0, 14)}`}`,
            }))}
          />
        </div>
        <div className="reader-bar-side">
          <Tooltip title={prev === undefined ? "已是最前一章" : `第 ${prev.chapter} 章`}>
            <Button type="text" icon={<LeftOutlined />} disabled={prev === undefined} onClick={() => prev && go(prev.chapter)} aria-label="上一章" />
          </Tooltip>
          <Tooltip title={next === undefined ? "已是最后一章" : `第 ${next.chapter} 章`}>
            <Button type="text" icon={<RightOutlined />} disabled={next === undefined} onClick={() => next && go(next.chapter)} aria-label="下一章" />
          </Tooltip>
          <a className="export-link" href="#/export">导出作品</a>
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
          <article className="prose">
            {paragraphsOf(text.data.text, hit).map((p, i) => (
              <p key={i}>
                {p.map((seg, j) =>
                  seg.marked ? (
                    <mark key={j} ref={markRef}>
                      {seg.text}
                    </mark>
                  ) : (
                    <span key={j}>{seg.text}</span>
                  ),
                )}
              </p>
            ))}
            <div className="reader-end">
              {next === undefined ? <span className="muted">已是最后一章</span> : <Button onClick={() => go(next.chapter)}>继续读第 {next.chapter} 章 →</Button>}
            </div>
          </article>
        </div>

        <aside className="reader-side">
          <Health health={health.data} />
        </aside>
      </div>
    </div>
  );
}

function Health({ health }: { health: HealthPayload | null }): React.ReactElement {
  if (health === null) {
    return (
      <>
        <h3>体检</h3>
        <p className="muted">这一章没有节拍表，无法体检。</p>
      </>
    );
  }

  const groups: readonly { title: string; findings: GateFinding[] }[] = [
    { title: "节拍表（V2）", findings: health.plan },
    { title: "章内（C6 代码通道）", findings: health.chapterGate?.findings ?? [] },
    { title: "跨章（C6）", findings: health.crossChapter },
  ];

  return (
    <>
      <h3>体检</h3>
      {health.chapterGate !== null && (
        <div className="reader-metrics">
          <div><span>{health.chapterGate.words}</span><small>字（只计汉字与西文词）</small></div>
          <div><span>{health.chapterGate.density.toFixed(2)}</span><small>加权事件密度 / 千字</small></div>
          <p className="muted reader-thresholds">
            {Object.entries(health.chapterGate.thresholds)
              .map(([k, v]) => `${k} ≤ ${v}`)
              .join("　")}
          </p>
        </div>
      )}

      {groups.map((g) => (
        <div key={g.title} className="reader-group">
          <h3>{g.title}</h3>
          {g.findings.length === 0 ? (
            <p className="muted reader-none">无</p>
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

interface Segment {
  text: string;
  marked: boolean;
}

/**
 * 按段落切分，并把命中区间标出来。
 *
 * 段落切分要与后端的 `paragraphs()` 口径一致（按换行、去空段），否则 offset
 * 落在哪一段会算错。这里做法是先按 offset 切成三段再分段落 —— 避免自己去
 * 累加每段长度，那种算法在段落里含换行时容易差一个字符。
 */
function paragraphsOf(text: string, hit: { offset: number; length: number } | null): Segment[][] {
  if (hit === null || hit.offset < 0 || hit.offset + hit.length > text.length) {
    return splitParagraphs(text).map((p) => [{ text: p, marked: false }]);
  }

  const before = text.slice(0, hit.offset);
  const inside = text.slice(hit.offset, hit.offset + hit.length);
  const after = text.slice(hit.offset + hit.length);

  const out: Segment[][] = splitParagraphs(before).map((p) => [{ text: p, marked: false }]);
  const tail = out.pop() ?? [];

  // 命中段落 = before 的最后一段 + 命中文本 + after 的第一段。
  const afterParas = splitParagraphs(after);
  const [firstAfter, ...restAfter] = afterParas;

  out.push([
    ...tail,
    { text: inside, marked: true },
    ...(firstAfter === undefined ? [] : [{ text: firstAfter, marked: false }]),
  ]);
  for (const p of restAfter) out.push([{ text: p, marked: false }]);

  return out;
}

function splitParagraphs(text: string): string[] {
  return text.split("\n").filter((p) => p.trim() !== "");
}
