//! `snapback2` — the one small binary and its measured verb table.

// Refusals intentionally retain the complete structured repair envelope at call boundaries.
#![allow(clippy::result_large_err)]

mod check;
mod client;
mod control;
mod doctor;
#[cfg(feature = "effects")]
mod effects;
mod guide;
mod init;
mod owner;
mod project;
mod protocol;
mod receipt;
mod serve;
mod test;
mod trace;
mod verbs;
mod watch;
mod why;
mod writer;
mod writer_util;
mod writer_wire;

use std::path::PathBuf;
use std::process::ExitCode;

pub(crate) const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = verbs::has(&args, "--json");
    match args.first().map(String::as_str) {
        Some("version") | Some("-V") => {
            println!("snapback2 {VERSION}");
            ExitCode::SUCCESS
        }
        Some("doctor") => doctor::run(json),
        Some("check") => run_check(&args, json),
        Some("dev") => verbs::dev(&args),
        Some("run") => verbs::run(&args),
        Some("data") => verbs::data(&args),
        Some("logs") => verbs::logs(&args),
        Some("persona") => verbs::persona(&args),
        Some("fork") => verbs::fork(&args),
        Some("reset") => verbs::reset(&args),

        // Lane B2 owns these modules and adds only their match arms here:
        // init | test | why | trace | guide
        Some("init") => init::run(&args),
        Some("test") => test::run(&args),
        Some("why") => why::run(&args),
        Some("trace") => trace::run(&args),
        Some("guide") => guide::run(&args),
        _ => {
            eprintln!(
                "usage: snapback2 <version | doctor | check | dev | run | test | why | trace | data | logs | persona | fork | reset | guide | init> [options]"
            );
            ExitCode::from(2)
        }
    }
}

fn run_check(args: &[String], json: bool) -> ExitCode {
    match parse_check(args) {
        Ok(CheckTarget::Ir(path)) => check::run(path.as_deref()),
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

fn parse_check(args: &[String]) -> Result<CheckTarget, String> {
    let mut project = None;
    let mut ir = false;
    let mut ir_file = None;
    let mut index = 1;
    while index < args.len() {
        match args[index].as_str() {
            "--json" => {}
            "--project" => {
                if ir || project.is_some() {
                    return Err("choose exactly one of --project or --ir".to_owned());
                }
                let value = args
                    .get(index + 1)
                    .ok_or_else(|| "--project requires a directory value".to_owned())?;
                if value.starts_with("--") {
                    return Err(format!("--project requires a directory, not {value}"));
                }
                project = Some(PathBuf::from(value));
                index += 1;
            }
            "--ir" => {
                if ir || project.is_some() {
                    return Err("choose exactly one of --project or --ir".to_owned());
                }
                ir = true;
            }
            option if option.starts_with("--") => {
                return Err(format!("unknown check option {option}"));
            }
            positional if ir && ir_file.is_none() => ir_file = Some(positional.to_owned()),
            positional => return Err(format!("unexpected check argument {positional}")),
        }
        index += 1;
    }
    if ir {
        Ok(CheckTarget::Ir(ir_file))
    } else {
        Ok(CheckTarget::Project(project))
    }
}

fn check_usage() -> &'static str {
    "usage: snapback2 check [--project <dir>] [--json]\n       snapback2 check --ir [<file>] [--json]"
}
