//! `snapback2` — the one small binary and its measured verb table.

// Refusals intentionally retain the complete structured repair envelope at call boundaries.
#![allow(clippy::result_large_err)]

mod check;
mod client;
mod control;
mod doctor;
#[cfg(feature = "effects")]
mod effects;
mod owner;
mod project;
mod protocol;
mod serve;
mod verbs;
mod watch;
mod writer;
mod writer_util;
mod writer_wire;

use std::io::{IsTerminal, Read};
use std::path::Path;
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
        _ => {
            eprintln!(
                "usage: snapback2 <version | doctor | check | dev | run | data | logs | persona | fork | reset> [options]"
            );
            ExitCode::from(2)
        }
    }
}

fn run_check(args: &[String], json: bool) -> ExitCode {
    if verbs::has(args, "--ir") {
        return check::run(verbs::flag(args, "--ir"));
    }
    if !std::io::stdin().is_terminal() {
        let mut input = String::new();
        if let Err(error) = std::io::stdin().read_to_string(&mut input) {
            return owner::print_refusal(
                protocol::Refusal::input(
                    format!("cannot read check input: {error}"),
                    "pipe project IR on stdin or run check in a project",
                ),
                json,
                2,
            );
        }
        if !input.trim().is_empty() {
            return check::run_input(input);
        }
    }
    let explicit = verbs::flag(args, "--project").map(Path::new);
    if let Some(path) = explicit.filter(|path| path.is_file()) {
        eprintln!(
            "usage: snapback2 check [--project dir] [--ir project.json] [--json]\n{} is a file; use --ir for project JSON",
            path.display()
        );
        return ExitCode::from(2);
    }
    match project::locate_root(explicit) {
        Ok(root) => check::run_project(&root, json),
        Err(error) => owner::print_refusal(error, json, 2),
    }
}
