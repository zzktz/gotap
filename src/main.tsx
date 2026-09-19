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
  // WebView2 can apply its default white canvas before the stylesheet rules
  // are resolved. Set all three document layers inline for the selection
  // window so the native transparent surface is preserved on Windows.
  for (const element of [
    document.documentElement,
    document.body,
    document.getElementById("root"),
  ]) {
    element?.style.setProperty("background", "rgba(0, 0, 0, 0)", "important");
    element?.style.setProperty(
      "background-color",
      "rgba(0, 0, 0, 0)",
      "important",
    );
  }
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HeroUIProvider>
      <App />
    </HeroUIProvider>
  </React.StrictMode>,
);
