import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "./components/ui/tooltip.js";
import { App } from "./App.js";
import "./styles.css";
import "./styles/ui.css";
import "./styles/application.css";
import "./styles/chat-dock.css";
import "./styles/passage-assistant.css";

const root = document.getElementById("root");
if (root === null) throw new Error("缺少 #root");

createRoot(root).render(
  <StrictMode>
    <TooltipProvider delayDuration={350}><div className="app-root"><App /></div></TooltipProvider>
  </StrictMode>,
);
