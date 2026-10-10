/**
 * 简卡铺 · 后台应用根组件
 */
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../shared/ToastProvider";
import { ConfirmProvider } from "../shared/ConfirmProvider";
import { Skeleton } from "../shared/components";
import { AuthProvider, useAuth } from "./AuthContext";
import { AdminLayout } from "./layout/AdminLayout";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ProductsPage } from "./pages/ProductsPage";
import { ProductEditPage } from "./pages/ProductEditPage";
import { CategoriesPage } from "./pages/CategoriesPage";
import { OrdersPage } from "./pages/OrdersPage";
import { CardsPage } from "./pages/CardsPage";
import { UsersPage } from "./pages/UsersPage";
import { SettingsPage } from "./pages/SettingsPage";
import { LogsPage } from "./pages/LogsPage";

/** 未登录时跳登录页；探测期间显示骨架，避免白屏 */
function RequireAuth() {
  const { admin, loading } = useAuth();

  if (loading) {
    return (
      <div className="admin-content" style={{ padding: 40 }}>
        <Skeleton height={60} />
        <div className="mt-24">
          <Skeleton height={320} />
        </div>
      </div>
    );
  }

  if (!admin) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AdminApp() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <BrowserRouter>
          <AuthProvider>
            <Routes>
              <Route path="/login" element={<LoginPage />} />

              <Route element={<RequireAuth />}>
                <Route element={<AdminLayout />}>
                  <Route path="/" element={<DashboardPage />} />
                  <Route path="/products" element={<ProductsPage />} />
                  <Route path="/products/new" element={<ProductEditPage />} />
                  <Route path="/products/:id" element={<ProductEditPage />} />
                  <Route path="/categories" element={<CategoriesPage />} />
                  <Route path="/orders" element={<OrdersPage />} />
                  <Route path="/cards" element={<CardsPage />} />
                  <Route path="/users" element={<UsersPage />} />
                  <Route path="/settings" element={<SettingsPage />} />
                  <Route path="/logs" element={<LogsPage />} />
                </Route>
              </Route>

              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </ConfirmProvider>
    </ToastProvider>
  );
}

export default AdminApp;
