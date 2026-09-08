import "./polyfills";
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import { initTheme } from "./lib/theme";
import { App } from "./App";

// Apply the stored terminal theme before first paint (no dark flash).
initTheme();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
