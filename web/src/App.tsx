/**
 * 应用外壳与路由。
 *
 * 用 hash 路由而不是 history API：这个前端由同一个 Node 进程托管静态文件，
 * hash 不进服务端，深链接不需要服务端配合（虽然 http.ts 也做了 SPA 回退）。
 * 少一处需要两边同时正确的东西。
 */

import { useCallback, useState } from "react";
import { api, type Alert, type AlertAction } from "./api.js";
import { useFetch, useRoute, useToast } from "./hooks.js";
import { actionLabel } from "./components/AlertCard.js";
import { Home } from "./pages/Home.js";
import { AlertList } from "./pages/AlertList.js";
import { ViewPage } from "./pages/ViewPage.js";
import { Reader } from "./pages/Reader.js";
import { Chat } from "./pages/Chat.js";

const VIEWS = [
  { path: "/foreshadow", label: "伏笔时间线" },
  { path: "/plotlines", label: "情节线" },
  { path: "/arcs", label: "人物弧线" },
  { path: "/relations", label: "关系图" },
] as const;

export function App(): React.ReactElement {
  const [route, go] = useRoute();
  const [toast, showToast] = useToast();
  const [nonce, setNonce] = useState(0);

  const overview = useFetch(() => api.overview(), [nonce]);

  /** 全局重取。一键动作会同时改节拍表、事件流与告警，所以整体刷新。 */
  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  /**
   * 一键动作的统一入口。
   *
   * 两类动作在这里分岔：纯导航（跳原文/看视图）不发请求，其余都打后端并
   * 刷新。§12.6.7 的闭环要让用户**立刻**看到告警消失，所以 toast 里写清
   * 改到哪去了，再由 refresh 把首页三条换掉。
   */
  const onAction = useCallback(
    async (alert: Alert, action: AlertAction) => {
      if (action.kind === "jump_to_anchor") {
        go(`/chapter/${action.anchor.chapter}?quote=${encodeURIComponent(action.anchor.quote)}`);
        return;
      }
      if (action.kind === "open_view") {
        const target = VIEWS.find((v) => v.path.includes(action.view === "arc" ? "arcs" : action.view));
        go(target?.path ?? "/foreshadow");
        return;
      }
      try {
        const result = await api.action(alert.id, action);
        const budget = result.beat?.budget;
        showToast(
          !result.changed
            ? `${actionLabel(action)}：无需改动`
            : result.promotedToPayoff === true && budget != null
              ? `已${actionLabel(action)}；该章已改为回收章，预算随之放宽到 ${budget.words.min}–${budget.words.max} 字（主线收束需要呼应空间）`
              : `已${actionLabel(action)}`,
        );
        refresh();
      } catch (e) {
        showToast(`失败：${(e as Error).message}`);
      }
    },
    [go, refresh, showToast],
  );

  const onIgnore = useCallback(
    async (alert: Alert) => {
      try {
        await api.ignore(alert.id);
        showToast("已降低这条的优先级；问题变严重时会重新提醒");
        refresh();
      } catch (e) {
        showToast(`失败：${(e as Error).message}`);
      }
    },
    [refresh, showToast],
  );

  const onJump = useCallback(
    (chapter: number, quote: string) => go(`/chapter/${chapter}?quote=${encodeURIComponent(quote)}`),
    [go],
  );

  return (
    <div className="shell">
      <nav className="rail">
        <div className="rail-title">{overview.data?.title ?? "novel-forge"}</div>
        <div className="rail-sub">
          {overview.data === null
            ? "载入中"
            : `第 ${overview.data.currentChapter} 章 · 下一章 ${overview.data.nextChapter}`}
        </div>

        <Link route={route} to="/chat" go={go}>
          对话
        </Link>
        <Link route={route} to="/" go={go}>
          首页
        </Link>
        <Link route={route} to="/alerts" go={go} count={overview.data?.counts.fullList}>
          全部提示
        </Link>

        <div className="rail-group">结构视图</div>
        {VIEWS.map((v) => (
          <Link key={v.path} route={route} to={v.path} go={go}>
            {v.label}
          </Link>
        ))}

        <div className="rail-group">正文</div>
        <Link route={route} to={`/chapter/${overview.data?.currentChapter ?? 1}`} go={go}>
          章节与体检
        </Link>
      </nav>

      <main className="main">
        {overview.error !== null && <div className="empty">读取失败：{overview.error}</div>}
        {overview.data !== null && (
          <Routed
            route={route}
            overview={overview.data}
            onAction={onAction}
            onIgnore={onIgnore}
            onJump={onJump}
            refresh={refresh}
          />
        )}
      </main>

      {toast !== null && <div className="toast">{toast}</div>}
    </div>
  );
}

interface RoutedProps {
  route: string;
  overview: NonNullable<ReturnType<typeof useFetch<Awaited<ReturnType<typeof api.overview>>>>["data"]>;
  onAction: (alert: Alert, action: AlertAction) => void;
  onIgnore: (alert: Alert) => void;
  onJump: (chapter: number, quote: string) => void;
  refresh: () => void;
}

function Routed({ route, overview, onAction, onIgnore, onJump, refresh }: RoutedProps): React.ReactElement {
  const [path, search] = route.split("?");
  const query = new URLSearchParams(search ?? "");

  if (path === "/chat") {
    return <Chat onJump={onJump} refresh={refresh} />;
  }
  if (path === "/" || path === "") {
    return <Home overview={overview} onAction={onAction} onIgnore={onIgnore} />;
  }
  if (path === "/alerts") {
    return <AlertList onAction={onAction} onIgnore={onIgnore} refreshKey={overview.currentChapter} />;
  }
  if (path?.startsWith("/chapter/")) {
    const n = Number(path.slice("/chapter/".length));
    return <Reader chapter={Number.isInteger(n) ? n : overview.currentChapter} quote={query.get("quote")} onJump={onJump} />;
  }

  const view = VIEWS.find((v) => v.path === path);
  if (view !== undefined) {
    return <ViewPage kind={view.path} title={view.label} onJump={onJump} highlight={query.get("id")} refresh={refresh} />;
  }
  return <div className="empty">没有这个页面</div>;
}

function Link({
  route,
  to,
  go,
  count,
  children,
}: {
  route: string;
  to: string;
  go: (to: string) => void;
  count?: number | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  const active = route === to || (to !== "/" && route.startsWith(to));
  return (
    <a
      href={`#${to}`}
      data-active={active}
      onClick={(e) => {
        e.preventDefault();
        go(to);
      }}
    >
      <span>{children}</span>
      {count !== undefined && <span className="rail-count">{count}</span>}
    </a>
  );
}
