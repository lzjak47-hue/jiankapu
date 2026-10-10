import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const root = import.meta.dirname;

/**
 * 一个 Vite 工程构建两个独立应用：
 *   index.html        → 前台商城（部署在 2001）
 *   admin/index.html  → 管理后台（部署在 2002）
 *
 * 两者共享 src/shared 下的类型、API 客户端与设计系统。
 */
export default defineConfig({
  plugins: [react()],

  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },

  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      input: {
        site: path.resolve(root, "index.html"),
        admin: path.resolve(root, "admin/index.html"),
      },
    },
  },

  server: {
    port: 5173,
    strictPort: false,
    // 开发期把接口请求代理到后端；两个应用共用同一套 API
    proxy: {
      "/api": {
        target: process.env.VITE_API_TARGET || "http://localhost:2002",
        changeOrigin: true,
      },
    },
  },
});
