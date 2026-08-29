//! `snapback2` — the one binary. Verbs land as they exist (LLP 0329.016 §5.11).
//! No argument-parsing crate: the verb table is small and the binary must stay so.

mod check;
mod doctor;

use std::process::ExitCode;

const VERSION: &str = env!("CARGO_PKG_VERSION");

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let json = args.iter().any(|a| a == "--json");
    let positional: Vec<&str> = args.iter().filter(|a| !a.starts_with("--")).map(String::as_str).collect();
    match positional.first().copied() {
        Some("version") | Some("-V") => {
            println!("snapback2 {VERSION}");
            ExitCode::SUCCESS
        }
        Some("doctor") => doctor::run(json),
        Some("check") => check::run(positional.get(1).copied()),
        _ => {
            eprintln!("usage: snapback2 <version | doctor | check [program.json]> [--json]");
            ExitCode::from(2)
        }
    }
}
