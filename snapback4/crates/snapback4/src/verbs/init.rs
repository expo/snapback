//! Starter files are embedded at build time; the packaged binary needs no checkout.

use super::Options;
use crate::project::GITIGNORE;
use serde_json::{Value, json};
use std::path::Path;

pub fn init(options: &Options) -> i32 {
    if options.positionals.len() > 1 || (options.flags.contains_key("online") && options.flags.contains_key("expo")) {
        eprintln!("usage: snapback4 init [dir] [--online|--expo]");
        return 2;
    }
    let dir = options.positionals.first().map(Path::new).unwrap_or_else(|| Path::new("."));
    let online = options.flags.contains_key("online");
    let expo = options.flags.contains_key("expo");
    let files = if expo { expo_files() } else if online { online_files() } else { vec![("snapback/schema.q", snapback4_lang::guide::TEMPLATE.to_owned())] };
    // Check every destination before writing any starter file.
    for (name, _) in &files {
        if dir.join(name).exists() {
            eprintln!("{} already exists", dir.join(name).display());
            return 1;
        }
    }
    let write = || -> std::io::Result<()> {
        for (name, text) in &files {
            let path = dir.join(name);
            std::fs::create_dir_all(path.parent().unwrap())?;
            std::fs::write(path, text)?;
        }
        let gitignore = dir.join(".gitignore");
        let existing = match std::fs::read_to_string(&gitignore) { Ok(text) => text, Err(e) if e.kind() == std::io::ErrorKind::NotFound => String::new(), Err(e) => return Err(e) };
        let missing = GITIGNORE.lines().filter(|line| !existing.lines().any(|old| old == *line)).collect::<Vec<_>>().join("\n");
        if !missing.is_empty() { std::fs::write(gitignore, format!("{existing}{}{missing}\n", if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" }))?; }
        Ok(())
    };
    if let Err(error) = write() { eprintln!("init: {error}"); return 2; }
    println!("init: wrote {} files in {} — {} — next: `snapback4 check`, then `snapback4 dev`{}", files.len(), dir.display(), if expo { "Expo: native when available, online in Expo Go" } else if online { "online-only" } else { "local-first" }, if expo || online { "; see README.md" } else { "" });
    0
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
    app = app.replace("import { runWitness } from \"./src/witness\";\n", "");
    let start = app.find("    if (process.env.EXPO_PUBLIC_WITNESS_URL) {").unwrap();
    let end = app[start..].find("    openClient()").unwrap() + start;
    app.replace_range(start..end, "");
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
        ("metro.config.js", "const { getDefaultConfig } = require(\"expo/metro-config\");\nconst config = getDefaultConfig(__dirname);\nconfig.resolver.unstable_enablePackageExports = true;\nmodule.exports = config;\n".to_owned()),
        ("index.js", include_str!("../../../../apps/chat-expo/index.js").to_owned()),
        ("tsconfig.json", include_str!("../../../../apps/chat-expo/tsconfig.json").to_owned()),
        ("App.tsx", app), ("src/client.ts", client.to_owned()), ("src/Inbox.tsx", inbox), ("src/Thread.tsx", thread),
        ("snapback/schema.q", include_str!("../../../../apps/chat/snapback/schema.q").to_owned()),
        ("README.md", format!("# Expo chat starter\n\n{TWO_WAYS}\n\nThis starter opens the native Rust device in development and production\nbuilds that carry `snapback4-expo`; Expo Go selects `createClient`, with\nno native module and no wasm. `src/client.ts` exports `tier`.\n\nThe reference toolchain is Expo 57.0.22, React Native 0.86.3, React 19.2.3,\nexpo-sqlite 57.0.3 and babel-preset-expo 57.0.11. Keep the Expo and Babel\npreset major versions together; mixing them can fail Hermes compilation.\n\nRun `npm install`, `npx snapback4 check`, then `npx snapback4 dev` in one\nterminal. In another, run `EXPO_PUBLIC_SNAPBACK_PERSONA=alice npm start`\nfor Expo Go, or `EXPO_PUBLIC_SNAPBACK_PERSONA=alice npm run ios:dev` for\nthe native development build. The local server URL defaults to\nhttp://127.0.0.1:4400 (the iOS simulator on this machine). Set\nEXPO_PUBLIC_SNAPBACK_URL to your TLS deployment for a physical phone;\npersonas work on loopback only, and otherwise the client signs in as a guest.\nThe inbox starts empty: seed a conversation and its memberships through\n`POST /seed` during development. Change app.json's bundle IDs before shipping.\n")),
    ]
}
