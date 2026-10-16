//! `snapback4 reset`: the CLI mirror of a running dev's `POST /dev/reset`.
//! It only talks to a loopback dev host; it never opens a store itself.
use serde_json::{Value as Json, json};
use std::path::Path;
use std::time::Duration;

fn usage() -> String { format!("usage: {}", crate::cli_flags::synopsis("reset")) }

pub fn command(options: &crate::verbs::Options) -> i32 {
    match run(options) {
        Ok(reply) => { println!("{reply}"); 0 }
        Err(error) => { eprintln!("{error}"); 1 }
    }
}

fn run(options: &crate::verbs::Options) -> Result<Json, String> {
    if options.flags.contains_key("release") { return Err("E_AUTH: reset empties a running dev's store; snapback4 serve never resets a release\n  guide: testing".into()); }
    if !options.positionals.is_empty() { return Err(usage()); }
    let address = crate::verbs::dev_address(options)?;
    let mut body = serde_json::Map::new();
    if let Some(seed) = options.flags.get("seed") { body.insert("seed".into(), Json::Array(rows(Path::new(seed))?)); }
    match options.flags.get("clock").map(String::as_str) {
        None => {}
        Some("reset") => { body.insert("clock".into(), json!("reset")); }
        Some(other) => return Err(format!("E_CLOCK_INPUT: --clock takes `reset` (back to wall time), not {other:?}\n{}", usage())),
    }
    let (status, reply) = crate::verbs::run_forward::exchange(address, "POST", "/dev/reset", None, &Json::Object(body).to_string(), Duration::from_secs(60))
        .map_err(|error| format!("cannot reach a dev at {address}: {error}; start `snapback4 dev` (or pass the --port it printed)"))?;
    if let Some(denied) = reply.get("denied") {
        return Err(format!("{}: {}\n  guide: {}", denied["code"].as_str().unwrap_or("E_INPUT"), denied["message"].as_str().unwrap_or("reset refused; nothing was reset"),
            denied["guide"].as_str().unwrap_or("testing")));
    }
    if status != 200 { return Err(format!("dev answered HTTP {status} to POST /dev/reset: {reply}")); }
    Ok(reply)
}

/// `/seed` rows from a fixture directory (`<table>.jsonl`, one row per line,
/// as `test --fixture` reads it) or a JSON file holding a `/seed` array.
fn rows(path: &Path) -> Result<Vec<Json>, String> {
    if !path.is_dir() {
        let text = std::fs::read_to_string(path).map_err(|error| format!("E_INPUT: cannot read {}: {error}", path.display()))?;
        return match serde_json::from_str(&text) {
            Ok(Json::Array(rows)) => Ok(rows),
            _ => Err(format!("E_INPUT: {} is not a /seed array [{{\"table\": \"t\", \"row\": {{\"id\": ..}}}}, ..]; pass a fixture directory of <table>.jsonl files or a JSON file holding that array", path.display())),
        };
    }
    let mut names: Vec<String> = std::fs::read_dir(path).map_err(|error| format!("E_INPUT: cannot read {}: {error}", path.display()))?
        .filter_map(|entry| entry.ok().map(|entry| entry.file_name().to_string_lossy().into_owned())).collect();
    names.sort();
    let mut rows = Vec::new();
    for name in names {
        let Some(table) = name.strip_suffix(".jsonl") else { continue };
        if name == crate::verbs::CASES_FILE { continue; }
        let file = path.join(&name);
        let text = std::fs::read_to_string(&file).map_err(|error| format!("E_INPUT: cannot read {}: {error}", file.display()))?;
        for (number, line) in text.lines().enumerate().filter(|(_, line)| !line.trim().is_empty()) {
            let row: Json = serde_json::from_str(line).map_err(|error| format!("E_INPUT: {name}:{}: {error}", number + 1))?;
            rows.push(json!({ "table": table, "row": row }));
        }
    }
    Ok(rows)
}
