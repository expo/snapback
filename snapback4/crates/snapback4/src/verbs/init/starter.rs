//! The default `init --web` and `init --expo` starters: one table, one live
//! query, three mutations and one screen. Toolchain pins come from the
//! maintained reference apps, so the starters move with them; the reference
//! chat apps themselves stay reachable as `--template chat`.
use serde_json::{Value, json};

const SCHEMA: &str = include_str!("starter/schema.q");
/// Rows and cases for the starter's own `todos` schema; init writes them only
/// beside that schema (see `init`), never beside a project's own.
pub(super) const FIXTURES: [(&str, &str); 2] = [
    ("fixtures/todos.jsonl", include_str!("starter/fixtures/todos.jsonl")),
    ("fixtures/test.cases.jsonl", include_str!("starter/fixtures/test.cases.jsonl")),
];

/// What init knows about the project before it writes the starter.
pub(super) struct Shape {
    /// The page and app name, from the directory.
    pub title: String,
    /// Personas of a kept schema that declares `use personas` and no
    /// `use identity`: nobody can sign in, so the screen picks a persona.
    pub personas: Option<Vec<String>>,
}

// The persona screens reuse the guest starter's `Todos` screen verbatim.
fn with_persona_session(head: &str, guest: &str, personas: &[String]) -> (String, String) {
    let todos = guest.find("function Todos()").expect("the starter screen declares Todos");
    let list = personas.iter().map(|name| serde_json::to_string(name).unwrap()).collect::<Vec<_>>().join(", ");
    (format!("{head}{}", &guest[todos..]), format!("[{list}]"))
}

pub(super) fn web_files(shape: &Shape) -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(include_str!("../../../../../apps/chat/package.json")).unwrap();
    package["name"] = json!("snapback4-web-starter");
    package["version"] = json!("0.1.0");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    package["scripts"]["build"] = json!("vite build && snapback4 web-shell dist");
    let (app, client) = match &shape.personas {
        None => (include_str!("starter/web/App.tsx").to_owned(), include_str!("starter/web/client.ts").to_owned()),
        Some(personas) => {
            let (app, list) = with_persona_session(include_str!("starter/personas/web-app.tsx"), include_str!("starter/web/App.tsx"), personas);
            (app, include_str!("starter/personas/web-client.ts").replace("PERSONAS", &list))
        }
    };
    vec![
        ("package.json", super::pretty(&package)),
        ("index.html", include_str!("starter/web/index.html").replace("TITLE", &html_text(&shape.title))),
        ("vite.config.mts", include_str!("starter/web/vite.config.mts").to_owned()),
        ("tsconfig.json", super::esm_vite_config(include_str!("../../../../../apps/chat/tsconfig.json"))),
        ("src/main.tsx", include_str!("starter/web/main.tsx").to_owned()),
        ("src/styles.css", include_str!("starter/web/styles.css").to_owned()),
        ("src/App.tsx", app),
        ("src/client.ts", client),
        ("src/vite-env.d.ts", include_str!("../../../../../apps/chat/src/vite-env.d.ts").to_owned()),
        ("snapback/schema.q", SCHEMA.to_owned()),
        ("README.md", include_str!("starter/web/README.md").to_owned()),
    ].into_iter().chain(FIXTURES.map(|(name, text)| (name, text.to_owned()))).collect()
}

fn html_text(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub(super) fn expo_files(shape: &Shape) -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(&super::expo_package()).unwrap();
    package["name"] = json!("snapback4-expo-starter");
    let mut config: Value = serde_json::from_str(include_str!("../../../../../apps/chat-expo/app.json")).unwrap();
    config["expo"]["name"] = json!(shape.title);
    config["expo"]["slug"] = json!("snapback4-todos");
    config["expo"]["scheme"] = json!("snapback4todos");
    config["expo"]["ios"]["bundleIdentifier"] = json!("dev.snapback4.todos");
    config["expo"]["android"]["package"] = json!("dev.snapback4.todos");
    let (app, client) = match &shape.personas {
        None => (include_str!("starter/expo/App.tsx").to_owned(), include_str!("starter/expo/client.ts").to_owned()),
        Some(personas) => {
            let (app, list) = with_persona_session(include_str!("starter/personas/expo-app.tsx"), include_str!("starter/expo/App.tsx"), personas);
            (app, include_str!("starter/personas/expo-client.ts").replace("PERSONAS", &list))
        }
    };
    vec![
        ("package.json", super::pretty(&package)),
        ("app.json", super::pretty(&config)),
        ("babel.config.js", include_str!("../../../../../apps/chat-expo/babel.config.js").to_owned()),
        ("metro.config.js", include_str!("metro.config.js").to_owned()),
        ("metro-wasm-transformer.cjs", include_str!("metro-wasm-transformer.cjs").to_owned()),
        ("index.js", include_str!("../../../../../apps/chat-expo/index.js").to_owned()),
        ("tsconfig.json", include_str!("../../../../../apps/chat-expo/tsconfig.json").to_owned()),
        ("expo-env.d.ts", include_str!("starter/expo-env.d.ts").to_owned()),
        ("App.tsx", app),
        ("src/client.ts", client),
        ("src/native-smoke.ts", include_str!("native-smoke.ts").to_owned()),
        ("snapback/schema.q", SCHEMA.to_owned()),
        ("README.md", include_str!("starter/expo/README.md").to_owned()),
    ].into_iter().chain(FIXTURES.map(|(name, text)| (name, text.to_owned()))).collect()
}

pub(super) const EXPO_ENV: &str = include_str!("starter/expo-env.d.ts");
