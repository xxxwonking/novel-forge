import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App as AntApp, ConfigProvider } from "antd";
import { StyleProvider } from "@ant-design/cssinjs";
import zhCN from "antd/locale/zh_CN";
import { App } from "./App.js";
import { getLegacyTheme } from "./theme.js";
import "./styles.css";
import "./styles/ui.css";

const root = document.getElementById("root");
if (root === null) throw new Error("缺少 #root");

createRoot(root).render(
  <StrictMode>
    <StyleProvider layer>
      <ConfigProvider theme={getLegacyTheme()} locale={zhCN}>
        <AntApp className="app-root">
          <App />
        </AntApp>
      </ConfigProvider>
    </StyleProvider>
  </StrictMode>,
);
