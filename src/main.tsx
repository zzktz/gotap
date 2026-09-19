import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { HeroUIProvider } from "@heroui/react";

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

// Selection windows are rendered before React effects run. Mark the document
// synchronously so the WebView2 page never paints its normal white app
// background before the transparent selection surface is ready.
const isSelectionWindow = new URLSearchParams(window.location.search).has(
  "selection",
);
if (isSelectionWindow) {
  document.documentElement.classList.add("selection-mode");
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isSelectionWindow ? (
      <App />
    ) : (
      <HeroUIProvider>
        <App />
      </HeroUIProvider>
    )}
  </React.StrictMode>,
);
