//! Starter leftovers on the init-first path: `init --web` (or `--expo`) wrote
//! the todo starter, then the project replaced `snapback/schema.q`. The
//! starter's own files that still match the bytes init wrote, but no longer
//! fit the schema, are leftovers: `check` names them and `init --adapt`
//! removes or rewrites them. A file the project changed is never touched.
// @ref LLP 3000.011.003.000#7.2 — leftovers are judged by the starter's original bytes, never by name alone.
use super::starter::{self, Platform};
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

/// What the schema in `dir` leaves of the starter, and the advice that goes
/// with it (a screen the project must adapt by hand). No schema: nothing.
pub(crate) fn leftovers(dir: &Path) -> (Vec<Leftover>, Vec<String>) {
    let Ok(Some(own)) = own_schema(dir) else { return (Vec::new(), Vec::new()) };
    let mut found = Vec::new();
    let mut advice = Vec::new();
    let todos = own.tables.iter().any(|table| table == "todos")
        && STARTER_OPERATIONS.iter().all(|op| own.operations.iter().any(|name| name == op));
    if !todos {
        for (path, text) in starter::FIXTURES {
            if read(dir, path).is_some_and(|current| current == super::without_design_references(text)) {
                let what = if path.ends_with("todos.jsonl") { "rows for the todo starter's `todos` table" } else { "cases for the todo starter's list/add/toggle/remove" };
                found.push(Leftover { path, why: format!("the unmodified {what}; your snapback/*.q has no todos table with those operations, so `snapback4 test` would refuse it"), rewrite: None });
            }
        }
    }
    for platform in [Platform::Web, Platform::Expo] {
        screens(dir, platform, &own, todos, &mut found, &mut advice);
    }
    (found, advice)
}

/// The sign-in a schema admits, as the starter screen it needs: the guest
/// screen (`None`), the persona picker (`Some(personas)`), or no starter
/// screen fits (`Err(advice)`).
fn wanted(own: &OwnSchema) -> Result<Option<Vec<String>>, &'static str> {
    match own.identity {
        Some((_, true)) => Ok(None),
        Some((_, false)) => Err("declares `use identity password`, which has no guests: replace the starter's `auth.guest()` with `auth.signup`/`auth.login` (`snapback4 guide personas`)"),
        None if !own.personas.is_empty() => Ok(Some(own.personas.clone())),
        None => Err("declares neither `use identity` nor `use personas`, so nobody can act: add `use identity` for the guest sign-in or `use personas alice, bob` for development, then rerun `snapback4 init --adapt`"),
    }
}

fn screens(dir: &Path, platform: Platform, own: &OwnSchema, todos: bool, found: &mut Vec<Leftover>, advice: &mut Vec<String>) {
    let (app_path, client_path) = platform.paths();
    let (Some(app), Some(client)) = (read(dir, app_path), read(dir, client_path)) else { return };
    // Which starter pair is on disk, if either file is still as init wrote it.
    let shipped = |personas: Option<&[String]>| starter::screens(platform, personas);
    let (guest_app, guest_client) = shipped(None);
    let (persona_app, persona_client) = shipped(Some(&[]));
    let client_shape = normalized(&client);
    let current = if app == guest_app && client_shape == normalized(&guest_client) { Some(None) }
        else if app == persona_app && client_shape == normalized(&persona_client) { Some(Some(personas_of(&client))) }
        else { None };
    let Some(current) = current else { return };
    let screen = if todos { "" } else { "; its Todos screen still calls the starter's list/add/toggle/remove: replace it with your own screens" };
    match wanted(own) {
        Ok(wanted) if wanted == current => {
            if !todos { advice.push(format!("{app_path} is the starter's screen{screen}")); }
        }
        Ok(wanted) => {
            let (app, mut text) = shipped(wanted.as_deref());
            // Keep the backend port init wrote.
            if let Some(port) = port_of(&client) { text = text.replace("127.0.0.1:4400", &format!("127.0.0.1:{port}")); }
            let (from, to) = match (&current, &wanted) {
                (None, Some(personas)) => ("the guest sign-in".to_owned(), format!("a persona picker ({})", personas.join(", "))),
                (Some(_), None) => ("a persona picker".to_owned(), "the guest sign-in".to_owned()),
                (Some(old), Some(new)) => (format!("a picker for {}", old.join(", ")), format!("one for {}", new.join(", "))),
                (None, None) => unreachable!(),
            };
            let because = if wanted.is_some() { "your snapback/*.q declares `use personas` and no `use identity`" } else { "your snapback/*.q declares `use identity`" };
            found.push(Leftover { path: app_path, why: format!("the unmodified starter screen shows {from}, but {because}; adapt writes {to}{screen}"), rewrite: Some(app) });
            found.push(Leftover { path: client_path, why: format!("the unmodified starter client for {from}; adapt writes {to}"), rewrite: Some(text) });
        }
        Err(why) => advice.push(format!("{app_path} is the starter's {}, but your snapback/*.q {why}{screen}", if current.is_none() { "guest sign-in" } else { "persona picker" })),
    }
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

/// One `check` line, or none: the leftovers and the command that fixes them.
pub(crate) fn report(dir: &Path) -> Option<String> {
    let (found, advice) = leftovers(dir);
    if found.is_empty() && advice.is_empty() { return None; }
    let mut lines = Vec::new();
    for leftover in &found { lines.push(format!("  {}: {}", leftover.path, leftover.why)); }
    for line in &advice { lines.push(format!("  {line}")); }
    if !found.is_empty() {
        lines.push("  fix: snapback4 init --adapt (removes or rewrites only these files, which still match the starter; your own files are never touched)".into());
    }
    Some(format!("starter: {} left from `snapback4 init` that {} not fit your schema\n{}",
        if found.is_empty() { "a screen".to_owned() } else { format!("{} file{}", found.len(), if found.len() == 1 { "" } else { "s" }) },
        if found.len() == 1 || found.is_empty() { "does" } else { "do" }, lines.join("\n")))
}

/// The same, for `check --json`: `null` when nothing is left over.
pub(crate) fn report_json(dir: &Path) -> serde_json::Value {
    let (found, advice) = leftovers(dir);
    if found.is_empty() && advice.is_empty() { return serde_json::Value::Null; }
    serde_json::json!({
        "files": found.iter().map(|leftover| serde_json::json!({ "path": leftover.path, "why": leftover.why, "adapt": if leftover.rewrite.is_some() { "rewrite" } else { "remove" } })).collect::<Vec<_>>(),
        "advice": advice,
        "fix": if found.is_empty() { serde_json::Value::Null } else { "snapback4 init --adapt".into() },
    })
}

/// `snapback4 init --adapt [dir]`.
pub(super) fn adapt(dir: &Path) -> i32 {
    match own_schema(dir) {
        Ok(Some(_)) => {}
        Ok(None) => { eprintln!("init --adapt: no snapback/*.q in {}; nothing to adapt to (run `snapback4 init --web` or `--expo` first)", dir.display()); return 1; }
        Err(error) => { eprintln!("init: {error}"); return 2; }
    }
    let (found, advice) = leftovers(dir);
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
    if found.is_empty() { println!("init --adapt: nothing to adapt — no unmodified starter file conflicts with your snapback/*.q"); }
    if !removed.is_empty() {
        let kept = if removed.iter().any(|path| path.starts_with("fixtures/")) { "; fixtures/ stays for your own rows" } else { "" };
        println!("init --adapt: removed {} (the todo starter's samples{kept}; write your own as fixtures/<table>.jsonl and fixtures/test.cases.jsonl, `snapback4 guide testing`)", removed.join(" and "));
    }
    if !rewritten.is_empty() {
        let why = found.iter().find(|leftover| leftover.rewrite.is_some()).map(|leftover| leftover.why.as_str()).unwrap_or_default();
        println!("init --adapt: rewrote {} — {why}", rewritten.join(" and "));
    }
    for line in advice { println!("init --adapt: {line}"); }
    0
}
