import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { PartifulApp } from "./PartifulApp";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode><PartifulApp /></StrictMode>
);
