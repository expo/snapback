import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { LinearApp } from "./LinearApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LinearApp />
  </StrictMode>
);
