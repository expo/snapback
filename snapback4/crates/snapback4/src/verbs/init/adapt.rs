//! Starter leftovers on the init-first path: `init --web` (or `--expo`) wrote
//! the todo starter, then the project replaced `snapback/schema.q`. The
//! starter's own files that still match the bytes init wrote, but no longer
//! fit the schema, are leftovers: `check` names them and `init --adapt`
//! removes or rewrites them. A file the project changed is never touched.
// @ref LLP 3000.011.003.000#7.2 — leftovers are judged by the starter's original bytes, never by name alone.
use super::starter::{self, Body, Platform};
use super::{OwnSchema, own_schema};
use std::path::Path;

/// One unmodified starter file that no longer fits the project's schema.
pub(crate) struct Leftover {
    pub path: &'static str,
    pub why: String,
    /// The text `init --adapt` writes; `None` removes the file.
    pub rewrite: Option<String>,
}

/// Starter operations its fixtures, cases and `Todos` screen call.
const STARTER_OPERATIONS: [&str; 4] = ["list", "add", "toggle", "remove"];

/// Whether a schema still has the starter's `todos` table and the operations
/// its fixtures, cases and `Todos` screen call.
pub(super) fn fits_todos(own: &OwnSchema) -> bool {
    own.tables.iter().any(|table| table == "todos")
        && STARTER_OPERATIONS.iter().all(|op| own.operations.iter().any(|name| name == op))
}

/// What the schema in `dir` leaves of the starter, and the advice that goes
/// with it (a sign-in the project must write by hand). No schema: nothing.
pub(crate) fn leftovers(dir: &Path) -> (Vec<Leftover>, Vec<String>) {
    let (found, advice, _) = plan(dir);
    (found, advice)
}

fn plan(dir: &Path) -> (Vec<Leftover>, Vec<String>, Vec<String>) {
    let Ok(Some(own)) = own_schema(dir) else { return (Vec::new(), Vec::new(), Vec::new()) };
    let mut found = Vec::new();
    let mut advice = Vec::new();
    let mut modified = Vec::new();
    let todos = fits_todos(&own);
    for (path, text) in starter::FIXTURES {
        let current = read(dir, path);
        if current.as_ref().is_some_and(|current| *current != super::without_design_references(text)) { modified.push(path.to_owned()); }
        if !todos && current.is_some_and(|current| current == super::without_design_references(text)) {
            let what = if path.ends_with("todos.jsonl") { "rows for the todo starter's `todos` table" } else { "cases for the todo starter's list/add/toggle/remove" };
            found.push(Leftover { path, why: format!("the unmodified {what}; your snapback/*.q has no todos table with those operations, so `snapback4 test` would refuse it"), rewrite: None });
        }
    }
    for platform in [Platform::Web, Platform::Expo] {
        if !screens(dir, platform, &own, todos, &mut found, &mut advice) {
            for path in [platform.paths().0, platform.paths().1] { if read(dir, path).is_some() { modified.push(path.to_owned()); } }
        }
    }
    if let Some(text) = read(dir, "src/native-smoke.ts") {
        let wanted = starter::native_smoke(own.identity.is_some_and(|(password, guests)| password && !guests));
        let recognized = [false, true].into_iter().any(|password| [starter::native_smoke(password), starter::wave14_native_smoke(password)].iter().any(|reference| text == *reference || text == reference.lines().filter(|line| !line.starts_with("// smokeSegment()") && !line.starts_with("// native module config")).collect::<Vec<_>>().join("\n") + "\n"));
        if !recognized { modified.push("src/native-smoke.ts".to_owned()); }
        if text != wanted && recognized && smoke_referenced(dir) {
            found.push(Leftover { path: "src/native-smoke.ts", why: "the unmodified native smoke helper uses the previous schema's sign-in".into(), rewrite: Some(wanted) });
        }
    }
    if read(dir, "src/native-smoke.ts").is_some() && !smoke_referenced(dir) {
        advice.push("info: src/native-smoke.ts has no source reference; review it before a native smoke proof".into());
    }
    readme(dir, &own, todos, &mut found, &mut modified);
    app_json(dir, &mut found);
    expo_favicon(dir, &mut found);
    (found, advice, modified)
}

// A custom entry/component/proof can reference the helper too. Generated trees
// and dependency directories are not authored source; do not follow symlinks.
fn smoke_referenced(root: &Path) -> bool {
    fn walk(dir: &Path, helper: &Path) -> bool {
        let Ok(entries)=std::fs::read_dir(dir) else { return true; };
        for entry in entries {
            let Ok(entry)=entry else {return true;};
            let Ok(kind)=entry.file_type() else {return true;};
            let path=entry.path();
            if kind.is_symlink() {continue;}
            if kind.is_dir() {
                if !matches!(entry.file_name().to_str(),Some("node_modules"|".git"|".snapback4"|".expo"|"target"|"dist"|"build"|"generated")) && walk(&path,helper) {return true;}
            } else if path!=helper && !path.to_string_lossy().ends_with(".d.ts")
                && path.extension().and_then(|e|e.to_str()).is_some_and(|e|matches!(e,"ts"|"tsx"|"js"|"jsx"|"mjs"|"cjs")) {
                if std::fs::read_to_string(path).map_or(true,|text|text.contains("native-smoke")) {return true;}
            }
        }
        false
    }
    walk(root,&root.join("src/native-smoke.ts"))
}

/// The starter README, while it is still one init wrote (for either screen,
/// at the ports it names), when it describes another screen than the schema
/// now gets: the Todos README beside a project's schema, or the reverse.
// @ref LLP 3000.011.003.000#7.4 — wave 6 (042): adapt rewrote the screen but left a README about todos and guest sign-in.
fn readme(dir: &Path, own: &OwnSchema, todos: bool, found: &mut Vec<Leftover>, modified: &mut Vec<String>) {
    let platform = if dir.join("src/App.tsx").is_file() { Platform::Web } else if dir.join("App.tsx").is_file() { Platform::Expo } else { return };
    let title = super::title(dir);
    let personas = own.identity.is_none() && !own.personas.is_empty();
    let wanted_body = if todos { Body::Todos } else { Body::Home(None) };
    for path in ["README.md", "README.snapback.md"] {
        let Some(text) = read(dir, path) else { continue };
        let port = number_after(&text, "127.0.0.1:");
        let web_port = number_after(&text, "localhost:");
        let ports = [(port, web_port), (None, web_port), (port, None), (None, None)];
        // The offline paragraph names the schema's synced tables when init
        // wrote it; any of them (or 0.4.22's unconditional claim) still matches.
        let masked = starter::without_offline(&text);
        let explicit_online = platform == Platform::Web && read(dir, "src/client.ts").is_some_and(|client| client.contains("writes: \"online\""));
        let matched = ports.into_iter().find(|&(port, web_port)| {
            [(Body::Todos, false), (Body::Home(None), false), (Body::Home(None), true)].iter()
                .any(|(body, personas)| [false, true].iter().any(|password| [false, true].iter().any(|online| {
                    let readme = starter::identity_readme(platform, &title, body, *personas, &starter::Offline::Unknown, *password);
                    let readme = if *online { starter::online_readme(&readme) } else { readme };
                    masked == starter::without_offline(&super::localize(path, &super::without_design_references(&readme), port, web_port))
                })))
        });
        let Some((port, web_port)) = matched else { modified.push(path.to_owned()); continue };
        let wanted = super::localize(path, &super::without_design_references(&starter::identity_readme(platform, &title, &wanted_body, personas, &own.offline, own.identity.is_some_and(|(password, guests)| password && !guests))), port, web_port);
        let wanted = if explicit_online { starter::online_readme(&wanted) } else { wanted };
        if wanted == text { continue; }
        let about = if todos { "the todo starter's operations, which your snapback/*.q declares again" } else { "your snapback/*.q and the Home screen, named after this directory" };
        let only_proof = super::proof::without_readme(&wanted) == text;
        let only_offline = !text.starts_with("# Todos") && starter::without_offline(&wanted) == masked;
        // A schema that does not compile right now says nothing about what it syncs.
        if only_offline && !only_proof && own.offline == starter::Offline::Unknown { continue; }
        let why = if only_proof {
            "the unmodified starter README lacks frontend/day-two proof instructions; adapt adds them".to_owned()
        } else if only_offline {
            "the unmodified starter README says what works offline for another schema; adapt rewrites that paragraph from the tables your snapback/*.q syncs".to_owned()
        } else {
            format!("the unmodified starter README describes {}; adapt rewrites it to describe {about}", if text.starts_with("# Todos") { "the todo starter (its todos table and guest sign-in)" } else { "the Home screen for another schema" })
        };
        found.push(Leftover { path, why, rewrite: Some(wanted) });
    }
}

/// An Expo `app.json` that still carries the todo starter's slug, scheme and
/// bundle ids (written by 0.4.21 and earlier): adapt names them after the
/// directory and changes nothing else in the file.
// @ref LLP 3000.011.003.000#7.4 — wave 6 (067): adapted Expo apps kept dev.snapback4.todos.
fn app_json(dir: &Path, found: &mut Vec<Leftover>) {
    let Some(text) = read(dir, "app.json") else { return };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    let expo = &config["expo"];
    let [(_, slug), (_, scheme), (_, bundle)] = starter::TODO_IDS;
    if expo["slug"] != slug || expo["scheme"] != scheme || expo["ios"]["bundleIdentifier"] != bundle || expo["android"]["package"] != bundle { return; }
    let (new_slug, new_scheme, new_bundle) = starter::app_ids(&super::title(dir));
    let quoted = |value: &str| format!("\"{value}\"");
    let rewrite = text.replace(&quoted(bundle), &quoted(&new_bundle)).replace(&quoted(slug), &quoted(&new_slug)).replace(&quoted(scheme), &quoted(&new_scheme));
    found.push(Leftover { path: "app.json", why: format!("the todo starter's ids (slug {slug}, scheme {scheme}, bundle id {bundle}); adapt names them after this directory ({new_slug}, {new_scheme}, {new_bundle})"), rewrite: Some(rewrite) });
}

// Repair only the exact SVG asset and setting emitted by 0.4.26. Custom
// images/settings remain owned by the app, including other SVG paths.
fn expo_favicon(dir: &Path, found: &mut Vec<Leftover>) {
    if read(dir, "assets/favicon.svg").as_deref() != Some(include_str!("starter/favicon.svg")) { return; }
    let Some(text) = read(dir, "app.json") else { return };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&text) else { return };
    if config.pointer("/expo/web/favicon").and_then(|value| value.as_str()) != Some("./assets/favicon.svg") { return; }
    let why = "the unmodified Expo favicon is SVG, which Expo's web export requires to be raster".to_owned();
    if let Some(existing) = found.iter_mut().find(|change| change.path == "app.json") {
        let mut config: serde_json::Value = serde_json::from_str(existing.rewrite.as_ref().unwrap()).unwrap();
        config["expo"]["web"].as_object_mut().unwrap().remove("favicon");
        existing.rewrite = Some(super::pretty(&config));
        existing.why.push_str("; Expo's web export also requires a raster favicon");
    } else {
        let mut config = config;
        config["expo"]["web"].as_object_mut().unwrap().remove("favicon");
        found.push(Leftover { path: "app.json", why: why.clone(), rewrite: Some(super::pretty(&config)) });
    }
    found.push(Leftover { path: "assets/favicon.svg", why, rewrite: None });
}

fn number_after(text: &str, prefix: &str) -> Option<u16> {
    let at = text.find(prefix)? + prefix.len();
    let digits: String = text[at..].chars().take_while(char::is_ascii_digit).collect();
    digits.parse().ok()
}

/// The sign-in a schema admits, as the starter screen it needs: the guest
/// screen (`None`), the persona picker (`Some(personas)`), or no starter
/// screen fits (`Err(advice)`).
#[derive(Clone, PartialEq, Eq)]
enum SignIn { Guest, Password, Personas(Vec<String>) }
impl SignIn {
    fn label(&self) -> String {
        match self { Self::Guest => "the guest sign-in".into(), Self::Password => "the password sign-in".into(), Self::Personas(names) => format!("a persona picker ({})", names.join(", ")) }
    }
    fn personas(&self) -> Option<&[String]> { match self { Self::Personas(names) => Some(names), _ => None } }
}
fn wanted(own: &OwnSchema) -> Result<SignIn, &'static str> {
    match own.identity {
        Some((_, true)) => Ok(SignIn::Guest),
        Some((true, false)) => Ok(SignIn::Password),
        None if !own.personas.is_empty() => Ok(SignIn::Personas(own.personas.clone())),
        _ => Err("declares neither `use identity` nor `use personas`, so nobody can act: add `use identity` for the guest sign-in or `use personas alice, bob` for development, then rerun `snapback4 init --adapt`"),
    }
}

fn screens(dir: &Path, platform: Platform, own: &OwnSchema, todos: bool, found: &mut Vec<Leftover>, advice: &mut Vec<String>) -> bool {
    let (app_path, client_path) = platform.paths();
    let (Some(app), Some(client)) = (read(dir, app_path), read(dir, client_path)) else { return true };
    // Which starter screen is on disk, if both files are still as init wrote
    // them: its sign-in (guest, or a persona picker) and its body.
    let journal_shape = starter::Offline::Tables { synced: vec![], total: 0 };
    let explicit_online = platform == Platform::Web && client.contains("writes: \"online\"");
    let client_shape = normalized(&client);
    let matches_client = |reference: &str, personas: bool| [reference, starter::previous_client(platform, personas)].iter().any(|reference|
        client_shape == normalized(reference) || client_shape == normalized(&starter::web_client((*reference).to_owned(), &journal_shape)) || client_shape == normalized(&starter::online_web_client((*reference).to_owned())) || client_shape == normalized(&starter::expo_client((*reference).to_owned(), &journal_shape)));
    let current = [Body::Todos, Body::Home(first_read(&app))].into_iter().find_map(|body| [0, 1, 2].into_iter().find_map(|version| {
        let screens = |personas: Option<&[String]>, password| match version { 1 => starter::previous_screens(platform, personas, &body, password), 2 => starter::wave14_screens(platform, personas, &body, password), _ => starter::identity_screens(platform, personas, &body, password) };
        let (guest_app, guest_client) = screens(None, false);
        let (persona_app, persona_client) = screens(Some(&[]), false);
        let (password_app, password_client) = screens(None, true);
        if app == guest_app && matches_client(&guest_client, false) { Some((SignIn::Guest, body.clone())) }
        else if app == password_app && matches_client(&password_client, false) { Some((SignIn::Password, body.clone())) }
        else if app == persona_app && matches_client(&persona_client, true) { Some((SignIn::Personas(personas_of(&client)), body.clone())) }
        else { None }
    }));
    let Some((sign_in, body)) = current else { return false };
    // A Home keeps its read while the schema still declares that query
    // argument-free; a Home without one stays as written (it fits any schema).
    let wanted_body = match &body {
        _ if todos => Body::Todos,
        Body::Home(None) => Body::Home(None),
        Body::Home(Some(op)) if own.reads.contains(op) => body.clone(),
        _ => Body::Home(own.reads.first().cloned()),
    };
    // A sign-in no starter screen fits keeps the one on disk, with advice.
    let wanted_sign_in = match wanted(own) {
        Ok(wanted) => wanted,
        Err(why) => {
            advice.push(format!("{app_path} is the starter's {}, but your snapback/*.q {why}", sign_in.label()));
            sign_in.clone()
        }
    };
    let (app_text, mut client_text) = starter::identity_screens(platform, wanted_sign_in.personas(), &wanted_body, wanted_sign_in == SignIn::Password);
    client_text = if explicit_online { starter::online_web_client(client_text) } else if platform == Platform::Expo { starter::expo_client(client_text, &own.offline) } else { starter::web_client(client_text, &own.offline) };
    let client_changed = client_shape != normalized(&client_text);
    if wanted_sign_in == sign_in && app == app_text && wanted_body == body && !client_changed { return true; }
    let mut reasons = Vec::new();
    let mut client_leftover = None;
    if wanted_sign_in != sign_in {
        let (from, to) = (sign_in.label(), wanted_sign_in.label());
        let because = match &wanted_sign_in { SignIn::Personas(_) => "your snapback/*.q declares `use personas` and no `use identity`", SignIn::Password => "your snapback/*.q declares `use identity password`", SignIn::Guest => "your snapback/*.q admits guests" };
        reasons.push(format!("the unmodified starter screen shows {from}, but {because}; adapt writes {to}"));
        // Keep the backend port init wrote.
        if let Some(port) = port_of(&client) { client_text = client_text.replace("127.0.0.1:4400", &format!("127.0.0.1:{port}")); }
        client_leftover = Some(Leftover { path: client_path, why: format!("the unmodified starter client for {from}; adapt writes {to}"), rewrite: Some(client_text.clone()) });
    }
    if wanted_sign_in == sign_in && client_changed {
        if let Some(port) = port_of(&client) { client_text = client_text.replace("127.0.0.1:4400", &format!("127.0.0.1:{port}")); }
        let why = "the unmodified web client needs the device or principal journal selected by your schema's synced tables".to_owned();
        reasons.push(why.clone());
        client_leftover = Some(Leftover { path: client_path, why, rewrite: Some(client_text.clone()) });
    }
    if wanted_body != body {
        reasons.push(match (&wanted_body, &body) {
            (Body::Home(_), Body::Home(Some(op))) => format!("its Home screen reads api.{op}, which your snapback/*.q no longer declares as a query without required arguments; adapt writes the Home screen again{}", match &wanted_body { Body::Home(Some(next)) => format!(", reading api.{next}"), _ => String::new() }),
            (Body::Home(_), _) => "its Todos screen calls the starter's list/add/toggle/remove, which your snapback/*.q does not declare, so it would not typecheck; adapt writes a Home screen that compiles against any schema (the signed-in viewer, your operations from snapback/generated/api.ts, and your first query without required arguments rendered with matchRead) for you to replace".to_owned(),
            (Body::Todos, _) => "your snapback/*.q declares the todo starter's operations again; adapt writes the Todos screen back".to_owned(),
        });
    }
    let why = reasons.join("; ");
    let why = if why.starts_with("the unmodified") { why } else { format!("the unmodified starter screen: {why}") };
    found.push(Leftover { path: app_path, why, rewrite: Some(app_text) });
    found.extend(client_leftover);
    true
}

/// The `api` path a starter Home's first read calls, if it has one.
fn first_read(app: &str) -> Option<String> {
    let after = app.split_once("function FirstRead()")?.1;
    let op = after.split_once("useQuery(api.")?.1.split_once(',')?.0;
    Some(op.to_owned())
}

fn read(dir: &Path, path: &str) -> Option<String> {
    let path = dir.join(path);
    path.symlink_metadata().ok().filter(|metadata| metadata.is_file())?;
    std::fs::read_to_string(path).ok()
}

/// A starter client without what init or the schema varies: the backend port
/// and the persona list.
fn normalized(client: &str) -> String {
    let lines = client.split_inclusive('\n').map(|line| {
        if line.starts_with(PERSONAS) { format!("{PERSONAS}[];\n") } else { line.to_owned() }
    }).collect::<String>();
    match port_of(&lines) { Some(port) => lines.replace(&format!("127.0.0.1:{port}"), "127.0.0.1:4400"), None => lines }
}

const PERSONAS: &str = "export const personas: readonly string[] = ";

fn personas_of(client: &str) -> Vec<String> {
    client.lines().find_map(|line| line.strip_prefix(PERSONAS))
        .and_then(|list| serde_json::from_str(list.trim_end().trim_end_matches(';')).ok()).unwrap_or_default()
}

fn port_of(client: &str) -> Option<&str> {
    let at = client.find("127.0.0.1:")? + "127.0.0.1:".len();
    let digits = client[at..].find(|c: char| !c.is_ascii_digit()).unwrap_or(client.len() - at);
    (digits > 0).then(|| &client[at..at + digits])
}

fn proof_advice(dir: &Path) -> Vec<String> {
    let mut advice = Vec::new();
    if let Ok(Some(own)) = super::own_schema(dir) {
        match super::proof::plan(dir, &own) {
            Ok(changes) if !changes.is_empty() => {
                let package: serde_json::Value = std::fs::read_to_string(dir.join("package.json")).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
                if package["scripts"]["day2:proof"] == "node scripts/day2-proof.mjs" {
                    advice.push("info: day2:proof passes no saved versions; run `snapback4 init --adapt`, then `snapback4 init --adapt --apply`".into());
                } else { advice.push("info: starter proof infrastructure needs updating; run `snapback4 init --adapt` to preview, then `snapback4 init --adapt --apply`".into()); }
            }
            Err(error) => advice.push(format!("info: cannot inspect starter proof infrastructure: {error}")),
            _ => {}
        }
    }
    advice
}

/// One `check` line, or none: the leftovers and the command that fixes them.
pub(crate) fn report(dir: &Path) -> Option<String> {
    let (found, mut advice) = leftovers(dir);
    advice.extend(proof_advice(dir));
    if found.is_empty() && advice.is_empty() { return None; }
    if found.is_empty() && advice.iter().all(|line| line.starts_with("info:")) { return Some(advice.join("\n")); }
    let mut lines = Vec::new();
    for leftover in &found { lines.push(format!("  {}: {}", leftover.path, leftover.why)); }
    for line in &advice { lines.push(format!("  {line}")); }
    if !found.is_empty() {
        lines.push("  fix: snapback4 init --adapt (removes or rewrites only these files, which still match the starter; your own files are never touched)".into());
    }
    Some(format!("info: starter: {} left from `snapback4 init` that {} not fit your schema\n{}",
        if found.is_empty() { "a screen".to_owned() } else { format!("{} file{}", found.len(), if found.len() == 1 { "" } else { "s" }) },
        if found.len() == 1 || found.is_empty() { "does" } else { "do" }, lines.join("\n")))
}

/// The same, for `check --json`: `null` when nothing is left over.
pub(crate) fn report_json(dir: &Path) -> serde_json::Value {
    let (found, mut advice) = leftovers(dir);
    advice.extend(proof_advice(dir));
    if found.is_empty() && advice.is_empty() { return serde_json::Value::Null; }
    serde_json::json!({
        "files": found.iter().map(|leftover| serde_json::json!({ "path": leftover.path, "why": leftover.why, "adapt": if leftover.rewrite.is_some() { "rewrite" } else { "remove" } })).collect::<Vec<_>>(),
        "advice": advice,
        "fix": if found.is_empty() { serde_json::Value::Null } else { "snapback4 init --adapt".into() },
    })
}

/// `snapback4 init --adapt [dir]`.
pub(super) fn adapt(dir: &Path, dry_run: bool, apply: bool) -> i32 {
    let own = match own_schema(dir) {
        Ok(Some(own)) => own,
        Ok(None) => { eprintln!("init --adapt: no snapback/*.q in {}; nothing to adapt to (run `snapback4 init --web` or `--expo` first)", dir.display()); return 1; }
        Err(error) => { eprintln!("init: {error}"); return 2; }
    };
    let (found, advice, modified) = plan(dir);
    let proof = match super::proof::plan(dir, &own) {
        Ok(proof) => proof,
        Err(error) => { eprintln!("init --adapt proof: {error}"); return 2; }
    };
    if !found.is_empty() || !proof.is_empty() {
        println!("init --adapt: planned changes (only unmodified starter files):");
        for change in &found { println!("  {} {} — {}", if change.rewrite.is_some() { "rewrite" } else { "remove" }, change.path, change.why); }
    }
    for (path, body) in &proof {
        let exists = dir.join(path).exists();
        println!("  {} {} — {} proof infrastructure", if *path == "package.json" { "extend" } else if exists { "replace" } else { "add" }, path, if exists { "inherited" } else { "missing" });
        if *path == "package.json" {
            let old: serde_json::Value = std::fs::read_to_string(dir.join(path)).ok().and_then(|text| serde_json::from_str(&text).ok()).unwrap_or_default();
            let new: serde_json::Value = serde_json::from_str(body).unwrap();
            for (key, value) in new["scripts"].as_object().unwrap() {
                if old["scripts"][key] != *value { println!("    scripts.{key}: {} → {value}", old["scripts"][key]); }
            }
        }
    }
    if !modified.is_empty() { println!("init --adapt: application-owned or modified files stay unchanged: {}", modified.join(", ")); }
    if dry_run || !apply {
        for line in advice { println!("init --adapt: {line}"); }
        if !fits_todos(&own) { println!("init --adapt: no write scenario: replace the Home assertions"); }
        println!("init --adapt: preview only; no files changed. Apply with:");
        println!("snapback4 init{} --adapt --apply", if dir == Path::new(".") { String::new() } else { format!(" '{}'", dir.to_string_lossy().replace('\'', "'\"'\"'")) });
        return 0;
    }
    if let Err(error) = super::proof::apply(dir, &proof) { eprintln!("init --adapt proof: {error}"); return 2; }
    let mut removed = Vec::new();
    let mut rewritten = Vec::new();
    for leftover in &found {
        let path = dir.join(leftover.path);
        let result = match &leftover.rewrite {
            Some(text) => super::replace_file(&path, text).map(|()| rewritten.push(leftover.path)),
            None => std::fs::remove_file(&path).map(|()| removed.push(leftover.path)),
        };
        if let Err(error) = result { eprintln!("init --adapt: {}: {error}", path.display()); return 2; }
    }
    // @ref LLP 3000.011.003.000#7.4 — adapt removes the files it names, never a directory: the next step writes fixtures/<table>.jsonl.
    if found.is_empty() && proof.is_empty() { println!("init --adapt: nothing to adapt — no unmodified starter file conflicts with your snapback/*.q"); }
    if !removed.is_empty() {
        let kept = if removed.iter().any(|path| path.starts_with("fixtures/")) { "; fixtures/ stays for your own rows" } else { "" };
        println!("init --adapt: removed {} (unmodified starter files{kept}; write your own as fixtures/<table>.jsonl and fixtures/test.cases.jsonl, `snapback4 guide testing`)", removed.join(" and "));
    }
    if !rewritten.is_empty() {
        let why = found.iter().find(|leftover| leftover.rewrite.is_some()).map(|leftover| leftover.why.as_str()).unwrap_or_default();
        println!("init --adapt: rewrote {} — {why}", rewritten.join(" and "));
    }
    if found.iter().any(|leftover| leftover.rewrite.as_deref().is_some_and(|text| text.contains("function Home("))) {
        println!("init --adapt: next: `snapback4 check` writes snapback/generated/api.ts for the Home screen; replace Home with your own screens (`snapback4 guide client`)");
    }
    for line in advice { println!("init --adapt: {line}"); }
    0
}

#[test]
fn untouched_wave9_screens_still_adapt_and_edited_clients_stay_owned() {
    for platform in [Platform::Web, Platform::Expo] {
        for password in [false, true] {
            let dir = std::env::temp_dir().join(format!("sb4-w10-adapt-{}-{platform:?}-{password}", std::process::id()));
            std::fs::create_dir_all(dir.join("snapback")).unwrap(); std::fs::create_dir_all(dir.join("src")).unwrap();
            let schema = include_str!("starter/schema.q").replace("use identity ", "use identity password ");
            std::fs::write(dir.join("snapback/schema.q"), schema).unwrap();
            let (app, client) = starter::previous_screens(platform, None, &Body::Todos, password);
            let (app_path, client_path) = platform.paths();
            std::fs::write(dir.join(app_path), &app).unwrap(); std::fs::write(dir.join(client_path), &client).unwrap();
            let (changes, _) = leftovers(&dir);
            assert!(changes.iter().any(|change| change.path == app_path), "{platform:?}, password={password}: previous screens recognized");
            std::fs::write(dir.join(client_path), format!("{client}\n// application-owned edit\n")).unwrap();
            let (changes, _) = leftovers(&dir);
            assert!(!changes.iter().any(|change| change.path == app_path || change.path == client_path), "edited pair stays owned");
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
}


#[test]
fn untouched_wave14_screens_and_smoke_still_adapt() {
    for platform in [Platform::Web, Platform::Expo] {
        let dir = std::env::temp_dir().join(format!("sb4-w14-adapt-{}-{platform:?}", std::process::id()));
        std::fs::create_dir_all(dir.join("snapback")).unwrap();
        std::fs::create_dir_all(dir.join("src")).unwrap();
        let schema = include_str!("starter/schema.q").replace("use identity ", "use identity password ");
        std::fs::write(dir.join("snapback/schema.q"), schema).unwrap();
        let (app, client) = starter::wave14_screens(platform, None, &Body::Todos, false);
        assert!(!app.contains("No tasks yet."));
        let (app_path, client_path) = platform.paths();
        std::fs::write(dir.join(app_path), app).unwrap();
        std::fs::write(dir.join(client_path), &client).unwrap();
        std::fs::write(dir.join("src/native-smoke.ts"), starter::wave14_native_smoke(false)).unwrap();
        let (changes, _) = leftovers(&dir);
        assert!(changes.iter().any(|change| change.path == app_path));
        if platform == Platform::Expo { assert!(changes.iter().any(|change| change.path == "src/native-smoke.ts")); }
        std::fs::write(dir.join(client_path), format!("{client}\n// application-owned edit\n")).unwrap();
        let (changes, _) = leftovers(&dir);
        assert!(!changes.iter().any(|change| change.path == app_path || change.path == client_path));
        std::fs::remove_dir_all(dir).unwrap();
    }
}
