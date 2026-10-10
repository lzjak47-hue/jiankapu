/**
 * 简卡铺 · 前台应用根组件
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ToastProvider } from "../shared/ToastProvider";
import { SiteProvider } from "./SiteContext";
import { SiteLayout } from "./layout/SiteLayout";
import { HomePage } from "./pages/HomePage";
import { ProductPage } from "./pages/ProductPage";
import { QueryPage } from "./pages/QueryPage";
import { BootGate } from "./BootGate";

export function SiteApp() {
  return (
    <ToastProvider>
      <SiteProvider>
        <BootGate>
          <BrowserRouter>
            <Routes>
              <Route element={<SiteLayout />}>
                <Route path="/" element={<HomePage />} />
                <Route path="/product/:id" element={<ProductPage />} />
                <Route path="/query" element={<QueryPage />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </BootGate>
      </SiteProvider>
    </ToastProvider>
  );
}

export default SiteApp;
