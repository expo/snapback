//! The default `init --web` and `init --expo` starters: one table, one live
//! query, three mutations and one screen. Toolchain pins come from the
//! maintained reference apps, so the starters move with them; the reference
//! chat apps themselves stay reachable as `--template chat`.
use serde_json::{Value, json};

const SCHEMA: &str = include_str!("starter/schema.q");
const FIXTURES: [(&str, &str); 2] = [
    ("fixtures/todos.jsonl", include_str!("starter/fixtures/todos.jsonl")),
    ("fixtures/test.cases.jsonl", include_str!("starter/fixtures/test.cases.jsonl")),
];

pub(super) fn web_files() -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(include_str!("../../../../../apps/chat/package.json")).unwrap();
    package["name"] = json!("snapback4-web-starter");
    package["version"] = json!("0.1.0");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    package["scripts"]["build"] = json!("vite build && snapback4 web-shell dist");
    vec![
        ("package.json", super::pretty(&package)),
        ("index.html", include_str!("starter/web/index.html").to_owned()),
        ("vite.config.ts", include_str!("starter/web/vite.config.ts").to_owned()),
        ("tsconfig.json", include_str!("../../../../../apps/chat/tsconfig.json").to_owned()),
        ("src/main.tsx", include_str!("starter/web/main.tsx").to_owned()),
        ("src/App.tsx", include_str!("starter/web/App.tsx").to_owned()),
        ("src/client.ts", include_str!("starter/web/client.ts").to_owned()),
        ("src/vite-env.d.ts", include_str!("../../../../../apps/chat/src/vite-env.d.ts").to_owned()),
        ("snapback/schema.q", SCHEMA.to_owned()),
        ("README.md", include_str!("starter/web/README.md").to_owned()),
    ].into_iter().chain(FIXTURES.map(|(name, text)| (name, text.to_owned()))).collect()
}

pub(super) fn expo_files() -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(&super::expo_package()).unwrap();
    package["name"] = json!("snapback4-expo-starter");
    let mut config: Value = serde_json::from_str(include_str!("../../../../../apps/chat-expo/app.json")).unwrap();
    config["expo"]["name"] = json!("Todos");
    config["expo"]["slug"] = json!("snapback4-todos");
    config["expo"]["scheme"] = json!("snapback4todos");
    config["expo"]["ios"]["bundleIdentifier"] = json!("dev.snapback4.todos");
    config["expo"]["android"]["package"] = json!("dev.snapback4.todos");
    vec![
        ("package.json", super::pretty(&package)),
        ("app.json", super::pretty(&config)),
        ("babel.config.js", include_str!("../../../../../apps/chat-expo/babel.config.js").to_owned()),
        ("metro.config.js", include_str!("metro.config.js").to_owned()),
        ("metro-wasm-transformer.cjs", include_str!("metro-wasm-transformer.cjs").to_owned()),
        ("index.js", include_str!("../../../../../apps/chat-expo/index.js").to_owned()),
        ("tsconfig.json", include_str!("../../../../../apps/chat-expo/tsconfig.json").to_owned()),
        ("expo-env.d.ts", include_str!("starter/expo-env.d.ts").to_owned()),
        ("App.tsx", include_str!("starter/expo/App.tsx").to_owned()),
        ("src/client.ts", include_str!("starter/expo/client.ts").to_owned()),
        ("src/native-smoke.ts", include_str!("native-smoke.ts").to_owned()),
        ("snapback/schema.q", SCHEMA.to_owned()),
        ("README.md", include_str!("starter/expo/README.md").to_owned()),
    ].into_iter().chain(FIXTURES.map(|(name, text)| (name, text.to_owned()))).collect()
}

pub(super) const EXPO_ENV: &str = include_str!("starter/expo-env.d.ts");
