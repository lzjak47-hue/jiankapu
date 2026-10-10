/**
 * 简卡铺 · 通用 React Hooks
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { DependencyList } from "react";

/* ============================================================ 数据加载 */

export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export interface UseAsyncResult<T> extends AsyncState<T> {
  /** 重新拉取 */
  reload: () => void;
  /** 本地更新数据（乐观更新用） */
  setData: (updater: T | ((prev: T | null) => T)) => void;
}

/**
 * 声明式数据加载：自动处理 loading / error / 组件卸载后不再 setState，
 * 并且每次依赖变化都会取消上一次请求（AbortController）。
 */
export function useAsync<T>(
  loader: (signal: AbortSignal) => Promise<T>,
  deps: DependencyList = []
): UseAsyncResult<T> {
  const [state, setState] = useState<AsyncState<T>>({ data: null, loading: true, error: null });
  const [tick, setTick] = useState(0);

  const loaderRef = useRef(loader);
  loaderRef.current = loader;

  useEffect(() => {
    const controller = new AbortController();
    let alive = true;

    setState((prev) => ({ ...prev, loading: true, error: null }));

    loaderRef.current(controller.signal)
      .then((data) => {
        if (alive) setState({ data, loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (!alive || controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "加载失败";
        setState({ data: null, loading: false, error: message });
      });

    return () => {
      alive = false;
      controller.abort();
    };
    // 依赖由调用方声明，tick 用于手动重载
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  const setData = useCallback((updater: T | ((prev: T | null) => T)) => {
    setState((prev) => ({
      ...prev,
      data:
        typeof updater === "function"
          ? (updater as (p: T | null) => T)(prev.data)
          : updater,
    }));
  }, []);

  return { ...state, reload, setData };
}

/* ============================================================ 防抖输入 */

/** 输入防抖：返回延迟后的值，适合搜索框 */
export function useDebouncedValue<T>(value: T, delay = 280): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}

/* ============================================================ 倒计时 */

/**
 * 倒计时秒数。归零时触发 onExpire（只触发一次）。
 * @param initial 初始秒数；变化时会重置
 */
export function useCountdown(initial: number, onExpire?: () => void) {
  const [remain, setRemain] = useState(initial);
  const expireRef = useRef(onExpire);
  expireRef.current = onExpire;

  useEffect(() => {
    setRemain(initial);
  }, [initial]);

  useEffect(() => {
    if (remain <= 0) {
      expireRef.current?.();
      return;
    }
    const timer = setTimeout(() => setRemain((r) => r - 1), 1000);
    return () => clearTimeout(timer);
  }, [remain]);

  return remain;
}

/* ============================================================ 定时轮询 */

/**
 * 周期性执行回调。cb 变化不会重启定时器（用 ref 透传）。
 * @param enabled 为 false 时不启动
 */
export function useInterval(callback: () => void, delayMs: number | null): void {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  useEffect(() => {
    if (delayMs === null) return;
    const timer = setInterval(() => cbRef.current(), delayMs);
    return () => clearInterval(timer);
  }, [delayMs]);
}

/* ============================================================ 滚动入场 */

/**
 * 给容器内的 .reveal 元素加 is-in 类，触发入场动画。
 * 返回 ref 挂到容器上即可。
 */
export function useRevealOnScroll<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;

    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".reveal"));
    if (nodes.length === 0) return;

    if (!("IntersectionObserver" in window)) {
      nodes.forEach((n) => n.classList.add("is-in"));
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.05 }
    );

    nodes.forEach((n) => {
      if (!n.classList.contains("is-in")) observer.observe(n);
    });

    return () => observer.disconnect();
  }, []);

  return ref;
}

/* ============================================================ 本地持久化 */

/** 受控的 localStorage 状态 */
export function useLocalStorage<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* 隐私模式等场景忽略 */
    }
  }, [key, value]);

  return [value, setValue] as const;
}

/* ============================================================ 列表列显隐 */

/**
 * 表格列显隐偏好：按 storageKey 持久化到 localStorage（每个列表页独立）。
 * 返回的 visible(key) 控制每列是否渲染。
 */
export function useColumnVisibility(storageKey: string) {
  const [hidden, setHidden] = useLocalStorage<string[]>(storageKey, []);
  const hiddenSet = new Set(hidden);

  const visible = (key: string) => !hiddenSet.has(key);
  const toggle = (key: string) =>
    setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  const showAll = () => setHidden([]);

  return { hidden, visible, toggle, showAll };
}
