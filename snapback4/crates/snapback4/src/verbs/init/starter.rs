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
    pub password: bool,
    /// Personas of a kept schema that declares `use personas` and no
    /// `use identity`: nobody can sign in, so the screen picks a persona.
    pub personas: Option<Vec<String>>,
    /// The screen behind the sign-in: the todo list over the starter's own
    /// operations, or the neutral `Home` beside a schema without them.
    pub body: Body,
    /// What the kept schema syncs, for the README's offline sentence.
    pub offline: Offline,
}

/// Which tables of the project's schema a device holds offline: the README
/// and init's summary say what works offline from this, never from the
/// starter's own (synced) todos schema.
// @ref LLP 3000.011.003.000#7.6 — wave 7 (R3): "works offline" was printed beside online-only schemas.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum Offline {
    /// The schema does not compile (yet), or there is none: no claim either way.
    Unknown,
    /// The tables that declare `sync`, and how many tables there are (views excluded).
    Tables { synced: Vec<String>, total: usize },
}

impl Offline {
    /// The README paragraph (it always starts with "Offline", which is how
    /// `init --adapt` finds it again), wrapped like the rest of the README.
    pub(super) fn paragraph(&self, platform: Platform) -> String {
        let lead = match platform { Platform::Web => "Offline:", Platform::Expo => "Offline, in device builds and on the web:" };
        let body = match self {
            Offline::Unknown => "tables that declare `sync` read and write offline and sync when the link returns; the others read from the server, and writes to them made offline are kept on this device and sent when the link returns (`npx snapback4 guide sync`).".to_owned(),
            Offline::Tables { synced, .. } if synced.is_empty() => format!("no table in `snapback/*.q` declares `sync`, so reads need the server. Writes made offline are kept {} and sent when the link returns. Add `sync` to a table to read it offline (`npx snapback4 guide sync`).", if platform == Platform::Web { "in this browser's principal journal" } else { "on this device" }),
            Offline::Tables { synced, total } if synced.len() >= *total => "every table declares `sync`, so the app reads and writes offline and syncs when the link returns.".to_owned(),
            Offline::Tables { synced, .. } => format!("the synced {} ({}) {} and {} offline and {} when the link returns; the other tables read from the server, and writes to them made offline are sent when the link returns (`npx snapback4 guide sync`).",
                if synced.len() == 1 { "table" } else { "tables" }, synced.iter().map(|name| format!("`{name}`")).collect::<Vec<_>>().join(", "),
                if synced.len() == 1 { "reads" } else { "read" }, if synced.len() == 1 { "writes" } else { "write" }, if synced.len() == 1 { "syncs" } else { "sync" }),
        };
        wrap(&format!("{lead} {body}"), 80)
    }

    /// init's one-line summary of the same fact, or nothing when unknown.
    pub(super) fn summary(&self) -> &'static str {
        match self {
            Offline::Unknown => "",
            Offline::Tables { synced, .. } if synced.is_empty() => ", online reads (no table declares `sync`; offline writes queue in the write journal)",
            Offline::Tables { .. } => ", offline-capable for its synced tables",
        }
    }
}

/// Wrap at `width`, never inside a `code span`.
fn wrap(text: &str, width: usize) -> String {
    let mut words: Vec<String> = Vec::new();
    for word in text.split(' ') {
        match words.last_mut() {
            Some(open) if open.matches('`').count() % 2 == 1 => { open.push(' '); open.push_str(word); }
            _ => words.push(word.to_owned()),
        }
    }
    let mut lines: Vec<String> = Vec::new();
    for word in &words {
        match lines.last_mut() {
            Some(line) if line.len() + 1 + word.len() <= width => { line.push(' '); line.push_str(word); }
            _ => lines.push(word.clone()),
        }
    }
    lines.join("\n")
}

/// A README with its offline paragraph replaced by `OFFLINE`, and 0.4.22's
/// claim in the opening paragraph rewritten to today's opening, so `init
/// --adapt` recognizes an unmodified starter README whatever its schema
/// synced when it was written.
pub(super) fn without_offline(text: &str) -> String {
    let legacy = [
        ("the Snapback 4 web starter. It works offline and syncs when the link returns.\n", "the Snapback 4 web starter.\n\nOFFLINE\n"),
        ("started from the Snapback 4 Expo starter. Development and production builds\nopen the native device and work offline; Expo Go uses the online client; web\nuses the wasm device.\n",
            "started from the Snapback 4 Expo starter. Development and production builds\nopen the native device; Expo Go uses the online client; web uses the wasm\ndevice.\n\nOFFLINE\n"),
    ];
    let mut text = text.to_owned();
    for (old, new) in legacy { text = text.replacen(old, new, 1); }
    text = text.replace("web uses the principal write journal (no synced tables)", "web uses the wasm\ndevice")
        .replace("or the principal write journal (web, no synced tables)", "or `webDevice()` (web)")
        .replace("native device and work offline;", "native device;")
        .replace("web uses the wasm\ndevice", "web uses the wasm device")
        .replace("web uses the\nwasm device", "web uses the wasm device");
    let mut masked = text.split("\n\n").map(|paragraph| if paragraph.starts_with("Offline") { "OFFLINE" } else { paragraph }).collect::<Vec<_>>().join("\n\n");
    if masked.starts_with("# Todos") && !masked.contains("\n\nOFFLINE\n\n") {
        masked = masked.replacen("wasm device.\n\n", "wasm device.\n\nOFFLINE\n\n", 1);
    }
    masked
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
/// viewer and the generated api's operation names, for the project to replace),
/// with one real read when the schema has a query that takes no required
/// arguments (its `api` path, `notes` or `module.notes`).
// @ref LLP 3000.011.003.000#7.4 — a starter screen must typecheck against the schema beside it.
// @ref LLP 3000.013#6.6 — wave 5: the adapted Home renders one useQuery through matchRead, the idioms Todos taught.
#[derive(Clone, PartialEq, Eq, Debug)]
pub(super) enum Body { Todos, Home(Option<String>) }

/// The starter's screen and client for a schema: the guest sign-in, or, with
/// `personas`, the persona picker, around `body`. The texts are as the
/// starter ships them, before init's port rewrite.
fn screens_version(platform: Platform, personas: Option<&[String]>, body: &Body, previous: bool) -> (String, String) {
    let version = |current, old| if previous { old } else { current };
    let (guest, guest_client, persona, persona_client, todos, home) = match platform {
        Platform::Web => (include_str!("starter/web/guest.tsx"), version(include_str!("starter/web/client.ts"), include_str!("starter/previous/wave9/web-client.ts")), include_str!("starter/personas/web-app.tsx"), include_str!("starter/personas/web-client.ts"), version(include_str!("starter/web/todos.tsx"), include_str!("starter/previous/wave9/web-todos.tsx")), include_str!("starter/web/home.tsx")),
        Platform::Expo => (include_str!("starter/expo/guest.tsx"), version(include_str!("starter/expo/client.ts"), include_str!("starter/previous/wave9/expo-client.ts")), version(include_str!("starter/personas/expo-app.tsx"), include_str!("starter/previous/wave9/expo-personas.tsx")), include_str!("starter/personas/expo-client.ts"), version(include_str!("starter/expo/todos.tsx"), include_str!("starter/previous/wave9/expo-todos.tsx")), include_str!("starter/expo/home.tsx")),
    };
    let first_read = match platform { Platform::Web => include_str!("starter/web/first-read.tsx"), Platform::Expo => include_str!("starter/expo/first-read.tsx") };
    let (head, client) = match personas {
        None => (guest, guest_client.to_owned()),
        Some(personas) => {
            let list = personas.iter().map(|name| serde_json::to_string(name).unwrap()).collect::<Vec<_>>().join(", ");
            (persona, persona_client.replace("PERSONAS", &format!("[{list}]")))
        }
    };
    let app = match body {
        Body::Todos => compose(head, todos),
        Body::Home(op) => {
            let (head, home) = if personas.is_some() { (persona_head_home(head), persona_home(home)) } else { (head.replace("<Todos />", "<Home />"), home.to_owned()) };
            match op {
                None => compose(&head, &home.replace("    <FirstRead />\n", "")),
                Some(op) => compose(&compose(&head, &home), &first_read.replace("api.OP", &format!("api.{op}"))),
            }
        }
    };
    (super::without_design_references(&app), super::without_design_references(&client))
}

// @ref LLP 3000.013.000#17 — both identity modes choose the no-device journal when nothing syncs.
pub(super) fn web_client(client: String, offline: &Offline) -> String {
    if matches!(offline, Offline::Tables { synced, .. } if synced.is_empty()) {
        client.replace("import { webDevice } from \"snapback4/web\";\n", "")
            .replace("tier === \"web\" ? webDevice() : ", "")
            .replace("device: webDevice(), ", "").replace(", device: webDevice()", "")
            .replace("each with its own device and store", "each with its own principal write journal")
            .replace("web uses the wasm device", "web uses the principal write journal (no synced tables)")
            .replace("web uses the\nwasm device", "web uses the principal write journal (no synced tables)")
    } else { client }
}

/// Behind the persona picker there is no session: "Sign out" (`auth.logout()`)
/// showed "Signed out" and then a "Choose a persona" button, two steps for a
/// switch (wave 5 lane 062). The persona Home takes the picker's `leave` and
/// says "Switch persona"; the guest Home keeps its sign-out.
// @ref LLP 3000.036#15.10 — the adapted persona Home switches persona; it never signs out.
fn persona_head_home(head: &str) -> String {
    let leave = ["() => setPersona(null)", "() => choose(null)"].into_iter().find(|leave| head.contains(&format!("<Account leave={{{leave}}}><Todos /></Account>")))
        .expect("the persona heads render <Account leave={…}><Todos /></Account>");
    head.replace(&format!("<Account leave={{{leave}}}><Todos /></Account>"), &format!("<Account leave={{{leave}}}><Home leave={{{leave}}} /></Account>"))
}

fn persona_home(home: &str) -> String {
    let replacements = [
        ("function Home() {", "function Home({ leave }: { leave: () => void }) {"),
        ("  const auth = useAuth(), link = useLink();", "  const link = useLink();"),
        (r#"<Button title="Sign out" onPress={() => void auth.logout()} />"#, r#"<Button title="Switch persona" onPress={leave} />"#),
        (r#"<button onClick={() => void auth.logout()}>Sign out</button>"#, r#"<button onClick={leave}>Switch persona</button>"#),
        ("// Never null here: Account renders this screen only once signed in.", "// Never null here: Account renders this screen only once the persona's app is open."),
    ];
    let mut home = home.to_owned();
    for (from, to) in replacements { home = home.replace(from, to); }
    assert!(!home.contains("auth.") && home.contains("Switch persona"), "the persona Home has no session to sign out of");
    home.replace("import { useAuth, useLink, useSignedInViewer }", "import { useLink, useSignedInViewer }")
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

const GUEST_SIGN_IN: &str = "Choose \"Continue as a guest\" to sign in (`use identity`); `npx snapback4 guide personas`\nadds password accounts and development personas.";
const PERSONA_SIGN_IN: &str = "The first screen (on the web also `?as=<name>`) acts as a persona your schema declares with\n`use personas`: `usePersonaApp` opens one app per persona and closes the old one on a switch.\nPersonas act only on `snapback4 dev`: add `use identity` and a sign-in screen before you\ndeploy (`npx snapback4 guide personas`).";

/// The starter README for a screen: the Todos README describes the starter's
/// own schema and screen; beside a project's schema (the neutral `Home`) the
/// README is named after the directory and describes that schema's sign-in.
// @ref LLP 3000.011.003.000#7.4 — wave 6 (042): an adapted starter kept a README about todos and guest sign-in.
pub(super) fn readme(platform: Platform, title: &str, body: &Body, personas: bool, offline: &Offline) -> String {
    let todos = match platform { Platform::Web => include_str!("starter/web/README.md"), Platform::Expo => include_str!("starter/expo/README.md") };
    if *body == Body::Todos {
        return todos.replace("native device and work offline;", "native device;")
            .replace("wasm device.\n", &format!("wasm device.\n\n{}\n", offline.paragraph(platform)));
    }
    let home = match platform { Platform::Web => include_str!("starter/web/README.home.md"), Platform::Expo => include_str!("starter/expo/README.home.md") };
    let text = home.replacen("# TITLE", &format!("# {title}"), 1).replace("SIGN_IN", if personas { PERSONA_SIGN_IN } else { GUEST_SIGN_IN })
        .replacen("OFFLINE\n", &format!("{}\n", offline.paragraph(platform)), 1);
    if platform == Platform::Web { return text; }
    // The Expo toolchain notes are the Todos README's own, word for word.
    let advisories = todos.split_once("\n> ").map(|(_, rest)| format!("> {}", rest.split_once("\n\n").expect("the advisory box ends").0)).expect("the Expo README has its advisory box");
    let toolchain = todos.split_once("\nKeep the Expo and").map(|(_, rest)| format!("Keep the Expo and{}", rest.split_once("## Next steps").expect("the Expo README has next steps").0)).expect("the Expo README has its toolchain notes");
    text.replacen("ADVISORIES", &advisories, 1).replacen("TOOLCHAIN\n", &toolchain, 1)
}

/// The Expo app's `app.json` ids, named after the directory's title: a slug
/// (`bake-sale`), a URL scheme and a bundle id that start with a letter
/// (`bakesale`, `dev.snapback4.bakesale`).
pub(super) fn app_ids(title: &str) -> (String, String, String) {
    let words: Vec<String> = title.split(|c: char| !c.is_ascii_alphanumeric()).filter(|word| !word.is_empty()).map(str::to_ascii_lowercase).collect();
    let slug = if words.is_empty() { "app".to_owned() } else { words.join("-") };
    let mut scheme = words.concat();
    if !scheme.starts_with(|c: char| c.is_ascii_alphabetic()) { scheme = format!("app{scheme}"); }
    let bundle = format!("dev.snapback4.{scheme}");
    (slug, scheme, bundle)
}

/// What 0.4.21 and earlier wrote into every Expo starter's `app.json`.
pub(super) const TODO_IDS: [(&str, &str); 3] = [("slug", "snapback4-todos"), ("scheme", "snapback4todos"), ("bundle", "dev.snapback4.todos")];

pub(super) fn web_files(shape: &Shape) -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(include_str!("../../../../../apps/chat/package.json")).unwrap();
    package["devDependencies"]["@types/node"] = json!("^24");
    package["name"] = json!("snapback4-web-starter");
    package["version"] = json!("0.1.0");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    package["scripts"]["build"] = json!("vite build && snapback4 web-shell dist");
    package["scripts"]["build:web"] = package["scripts"]["build"].clone();
    let (app, client) = identity_screens(Platform::Web, shape.personas.as_deref(), &shape.body, shape.password);
    let client = web_client(client, &shape.offline);
    vec![
        ("package.json", super::pretty(&package)),
        ("index.html", include_str!("starter/web/index.html").replace("TITLE", &html_text(&shape.title))),
        ("vite.config.mts", include_str!("starter/web/vite.config.mts").to_owned()),
        ("tsconfig.json", super::esm_vite_config(include_str!("../../../../../apps/chat/tsconfig.json"))),
        ("public/favicon.svg", include_str!("starter/favicon.svg").to_owned()),
        ("src/main.tsx", include_str!("starter/web/main.tsx").to_owned()),
        ("src/styles.css", include_str!("starter/web/styles.css").to_owned()),
        ("src/App.tsx", app),
        ("src/client.ts", client),
        ("src/vite-env.d.ts", include_str!("../../../../../apps/chat/src/vite-env.d.ts").to_owned()),
        ("snapback/schema.q", SCHEMA.to_owned()),
        ("README.md", identity_readme(Platform::Web, &shape.title, &shape.body, shape.personas.is_some(), &shape.offline, shape.password)),
    ].into_iter().chain(FIXTURES.map(|(name, text)| (name, text.to_owned()))).collect()
}

fn html_text(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

pub(super) fn expo_files(shape: &Shape) -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(&super::expo_package()).unwrap();
    package["name"] = json!("snapback4-expo-starter");
    package["scripts"]["build:web"] = json!("expo export --platform web --clear && snapback4 web-shell dist");
    let mut config: Value = serde_json::from_str(include_str!("../../../../../apps/chat-expo/app.json")).unwrap();
    config["expo"]["name"] = json!(shape.title);
    // @ref LLP 3000.011.003.000#7.4 — wave 6 (067): ids named after the directory, never the todo starter's.
    let (slug, scheme, bundle) = app_ids(&shape.title);
    config["expo"]["slug"] = json!(slug);
    config["expo"]["scheme"] = json!(scheme);
    config["expo"]["ios"]["bundleIdentifier"] = json!(bundle);
    config["expo"]["android"]["package"] = json!(bundle);
    let (app, client) = identity_screens(Platform::Expo, shape.personas.as_deref(), &shape.body, shape.password);
    let client = web_client(client, &shape.offline);
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
        ("src/native-smoke.ts", native_smoke(shape.password)),
        ("snapback/schema.q", SCHEMA.to_owned()),
        ("README.md", identity_readme(Platform::Expo, &shape.title, &shape.body, shape.personas.is_some(), &shape.offline, shape.password)),
    ].into_iter().chain(FIXTURES.map(|(name, text)| (name, text.to_owned()))).collect()
}

pub(super) const EXPO_ENV: &str = include_str!("starter/expo-env.d.ts");

// @ref LLP 3000.011.003.000#8 — password identity gets an executable sign-in screen.
pub(super) fn identity_screens(platform: Platform, personas: Option<&[String]>, body: &Body, password: bool) -> (String, String) { identity_screens_version(platform, personas, body, password, false) }
// Recognize only complete known templates; edited application source never matches.
pub(super) fn previous_screens(platform: Platform, personas: Option<&[String]>, body: &Body, password: bool) -> (String, String) { identity_screens_version(platform, personas, body, password, true) }
fn identity_screens_version(platform: Platform, personas: Option<&[String]>, body: &Body, password: bool, previous: bool) -> (String, String) {
    let version = |current, old| if previous { old } else { current };
    if !password { return screens_version(platform, personas, body, previous); }
    let head = match platform { Platform::Web => include_str!("starter/web/password.tsx"), Platform::Expo => version(include_str!("starter/expo/password.tsx"), include_str!("starter/previous/wave9/expo-password.tsx")) };
    let (_, client) = screens_version(platform, None, body, previous);
    let body_source = match (platform, body) {
        (Platform::Web, Body::Todos) => version(include_str!("starter/web/todos.tsx"), include_str!("starter/previous/wave9/web-todos.tsx")).to_owned(),
        (Platform::Expo, Body::Todos) => version(include_str!("starter/expo/todos.tsx"), include_str!("starter/previous/wave9/expo-todos.tsx")).to_owned(),
        (platform, Body::Home(op)) => {
            let (home, first) = match platform { Platform::Web => (include_str!("starter/web/home.tsx"), include_str!("starter/web/first-read.tsx")), Platform::Expo => (include_str!("starter/expo/home.tsx"), include_str!("starter/expo/first-read.tsx")) };
            match op { Some(op) => compose(home, &first.replace("api.OP", &format!("api.{op}"))), None => home.replace("    <FirstRead />\n", "") }
        }
    };
    (compose(&head.replace("<Todos />", if matches!(body, Body::Todos) { "<Todos />" } else { "<Home />" }), &body_source), client)
}

pub(super) fn identity_readme(platform: Platform, title: &str, body: &Body, personas: bool, offline: &Offline, password: bool) -> String {
    let mut text = readme(platform, title, body, personas, offline);
    if platform == Platform::Expo && matches!(offline, Offline::Tables { synced, .. } if synced.is_empty()) {
        text = text.replace("web uses the wasm\ndevice", "web uses the principal write journal (no synced tables)")
            .replace("web uses the wasm device", "web uses the principal write journal (no synced tables)")
            .replace("web uses the\nwasm device", "web uses the principal write journal (no synced tables)")
            .replace("or `webDevice()` (web)", "or the principal write journal (web, no synced tables)");
    }
    if password { text.replace(GUEST_SIGN_IN, "Sign up or sign in with email and password (`use identity password`); the SDK\nkeeps your session across restarts. See `snapback4 guide client --section password`.")
        .replace("Choose \"Continue as a guest\", then add", "Sign up or sign in with email and password, then add")
        .replace("Choose \"Continue as a\nguest\", then add", "Sign up or sign in with email and password, then add") } else { text }
}

/// Exact client templates emitted by 0.4.24, before runtime URL/witness additions.
/// Matching complete known bytes preserves the rule that edited files stay owned.
// @ref LLP 3000.011.003.000#8 — upgrading an untouched starter still adapts its identity.
pub(super) fn previous_client(platform: Platform, personas: bool) -> &'static str {
    match (platform, personas) {
        (Platform::Web, false) => include_str!("starter/previous/web-client.ts"),
        (Platform::Web, true) => include_str!("starter/previous/web-persona-client.ts"),
        (Platform::Expo, false) => include_str!("starter/previous/expo-client.ts"),
        (Platform::Expo, true) => include_str!("starter/previous/expo-persona-client.ts"),
    }
}

// The smoke's identity choice is generated with the screen, not assumed guest.
pub(super) fn native_smoke(password: bool) -> String {
    let guest = include_str!("native-smoke.ts");
    if !password { return guest.to_owned(); }
    guest.replace("import { smokeSegment }", "import { smokeAccount, smokeSegment }")
        .replace("void auth.guest();", "const account = smokeAccount();\n    if (account) void auth.signup(account.email, account.password);")
        .replace("sign in as a guest", "sign up with the driver's disposable password account")
}
