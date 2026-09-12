//! The Snapback 4 binary (LLP 3000 §5, week 2): one small program with the
//! loop verbs. `check` compiles the schema in milliseconds and writes the
//! client's types; `dev` serves it and re-adopts it on every save; `run`,
//! `test`, `why`, `guide`, `doctor`, `data` and `init` do what they say.

mod guide;
mod project;
mod serve;
mod verbs;

use std::process::ExitCode;

const HELP: &str = "snapback4 — the scale-to-zero backend with a partition on every device

  init [dir]                       start a project: snapback/schema.q
  check [--cost] [--json]          compile snapback/*.q; write snapback/generated/api.ts
  dev [--port N] [--no-watch]      serve on 127.0.0.1:4400 and re-adopt on every save
  run <op> [json] --as <persona>   run one operation against the local store
  test [--fixture dir] [--as p]    load a fixture, run every query, print the meters
  why <E_CODE | op | table>        explain a refusal, an operation's cost, or a table's rules
  guide [keyword]                  the grammar, or one card: rules, sync, writes, reads, ...
  data <table> [--limit N]         print rows
  doctor                           say what is and is not in place
  --version";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verb = args.first().map(String::as_str).unwrap_or("");
    if args.iter().any(|a| a == "--help" || a == "-h") || verb.is_empty() {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    let options = verbs::parse(&args);
    let code = match verb {
        "--version" | "-V" | "version" => {
            println!("snapback4 {}", env!("CARGO_PKG_VERSION"));
            0
        }
        "init" => verbs::init(&options),
        "check" => verbs::check(&options),
        "types" => verbs::types(&options),
        "run" => verbs::run(&options),
        "test" => verbs::test(&options),
        "why" => verbs::why(&options),
        "data" => verbs::data(&options),
        "doctor" => verbs::doctor(&options),
        "guide" => {
            match options.positionals.first().map(String::as_str) {
                None | Some("grammar") | Some("quarry") => println!("{}", guide::GRAMMAR),
                Some(keyword) => match guide::card(keyword) {
                    Some(card) => println!("{card}"),
                    None => match guide::explain_code(keyword) {
                        Some(text) => println!("{text}"),
                        None => {
                            eprintln!("no card for {keyword}; cards: rules, sync, writes, reads, shapes, bounds, types, personas, refusals, programs");
                            return ExitCode::from(1);
                        }
                    },
                },
            }
            0
        }
        "dev" => {
            let Some(project) = std::env::current_dir().ok().and_then(|dir| project::Project::locate(&dir)) else {
                eprintln!("no snapback/schema.q here or above; run `snapback4 init` to start one");
                return ExitCode::from(2);
            };
            let port: u16 = options.flags.get("port").and_then(|p| p.parse().ok()).unwrap_or(4400);
            match serve::serve(project, port, !options.flags.contains_key("no-watch")) {
                Ok(()) => 0,
                Err(error) => {
                    eprintln!("dev: {error}");
                    1
                }
            }
        }
        other => {
            eprintln!("unknown verb {other}\n{HELP}");
            2
        }
    };
    ExitCode::from(code as u8)
}

#[cfg(test)]
mod tests {
    #[test]
    fn version_is_the_workspace_version() {
        assert_eq!(env!("CARGO_PKG_VERSION"), "0.0.1");
    }
}
