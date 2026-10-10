/**
 * 简卡铺 · 前台入口
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../shared/styles/tokens.css";
import "../shared/styles/base.css";
import "./site.css";

import { SiteApp } from "./App";

const container = document.getElementById("root");
if (!container) throw new Error("找不到 #root 挂载点");

createRoot(container).render(
  <StrictMode>
    <SiteApp />
  </StrictMode>
);
