/**
 * 简卡铺 · 后台登录态
 * ---------------------------------------------------------------------------
 * 进入后台先探测 /api/admin/me：
 *   · 成功 → 放进 Context，渲染壳层
 *   · 401  → admin 保持 null，RequireAuth 会跳登录页（不再白屏）
 * 之后任意接口返回 401（会话过期）都会通过全局处理器跳回登录页。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { api, setUnauthorizedHandler } from "../shared/api";
import type { AdminInfo } from "../shared/types";

interface AuthValue {
  admin: AdminInfo | null;
  /** 首次探测登录态是否完成 */
  loading: boolean;
  /** 重新探测 */
  refresh: () => Promise<void>;
  /** 登录成功后写入 */
  setAdmin: (admin: AdminInfo) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [admin, setAdminState] = useState<AdminInfo | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const data = await api.admin.me();
      setAdminState(data.admin);
    } catch {
      setAdminState(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /* 会话过期时统一跳登录页 */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAdminState(null);
      navigate("/login", { replace: true });
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  const logout = useCallback(async () => {
    try {
      await api.admin.logout();
    } catch {
      /* 退出失败也要清本地状态 */
    }
    setAdminState(null);
    navigate("/login", { replace: true });
  }, [navigate]);

  const value = useMemo<AuthValue>(
    () => ({ admin, loading, refresh, setAdmin: setAdminState, logout }),
    [admin, loading, refresh, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** 取用登录态；必须在 AuthProvider 内使用 */
export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth 必须在 <AuthProvider> 内使用");
  return ctx;
}
