//! Starter files are embedded at build time; the packaged binary needs no checkout.

use super::Options;
use crate::project::{GENERATED_PACKAGE, GITIGNORE};
use serde_json::{Value, json};
use std::path::Path;

pub fn init(options: &Options) -> i32 {
    let recipe = options.flags.get("recipe");
    if options.positionals.len() > 1 || (options.flags.contains_key("online") && options.flags.contains_key("expo")) || recipe.is_some_and(|name| name != "feeds") {
        eprintln!("usage: snapback4 init [dir] [--online|--expo] [--recipe feeds]");
        return 2;
    }
    let dir = options.positionals.first().map(Path::new).unwrap_or_else(|| Path::new("."));
    let online = options.flags.contains_key("online");
    let expo = options.flags.contains_key("expo");
    let recipe_only = recipe.is_some() && !expo && !online && dir.join("snapback/schema.q").is_file();
    let mut files = if recipe_only { Vec::new() } else if expo { expo_files() } else if online { online_files() } else { vec![("snapback/schema.q", snapback4_lang::guide::TEMPLATE.to_owned())] };
    if recipe.is_some() {
        // @ref LLP 3000.007#20.3 — adopt the tested Following recipe; only its schedule needs the module's qualified job name.
        let source = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).remove(0);
        files.push(("snapback/feed.q", source.replace(": purgeRemoved\n", ": feed.purgeRemoved\n")));
        files.push(("src/following.ts", include_str!("init/following.ts").to_owned()));
    }
    // @ref LLP 3000.007#20.2 — installed packages can receive a starter; only conflicting required entries refuse.
    for (name, text) in &mut files {
        if *name == "package.json" && dir.join(*name).exists() {
            match merge_package(&dir.join(*name), text) {
                Ok(merged) => *text = merged,
                Err(error) => { eprintln!("init: {error}"); return 1; }
            }
        } else if *name == "package.json" && dir.is_dir() {
            match inherited_package_type(dir) {
                Ok(kind) => {
                    let mut package: Value = serde_json::from_str(text).unwrap();
                    package.as_object_mut().unwrap().remove("type");
                    if let Some(kind) = kind { package["type"] = kind; }
                    *text = pretty(&package);
                }
                Err(error) => { eprintln!("init: {error}"); return 1; }
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
    if !recipe_only { files.push(("snapback/generated/package.json", GENERATED_PACKAGE.into())); }
    // Check every destination before writing any starter file.
    for (name, _) in &files {
        let alternate = match *name { "metro.config.cjs" => Some("metro.config.js"), "babel.config.cjs" => Some("babel.config.js"), "metro.config.js" => Some("metro.config.cjs"), "babel.config.js" => Some("babel.config.cjs"), _ => None };
        if let Some(alternate) = alternate.filter(|name| dir.join(name).exists()) {
            eprintln!("{} already exists", dir.join(alternate).display());
            return 1;
        }
        if *name != "package.json" && dir.join(*name).symlink_metadata().is_ok() {
            eprintln!("{} already exists", dir.join(*name).display());
            return 1;
        }
    }
    let write = || -> std::io::Result<()> {
        for (name, text) in &files {
            let path = dir.join(*name);
            std::fs::create_dir_all(path.parent().unwrap())?;
            if *name == "package.json" { replace_package(&path, text)?; } else { std::fs::write(path, text)?; }
        }
        let gitignore = dir.join(".gitignore");
        let existing = match std::fs::read_to_string(&gitignore) { Ok(text) => text, Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(), Err(e) => return Err(e) };
        let missing = GITIGNORE.lines().filter(|line| !existing.lines().any(|old| old == *line)).collect::<Vec<_>>().join("\n");
        if !missing.is_empty() { std::fs::write(gitignore, format!("{existing}{}{missing}\n", if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" }))?; }
        Ok(())
    };
    if let Err(error) = write() { eprintln!("init: {error}"); return 2; }
    println!("init: wrote {} files in {} — {}{} — next: `snapback4 check`, then `snapback4 dev`{}", files.len(), dir.display(), if recipe_only { "Following recipe" } else if expo { "Expo: native when available, online in Expo Go" } else if online { "online-only" } else { "local-first" }, if recipe.is_some() && !recipe_only { " + Following recipe" } else { "" }, if expo || online { "; see README.md" } else { "" });
    0
}

// A new package boundary in an existing directory inherits the nearest
// package's type, including its absence, rather than reinterpreting scripts.
fn inherited_package_type(dir: &Path) -> Result<Option<Value>, String> {
    let absolute = std::fs::canonicalize(dir).map_err(|e| e.to_string())?;
    for ancestor in absolute.ancestors().skip(1) {
        let path = ancestor.join("package.json");
        let text = match std::fs::read_to_string(&path) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("{}: {error}", path.display())),
        };
        let package: Value = serde_json::from_str(&text).map_err(|e| format!("{}: {e}", path.display()))?;
        return Ok(package.get("type").cloned());
    }
    Ok(None)
}

// @ref LLP 3000.007#20.2 — merge an installed package without losing it on a partial write.
fn replace_package(path: &Path, text: &str) -> std::io::Result<()> {
    use std::{fs::OpenOptions, io::Write, sync::atomic::{AtomicU64, Ordering}};
    static SERIAL: AtomicU64 = AtomicU64::new(0);
    let (temporary, mut file) = loop {
        let temporary = path.with_file_name(format!(".package.json.{}.{}.tmp", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
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
    for (key, value) in required.as_object().unwrap() {
        if matches!(key.as_str(), "dependencies" | "devDependencies" | "scripts") {
            let group = object.entry(key.clone()).or_insert_with(|| json!({})).as_object_mut()
                .ok_or_else(|| format!("package.json {key} must be an object"))?;
            for (name, needed) in value.as_object().unwrap() {
                match group.get(name) {
                    Some(old) if old != needed => return Err(format!("package.json conflict at {key}.{name}: existing {old}, required {needed}")),
                    Some(_) => {},
                    None => { group.insert(name.clone(), needed.clone()); }
                }
            }
        } else if key != "type" {
            // An absent type is itself the existing package's module policy.
            object.entry(key.clone()).or_insert_with(|| value.clone());
        }
    }
    Ok(pretty(&existing))
}

// @ref LLP 3000.007#7 — no sync lines and createClient pave the online tier
fn online_files() -> Vec<(&'static str, String)> {
    vec![
        ("snapback/schema.q", snapback4_lang::guide::TEMPLATE_ONLINE.to_owned()),
        ("src/client.ts", "import { createClient } from \"snapback4/client\";\nimport { api } from \"../snapback/generated/api\";\n\n// Development on this machine. In a deployment, pass a session instead of a persona.\nexport const client = createClient({ url: \"http://127.0.0.1:4400\", persona: \"alice\" });\nexport { api };\n".to_owned()),
        ("package.json", pretty(&json!({ "name": "snapback4-online-starter", "private": true, "type": "module", "dependencies": { "snapback4": env!("CARGO_PKG_VERSION") } }))),
        ("README.md", format!("# Online starter\n\n{TWO_WAYS}\n\nInstall with `npm install`, then run `npx snapback4 check` and\n`npx snapback4 dev`. `src/client.ts` exports the client and generated API\nfor your UI. For example: `await client.query(api.list, {{}})` and\n`await client.mutate(api.add, {{ title: \"First task\" }})`.\nThe demo persona is local development only; use a session in production.\n")),
    ]
}

const TWO_WAYS: &str = "Two ways to run: the default `snapback4 init` declares `sync` so a\nlocal-first client can hold its partition and work offline. `init --online`\nomits `sync` and opens `createClient`: queries run on the server and stay\nlive through `/changes`, with no replica. Both use the same schema, rules\nand meter. Add a sync line and open a local-first client when you need\noffline data.";

fn pretty(value: &Value) -> String { format!("{}\n", serde_json::to_string_pretty(value).unwrap()) }

// @ref LLP 3000.007#8 — the Expo reference app owns the starter's toolchain and tier selection
fn expo_files() -> Vec<(&'static str, String)> {
    let mut package: Value = serde_json::from_str(include_str!("../../../../apps/chat-expo/package.json")).unwrap();
    package["name"] = json!("snapback4-expo-starter");
    package["dependencies"]["snapback4"] = json!(env!("CARGO_PKG_VERSION"));
    let native: Value = serde_json::from_str(include_str!("../../../../packages/snapback4-expo/package.json")).unwrap();
    package["dependencies"]["snapback4-expo"] = native["version"].clone();
    // The reference lock resolves Expo 57's preset at this version; pin it
    // explicitly so an app cannot accidentally select an Expo 54 preset.
    package["devDependencies"]["babel-preset-expo"] = json!("57.0.11");
    let mut app = include_str!("../../../../apps/chat-expo/App.tsx").to_owned();
    app = app.replace("import { runWitness } from \"./src/witness\";\n", "")
        .replace("import { witness } from \"snapback4-expo/witness\";\n", "");
    let start = app.find("    const proof = witness();").unwrap();
    let end = app[start..].find("    openClient()").unwrap() + start;
    app.replace_range(start..end, "");
    app = app.lines().filter(|line| !line.contains("const [witnessConversation") && !line.contains("const [witnessStatus") && !line.contains("{witnessStatus ?"))
        .collect::<Vec<_>>().join("\n") + "\n";
    app = app.replace("<Home initialConversationId={witnessConversation} />", "<Home />");
    app = app.replace("import { openClient }", "import { openClient, tier }")
        .replace("in SQLite (expo-sqlite)", "in the Rust module's SQLite")
        .replace("apps/chat/snapback/schema.q", "snapback/schema.q")
        .replace("Opening your replica…", "Opening your client…")
        .replace(" · local-first · SQLite</Text>", " · {tier === \"native\" ? \"local-first · SQLite\" : \"online tier\"}</Text>");
    let client = include_str!("../../../../apps/chat-expo/src/client.ts");
    let inbox = include_str!("../../../../apps/chat-expo/src/Inbox.tsx").replace("../../chat/snapback/generated/api", "../snapback/generated/api");
    let thread = include_str!("../../../../apps/chat-expo/src/Thread.tsx").replace("../../chat/snapback/generated/api", "../snapback/generated/api");
    vec![
        ("package.json", pretty(&package)),
        ("app.json", include_str!("../../../../apps/chat-expo/app.json").to_owned()),
        ("babel.config.js", include_str!("../../../../apps/chat-expo/babel.config.js").to_owned()),
        ("metro.config.js", include_str!("init/metro.config.js").to_owned()),
        ("metro-wasm-transformer.cjs", include_str!("init/metro-wasm-transformer.cjs").to_owned()),
        ("index.js", include_str!("../../../../apps/chat-expo/index.js").to_owned()),
        ("tsconfig.json", include_str!("../../../../apps/chat-expo/tsconfig.json").to_owned()),
        ("App.tsx", app), ("src/client.ts", client.to_owned()), ("src/Inbox.tsx", inbox), ("src/Thread.tsx", thread),
        ("snapback/schema.q", include_str!("../../../../apps/chat/snapback/schema.q").to_owned()),
        ("snapback/worker.mts", include_str!("../../../../apps/chat/snapback/worker.ts").to_owned()),
        ("README.md", format!("# Expo chat starter\n\n{TWO_WAYS}\n\nThis starter opens the native Rust device in development and production\nbuilds that carry `snapback4-expo`; Expo Go selects `createClient`, with\nno native module and no wasm. `src/client.ts` exports `tier`.\nFor a web client using `webDevice()`, keep the generated Metro config and\nmetro-wasm-transformer.cjs: Metro then emits the wasm asset URL.\n\nThe reference toolchain is Expo 57.0.22, React Native 0.86.3, React 19.2.3,\nexpo-sqlite 57.0.3 and babel-preset-expo 57.0.11. Keep the Expo and Babel\npreset major versions together; mixing them can fail Hermes compilation.\n\nRun `npm install`, `npx snapback4 check`, then `npx snapback4 dev` in one\nterminal. In another, run `EXPO_PUBLIC_SNAPBACK_PERSONA=alice npm start`\nfor Expo Go, or `EXPO_PUBLIC_SNAPBACK_PERSONA=alice npm run ios:dev` for\nthe native development build. The local server URL defaults to\nhttp://127.0.0.1:4400 (the iOS simulator on this machine). Set\nEXPO_PUBLIC_SNAPBACK_URL to your TLS deployment for a physical phone;\npersonas work on loopback only, and otherwise the client signs in as a guest.\nThe inbox starts empty: seed a conversation and its memberships through\n`POST /seed` during development. Change app.json's bundle IDs before shipping.\n")),
    ]
}
