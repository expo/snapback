//! CLI verb adapters. Store-touching verbs attach to the owner over control HTTP.
// @ref LLP 1002#6-verbs-this-wave — every data-plane verb goes through the one owner.

use crate::client;
use crate::owner::{self, DevOptions};
use crate::project::locate_root;
use crate::protocol::Refusal;
use serde_json::{Value as Json, json};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub fn dev(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(
        args,
        &["--port", "--project", "--apply-migration"],
        &[
            "--foreground",
            "--owner-child",
            "--serve",
            "--stop",
            "--status",
            "--json",
        ],
    ) {
        return code;
    }
    if positionals(args, &["--port", "--project", "--apply-migration"]).len() != 1 {
        return usage(
            "usage: snapback2 dev [--port N] [--foreground] [--stop] [--status] [--apply-migration file] [--serve] [--project dir] [--json]",
        );
    }
    let port = match flag(args, "--port") {
        Some(value) => match value.parse() {
            Ok(port) => port,
            Err(_) => {
                return usage(
                    "usage: snapback2 dev [--port N] [--foreground] [--stop] [--status] [--apply-migration file] [--serve] [--project dir] [--json]",
                );
            }
        },
        None => 0,
    };
    owner::run(DevOptions {
        project: flag(args, "--project").map(PathBuf::from),
        port,
        foreground: has(args, "--foreground"),
        owner_child: has(args, "--owner-child"),
        serve: has(args, "--serve"),
        stop: has(args, "--stop"),
        status: has(args, "--status"),
        apply_migration: flag(args, "--apply-migration").map(PathBuf::from),
        json: has(args, "--json"),
    })
}

pub fn run(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(args, &["--project", "--as"], &["--json"]) {
        return code;
    }
    let positional = positionals(args, &["--project", "--as"]);
    if positional.len() < 2 || positional.len() > 3 {
        return usage("usage: snapback2 run <op> [args-json] --as <persona> [--json]");
    }
    let op = positional[1].clone();
    let args_json = if positional.len() == 3 {
        match serde_json::from_str(&positional[2]) {
            Ok(value) => value,
            Err(error) => {
                return refused(
                    Refusal::input(
                        format!("invalid args JSON: {error}"),
                        "pass a JSON object such as '{}'",
                    ),
                    has(args, "--json"),
                    2,
                );
            }
        }
    } else {
        json!({})
    };
    let persona = match flag(args, "--as") {
        Some(persona) => persona,
        None => return usage("usage: snapback2 run <op> [args-json] --as <persona> [--json]"),
    };
    let (root, owner) = match attached(args) {
        Ok(value) => value,
        Err(error) => return refused(error, has(args, "--json"), 1),
    };
    let manifest = match client::api(&owner, "GET", "/api/manifest", &[], json!({})) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => return print_response(response.status, response.body, has(args, "--json")),
        Err(error) => return refused(error, has(args, "--json"), 1),
    };
    let kind = manifest
        .get("ops")
        .and_then(|ops| ops.get(&op))
        .and_then(|op| op.get("kind"))
        .and_then(Json::as_str);
    let path = match kind {
        Some("query") => "/api/query",
        Some("mutation") => "/api/mutation",
        _ => {
            return refused(
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown operation {op}"),
                    "use an operation listed by /api/manifest",
                    "op/manifest",
                ),
                has(args, "--json"),
                1,
            );
        }
    };
    let _ = root;
    match client::api(
        &owner,
        "POST",
        path,
        &[("X-Snapback-As", persona)],
        json!({ "op": op, "args": args_json }),
    ) {
        Ok(response) => print_response(response.status, response.body, has(args, "--json")),
        Err(error) => refused(error, has(args, "--json"), 1),
    }
}

pub fn data(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(
        args,
        &["--project", "--as", "--index", "--prefix", "--limit"],
        &["--json"],
    ) {
        return code;
    }
    let positional = positionals(
        args,
        &["--project", "--as", "--index", "--prefix", "--limit"],
    );
    if positional.len() != 2 {
        return usage(
            "usage: snapback2 data <table> [--index name --prefix json] [--limit 50] --as <persona> [--json]",
        );
    }
    let persona = match flag(args, "--as") {
        Some(value) => value,
        None => return usage("usage: snapback2 data <table> --as <persona> [--json]"),
    };
    let prefix = match flag(args, "--prefix") {
        Some(value) => match serde_json::from_str(value) {
            Ok(value) => value,
            Err(error) => {
                return refused(
                    Refusal::input(format!("invalid prefix JSON: {error}"), "pass a JSON array"),
                    has(args, "--json"),
                    2,
                );
            }
        },
        None => json!([]),
    };
    let limit = match data_limit(args) {
        Ok(value) => value,
        Err(code) => return code,
    };
    control(
        args,
        "POST",
        "/control/data",
        json!({
            "table": positional[1],
            "index": flag(args, "--index").unwrap_or("byId"),
            "prefix": prefix,
            "limit": limit,
            "as": persona,
        }),
    )
}

pub fn logs(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(args, &["--project", "--since", "--limit"], &["--json"]) {
        return code;
    }
    if positionals(args, &["--project", "--since", "--limit"]).len() != 1 {
        return usage("usage: snapback2 logs [--since seq] [--limit 100] [--json]");
    }
    let since = match numeric_flag(args, "--since") {
        Ok(value) => value.unwrap_or(0),
        Err(code) => return code,
    };
    let limit = match numeric_flag(args, "--limit") {
        Ok(value) => value.unwrap_or(100).min(500) as usize,
        Err(code) => return code,
    };
    control(
        args,
        "GET",
        &format!("/control/logs?since={since}&limit={limit}"),
        json!({}),
    )
}

pub fn persona(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(args, &["--project"], &["--json"]) {
        return code;
    }
    let positional = positionals(args, &["--project"]);
    match positional.get(1).map(String::as_str) {
        Some("list") if positional.len() == 2 => {
            control(args, "GET", "/control/personas", json!({}))
        }
        Some("create") if positional.len() == 3 => control(
            args,
            "POST",
            "/control/persona",
            json!({ "name": positional[2] }),
        ),
        _ => usage("usage: snapback2 persona list | create <name> [--json]"),
    }
}

pub fn fork(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(args, &["--project"], &["--json"]) {
        return code;
    }
    let positional = positionals(args, &["--project"]);
    if positional.len() != 2 {
        return usage("usage: snapback2 fork <name> [--json]");
    }
    control(
        args,
        "POST",
        "/control/fork",
        json!({ "name": positional[1] }),
    )
}

pub fn reset(args: &[String]) -> ExitCode {
    if let Err(code) = validate_options(args, &["--project"], &["--json"]) {
        return code;
    }
    if positionals(args, &["--project"]).len() != 1 {
        return usage("usage: snapback2 reset [--json]");
    }
    control(args, "POST", "/control/reset", json!({}))
}

fn control(args: &[String], method: &str, path: &str, body: Json) -> ExitCode {
    let (_, owner) = match attached(args) {
        Ok(value) => value,
        Err(error) => return refused(error, has(args, "--json"), 1),
    };
    match client::control(&owner, method, path, body) {
        Ok(response) => print_response(response.status, response.body, has(args, "--json")),
        Err(error) => refused(error, has(args, "--json"), 1),
    }
}

fn attached(args: &[String]) -> Result<(PathBuf, owner::OwnerInfo), Refusal> {
    let root = locate_root(flag(args, "--project").map(Path::new))?;
    let owner = owner::require_owner(&root)?;
    Ok((root, owner))
}

fn print_response(status: u16, body: Json, json_output: bool) -> ExitCode {
    if json_output {
        println!("{}", serde_json::to_string(&body).unwrap_or_default());
    } else {
        println!(
            "{}",
            serde_json::to_string_pretty(&body).unwrap_or_default()
        );
    }
    if status < 400 {
        ExitCode::SUCCESS
    } else {
        ExitCode::from(1)
    }
}

fn refused(error: Refusal, json_output: bool, code: u8) -> ExitCode {
    owner::print_refusal(error, json_output, code)
}

fn usage(message: &str) -> ExitCode {
    eprintln!("{message}");
    ExitCode::from(2)
}

fn numeric_flag(args: &[String], name: &str) -> Result<Option<u64>, ExitCode> {
    let Some(index) = args.iter().position(|arg| arg == name) else {
        return Ok(None);
    };
    let Some(value) = args.get(index + 1) else {
        return Err(usage(&format!("{name} requires a numeric value")));
    };
    if value.starts_with("--") {
        return Err(usage(&format!(
            "{name} requires a numeric value, not {value}"
        )));
    }
    value
        .parse()
        .map(Some)
        .map_err(|_| usage(&format!("invalid numeric value for {name}: {value}")))
}

fn data_limit(args: &[String]) -> Result<u64, ExitCode> {
    let Some(value) = flag(args, "--limit") else {
        return Ok(50);
    };
    let parsed = value.parse::<i128>();
    if !matches!(parsed, Ok(1..=500)) {
        return Err(refused(
            Refusal::new(
                "E_ARGS_LIMIT",
                "args",
                format!("data limit must be between 1 and 500, got {value}"),
                "pass --limit 1..500",
                "args/data-limit",
            ),
            has(args, "--json"),
            2,
        ));
    }
    Ok(parsed.unwrap() as u64)
}

pub(crate) fn validate_options(
    args: &[String],
    value_flags: &[&str],
    boolean_flags: &[&str],
) -> Result<(), ExitCode> {
    let mut index = 1;
    while index < args.len() {
        let arg = args[index].as_str();
        if value_flags.contains(&arg) {
            let Some(value) = args.get(index + 1) else {
                return Err(usage(&format!("{arg} requires a value")));
            };
            if value.starts_with("--") {
                return Err(usage(&format!("{arg} requires a value, not {value}")));
            }
            index += 2;
            continue;
        }
        if boolean_flags.contains(&arg) || !arg.starts_with('-') {
            index += 1;
            continue;
        }
        return Err(usage(&format!("unknown option {arg}")));
    }
    Ok(())
}

pub fn flag<'a>(args: &'a [String], name: &str) -> Option<&'a str> {
    args.windows(2)
        .find(|pair| pair[0] == name)
        .map(|pair| pair[1].as_str())
        .filter(|value| !value.starts_with("--"))
}

pub fn has(args: &[String], name: &str) -> bool {
    args.iter().any(|arg| arg == name)
}

fn positionals(args: &[String], value_flags: &[&str]) -> Vec<String> {
    let mut output = Vec::new();
    let mut skip = false;
    for arg in args {
        if skip {
            skip = false;
            continue;
        }
        if value_flags.contains(&arg.as_str()) {
            skip = true;
        } else if !arg.starts_with("--") {
            output.push(arg.clone());
        }
    }
    output
}
