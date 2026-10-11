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
    /// The screen behind the sign-in: the todo list over the starter's own
    /// operations, or the neutral `Home` beside a schema without them.
    pub body: Body,
}

/// Which starter screen pair: the guest sign-in, or the persona picker.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Platform { Web, Expo }

impl Platform {
    /// Where the starter writes its screen and its client.
    pub(super) fn paths(self) -> (&'static str, &'static str) {
        match self { Platform::Web => ("src/App.tsx", "src/client.ts"), Platform::Expo => ("App.tsx", "src/client.ts") }
    }
}

/// The screen a signed-in viewer sees: the starter's `Todos`, which calls
/// list/add/toggle/remove, or `Home`, which compiles against any schema (the
/// viewer and the generated api's operation names, for the project to replace).
// @ref LLP 3000.011.003.000#7.4 — a starter screen must typecheck against the schema beside it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Body { Todos, Home }

/// The starter's screen and client for a schema: the guest sign-in, or, with
/// `personas`, the persona picker, around `body`. The texts are as the
/// starter ships them, before init's port rewrite.
pub(super) fn screens(platform: Platform, personas: Option<&[String]>, body: Body) -> (String, String) {
    let (guest, guest_client, persona, persona_client, todos, home) = match platform {
        Platform::Web => (include_str!("starter/web/guest.tsx"), include_str!("starter/web/client.ts"), include_str!("starter/personas/web-app.tsx"), include_str!("starter/personas/web-client.ts"), include_str!("starter/web/todos.tsx"), include_str!("starter/web/home.tsx")),
        Platform::Expo => (include_str!("starter/expo/guest.tsx"), include_str!("starter/expo/client.ts"), include_str!("starter/personas/expo-app.tsx"), include_str!("starter/personas/expo-client.ts"), include_str!("starter/expo/todos.tsx"), include_str!("starter/expo/home.tsx")),
    };
    let (head, client) = match personas {
        None => (guest, guest_client.to_owned()),
        Some(personas) => {
            let list = personas.iter().map(|name| serde_json::to_string(name).unwrap()).collect::<Vec<_>>().join(", ");
            (persona, persona_client.replace("PERSONAS", &format!("[{list}]")))
        }
    };
    let app = match body { Body::Todos => compose(head, todos), Body::Home => compose(&head.replace("<Todos />", "<Home />"), home) };
    (super::without_design_references(&app), super::without_design_references(&client))
}

/// One module from a sign-in head and a screen body, each written as a whole
/// file: their single-line named imports merge per module (packages before
/// `../`, then `./`), then the head's code, then the body's.
fn compose(head: &str, body: &str) -> String {
    fn split(text: &str) -> (Vec<&str>, &str) {
        let mut imports = Vec::new();
        let mut rest = text;
        while let Some(line) = rest.split_inclusive('\n').next().filter(|line| line.starts_with("import ")) {
            imports.push(line.trim_end());
            rest = &rest[line.len()..];
        }
        (imports, rest.trim_start_matches('\n'))
    }
    let (head_imports, head_code) = split(head);
    let (body_imports, body_code) = split(body);
    // (`import {` or `import type {`, module, names) in first-seen order.
    let mut merged: Vec<(String, String, Vec<String>)> = Vec::new();
    for line in head_imports.into_iter().chain(body_imports) {
        let (Some(open), Some(close)) = (line.find('{'), line.find('}')) else { panic!("starter imports are `import {{ … }} from \"…\";`: {line}") };
        let (kind, module) = (line[..open].trim().to_owned(), line[close + 1..].trim().to_owned());
        let names = line[open + 1..close].split(',').map(|name| name.trim().to_owned()).filter(|name| !name.is_empty());
        match merged.iter_mut().find(|(k, m, _)| *k == kind && *m == module) {
            Some((_, _, existing)) => for name in names { if !existing.contains(&name) { existing.push(name); } },
            None => merged.push((kind, module, names.collect())),
        }
    }
    merged.sort_by_key(|(_, module, _)| if module.contains("\"../") { 1 } else if module.contains("\"./") { 2 } else { 0 });
    let imports = merged.iter().map(|(kind, module, names)| format!("{kind} {{ {} }} {module}\n", names.join(", "))).collect::<String>();
    format!("{imports}\n{head_code}\n{body_code}")
}

pub(super) fn web_files(shape: &Shape) -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(include_str!("../../../../../apps/chat/package.json")).unwrap();
    package["name"] = json!("snapback4-web-starter");
    package["version"] = json!("0.1.0");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    package["scripts"]["build"] = json!("vite build && snapback4 web-shell dist");
    let (app, client) = screens(Platform::Web, shape.personas.as_deref(), shape.body);
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
    let (app, client) = screens(Platform::Expo, shape.personas.as_deref(), shape.body);
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
