//! CLI verb adapters. Store-touching verbs attach to the owner over control HTTP.
// @ref LLP 1002#6-verbs-this-wave — every data-plane verb goes through the one owner.

use crate::client;
use crate::owner::{self, DevOptions};
use crate::project::locate_root;
use crate::protocol::Refusal;
use serde_json::{Value as Json, json};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::ExitCode;

pub fn dev(args: &[String]) -> ExitCode {
    let options = match parse_options(
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
        Ok(options) => options,
        Err(code) => return code,
    };
    if options.positionals().len() != 1 {
        return usage(
            "usage: snapback2 dev [--port N] [--foreground] [--stop] [--status] [--apply-migration file] [--serve] [--project dir] [--json]",
        );
    }
    let port = match options.value("--port") {
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
        project: options.value("--project").map(PathBuf::from),
        port,
        foreground: options.has("--foreground"),
        owner_child: options.has("--owner-child"),
        serve: options.has("--serve"),
        stop: options.has("--stop"),
        status: options.has("--status"),
        apply_migration: options.value("--apply-migration").map(PathBuf::from),
        json: options.has("--json"),
    })
}

pub fn run(args: &[String]) -> ExitCode {
    let options = match parse_options(args, &["--project", "--as"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let positional = options.positionals();
    if positional.len() < 2 || positional.len() > 3 {
        return usage("usage: snapback2 run <op> [args-json] --as <persona> [--json]");
    }
    let op = positional[1].to_owned();
    let args_json = if positional.len() == 3 {
        match serde_json::from_str(&positional[2]) {
            Ok(value) => value,
            Err(error) => {
                return refused(
                    Refusal::input(
                        format!("invalid args JSON: {error}"),
                        "pass a JSON object such as '{}'",
                    ),
                    options.has("--json"),
                    2,
                );
            }
        }
    } else {
        json!({})
    };
    let persona = match options.value("--as") {
        Some(persona) => persona,
        None => return usage("usage: snapback2 run <op> [args-json] --as <persona> [--json]"),
    };
    let (root, owner) = match attached(&options) {
        Ok(value) => value,
        Err(error) => return refused(error, options.has("--json"), 1),
    };
    let manifest = match client::api(&owner, "GET", "/api/manifest", &[], json!({})) {
        Ok(response) if response.status < 400 => response.body,
        Ok(response) => {
            return print_response(response.status, response.body, options.has("--json"));
        }
        Err(error) => return refused(error, options.has("--json"), 1),
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
                options.has("--json"),
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
        Ok(response) => print_response(response.status, response.body, options.has("--json")),
        Err(error) => refused(error, options.has("--json"), 1),
    }
}

pub fn data(args: &[String]) -> ExitCode {
    let options = match parse_options(
        args,
        &["--project", "--as", "--index", "--prefix", "--limit"],
        &["--json"],
    ) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let positional = options.positionals();
    if positional.len() != 2 {
        return usage(
            "usage: snapback2 data <table> [--index name --prefix json] [--limit 50] --as <persona> [--json]",
        );
    }
    let persona = match options.value("--as") {
        Some(value) => value,
        None => return usage("usage: snapback2 data <table> --as <persona> [--json]"),
    };
    let prefix = match options.value("--prefix") {
        Some(value) => match serde_json::from_str(value) {
            Ok(value) => value,
            Err(error) => {
                return refused(
                    Refusal::input(format!("invalid prefix JSON: {error}"), "pass a JSON array"),
                    options.has("--json"),
                    2,
                );
            }
        },
        None => json!([]),
    };
    let limit = match data_limit(&options) {
        Ok(value) => value,
        Err(code) => return code,
    };
    control(
        &options,
        "POST",
        "/control/data",
        json!({
            "table": positional[1],
            "index": options.value("--index").unwrap_or("byId"),
            "prefix": prefix,
            "limit": limit,
            "as": persona,
        }),
    )
}

pub fn logs(args: &[String]) -> ExitCode {
    let options = match parse_options(args, &["--project", "--since", "--limit"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    if options.positionals().len() != 1 {
        return usage("usage: snapback2 logs [--since seq] [--limit 100] [--json]");
    }
    let since = match numeric_option(&options, "--since") {
        Ok(value) => value.unwrap_or(0),
        Err(code) => return code,
    };
    let limit = match numeric_option(&options, "--limit") {
        Ok(value) => value.unwrap_or(100).min(500) as usize,
        Err(code) => return code,
    };
    control(
        &options,
        "GET",
        &format!("/control/logs?since={since}&limit={limit}"),
        json!({}),
    )
}

pub fn persona(args: &[String]) -> ExitCode {
    let options = match parse_options(args, &["--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let positional = options.positionals();
    match positional.get(1).copied() {
        Some("list") if positional.len() == 2 => {
            control(&options, "GET", "/control/personas", json!({}))
        }
        Some("create") if positional.len() == 3 => control(
            &options,
            "POST",
            "/control/persona",
            json!({ "name": positional[2] }),
        ),
        _ => usage("usage: snapback2 persona list | create <name> [--json]"),
    }
}

pub fn fork(args: &[String]) -> ExitCode {
    let options = match parse_options(args, &["--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let positional = options.positionals();
    if positional.len() != 2 {
        return usage("usage: snapback2 fork <name> [--json]");
    }
    control(
        &options,
        "POST",
        "/control/fork",
        json!({ "name": positional[1] }),
    )
}

pub fn reset(args: &[String]) -> ExitCode {
    let options = match parse_options(args, &["--project"], &["--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    if options.positionals().len() != 1 {
        return usage("usage: snapback2 reset [--json]");
    }
    control(&options, "POST", "/control/reset", json!({}))
}

fn control(options: &ParsedOptions<'_>, method: &str, path: &str, body: Json) -> ExitCode {
    let (_, owner) = match attached(options) {
        Ok(value) => value,
        Err(error) => return refused(error, options.has("--json"), 1),
    };
    match client::control(&owner, method, path, body) {
        Ok(response) => print_response(response.status, response.body, options.has("--json")),
        Err(error) => refused(error, options.has("--json"), 1),
    }
}

fn attached(options: &ParsedOptions<'_>) -> Result<(PathBuf, owner::OwnerInfo), Refusal> {
    let root = locate_root(options.value("--project").map(Path::new))?;
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

fn numeric_option(options: &ParsedOptions<'_>, name: &str) -> Result<Option<u64>, ExitCode> {
    let Some(value) = options.value(name) else {
        return Ok(None);
    };
    value
        .parse()
        .map(Some)
        .map_err(|_| usage(&format!("invalid numeric value for {name}: {value}")))
}

fn data_limit(options: &ParsedOptions<'_>) -> Result<u64, ExitCode> {
    let Some(value) = options.value("--limit") else {
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
            options.has("--json"),
            2,
        ));
    }
    Ok(parsed.unwrap() as u64)
}

pub(crate) struct ParsedOptions<'a> {
    values: BTreeMap<&'a str, &'a str>,
    booleans: BTreeSet<&'a str>,
    positionals: Vec<&'a str>,
}

impl<'a> ParsedOptions<'a> {
    pub(crate) fn value(&self, name: &str) -> Option<&'a str> {
        self.values.get(name).copied()
    }

    pub(crate) fn has(&self, name: &str) -> bool {
        self.booleans.contains(name)
    }

    pub(crate) fn positionals(&self) -> &[&'a str] {
        &self.positionals
    }
}

pub(crate) fn parse_options<'a>(
    args: &'a [String],
    value_flags: &[&str],
    boolean_flags: &[&str],
) -> Result<ParsedOptions<'a>, ExitCode> {
    let mut values = BTreeMap::new();
    let mut booleans = BTreeSet::new();
    let mut positionals = args
        .first()
        .map(|verb| vec![verb.as_str()])
        .unwrap_or_default();
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
            if values.insert(arg, value.as_str()).is_some() {
                return Err(usage(&format!("{arg} may be passed only once")));
            }
            index += 2;
            continue;
        }
        if boolean_flags.contains(&arg) {
            if !booleans.insert(arg) {
                return Err(usage(&format!("{arg} may be passed only once")));
            }
            index += 1;
            continue;
        }
        if arg.starts_with('-') {
            return Err(usage(&format!("unknown option {arg}")));
        }
        positionals.push(arg);
        index += 1;
    }
    Ok(ParsedOptions {
        values,
        booleans,
        positionals,
    })
}
