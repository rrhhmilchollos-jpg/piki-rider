import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.tsx";
import PikiSplash from "./PikiSplash";
import { PikiReleaseGate, installPikiReleaseHeaders } from "./pikiRelease";

installPikiReleaseHeaders();
createRoot(document.getElementById("root")!).render(
  <StrictMode><PikiSplash><PikiReleaseGate><App /></PikiReleaseGate></PikiSplash></StrictMode>,
);
