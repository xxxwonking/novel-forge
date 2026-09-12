import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "./api.js";

/** 一次性拉取 + 手动重取。三态（加载/错误/数据）在每个页面都要用。 */
export function useFetch<T>(fn: () => Promise<T>, deps: readonly unknown[] = []): {
  data: T | null;
  error: string | null;
  /** HTTP 状态码（仅 ApiError 有）。409「未选择作品」要与其他失败区分。 */
  errorStatus: number | null;
  loading: boolean;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  // fn 每次渲染都是新函数（调用处写的是箭头函数），放进依赖会死循环。
  // 依赖由调用方通过 deps 显式给出。
  const latest = useRef(fn);
  latest.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    latest
      .current()
      .then((v) => {
        if (alive) {
          setData(v);
          setError(null);
          setErrorStatus(null);
        }
      })
      .catch((e: unknown) => {
        if (alive) {
          setError((e as Error).message);
          setErrorStatus(e instanceof ApiError ? e.status : null);
        }
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce, ...deps]);

  return { data, error, errorStatus, loading, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

/** 容器宽度。SVG 要按可用宽度算刻度，而不是写死一个值。 */
export function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(900);

  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) setWidth(entry.contentRect.width);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [ref, width];
}

/** 极简哈希路由。深链接（#/views/foreshadow）要能直接打开与后退。 */
export function useRoute(): [string, (to: string) => void] {
  const [hash, setHash] = useState(() => window.location.hash.slice(1) || "/");

  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash.slice(1) || "/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return [
    hash,
    useCallback((to: string) => {
      window.location.hash = to;
    }, []),
  ];
}

/** 短暂提示。一键动作之后要让用户看到"改到哪去了"。 */
export function useToast(): [string | null, (message: string) => void] {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  return [
    message,
    useCallback((next: string) => {
      setMessage(next);
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setMessage(null), 4000);
    }, []),
  ];
}
