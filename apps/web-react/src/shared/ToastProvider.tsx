/**
 * 简卡铺 · 轻提示（Toast）
 * ---------------------------------------------------------------------------
 * 用 Context 提供 toast(msg, icon)，任意组件可调用；前台后台共用。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

type ToastKind = "info" | "success" | "warn" | "error";

interface ToastItem {
  id: number;
  message: string;
  icon?: string;
  kind: ToastKind;
}

interface ToastApi {
  toast: (message: string, icon?: string) => void;
  success: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_ICON: Record<ToastKind, string> = {
  info: "",
  success: "✅",
  warn: "⚠️",
  error: "🚫",
};

const DURATION_MS = 2200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  /**
   * 记下所有待触发的定时器。
   *
   * 组件卸载后这些定时器还会烧到点，回调里去 setState 就是「对已卸载组件更新」；
   * 在测试环境里宿主对象已被回收，甚至会直接抛 ReferenceError 让整轮测试失败。
   */
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const push = useCallback((message: string, kind: ToastKind, icon?: string) => {
    const id = ++seq.current;
    setItems((prev) => [...prev, { id, message, kind, icon }]);

    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setItems((prev) => prev.filter((t) => t.id !== id));
    }, DURATION_MS);

    timers.current.add(timer);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      toast: (message, icon) => push(message, "info", icon),
      success: (message) => push(message, "success"),
      warn: (message) => push(message, "warn"),
      error: (message) => push(message, "error"),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-wrap" role="status" aria-live="polite">
        {items.map((item) => (
          <div className="toast" key={item.id}>
            {(item.icon ?? DEFAULT_ICON[item.kind]) && (
              <span>{item.icon ?? DEFAULT_ICON[item.kind]}</span>
            )}
            <span>{item.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** 取用 toast API；必须在 ToastProvider 内使用 */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast 必须在 <ToastProvider> 内使用");
  return ctx;
}
