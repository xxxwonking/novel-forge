import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App.js";
import { appTheme } from "./theme.js";
import "./styles.css";

const root = document.getElementById("root");
if (root === null) throw new Error("缺少 #root");

createRoot(root).render(
  <StrictMode>
    <ConfigProvider theme={appTheme} locale={zhCN}>
      <AntApp className="app-root">
        <App />
      </AntApp>
    </ConfigProvider>
  </StrictMode>,
);
