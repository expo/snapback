//! Starter files are embedded at build time; the packaged binary needs no checkout.

use super::Options;
use crate::project::{GENERATED_PACKAGE, GITIGNORE};
use serde_json::{Value, json};
use std::{io::Write, path::Path};

mod web;
mod social;
mod starter;

const USAGE: &str = "usage: snapback4 init [dir] [--online|--expo|--web]";

pub fn init(options: &Options) -> i32 {
    let template = options.flags.get("template").map(String::as_str);
    let modes = ["online", "expo", "web"].iter().filter(|flag| options.flags.contains_key(**flag)).count();
    // `--template social` is a whole app; `--template chat` is the reference
    // chat app for one client, `--web` or `--expo`.
    let template_ok = match template {
        None => true,
        Some("social") => modes == 0,
        Some("chat") => modes == 1 && !options.flags.contains_key("online"),
        Some(_) => false,
    };
    if !template_ok || (template.is_some() && options.flags.contains_key("recipe")) {
        eprintln!("usage: snapback4 new <dir> --template social\n       snapback4 init [dir] --web --template chat\n       snapback4 init [dir] --expo --template chat");
        return 2;
    }
    let social = template == Some("social");
    let chat = template == Some("chat");
    // @ref LLP 3000.007.003#7 — new apps declare timelines; installed recipes retain their library support.
    let retired = ["prefix", "authors", "edges", "public-profiles", "public-posts", "public-follows", "public-reposts"];
    if options.flags.get("recipe").is_some_and(|name| name == "feeds")
        || retired.iter().any(|flag| options.flags.contains_key(*flag)) {
        eprintln!("E_RECIPE_RETIRED: the Following recipe installer is retired; no files written\n  rewrite: maintain feed: timeline\n    events posts by authorId, at removed by removed\n    reposts reposts by actorId, postId, at\n    edges follows by followerId, followedId\n  use a fresh feed name; dev adopts retained sources and deploy requires --allow-feed-adoption; see snapback4 guide feeds");
        return 2;
    }
    if options.positionals.len() > 1 || modes > 1 || options.flags.contains_key("recipe") {
        eprintln!("{USAGE}");
        return 2;
    }
    let port = match options.flags.get("port").map(|port| port.parse::<u16>()) {
        None => None,
        Some(Ok(port)) if port > 0 => Some(port),
        Some(_) => {
            eprintln!("E_INPUT at init --port: expected a port number from 1 to 65535\n  rewrite: snapback4 init --web --port 4401");
            return 2;
        }
    };
    let skip_existing = options.flags.contains_key("skip-existing");
    let dir = options.positionals.first().map(Path::new).unwrap_or_else(|| Path::new("."));
    let online = options.flags.contains_key("online");
    let expo = social || options.flags.contains_key("expo");
    let web = options.flags.contains_key("web");
    let mut files = if social { social::files() }
        else if chat && web { web::files() } else if chat { expo_files() }
        else if web { starter::web_files() } else if expo { starter::expo_files() }
        else if online { online_files() } else { vec![("snapback/schema.q", snapback4_lang::guide::TEMPLATE.to_owned())] };
    for (name, text) in &mut files {
        // Starters copied from the reference apps keep their design notes in
        // this repository; a new project gets the explanation alone.
        if *name != "package.json" { *text = without_design_references(text); }
        if let Some(port) = port { *text = text.replace("127.0.0.1:4400", &format!("127.0.0.1:{port}")); }
    }
    let mut conflicts = Vec::new();
    // A project's existing introduction is unrelated to the starter. Keep it
    // and place our setup instructions beside it, still without overwriting.
    if dir.join("README.md").symlink_metadata().is_ok() {
        for (name, _) in &mut files {
            if *name == "README.md" { *name = "README.snapback.md"; }
        }
    }
    // @ref LLP 3000.007#20.2 — installed packages can receive a starter; only conflicting required entries refuse.
    for (name, text) in &mut files {
        if *name == "package.json" && dir.join(*name).exists() {
            match merge_package(&dir.join(*name), text) {
                Ok(merged) => *text = merged,
                Err(error) => conflicts.push(error),
            }
        } else if *name == "package.json" && dir.is_dir() {
            match inherited_package_type(dir) {
                // A directory with no package above it and no scripts of its
                // own keeps the starter's module type (Vite expects ESM).
                Ok(None) if !has_scripts(dir, 0) => {},
                Ok(kind) => {
                    let mut package: Value = serde_json::from_str(text).unwrap();
                    package.as_object_mut().unwrap().remove("type");
                    if let Some(kind) = kind.flatten() { package["type"] = kind; }
                    *text = pretty(&package);
                }
                Err(error) => conflicts.push(error),
            }
        }
    }
    // Preserve an existing ESM package while keeping Metro and Babel's configs CommonJS.
    if expo && files.iter().any(|(name, text)| *name == "package.json" && serde_json::from_str::<Value>(text).unwrap()["type"] == "module") {
        for (name, _) in &mut files {
            *name = match *name { "metro.config.js" => "metro.config.cjs", "babel.config.js" => "babel.config.cjs", other => other };
        }
    }
    // @ref LLP 3000.007#20.2 — scope generated ESM to its artifacts, preserving existing application scripts' module interpretation.
    files.push(("snapback/generated/package.json", GENERATED_PACKAGE.into()));
    // Check every destination before writing any starter file. An existing
    // file is a conflict, or with --skip-existing is kept exactly as it is.
    let mut kept = Vec::new();
    let mut existing = Vec::new();
    for (name, _) in &files {
        if let Err(error) = preflight_parents(&dir.join(name)) { conflicts.push(error); }
        let alternate = match *name { "metro.config.cjs" => Some("metro.config.js"), "babel.config.cjs" => Some("babel.config.js"), "metro.config.js" => Some("metro.config.cjs"), "babel.config.js" => Some("babel.config.cjs"), _ => None };
        let mut present = Vec::new();
        if let Some(alternate) = alternate.filter(|name| dir.join(name).symlink_metadata().is_ok()) {
            present.push(format!("{} already exists", dir.join(alternate).display()));
        }
        if *name != "package.json" {
            match dir.join(*name).symlink_metadata() {
                Ok(_) => present.push(format!("{} already exists", dir.join(*name).display())),
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                Err(error) => conflicts.push(format!("{}: {error}", dir.join(*name).display())),
            }
        }
        if present.is_empty() { continue; }
        if skip_existing { kept.push(*name); } else { existing.extend(present); }
    }
    files.retain(|(name, _)| !kept.contains(name));
    let skippable = !existing.is_empty();
    conflicts.extend(existing);
    if let Err(error) = preflight_parents(&dir.join(".gitignore")) { conflicts.push(error); }
    for name in ["package.json", ".gitignore"] {
        if name == "package.json" && !files.iter().any(|(file, _)| *file == name) { continue; }
        if dir.join(name).symlink_metadata().is_ok_and(|m| !m.is_file()) {
            conflicts.push(format!("{} is not a regular file", dir.join(name).display()));
        }
    }
    if !conflicts.is_empty() {
        conflicts.sort(); conflicts.dedup();
        let recipe = if skippable { "rerun with --skip-existing to keep every existing file as it is and write only the missing ones (snapback/*.q is never overwritten), or rename the listed files and rerun; " } else { "" };
        eprintln!("E_INIT_CONFLICT: no files written\n  {}\n  rewrite: {recipe}reconcile any listed package.json entries first. Do not init into another directory and copy it over: that overwrites your files", conflicts.join("\n  "));
        return 1;
    }
    let readme = files.iter().find(|(name, _)| name.starts_with("README.")).map(|(name, _)| *name);
    let mut created = Vec::new();
    let mut write = || -> std::io::Result<()> {
        for (name, text) in &files {
            let path = dir.join(*name);
            std::fs::create_dir_all(path.parent().unwrap())?;
            if *name == "package.json" {
                let existed = path.symlink_metadata().is_ok();
                replace_file(&path, text)?;
                if !existed { created.push(path); }
            } else {
                let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path)?;
                created.push(path);
                file.write_all(text.as_bytes())?;
            }
        }
        let gitignore = dir.join(".gitignore");
        let existing = match std::fs::read_to_string(&gitignore) { Ok(text) => text, Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(), Err(e) => return Err(e) };
        let ignores = format!("{GITIGNORE}{}", if expo { ".snapback4-witness/\nartifacts/native-smoke/\n" } else { "" });
        let missing = ignores.lines().filter(|line| !existing.lines().any(|old| old == *line)).collect::<Vec<_>>().join("\n");
        if !missing.is_empty() { replace_file(&gitignore, &format!("{existing}{}{missing}\n", if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" }))?; }
        Ok(())
    };
    if let Err(error) = write() {
        eprintln!("init: {error}");
        for path in created.iter().rev() {
            if let Err(error) = std::fs::remove_file(path) { eprintln!("init: could not remove {}: {error}", path.display()); }
        }
        return 2;
    }
    // A starter that wrote package.json dependencies needs them installed before
    // its typecheck, build or `npm start` can run.
    let install = if files.iter().any(|(name, _)| *name == "package.json") { "`npm install`, then " } else { "" };
    let dev = port.map(|port| format!("snapback4 dev --port {port}")).unwrap_or_else(|| "snapback4 dev".into());
    let kind = if social { "Expo Router social app" } else if chat && expo { "Expo chat app" } else if chat { "Vite chat app" }
        else if expo { "Expo todos: native when available, online in Expo Go" } else if web { "Vite + React todos, offline-capable" }
        else if online { "online-only" } else { "local-first" };
    println!("init: wrote {} files in {} — {kind} — next: {install}`snapback4 check`, then `{dev}`{}", files.len(), dir.display(), readme.map(|name| format!("; see {name}")).unwrap_or_default());
    if !kept.is_empty() {
        println!("init: kept {} existing file{} unchanged: {}", kept.len(), if kept.len() == 1 { "" } else { "s" }, kept.join(", "));
        if kept.contains(&"snapback/schema.q") && files.iter().any(|(name, _)| name.starts_with("src/") || name.starts_with("App.")) {
            println!("init: your snapback/schema.q was kept; the starter screens call its own operations (list, add, toggle, remove) — adapt them to your schema after `snapback4 check`");
        }
    }
    0
}

fn preflight_parents(path: &Path) -> Result<(), String> {
    let ancestors = path.ancestors().skip(1).filter(|p| !p.as_os_str().is_empty()).collect::<Vec<_>>();
    for parent in ancestors.into_iter().rev() {
        match std::fs::metadata(parent) {
            Ok(metadata) if metadata.is_dir() => {},
            Ok(_) => return Err(format!("{} is not a directory; rename it or choose another init directory", parent.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && parent.symlink_metadata().is_err() => {},
            Err(error) => return Err(format!("{}: {error}", parent.display())),
        }
    }
    Ok(())
}

// A new package boundary in an existing directory inherits the nearest
// package's type, including its absence, rather than reinterpreting scripts.
fn inherited_package_type(dir: &Path) -> Result<Option<Option<Value>>, String> {
    let absolute = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    for ancestor in absolute.ancestors().skip(1) {
        let path = ancestor.join("package.json");
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("{}: {error}", path.display())),
        };
        let package: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        return Ok(Some(package.get("type").cloned()));
    }
    Ok(None)
}

// Existing JavaScript keeps its module interpretation: only a directory
// without scripts can take the starter's `"type"`.
fn has_scripts(dir: &Path, depth: usize) -> bool {
    let Ok(entries) = std::fs::read_dir(dir) else { return false };
    entries.flatten().any(|entry| {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let path = entry.path();
        if path.is_dir() { depth < 4 && name != "node_modules" && !name.starts_with('.') && has_scripts(&path, depth + 1) }
        else { name.ends_with(".js") }
    })
}

/// A starter is the user's code: keep each comment's explanation and drop the
/// annotation pointing into this repository's design records.
fn without_design_references(text: &str) -> String {
    const POINTER: &str = concat!("@", "ref LLP ");
    text.split_inclusive('\n').map(|line| {
        let Some(start) = line.find(POINTER) else { return line.to_owned() };
        let rest = &line[start..];
        match rest.find(" — ") {
            Some(gloss) => format!("{}{}", &line[..start], &rest[gloss + " — ".len()..]),
            None => line.to_owned(),
        }
    }).collect()
}

// @ref LLP 3000.007#20.2 — merge an installed package without losing it on a partial write.
fn replace_file(path: &Path, text: &str) -> std::io::Result<()> {
    use std::{fs::OpenOptions, io::Write, sync::atomic::{AtomicU64, Ordering}};
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let (temporary, mut file) = loop {
        let temporary = path.with_file_name(format!(".{}.{}.{}.tmp", path.file_name().unwrap().to_string_lossy(), std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        match OpenOptions::new().write(true).create_new(true).open(&temporary) {
            Ok(file) => break (temporary, file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    };
    let result = (|| {
        if let Ok(metadata) = std::fs::metadata(path) { file.set_permissions(metadata.permissions())?; }
        file.write_all(text.as_bytes())?;
        file.sync_all()?;
        std::fs::rename(&temporary, path)
    })();
    if result.is_err() { let _ = std::fs::remove_file(&temporary); }
    result
}

fn merge_package(path: &Path, starter: &str) -> Result<String, String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{}: {e}", path.display()))?;
    let mut existing: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
    let object = existing.as_object_mut().ok_or("package.json must be an object")?;
    let required: Value = serde_json::from_str(starter).unwrap();
    let mut conflicts = Vec::new();
    for (key, value) in required.as_object().unwrap() {
        if matches!(key.as_str(), "dependencies" | "devDependencies" | "scripts") {
            let Some(group) = object.entry(key.clone()).or_insert_with(|| json!({})).as_object_mut() else {
                conflicts.push(format!("package.json {key} must be an object"));
                continue;
            };
            for (name, needed) in value.as_object().unwrap() {
                match group.get(name) {
                    Some(old) if old != needed => conflicts.push(format!("package.json conflict at {key}.{name}: existing {old}, required {needed}")),
                    Some(_) => {},
                    None => { group.insert(name.clone(), needed.clone()); }
                }
            }
        } else if key == "main" && object.get(key).is_some_and(|old| old != value) {
            conflicts.push(format!("package.json conflict at {key}: existing {}, required {value}", object[key]));
        } else if key != "type" {
            // An absent type is itself the existing package's module policy.
            object.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }
    if conflicts.is_empty() { Ok(pretty(&existing)) } else { Err(conflicts.join("\n  ")) }
}

// @ref LLP 3000.007#7 — no sync lines and createClient pave the online tier
fn online_files() -> Vec<(&'static str, String)> {
    vec![
        ("snapback/schema.q", snapback4_lang::guide::TEMPLATE_ONLINE.to_owned()),
        ("src/client.ts", "import { createClient } from \"snapback4/client\";\nimport { api } from \"../snapback/generated/api\";\n\n// Development on this machine. In a deployment, pass a session instead of a persona.\nexport const client = createClient({ url: \"http://127.0.0.1:4400\", persona: \"alice\" });\nexport { api };\n".to_owned()),
        ("package.json", pretty(&json!({ "name": "snapback4-online-starter", "private": true, "type": "module", "dependencies": { "snapback4": env!("CARGO_PKG_VERSION") } }))),
        ("README.md", format!("# Online starter\n\n{TWO_WAYS}\n\nInstall with `npm install`, then run `npx snapback4 check` and\n`npx snapback4 dev`. `src/client.ts` exports the client and generated API\nfor your UI. For example: `await client.query(api.list, {{}})` and\n`await client.mutate(api.add, {{ title: \"First task\" }})`.\nThe demo persona is local development only; use a session in production.\nFor headless password seeds, add `use identity password` to the schema and\nrun `snapback4 guide auth`: Node calls `signup`/`login` from `snapback4/auth`,\nthen `createClient({{ url, session }})` to act as each user through `api.add`.\n")),
    ]
}

const TWO_WAYS: &str = "Two ways to run: the default `snapback4 init` declares `sync` so a\nlocal-first client can hold its partition and work offline. `init --online`\nomits `sync` and opens `createClient`: queries run on the server and stay\nlive through `/changes`, with no replica. Both use the same schema, rules\nand meter. Add a sync line and open a local-first client when you need\noffline data.";

fn pretty(value: &Value) -> String { format!("{}\n", serde_json::to_string_pretty(value).unwrap()) }

// @ref LLP 3000.007#8 — the Expo reference app owns the starter's toolchain and tier selection
fn expo_package() -> String {
    let mut package: Value = serde_json::from_str(include_str!("../../../../apps/chat-expo/package.json")).unwrap();
    package["name"] = json!("snapback4-expo-starter");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    let native: Value = serde_json::from_str(include_str!("../../../../packages/snapback4-expo/package.json")).unwrap();
    package["dependencies"]["snapback4-expo"] = native["version"].clone();
    // The reference lock resolves Expo 57's preset at this version; pin it
    // explicitly so an app cannot accidentally select an Expo 54 preset.
    package["devDependencies"]["babel-preset-expo"] = json!("57.0.11");
    package["scripts"]["native:smoke"] = json!("snapback4 witness ios --build . --smoke");
    package["scripts"]["export:ios"] = json!("snapback4-export-ios");
    package["devDependencies"]["@expo/fingerprint"] = json!("0.20.13");
    package["scripts"]["build:web"] = json!("expo export -p web && snapback4 web-shell dist");
    package["dependencies"]["react-dom"] = json!("19.2.3");
    package["dependencies"]["react-native-web"] = json!("~0.21.0");
    pretty(&package)
}

fn expo_files() -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(&expo_package()).unwrap();
    package["name"] = json!("snapback4-expo-chat");
    let app = include_str!("init/expo-app.tsx").to_owned();
    // @ref LLP 3000.030#13 — copy the reference lifecycle configuration exactly once.
    let config: Value = serde_json::from_str(include_str!("../../../../apps/chat-expo/app.json")).unwrap();
    let client = include_str!("init/expo-client.ts");
    let inbox = include_str!("../../../../apps/chat-expo/src/Inbox.tsx").replace("../../chat/snapback/generated/api", "../snapback/generated/api");
    let thread = include_str!("../../../../apps/chat-expo/src/Thread.tsx").replace("../../chat/snapback/generated/api", "../snapback/generated/api");
    // @ref LLP 3000.009.000#3 — the Expo starter teaches the core; the reference app's invitation worker is optional server work.
    let schema = core_expo_schema(include_str!("../../../../apps/chat/snapback/schema.q"));
    vec![
        ("package.json", pretty(&package)),
        ("app.json", pretty(&config)),
        ("babel.config.js", include_str!("../../../../apps/chat-expo/babel.config.js").to_owned()),
        ("metro.config.js", include_str!("init/metro.config.js").to_owned()),
        ("metro-wasm-transformer.cjs", include_str!("init/metro-wasm-transformer.cjs").to_owned()),
        ("index.js", include_str!("../../../../apps/chat-expo/index.js").to_owned()),
        ("tsconfig.json", include_str!("../../../../apps/chat-expo/tsconfig.json").to_owned()),
        ("expo-env.d.ts", starter::EXPO_ENV.to_owned()),
        ("App.tsx", app), ("src/client.ts", client.to_owned()), ("src/native-smoke.ts", include_str!("init/native-smoke.ts").to_owned()), ("src/Inbox.tsx", inbox), ("src/Thread.tsx", thread),
        ("src/intents.ts", include_str!("../../../../apps/chat-expo/src/intents.ts").to_owned()),
        ("src/intent-store.ts", include_str!("../../../../apps/chat-expo/src/intent-store.ts").to_owned()),
        ("src/intent-store.web.ts", include_str!("../../../../apps/chat-expo/src/intent-store.web.ts").to_owned()),
        ("src/intent-store.native.ts", include_str!("../../../../apps/chat-expo/src/intent-store.native.ts").to_owned()),
        ("snapback/schema.q", schema),
        ("README.md", format!("# Expo chat starter\n\n{TWO_WAYS}\n\nThis starter opens the native Rust device in development and production\nbuilds that carry `snapback4-expo`; Expo Go selects the online client through `createApp`, with\nno native module and no wasm. `src/client.ts` exports `tier`.\nWeb selects `webDevice()`; `npm run build:web` exports and installs its offline shell.\nKeep the generated Metro config and\nmetro-wasm-transformer.cjs: Metro then emits the wasm asset URL.\n\nThe reference toolchain is Expo 57.0.22, React Native 0.86.3, React 19.2.3,\nexpo-sqlite 57.0.3 and babel-preset-expo 57.0.11. Keep the Expo and Babel\npreset major versions together; mixing them can fail Hermes compilation.\n`npm install` reports audit findings and a deprecated `uuid@7` from Expo's\nbuild-time toolchain (Metro, the Expo CLI, config plugins); they are not in the\napp bundle. Do not run `npm audit fix --force`: it downgrades Expo to SDK 44.\n\nRun `npm install`, `npx snapback4 check`, then `npx snapback4 dev` in one\nterminal. In another, run `npm start`\nfor Expo Go, or `npm run ios:dev` for\nthe native development build. The local server URL defaults to\nhttp://127.0.0.1:4400 (the iOS simulator on this machine). Set\nEXPO_PUBLIC_SNAPBACK_URL to your TLS deployment for a physical phone;\nchoose Continue as a guest to sign in. The app restores that session on reopen.\nThe inbox starts empty: seed a conversation and its memberships through\n`POST /seed` during development. Change app.json's bundle IDs before shipping.\nFor password accounts in Node seed scripts and replay adapters, see `snapback4 guide auth`.\nCall `signup`/`login` from `snapback4/auth`, then open one\n`createClient({{ url, session }})` per user; no browser or borrowed UI token is needed.\nThe schema already enables passwords.\n\nAt every milestone, `npm run export:ios` publishes Hermes to `dist/` and returns.\nNative proof runs in the background at background QoS, so you can keep building\nwithout waiting for Xcode or the simulator. A newer export supersedes pending proof.\nThe next export and `npx snapback4 doctor` print its result; for your final report\nrun `npx snapback4 witness status --wait`. Receipts and logs stay in\n`artifacts/native-smoke/<timestamp>`. Failures are reported there and in status,\nwithout failing a successful export. Unavailable native hosts report a skip.\nBackground preparation allows 900 seconds without output activity and at most 60 minutes total. Activity alone does not establish build progress; repeated output can keep a stalled build occupied until that cap.\n`npm run native:smoke` explicitly waits for a full Release build and smoke.\nThe starter uses normal guest sign-in when smoke needs an account.\nSmoke proves the local store opens, acquisition, cold offline reopen and reconnect.\nAn empty starter proves lifecycle only; seed history for nonempty evidence.\nPending write replay, media and application assertions need the deeper scenario\nin `npx snapback4 guide witness`.\n")),
    ]
}

// Derive from parsed declarations and logical lines, so work clauses, comments,
// whitespace and multiline argument lists cannot leave half an invitation behind.
fn core_expo_schema(source: &str) -> String {
    use snapback4_lang::lexer::{Kind, lex};
    let (document, errors) = snapback4_lang::parse_document("schema.q", source);
    assert!(errors.is_empty(), "the embedded Expo schema must parse: {errors:?}");
    let starts: std::collections::BTreeSet<_> = document.actions.iter().filter(|action| action.name == "invite").map(|action| action.site.line)
        .chain(document.schedules.iter().filter(|schedule| schedule.target == "invite").map(|schedule| schedule.site.line)).collect();
    let (tokens, _) = lex("schema.q", source);
    let mut removed = std::collections::BTreeSet::new();
    for (index, token) in tokens.iter().enumerate() {
        if starts.contains(&token.site.line) || (token.value == "use" && tokens.get(index + 1).is_some_and(|next| next.value == "server")) {
            let end = tokens[index..].iter().find(|next| matches!(next.kind, Kind::Newline | Kind::Eof)).unwrap().site.line;
            removed.extend(token.site.line..=end);
        }
    }
    source.lines().enumerate().filter(|(index, _)| !removed.contains(&(*index as u32 + 1)))
        .map(|(_, line)| format!("{line}\n")).collect()
}

#[test]
fn expo_core_derivation_removes_complete_server_declarations() {
    let core = "use identity guests\nquery answer():\n  return 42\n";
    let source = format!("use   server -- opt in\n{core}action invite(\n  email: text <=320\n) returns {{}} secrets [MAIL_KEY] retry 3 deadline 1h\nschedule invitations every 1d as service:mail: invite -- send\nuse server\n");
    assert_eq!(core_expo_schema(&source), core);
    assert_eq!(core_expo_schema(&source.replace('\n', "\r\n")), core);
}
