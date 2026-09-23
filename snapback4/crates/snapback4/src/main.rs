//! The Snapback 4 binary (LLP 3000 §5, week 2): one small program with the
//! loop verbs. `check` compiles the schema in milliseconds and writes the
//! client's types; `dev` serves it and re-adopts it on every save; `run`,
//! `test`, `why`, `guide`, `doctor`, `data` and `init` do what they say.

mod assets;
mod auth;
mod native;
mod project;
mod serve;
mod dev_worker;
mod dev_replay;
mod dev_clock;
mod lifecycle;
mod verbs;
mod timeline_cost;
mod sync_wire;

use snapback4_lang::guide;
use std::process::ExitCode;

const HELP: &str = "snapback4 — the scale-to-zero backend with a partition on every device

  init [dir] [--online|--expo|--web]  start a project
  check [--cost|--residency|--fix|--json|--verbose] [--store path] [--fixture dir --as p]  compile snapback/*.q; check store adoption; write types; build native jobs; --verbose includes redundant cascades
  types                            compile and write snapback/generated/api.ts
  dev [--port N] [--bind IP] [--no-watch] [--fresh|--memory] [--replay] [--hold-effects] [--hold-schedules] [--clock-offset +25h]
                                      --replay: suppress new effects and hold schedules; --hold-effects: pause claims, keep effects for later; serve on 127.0.0.1:4400, re-adopting on every save; --fresh/--memory: a store in memory that dies with this process
  deploy <dir> [--allow-destructive]  a release: the compiled backend into <dir>/releases/N, current → N
  rollback <dir>                   current → the previous release
  serve <dir> [--port N] [--bind IP] [--worker <path>]  serve HTTP on 127.0.0.1:4400 behind a TLS proxy; tokens only
    --i-understand-cleartext         required for a non-loopback bind; see README proxy contract
  run <op> [json] --as <persona|principal-id> [--now <milliseconds|+duration>]   run one operation against the local store (a job runs whole, as the system)
  clock advance <duration> [--port N]  advance a running dev clock, sweep expiry and run due jobs
  test [--fixture dir] [--as p] [--residency [--verbose]]    load a fixture, run every query, print the meters; --residency: acquisition report only; add --verbose to run queries and print meters
  why <E_CODE | op | table | id>   explain a refusal or note with its card section, an operation's cost, a table's rules, or work by id; --release <dir>, --values
  guide [keyword]                  list cards and aliases, or print one card
  data <table> [--limit N]         inspect stored rows as an administrator (bypasses read rules)
  sql <SELECT> [--release dir] [--limit N] [--json]  read-only inspection of your store (not rule-filtered)
  token --service <name> [--days N] [--release <dir>]  a bearer token for a service principal (a worker's seat), printed once
  doctor                           say what is and is not in place
  witness ios --bundle-id ID --segment NAME --artifacts DIR [--udid ID] [--port N] [--prime] [--relaunch] [--timeout 120]
                                      record an installed iOS app cold-offline, then reconnect its owned backend
  device <store.sqlite> [backend.json]  the native module over stdin/stdout: one JSON request per line, one answer per line
  --version";

fn main() -> ExitCode {
    // Keep this first: lifecycle tests distinguish a pre-main process-launch
    // stall from a server that reached its own bounded readiness window.
    if std::env::var_os("SNAPBACK4_TEST_MAIN_REACHED").is_some() {
        eprintln!("SNAPBACK4_TEST_MAIN_REACHED");
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verb = args.first().map(String::as_str).unwrap_or("");
    if args.iter().any(|a| a == "--help" || a == "-h") || verb.is_empty() {
        println!("{HELP}");
        return ExitCode::SUCCESS;
    }
    let options = verbs::parse(&args);
    if options.flags.contains_key("replay") && (verb != "dev" || options.flags.contains_key("release")) {
        eprintln!("{}", dev_replay::dev_only());
        return ExitCode::from(1);
    }
    if (verb == "serve" || options.flags.contains_key("release")) && (verb == "clock" || options.flags.contains_key("clock-offset") || options.flags.contains_key("now")) {
        eprintln!("{}", dev_clock::release());
        return ExitCode::from(1);
    }
    let code = match verb {
        "--version" | "-V" | "version" => {
            println!("snapback4 {}", env!("CARGO_PKG_VERSION"));
            0
        }
        "init" => verbs::init(&options),
        "deploy" => verbs::deploy(&options),
        "rollback" => verbs::rollback(&options),
        "serve" => lifecycle::run("serve", || verbs::serve_release(&options)),
        "check" => verbs::check(&options),
        "types" => verbs::types(&options),
        "run" => verbs::run(&options),
        "clock" => dev_clock::command(&options),
        "test" => verbs::test(&options),
        "why" => verbs::why(&options),
        "data" => verbs::data(&options),
        "sql" => verbs::sql(&options),
        "token" => verbs::token(&options),
        "doctor" => verbs::doctor(&options),
        "witness" => verbs::witness::run(&args[1..]),
        "device" => verbs::device(&options),
        "guide" => {
            match options.positionals.first().map(String::as_str) {
                None => println!("{}", guide::listing()),
                Some(keyword) => match guide::card(keyword) {
                    Some(card) => println!("{card}"),
                    None => match guide::explain_code(keyword) {
                        Some(text) => println!("{text}"),
                        None => {
                            println!("no card named {keyword}; nearest: {}\n{}", guide::nearest(keyword).join(", "), guide::listing());
                            return ExitCode::from(1);
                        }
                    },
                },
            }
            0
        }
        "dev" => lifecycle::run("dev", || {
            if options.flags.contains_key("worker") {
                return Err("dev does not accept --worker; put the entry at snapback/worker.ts, .mts or .mjs, or use serve --worker <path>".into());
            }
            let Some(project) = std::env::current_dir().ok().and_then(|dir| project::Project::locate(&dir)) else {
                return Err("no snapback/schema.q here or above; run `snapback4 init` to start one".into());
            };
            let clock_offset = options.flags.get("clock-offset").map(|text| dev_clock::offset(text)).transpose().map_err(|e| e.to_string())?.unwrap_or(0);
            let port: u16 = options.flags.get("port").and_then(|p| p.parse().ok()).unwrap_or(4400);
            let bind = development_bind(&options)?;
            serve::serve(project, port, serve::Mode::Dev { verbose: options.flags.contains_key("verbose"), watch: !options.flags.contains_key("no-watch"), fresh: options.flags.contains_key("fresh") || options.flags.contains_key("memory"), replay: options.flags.contains_key("replay"), hold_effects: options.flags.contains_key("hold-effects"), hold_schedules: options.flags.contains_key("hold-schedules"), clock_offset }, &bind.to_string())
        }),
        other => {
            eprintln!("unknown verb {other}\n{HELP}");
            2
        }
    };
    ExitCode::from(code as u8)
}

fn development_bind(options: &verbs::Options) -> Result<std::net::IpAddr, String> {
    let address = verbs::release_bind(options)?;
    if !address.is_loopback() && !address.is_unspecified() {
        return Err("dev --bind needs a loopback or wildcard IP (0.0.0.0 or ::): its worker and development doors still connect through loopback".into());
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    #[test]
    fn development_binding_preserves_a_loopback_path_for_the_supervised_worker() {
        let parse = |args: &[&str]| super::verbs::parse(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        assert!(super::development_bind(&parse(&["dev"])).unwrap().is_loopback());
        assert!(super::development_bind(&parse(&["dev", "--bind", "0.0.0.0"])).is_err());
        assert!(super::development_bind(&parse(&["dev", "--bind", "192.0.2.10", "--i-understand-cleartext"])).is_err());
        for wildcard in ["0.0.0.0", "::"] {
            assert!(super::development_bind(&parse(&["dev", "--bind", wildcard, "--i-understand-cleartext"])).unwrap().is_unspecified());
        }
    }

    #[test]
    fn early_response_does_not_wait_for_an_unread_request_body() {
        use std::io::{BufRead, BufReader, Write};
        use std::net::TcpStream;
        use std::time::Duration;
        for (length, expect) in [(1, "Expect: 100-continue\r\n"), (2048, "")] {
            let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
            let address = server.server_addr().to_ip().unwrap();
            let worker = std::thread::spawn(move || {
                let request = server.recv_timeout(Duration::from_secs(5)).unwrap().expect("request");
                crate::serve::respond_empty(request, 204);
            });
            let stream = TcpStream::connect(address).unwrap();
            stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
            let mut reader = BufReader::new(stream);
            write!(reader.get_mut(), "OPTIONS / HTTP/1.1\r\nHost: localhost\r\nContent-Length: {length}\r\n{expect}\r\n").unwrap();
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with("HTTP/1.1 204 "), "{line:?}");
            // Only send the body after receiving the final response.
            reader.get_mut().write_all(&vec![b'x'; length]).unwrap();
            worker.join().unwrap();
        }
    }

    #[test]
    fn json_responses_preserve_framing_on_a_persistent_connection() {
        use std::io::{BufRead, BufReader, Read, Write};
        use std::net::TcpStream;
        use std::time::Duration;
        use serde_json::json;
        let cases = [
            ("GET", 200, json!({ "data": "small" })),
            ("POST", 200, json!({ "data": "buffered request" })),
            ("GET", 200, json!({ "data": "page".repeat(1500) })),
            ("GET", 200, json!({ "data": "snapshot".repeat(10000) })),
            ("HEAD", 200, json!({ "data": "page".repeat(1500) })),
            ("OPTIONS", 204, json!(null)),
            ("GET", 403, json!({ "denied": { "code": "E_AUTH" } })),
        ];
        let server = tiny_http::Server::http(("127.0.0.1", 0)).unwrap();
        let address = server.server_addr().to_ip().unwrap();
        let responses = cases.clone();
        let worker = std::thread::spawn(move || {
            for (_, status, body) in responses {
                let request = server.recv_timeout(Duration::from_secs(5)).unwrap().expect("next request");
                if status == 204 {
                    crate::serve::respond_empty(request, status);
                } else {
                    crate::serve::respond(request, status, body);
                }
            }
        });
        let stream = TcpStream::connect(address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
        let mut reader = BufReader::new(stream);
        for (method, status, body) in cases {
            let body_wire = if method == "POST" { "Content-Length: 2\r\n\r\n{}" } else { "\r\n" };
            write!(reader.get_mut(), "{method} / HTTP/1.1\r\nHost: localhost\r\nOrigin: http://localhost:5173\r\nConnection: keep-alive\r\n{body_wire}").unwrap();
            let mut line = String::new();
            reader.read_line(&mut line).unwrap();
            assert!(line.starts_with(&format!("HTTP/1.1 {status} ")), "{line:?}");
            let mut headers = std::collections::BTreeMap::new();
            loop {
                line.clear();
                reader.read_line(&mut line).unwrap();
                if line == "\r\n" { break; }
                let (name, value) = line.split_once(':').expect("header");
                headers.insert(name.to_ascii_lowercase(), value.trim().to_owned());
            }
            if status == 204 {
                assert!(!headers.contains_key("content-type"));
                assert!(!headers.contains_key("content-length"));
            } else {
                assert_eq!(headers["content-type"], "application/json");
            }
            assert_eq!(headers["access-control-allow-origin"], "http://localhost:5173");
            let mut received = Vec::new();
            if method != "HEAD" && status != 204 {
                if headers.get("transfer-encoding").is_some_and(|v| v == "chunked") {
                    loop {
                        line.clear();
                        reader.read_line(&mut line).unwrap();
                        let size = usize::from_str_radix(line.trim(), 16).unwrap();
                        let mut chunk = vec![0; size + 2];
                        reader.read_exact(&mut chunk).unwrap();
                        assert_eq!(&chunk[size..], b"\r\n");
                        if size == 0 { break; }
                        received.extend_from_slice(&chunk[..size]);
                    }
                } else {
                    received.resize(headers["content-length"].parse().unwrap(), 0);
                    reader.read_exact(&mut received).unwrap();
                }
                assert_eq!(serde_json::from_slice::<serde_json::Value>(&received).unwrap(), body);
            }
        }
        worker.join().unwrap();
    }

    #[test]
    fn help_names_every_dispatched_verb() {
        for verb in ["init", "check", "types", "dev", "deploy", "rollback", "serve", "run", "test", "why", "guide", "data", "sql", "token", "doctor", "device", "witness"] {
            assert!(super::HELP.lines().any(|line| line.trim_start().starts_with(verb)), "HELP omits {verb}");
        }
    }

    /// The binary and the client package publish together at one version.
    #[test]
    fn version_is_the_workspace_version() {
        let package = include_str!("../../../packages/snapback4/package.json");
        let published = package.lines().find_map(|line| line.trim().strip_prefix("\"version\": \"")).and_then(|rest| rest.split('"').next()).expect("package.json has a version");
        assert_eq!(env!("CARGO_PKG_VERSION"), published, "bump Cargo.toml [workspace.package] and packages/snapback4/package.json together");
    }
}
