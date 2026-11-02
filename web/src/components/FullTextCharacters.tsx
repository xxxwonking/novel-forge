import { useEffect, useRef, useState } from "react";
import {
  api,
  type FullTextCharacters as View,
  type PreparationProposal,
} from "../api.js";
import { useFetch, useRouteActive } from "../hooks.js";
import { Button, CheckField } from "./controls.js";
export function FullTextCharacters({
  known,
  onProposed,
}: {
  known: readonly {
    name: string;
    aliases: readonly string[];
  }[];
  onProposed: (proposal: PreparationProposal) => void;
}): React.ReactElement {
  const data = useFetch(api.fullTextCharacters);
  const [current, setCurrent] = useState<View | null>(null);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const stop = useRef(false);
  const active = useRouteActive();
  useEffect(
    () => () => {
      stop.current = true;
    },
    [],
  );
  const view = current ?? data.data;
  const read = async () => {
    if (!view || running) return;
    stop.current = false;
    setRunning(true);
    setError(null);
    setNotice(null);
    try {
      let next = await api.fullTextCharacters();
      while (!next.done && !stop.current && active()) {
        next = await api.readFullTextChunk(next.completed, next.fingerprint);
        if (active()) setCurrent(next);
      }
    } catch (cause) {
      if (active()) setError((cause as Error).message);
    } finally {
      if (active()) setRunning(false);
    }
  };
  const propose = async () => {
    if (!view || saving || selected.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      const proposal = await api.proposeFullTextCharacters(
        view.fingerprint,
        selected,
      );
      if (active()) {
        setNotice("已保存为待确认方案，请核对身份、定位与出处后确认。");
        setSelected([]);
        onProposed(proposal);
      }
    } catch (cause) {
      if (active()) setError((cause as Error).message);
    } finally {
      if (active()) setSaving(false);
    }
  };
  return (
    <section
      className="prep-section full-text-intake"
      aria-label="全文人物核对"
    >
      <div className="section-head">
        <h2>全文人物核对</h2>
        <div className="row">
          {running ? (
            <Button
              onClick={() => {
                stop.current = true;
              }}
            >
              读完当前块后暂停
            </Button>
          ) : (
            <Button
              disabled={!view || view.total === 0 || view.done || saving}
              onClick={() => void read()}
            >
              {view && view.completed > 0 ? "继续阅读全文" : "阅读全文识别人物"}
            </Button>
          )}
          <Button
            disabled={running || saving}
            onClick={() => {
              setCurrent(null);
              setSelected([]);
              data.reload();
            }}
          >
            重新读取进度
          </Button>
        </div>
      </div>
      <p className="muted">
        逐块读取全部正文与资料，每块一次 AI
        调用。离开页面后读完当前块即停，刷新可继续；失败不会跳块或自动重试。原稿和已有档案保持不变。
      </p>
      {view && view.total > 0 && (
        <p role="status">
          已读取 {view.completed} / {view.total} 块
          {view.done
            ? "，全文读取完成，请核对识别结果"
            : view.next
              ? `，下一块：${view.next.title}（从第 ${view.next.offset + 1} 字符）`
              : ""}
        </p>
      )}
      {view?.total === 0 && <p className="muted">尚无可读取的正文或资料。</p>}
      {view?.stale && (
        <p className="finding" data-level="warn">
          正文或资料已换版，旧候选不再使用。下次从当前版本第一块开始。
        </p>
      )}
      {(error ?? data.error) && (
        <p role="alert" className="finding" data-level="block">
          {error ?? data.error}
        </p>
      )}
      {view && view.conflicts.length > 0 && (
        <details>
          <summary>核对身份与别名疑点（{view.conflicts.length}）</summary>
          <p className="muted">存疑项不会直接建卡，请按各项原文依据核对。</p>
          {view.conflicts.map((message) => (
            <p className="finding" data-level="warn" key={message}>
              {message}
            </p>
          ))}
        </details>
      )}
      {view && view.characters.length > 0 && (
        <details open={view.characters.length <= 10}>
          <summary>查看 {view.characters.length} 项识别结果与逐字出处</summary>
          {view.characters.map((person) => {
            const exists = known.some(
              (c) => c.name === person.name || c.aliases.includes(person.name),
            );
            return (
              <details key={person.name}>
                <summary>
                  {person.name}
                  {exists ? " · 已有档案" : ""} · {person.evidence.length}{" "}
                  处依据
                </summary>
                <p>{person.roles.join("；")}</p>
                {person.aliases.length > 0 && (
                  <p>别名：{person.aliases.join("、")}</p>
                )}
                {person.evidence.map((e, i) => (
                  <blockquote key={i}>
                    <small>{e.source}</small>
                    <p>{e.quote}</p>
                  </blockquote>
                ))}
                {!exists && (
                  <CheckField
                    aria-label={`补建${person.name}`}
                    disabled={
                      !view.done ||
                      running ||
                      view.blockedNames?.includes(person.name)
                    }
                    checked={selected.includes(person.name)}
                    onChange={(checked) =>
                      setSelected((old) =>
                        checked
                          ? [...old, person.name]
                          : old.filter((name) => name !== person.name),
                      )
                    }
                  >
                    补建此人物档案
                  </CheckField>
                )}
              </details>
            );
          })}
        </details>
      )}
      {view?.done && (
        <Button
          disabled={selected.length === 0 || running}
          loading={saving}
          onClick={() => void propose()}
        >
          保存所选人物为候选
        </Button>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}
