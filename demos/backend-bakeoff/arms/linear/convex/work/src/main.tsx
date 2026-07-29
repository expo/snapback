import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadRuntime } from "./provider";
import "./styles.css";

const root = createRoot(document.getElementById("root")!);
root.render(<div>Connecting to the isolated Convex target…</div>);
loadRuntime().then((runtime) => {
  root.render(<StrictMode><App runtime={runtime} /></StrictMode>);
}).catch((error) => root.render(<pre>{String(error)}</pre>));
