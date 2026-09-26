//! The maintained Vite reference is also the packaged production web starter.
use serde_json::{Value, json};

// @ref LLP 3000.011.003.000#1 — reuse one supported output; the default stays schema-only.
pub(super) fn files() -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(include_str!("../../../../../apps/chat/package.json")).unwrap();
    package["name"] = json!("snapback4-web-starter");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    package["scripts"]["build"] = json!("vite build && snapback4 web-shell dist");
    vec![
        ("package.json", super::pretty(&package)),
        ("src/App.tsx", include_str!("web-app.tsx").to_owned()),
        ("src/client.ts", include_str!("web-client.ts").to_owned()),
        ("src/Composer.tsx", include_str!("../../../../../apps/chat/src/Composer.tsx").to_owned()),
        ("src/Thread.tsx", include_str!("../../../../../apps/chat/src/Thread.tsx").to_owned()),
        ("src/Inbox.tsx", include_str!("../../../../../apps/chat/src/Inbox.tsx").to_owned()),
        ("src/main.tsx", r#"import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
createRoot(document.getElementById("root")!).render(<App />);
"#.to_owned()),
        ("src/intents.ts", include_str!("../../../../../apps/chat/src/intents.ts").to_owned()),
        ("src/state.ts", include_str!("../../../../../apps/chat/src/state.ts").to_owned()),
        ("src/vite-env.d.ts", include_str!("../../../../../apps/chat/src/vite-env.d.ts").to_owned()),
        ("index.html", include_str!("../../../../../apps/chat/index.html").to_owned()),
        ("vite.config.ts", r#"import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], build: { target: "es2022", sourcemap: false } });
"#.to_owned()),
        ("tsconfig.json", include_str!("../../../../../apps/chat/tsconfig.json").to_owned()),
        ("snapback/schema.q", include_str!("../../../../../apps/chat/snapback/schema.q").to_owned()),
        ("snapback/worker.ts", include_str!("../../../../../apps/chat/snapback/worker.ts").to_owned()),
        ("README.md", include_str!("web-readme.md").to_owned()),
    ]
}
