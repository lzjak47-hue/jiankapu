/**
 * 简卡铺 · 前台全局数据
 * ---------------------------------------------------------------------------
 * 首屏拉一次 /api/public/bootstrap，把站点设置、分类、商品、公告放进 Context。
 * 下单成功后调用 refreshProducts() 同步库存与销量。
 */
import { createContext, useCallback, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import { api } from "../shared/api";
import { useAsync } from "../shared/hooks";
import type {
  Announcement,
  Category,
  Product,
  PublicSettings,
  ServiceEndpoints,
} from "../shared/types";

interface SiteContextValue {
  settings: PublicSettings | null;
  categories: Category[];
  products: Product[];
  announcements: Announcement[];
  endpoints: ServiceEndpoints | null;
  loading: boolean;
  error: string | null;
  /** 重新拉取全部数据 */
  reload: () => void;
  /** 只刷新商品（下单后库存变化） */
  refreshProducts: () => Promise<void>;
  /** 按 id 找一个商品 */
  findProduct: (id: string) => Product | undefined;
  /** 分类 id → 名称 */
  categoryName: (id: string) => string;
}

const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: ReactNode }) {
  const { data, loading, error, reload, setData } = useAsync(
    (signal) => api.public.bootstrap(signal),
    []
  );

  const refreshProducts = useCallback(async () => {
    try {
      const fresh = await api.public.bootstrap();
      setData(fresh);
    } catch {
      /* 刷新失败不影响主流程，下次操作时会再试 */
    }
  }, [setData]);

  const value = useMemo<SiteContextValue>(
    () => ({
      settings: data?.settings ?? null,
      categories: data?.categories ?? [],
      products: data?.products ?? [],
      announcements: data?.announcements ?? [],
      endpoints: data?.endpoints ?? null,
      loading,
      error,
      reload,
      refreshProducts,
      findProduct: (id) => (data?.products ?? []).find((p) => p.id === id),
      categoryName: (id) => (data?.categories ?? []).find((c) => c.id === id)?.name ?? "商品",
    }),
    [data, loading, error, reload, refreshProducts]
  );

  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}

/** 取用前台全局数据；必须在 SiteProvider 内使用 */
export function useSite(): SiteContextValue {
  const ctx = useContext(SiteContext);
  if (!ctx) throw new Error("useSite 必须在 <SiteProvider> 内使用");
  return ctx;
}
