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

pub(crate) const TOP_HELP: &str = "usage: snapback2 <command> [options]

  init [dir]         Create or adopt a project (defaults: todos, React)
  check              Validate sources and refresh the build cache
  dev                Start or attach to the owner; watch and install successors
  run <op> [json]     Execute an operation with --as <persona|system>
  test               Prove derived checks and authored journeys
  why <query> [json]  Explain a query with --as <persona|system>
  trace <latest|id>   Inspect a commit, job, or timer
  data <table>       Page through rows with --as <persona|system>
  logs               Read the owner's logs
  persona list       List development personas
  reset              Clear application data and reapply the seed
  guide [topic]      Read grammar, recipes, symbols, or refusal recovery
  doctor             Check the installed toolchain
  version            Print the version

Use snapback2 <command> --help (or -h) for options and examples.
Start here: snapback2 guide init";

pub(crate) fn command_help(command: &str) -> Option<&'static str> {
    Some(match command {
        "init" => {
            "usage: snapback2 init [dir] [--template todos|chat] [--client react|expo|none] [--json]

Add the selected template, preserve authored files, and run check.
Defaults: current directory, todos template, React client. Expo requires chat.

  snapback2 init my-app --template chat --client react
  cd my-app
  npm install
  snapback_url=$(npx snapback2 dev) && VITE_SNAPBACK_URL=\"${snapback_url#SNAPBACK_URL=}\" npm run dev

This starts or attaches to the owner, then starts Vite with its actual URL.
For an already-running owner, set VITE_SNAPBACK_URL to its printed URL before
npm run dev. The owner chooses a free port; do not assume port 3210.
Backends live in snapback/*.q; read snapback2 guide quarry next."
        }
        "dev" => {
            "usage: snapback2 dev [--project dir] [--port N] [--foreground] [--serve] [--json]
       snapback2 dev [--project dir] --status [--json]
       snapback2 dev [--project dir] --stop [--json]
       snapback2 dev [--project dir] --apply-migration file [--json]

Start or attach to the one owner and print SNAPBACK_URL. By default it detaches;
--foreground stays attached. --serve refuses development persona headers.
The owner watches sources and installs valid successors. A refused successor
keeps the previous generation serving even when snapback2 check passes.
--status shows the active generation and any pending refusal.

For E_SUCCESSOR_DESTRUCTIVE, keep the owner running and inspect its migrationFile
from snapback2 dev --status --json. Review the plan, then run its applyCommand.
Relative --apply-migration paths resolve from your working directory, even with
--project. Read snapback2 guide E_SUCCESSOR_DESTRUCTIVE for the full sequence."
        }
        "check" => {
            "usage: snapback2 check [--project dir] [--json]
       snapback2 check --ir [file] [--json]

Compile, certify, and refresh .snapback/build, including api.d.ts.
check validates sources; it does not install them in the running owner.
Use snapback2 dev --status to see the active generation and successor refusals.
--ir validates project JSON from a file or stdin instead of authored sources."
        }
        "run" => {
            "usage: snapback2 run <op> [args-json] --as <persona|system> [--project dir] [--json]
       snapback2 run <job> [args-json] --as system [--plan|--wait|--dry-run]
       snapback2 run --file path.q [args-json] --as system [--plan|--wait|--dry-run]
       snapback2 run --cancel|--resume job_id --as system

Execute through the owner. --plan inspects; --wait streams chunk receipts;
--dry-run rehearses on a discarded snapshot. Read snapback2 guide job."
        }
        "test" => {
            "usage: snapback2 test [--project dir] [--blocked reason] [--journeys-only|--derived-only|--journey name] [--json]\n\nProve the project and write a receipt. --journey selects an exact authored name,\nruns every matching registration, and records scope.journey. Registration drift\nfails before a focused body runs. Use --journey=--help for a literal option name.\nIt does not infer affected coverage. Use plain test for the full suite. Read snapback2 guide testing."
        }
        "why" => {
            "usage: snapback2 why <query> [args-json] --as <persona|system> [--project dir] [--json]\n\nExplain query rows, rules, and bounds through the owner."
        }
        "trace" => {
            "usage: snapback2 trace <seq|latest|job_id|timer:id> [--project dir] [--json]\n\nInspect commit delivery, job progress, or a timer."
        }
        "data" => {
            "usage: snapback2 data <table> --as <persona|system> [--index name] [--prefix json] [--after token] [--limit 50] [--project dir] [--json]\n\nRead a bounded, rule-checked page. The maximum limit is 500."
        }
        "logs" => {
            "usage: snapback2 logs [--since seq] [--limit 100] [--project dir] [--json]\n\nRead structured owner logs and commits."
        }
        "persona" => {
            "usage: snapback2 persona list [--project dir] [--json]\n\nList development personas. First use creates a persona; read snapback2 guide personas."
        }
        "reset" => {
            "usage: snapback2 reset [--project dir] [--json]\n\nClear application data and jobs, then reapply the seed through the owner."
        }
        "guide" => {
            "usage: snapback2 guide [grammar|init|dev|check|app|<keyword>|<symbol>|<E_CODE>|<recipe>] [--project dir] [--json]\n\nRead installed help; app reads the checked build cache. Default: grammar."
        }
        "doctor" => {
            "usage: snapback2 doctor [--json]\n\nCheck the compiler, engine, and owner when present."
        }
        "version" | "-V" => {
            "usage: snapback2 version [--json]\n       snapback2 -V\n\nPrint the installed version."
        }
        _ => return None,
    })
}

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

pub fn data(args: &[String]) -> ExitCode {
    let options = match parse_options(
        args,
        &[
            "--project",
            "--as",
            "--index",
            "--prefix",
            "--after",
            "--limit",
        ],
        &["--json"],
    ) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let positional = options.positionals();
    if positional.len() != 2 {
        return usage(
            "usage: snapback2 data <table> [--index name --prefix json] [--after token] [--limit 50] --as <persona> [--json]",
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
            "after": options.value("--after"),
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
        _ => usage("usage: snapback2 persona list [--json]"),
    }
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

pub(crate) fn attached(
    options: &ParsedOptions<'_>,
) -> Result<(PathBuf, owner::OwnerInfo), Refusal> {
    let root = locate_root(options.value("--project").map(Path::new))?;
    let owner = owner::require_owner(&root)?;
    Ok((root, owner))
}

pub(crate) fn print_response(status: u16, body: Json, json_output: bool) -> ExitCode {
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

pub(crate) fn refused(error: Refusal, json_output: bool, code: u8) -> ExitCode {
    owner::print_refusal(error, json_output, code)
}

pub(crate) fn usage(message: &str) -> ExitCode {
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

pub(crate) fn help_requested(args: &[String], value_flags: &[&str]) -> bool {
    let mut index = 1;
    while let Some(arg) = args.get(index) {
        if value_flags.contains(&arg.as_str()) {
            index += 2;
        } else if matches!(arg.as_str(), "--help" | "-h") {
            return true;
        } else {
            index += 1;
        }
    }
    false
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
        if let Some((flag, value)) = arg.split_once('=')
            && value_flags.contains(&flag)
        {
            if values.insert(flag, value).is_some() {
                return Err(usage(&format!("{flag} may be passed only once")));
            }
            index += 1;
            continue;
        }
        if value_flags.contains(&arg) {
            let Some(value) = args.get(index + 1) else {
                return Err(usage(&format!("{arg} requires a value")));
            };
            if value.starts_with("--") {
                return Err(usage(&format!(
                    "{arg} requires a value, not {value}; use {arg}={value} for a literal value"
                )));
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

#[cfg(test)]
mod tests {
    use super::*;

    fn args(values: &[&str]) -> Vec<String> {
        values.iter().map(|v| (*v).to_owned()).collect()
    }

    #[test]
    fn literal_values_preserve_bytes_and_normal_option_refusals() {
        for value in ["--help", "-h", "--list", "name=part", "", "two words"] {
            let argv = args(&["test", &format!("--journey={value}"), "--json"]);
            let options = parse_options(&argv, crate::test::VALUE_FLAGS, &["--json"]).unwrap();
            assert_eq!(options.value("--journey"), Some(value));
            assert!(options.has("--json"));
            assert_eq!(options.positionals(), &["test"]);
        }
        for values in [
            vec!["test", "--journey=a", "--journey", "b"],
            vec!["test", "--journey", "a", "--journey=b"],
            vec!["test", "--json=true"],
            vec!["test", "--unknown=value"],
            vec!["test", "--journey", "--help"],
        ] {
            assert_eq!(
                parse_options(&args(&values), crate::test::VALUE_FLAGS, &["--json"]).err(),
                Some(ExitCode::from(2))
            );
        }
    }

    #[test]
    fn help_detection_reserves_literal_values_only_for_journey() {
        for values in [
            vec!["test", "--journey", "-h"],
            vec!["test", "--journey=--help"],
        ] {
            assert!(
                !help_requested(&args(&values), &["--journey"]),
                "{values:?}"
            );
        }
        for values in [
            vec!["test", "--help"],
            vec!["test", "-h"],
            vec!["test", "--journey=-h", "--help"],
            vec!["test", "--journey", "-h", "--help"],
            vec!["test", "--unknown", "--help"],
            vec!["test", "--project", "-h", "--journey=-h"],
            vec!["test", "--project", "--help"],
            vec!["test", "--blocked", "-h"],
            vec!["test", "--blocked", "--help"],
        ] {
            assert!(help_requested(&args(&values), &["--journey"]), "{values:?}");
        }
    }
}
