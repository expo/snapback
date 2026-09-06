//! `snapback2` — the one small binary and its measured verb table.

// Refusals intentionally retain the complete structured repair envelope at call boundaries.
#![allow(clippy::result_large_err)]

mod asset_gc;
mod asset_http;
mod blob_store;
mod check;
mod client;
mod control;
mod control_run;
mod doctor;
mod effects;
mod guide;
mod image_walk;
mod init;
mod media_helper;
mod owner;
mod project;
mod protocol;
mod receipt;
mod rehearsal;
mod serve;
mod test;
mod trace;
mod verbs;
mod verbs_jobs;
pub mod video_walk;
mod watch;
mod why;
mod writer;
mod writer_util;
mod writer_wire;

#[cfg(test)]
mod video_walk_tests;

use std::path::PathBuf;
use std::process::ExitCode;

pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    // @ref LLP 1002#6-verbs-this-wave — help never locates, compiles, or starts a project.
    if args.is_empty() || matches!(args.first().map(String::as_str), Some("--help" | "-h")) {
        println!("{}", verbs::TOP_HELP);
        return ExitCode::SUCCESS;
    }
    if args
        .iter()
        .skip(1)
        .any(|arg| matches!(arg.as_str(), "--help" | "-h"))
    {
        if let Some(help) = verbs::command_help(&args[0]) {
            println!("{help}");
            return ExitCode::SUCCESS;
        }
    }
    match args.first().map(String::as_str) {
        Some("version") | Some("-V") => {
            let options = match verbs::parse_options(&args, &[], &["--json"]) {
                Ok(options) => options,
                Err(code) => return code,
            };
            if options.positionals().len() != 1 {
                eprintln!("usage: snapback2 version [--json]");
                return ExitCode::from(2);
            }
            println!("snapback2 {VERSION}");
            ExitCode::SUCCESS
        }
        Some("doctor") => {
            let options = match verbs::parse_options(&args, &[], &["--json"]) {
                Ok(options) => options,
                Err(code) => return code,
            };
            if options.positionals().len() != 1 {
                eprintln!("usage: snapback2 doctor [--json]");
                return ExitCode::from(2);
            }
            doctor::run(options.has("--json"))
        }
        Some("check") => run_check(&args),
        Some("dev") => verbs::dev(&args),
        Some("run") => verbs_jobs::run(&args),
        Some("data") => verbs::data(&args),
        Some("logs") => verbs::logs(&args),
        Some("persona") => verbs::persona(&args),
        Some("reset") => verbs::reset(&args),

        // Lane B2 owns these modules and adds only their match arms here:
        // init | test | why | trace | guide
        Some("init") => init::run(&args),
        Some("test") => test::run(&args),
        Some("why") => why::run(&args),
        Some("trace") => trace::run(&args),
        Some("guide") => guide::run(&args),
        _ => {
            eprintln!("unknown command {}\n\n{}", args[0], verbs::TOP_HELP);
            ExitCode::from(2)
        }
    }
}

fn run_check(args: &[String]) -> ExitCode {
    let options = match verbs::parse_options(args, &["--project"], &["--ir", "--json"]) {
        Ok(options) => options,
        Err(code) => return code,
    };
    let json = options.has("--json");
    match parse_check(&options) {
        Ok(CheckTarget::Ir(path)) => check::run(path.as_deref(), json),
        Ok(CheckTarget::Project(explicit)) => {
            if let Some(path) = explicit.as_deref().filter(|path| path.is_file()) {
                eprintln!(
                    "{}\n{} is a file; use --ir for project JSON",
                    check_usage(),
                    path.display()
                );
                return ExitCode::from(2);
            }
            match project::locate_root(explicit.as_deref()) {
                Ok(root) => check::run_project(&root, json),
                Err(error) => owner::print_refusal(error, json, 2),
            }
        }
        Err(message) => {
            eprintln!("{}\n{message}", check_usage());
            ExitCode::from(2)
        }
    }
}

enum CheckTarget {
    Project(Option<PathBuf>),
    Ir(Option<String>),
}

fn parse_check(options: &verbs::ParsedOptions<'_>) -> Result<CheckTarget, String> {
    let project = options.value("--project").map(PathBuf::from);
    let ir = options.has("--ir");
    if ir && project.is_some() {
        return Err("choose exactly one of --project or --ir".to_owned());
    }
    let positionals = options.positionals();
    if ir {
        if positionals.len() > 2 {
            return Err(format!("unexpected check argument {}", positionals[2]));
        }
        Ok(CheckTarget::Ir(
            positionals.get(1).map(|value| (*value).to_owned()),
        ))
    } else {
        if let Some(positional) = positionals.get(1) {
            return Err(format!("unexpected check argument {positional}"));
        }
        Ok(CheckTarget::Project(project))
    }
}

fn check_usage() -> &'static str {
    "usage: snapback2 check [--project <dir>] [--json]\n       snapback2 check --ir [<file>] [--json]"
}
