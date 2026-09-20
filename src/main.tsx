import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { HeroUIProvider } from "@heroui/react";

document.addEventListener("contextmenu", (event) => {
  event.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HeroUIProvider>
      <App />
    </HeroUIProvider>
  </React.StrictMode>,
);
