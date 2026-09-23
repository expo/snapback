//! Starter files are embedded at build time; the packaged binary needs no checkout.

use super::Options;
use crate::project::{GENERATED_PACKAGE, GITIGNORE};
use serde_json::{Value, json};
use std::{io::Write, path::Path};

mod web;

pub fn init(options: &Options) -> i32 {
    let recipe = options.flags.get("recipe");
    let prefix = options.flags.get("prefix");
    if options.positionals.len() > 1 || (["online", "expo", "web"].iter().filter(|flag| options.flags.contains_key(**flag)).count() > 1) || recipe.is_some_and(|name| name != "feeds") || prefix.is_some_and(|p| recipe.is_none() || !snapback4_lang::recipe::valid_prefix(p)) {
        eprintln!("usage: snapback4 init [dir] [--online|--expo|--web] [--recipe feeds [--prefix <name>] [--authors N --edges N]]");
        return 2;
    }
    let sizing = options.flags.contains_key("authors") || options.flags.contains_key("edges");
    if sizing && recipe.map(String::as_str) != Some("feeds") {
        eprintln!("E_RECIPE_CAPS: --authors and --edges require --recipe feeds; see snapback4 guide feeds");
        return 2;
    }
    let caps = match snapback4_lang::recipe::FollowingCaps::parse(options.flags.get("authors").map(String::as_str), options.flags.get("edges").map(String::as_str)) {
        Ok(caps) => caps,
        Err(error) => { eprintln!("E_RECIPE_CAPS: {error}; see snapback4 guide feeds"); return 2; }
    };
    let dir = options.positionals.first().map(Path::new).unwrap_or_else(|| Path::new("."));
    let online = options.flags.contains_key("online");
    let expo = options.flags.contains_key("expo");
    let web = options.flags.contains_key("web");
    let recipe_only = recipe.is_some() && !expo && !online && !web && dir.join("snapback/schema.q").is_file();
    // @ref LLP 3000.011.002.000#2 — mappings explicitly authorize the public model; never infer or rewrite the app.
    let selectors = ["public-profiles", "public-posts", "public-follows", "public-reposts"];
    let bridge = if selectors.iter().any(|flag| options.flags.contains_key(*flag)) {
        if !recipe_only || prefix.is_none() || !selectors.iter().all(|flag| options.flags.contains_key(*flag)) {
            eprintln!("E_RECIPE_BRIDGE: use all four --public-profiles/--public-posts/--public-follows/--public-reposts mappings with --recipe feeds --prefix <name> in an existing app; see snapback4 guide feeds");
            return 2;
        }
        let result = (|| {
            let mapping = snapback4_lang::recipe::bridge::Mapping::parse(&options.flags[selectors[0]], &options.flags[selectors[1]], &options.flags[selectors[2]], &options.flags[selectors[3]])?;
            let sources = crate::project::Project { root: dir.to_path_buf() }.sources().map_err(|error| error.to_string())?;
            let app = snapback4_lang::compile(&sources);
            if !app.diagnostics.is_empty() {
                return Err(format!("check the existing app before installing its bridge; no files written\n{}", app.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")));
            }
            mapping.render(&app.schema, prefix.unwrap())
        })();
        match result {
            Ok(source) => Some(source),
            Err(error) => { eprintln!("E_RECIPE_BRIDGE: {error}; no files written; see snapback4 guide feeds"); return 1; }
        }
    } else { None };
    let mut files = if recipe_only { Vec::new() } else if web { web::files() } else if expo { expo_files() } else if online { online_files() } else { vec![("snapback/schema.q", snapback4_lang::guide::TEMPLATE.to_owned())] };
    if recipe.map(String::as_str) == Some("feeds") {
        let prefix = prefix.map(String::as_str).unwrap_or("");
        let source = match snapback4_lang::recipe::following_sized(prefix, "feed", caps) {
            Ok(source) => source,
            Err(error) => { eprintln!("init: {error}"); return 1; }
        };
        files.push(("snapback/feed.q", source));
        let mut client = include_str!("init/following.ts").to_owned();
        if let Some(bridge) = &bridge {
            files.push(("snapback/feed_bridge.q", bridge.clone()));
            let imports = client.split_once("// Pass your app").unwrap().0;
            let query = client.split_once("// Render the returned Read").unwrap().1;
            client = format!("{imports}// Public app bridge: snapback/feed_bridge.q; see snapback4 guide feeds.\n// Call {prefix}AppRegister, {prefix}AppPublish, {prefix}AppRemove,\n// {prefix}AppRepost, {prefix}AppUnrepost, {prefix}AppFollow, {prefix}AppUnfollow\n// inside the app's existing mutations.\n// The bridge validates ownership and translates app references to event IDs.\n// Backfill explicitly before switching Following; keep the app's card join.\n// Publish only a new card or initial backfill; never resurrect a removed card.\n// Retry the original mutation with its original write ID.\n// Render the returned Read{query}");
        }
        if !prefix.is_empty() {
            client = client.lines().filter(|line| !line.starts_with("export const registerForFollowing") && !line.starts_with("export const followAuthor") && !line.starts_with("export const unfollowAuthor"))
                .collect::<Vec<_>>().join("\n") + "\n";
            client = client.replace("Client, Cursor, Principal", "Client, Cursor");
        }
        for name in ["register", "follow", "unfollow", "following"] {
            client = client.replace(&format!("api.feed.{name}"), &format!("api.feed.{}", snapback4_lang::recipe::prefixed_name(prefix, name)));
        }
        files.push(("src/following.ts", client));
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
        if let Err(error) = preflight_parents(&dir.join(name)) { eprintln!("init: {error}"); return 1; }
        let alternate = match *name { "metro.config.cjs" => Some("metro.config.js"), "babel.config.cjs" => Some("babel.config.js"), "metro.config.js" => Some("metro.config.cjs"), "babel.config.js" => Some("babel.config.cjs"), _ => None };
        if let Some(alternate) = alternate.filter(|name| dir.join(name).exists()) {
            eprintln!("{} already exists", dir.join(alternate).display());
            return 1;
        }
        if *name != "package.json" {
            match dir.join(*name).symlink_metadata() {
                Ok(_) => { eprintln!("{} already exists", dir.join(*name).display()); return 1; }
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
                Err(error) => { eprintln!("init: {}: {error}", dir.join(*name).display()); return 1; }
            }
        }
    }
    if let Err(error) = preflight_parents(&dir.join(".gitignore")) { eprintln!("init: {error}"); return 1; }
    if recipe.is_some() {
        if let Err(error) = check_recipe(dir, &files) { eprintln!("init: {error}"); return 1; }
    }
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
        let missing = GITIGNORE.lines().filter(|line| !existing.lines().any(|old| old == *line)).collect::<Vec<_>>().join("\n");
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
    let cap_summary = if recipe.map(String::as_str) == Some("feeds") { format!(" — caps: {}", caps.summary()) } else { String::new() };
    let recipe_label = "Following recipe";
    println!("init: wrote {} files in {} — {}{}{cap_summary} — next: `snapback4 check`, then `snapback4 dev`{}", files.len(), dir.display(), if recipe_only { recipe_label } else if expo { "Expo: native when available, online in Expo Go" } else if web { "Vite web: production offline shell" } else if online { "online-only" } else { "local-first" }, if recipe.is_some() && !recipe_only { format!(" + {recipe_label}") } else { String::new() }, if expo || online || web { "; see README.md" } else { "" });
    // @ref LLP 3000.007#6.8 — measure fixture acquisition when the recipe is installed; ordinary checks stay quiet.
    if recipe.is_some() { println!("cold rows: snapback4 test --residency --fixture <fixture-directory> --as <principal>"); }
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

// @ref LLP 3000.007#20.3 — installing the Following module must preserve a compilable application.
fn check_recipe(dir: &Path, files: &[(&str, String)]) -> Result<(), String> {
    let project = crate::project::Project { root: dir.to_path_buf() };
    let mut sources = match project.sources() {
        Ok(sources) => sources,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(format!("{}: {error}", project.schema_dir().display())),
    };
    // Compilation alone cannot catch a helper that binds ahead of a builtin.
    // Check the syntax-selected names left unrenamed before adding any files.
    let recipe_file = "snapback/feed.q";
    let recipe = files.iter().find(|(name, _)| *name == recipe_file).unwrap();
    let references = snapback4_lang::recipe::unrenamed_references(&recipe.1)?;
    for (file, text) in &sources {
        let (document, _) = snapback4_lang::parse_document(file, text);
        for (kind, name, site) in document.functions.iter().map(|d| ("fn", &d.name, &d.site))
            .chain(document.tables.iter().map(|d| ("table", &d.name, &d.site)))
            .chain(document.maintains.iter().map(|d| ("maintain", &d.name, &d.site)))
            .chain(document.shapes.iter().map(|d| ("shape", &d.name, &d.site)))
            .chain(document.programs.iter().map(|d| ("operation", &d.name, &d.site)))
            .chain(document.effects.iter().map(|d| ("effect", &d.name, &d.site)))
            .chain(document.actions.iter().map(|d| ("action", &d.name, &d.site)))
            .chain(document.schedules.iter().map(|d| ("schedule", &d.name, &d.site))) {
            if references.contains(name) {
                return Err(format!("recipe cannot be installed; no files written\n  {kind} {name} in {}:{}:{} would shadow the recipe's unrenamed reference `{name}` in {recipe_file}\n  rename the app declaration `{name}` and its callers, then run init again", project.schema_dir().join(&site.file).display(), site.line, site.col));
            }
        }
    }
    sources.extend(files.iter().filter(|(name, _)| name.ends_with(".q")).map(|(name, text)| (Path::new(name).file_name().unwrap().to_string_lossy().into_owned(), text.clone())));
    let bound = snapback4_lang::compile(&sources);
    if bound.diagnostics.is_empty() { return Ok(()); }
    // The compiler locates the second declaration. Add both original sites
    // here, without changing the language lane's diagnostic contract.
    let mut declarations = std::collections::BTreeMap::new();
    let mut collisions = Vec::new();
    let retry = "feeds --prefix feed";
    for (file, text) in &sources {
        let (document, _) = snapback4_lang::parse_document(file, text);
        for (kind, name, site) in document.tables.into_iter().map(|t| ("table", t.name, t.site))
            .chain(document.maintains.into_iter().map(|m| ("maintain", m.name, m.site))) {
            let location = format!("{}:{}:{}", project.schema_dir().join(&site.file).display(), site.line, site.col);
            if let Some((previous_kind, previous)) = declarations.get(&name) {
                collisions.push(format!("  {previous_kind} {name} in {previous} collides with {kind} {name} in {location}\n  run `snapback4 init --recipe {retry}` to keep the app's declarations and rename the recipe"));
            } else { declarations.insert(name, (kind, location)); }
        }
    }
    let details = if collisions.is_empty() { bound.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n") } else { collisions.join("\n") };
    Err(format!("recipe cannot be installed; no files written\n{details}"))
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
    // @ref LLP 3000.009.000#3 — the Expo starter teaches the core; the reference app's invitation worker is optional server work.
    let schema = core_expo_schema(include_str!("../../../../apps/chat/snapback/schema.q"));
    vec![
        ("package.json", pretty(&package)),
        ("app.json", include_str!("../../../../apps/chat-expo/app.json").to_owned()),
        ("babel.config.js", include_str!("../../../../apps/chat-expo/babel.config.js").to_owned()),
        ("metro.config.js", include_str!("init/metro.config.js").to_owned()),
        ("metro-wasm-transformer.cjs", include_str!("init/metro-wasm-transformer.cjs").to_owned()),
        ("index.js", include_str!("../../../../apps/chat-expo/index.js").to_owned()),
        ("tsconfig.json", include_str!("../../../../apps/chat-expo/tsconfig.json").to_owned()),
        ("App.tsx", app), ("src/client.ts", client.to_owned()), ("src/Inbox.tsx", inbox), ("src/Thread.tsx", thread),
        ("snapback/schema.q", schema),
        ("README.md", format!("# Expo chat starter\n\n{TWO_WAYS}\n\nThis starter opens the native Rust device in development and production\nbuilds that carry `snapback4-expo`; Expo Go selects `createClient`, with\nno native module and no wasm. `src/client.ts` exports `tier`.\nFor a web client using `webDevice()`, keep the generated Metro config and\nmetro-wasm-transformer.cjs: Metro then emits the wasm asset URL.\n\nThe reference toolchain is Expo 57.0.22, React Native 0.86.3, React 19.2.3,\nexpo-sqlite 57.0.3 and babel-preset-expo 57.0.11. Keep the Expo and Babel\npreset major versions together; mixing them can fail Hermes compilation.\n\nRun `npm install`, `npx snapback4 check`, then `npx snapback4 dev` in one\nterminal. In another, run `EXPO_PUBLIC_SNAPBACK_PERSONA=alice npm start`\nfor Expo Go, or `EXPO_PUBLIC_SNAPBACK_PERSONA=alice npm run ios:dev` for\nthe native development build. The local server URL defaults to\nhttp://127.0.0.1:4400 (the iOS simulator on this machine). Set\nEXPO_PUBLIC_SNAPBACK_URL to your TLS deployment for a physical phone;\npersonas work on loopback only, and otherwise the client signs in as a guest.\nThe inbox starts empty: seed a conversation and its memberships through\n`POST /seed` during development. Change app.json's bundle IDs before shipping.\n")),
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
