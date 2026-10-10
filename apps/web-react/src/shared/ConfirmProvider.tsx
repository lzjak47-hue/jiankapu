/**
 * 简卡铺 · 确认框
 * ---------------------------------------------------------------------------
 * 用 Promise 风格的 useConfirm()：
 *   const ok = await confirm({ title: "删除商品", message: "...", danger: true });
 */
import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Modal } from "./components";

interface ConfirmOptions {
  title: string;
  message: string;
  okText?: string;
  cancelText?: string;
  danger?: boolean;
}

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

interface PendingConfirm extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;

  const confirm = useCallback<ConfirmFn>((options) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const settle = useCallback((value: boolean) => {
    const current = pendingRef.current;
    setPending(null);
    current?.resolve(value);
  }, []);

  const value = useMemo(() => confirm, [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {pending && (
        <Modal
          title={pending.title}
          width={400}
          onClose={() => settle(false)}
          footer={
            <>
              <button className="btn btn-ghost btn-block" onClick={() => settle(false)}>
                {pending.cancelText ?? "取消"}
              </button>
              <button
                className={pending.danger ? "btn btn-accent btn-block" : "btn btn-primary btn-block"}
                onClick={() => settle(true)}
              >
                {pending.okText ?? "确定"}
              </button>
            </>
          }
        >
          <p className="muted" style={{ lineHeight: 1.8, whiteSpace: "pre-wrap" }}>
            {pending.message}
          </p>
        </Modal>
      )}
    </ConfirmContext.Provider>
  );
}

/** 取用确认框；必须在 ConfirmProvider 内使用 */
export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm 必须在 <ConfirmProvider> 内使用");
  return ctx;
}
