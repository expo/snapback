//! The Snapback 4 binary (LLP 3000 §5, week 2): one small program with the
//! loop verbs. `check` compiles the schema in milliseconds and writes the
//! client's types; `dev` serves it and re-adopts it on every save; `run`,
//! `test`, `why`, `guide`, `doctor`, `data` and `init` do what they say.

mod witness_socket;
mod listen_refusal;
mod verb_help;
mod note_rank;
mod assets;
mod host_limits;
mod auth;
mod native;
mod project;
mod serve;
mod dev_worker;
mod dev_replay;
mod dev_clock;
mod dev_clock_store;
mod lifecycle;
mod thread_priority;
mod verbs;
mod timeline_cost;
mod column_cost;
mod scale;
mod presentation;
mod sync_wire;
mod store_owner;
mod supervisor;

use snapback4_lang::guide;
use std::process::ExitCode;

const HELP: &str = "snapback4 — the scale-to-zero backend with a partition on every device

  init [dir] [--online|--expo|--web]  start a project: a schema; --web a Vite + React todos app; --expo an Expo todos app; --online a schema and an online client
       [--template chat] [--port N] [--web-port N] [--skip-existing]  --web or --expo with --template chat: the full reference chat app; --port: the backend port the client calls; --web-port: the Vite page's port (default: the next port); --skip-existing: keep existing files, write only missing ones
  init [dir] --adapt               fit the starter init wrote to the schema written since: remove its unmodified todo fixtures (fixtures/ stays), rewrite its unmodified screen for the schema's sign-in and operations
  new <dir> --template social|chat   social: Expo Router social starter (feed, chats, search, profile); chat: add --web or --expo
  check [--cost|--residency|--fix|--json|--verbose] [--store path] [--fixture dir --as p]  compile snapback/*.q; check store adoption; write types; build native jobs; --verbose includes note explanations and redundant cascades
  check --emit-lean <file.q>          print the checked file as the Lean model's case JSON (LLP 3000.035 §5.2; snapback4/lean); programs outside the model's fragment are listed with a reason
  types                            compile and write snapback/generated/api.ts
  dev [--port N] [--bind IP] [--no-watch] [--fresh|--memory] [--replay] [--hold-effects] [--hold-schedules] [--clock-offset +25h|--resume-clock] [--trace-empty] [long-wait flags]
                                      --trace-empty: record unknown empty reads in why recent; --replay: suppress new effects and hold schedules; --hold-effects: pause claims, keep effects for later; serve on 127.0.0.1:4400, re-adopting on every save (--no-watch: never; restart to serve edits); --fresh/--memory: a store in memory that dies with this process
  deploy <dir> [--allow-destructive] [--allow-feed-adoption]  a release: the compiled backend into <dir>/releases/N, current → N
  rollback <dir>                   current → the previous release
  serve <dir> [--port N] [--bind IP] [--worker <path>] [long-wait flags]  serve HTTP on 127.0.0.1:4400 behind a TLS proxy; tokens only
    --i-understand-cleartext         required for a non-loopback bind; see README proxy contract
  long-wait flags (dev and serve; SERVER.md \"Long-wait capacity\"):
    --long-waits N                   viewers' held /changes?wait and /a/ calls (default 1024, max 4096; SNAPBACK4_LONG_WAITS)
    --long-waits-per-principal N     held change polls one principal may hold (default 16; SNAPBACK4_LONG_WAITS_PER_PRINCIPAL)
    --claim-waits N                  service workers' claim polls, a separate pool (default 32, max 1024; SNAPBACK4_CLAIM_WAITS)
  run <op> [json] --as <persona|principal-id> [--port N] [--now <milliseconds|+duration>]   run one operation against the local store (a job runs whole, as the system); beside a live dev, forwarded to it as the persona; --port N: to the dev on that port (a dev --fresh)
  clock advance <duration> [--port N]  advance a running dev clock, sweep expiry and run due jobs
  test [--fixture dir] [--as p] [--residency [--verbose]]    load a fixture, run every query, print the meters; --residency: acquisition report only; add --verbose to run queries and print meters
  why <E_CODE | op | table | id>   explain a refusal or note with its card section, an operation's cost, a table's rules, or work by id; --release <dir>, --values
  guide [keyword] [--full|--sections|--section <words|N>|--find <words>]  list cards and aliases, or print one card (over 130 lines: its opening and numbered index; --full: all of it), its index, one section (a word no heading names prints the section that mentions it most), or the lines that mention words (a|b: either)
  data <table> [--limit N]         inspect stored rows as an administrator (bypasses read rules)
  sql <SELECT> [--release dir] [--limit N] [--json]  read-only inspection of your store (not rule-filtered)
    sql '\\dt' / '.tables'           application tables, maintained views, bounded row counts, active generation
    sql '\\d messages' / '.schema messages'  columns (Quarry types/nullability), indexes and unique keys
  token --service <name> [--days N] [--release <dir>]  a bearer token for a service principal (a worker's seat), printed once
  doctor [--url <url>] [--latency [--reset]]  health or latency (--json for JSON)
  witness acquire --as <persona|principal> [--url URL] [--token TOKEN] [--restart] [--runs N] [--query NAME --args JSON] [--artifacts DIR] [--timeout 120] [--json]
                                      prove fresh acquisition and retained cold restart on the native process device
  witness ios --build PROJECT --smoke [--udid ID] [--port N] [--artifacts DIR]
  witness status [--wait] [--json]  latest background native proof
  witness ios --bundle-id ID (--smoke | --segment NAME) [--udid ID] [--port N] [--artifacts DIR] [--prime] [--relaunch] [--timeout 120]
                                      record an installed iOS app cold-offline, then reconnect its owned backend
  device <store.sqlite> [backend.json]  the native module over stdin/stdout: one JSON request per line, one answer per line
  --version

snapback4 <verb> --help explains one verb (init, check, dev, run, test: flags, output columns, exit codes).";

fn main() -> ExitCode {
    // Before any thread: the wrapper's PID leaves the environment here.
    supervisor::adopt();
    snapback4_core::diagnostics::set_thread_start(thread_priority::background);
    // Keep this first: lifecycle tests distinguish a pre-main process-launch
    // stall from a server that reached its own bounded readiness window.
    if std::env::var_os("SNAPBACK4_TEST_MAIN_REACHED").is_some() {
        eprintln!("SNAPBACK4_TEST_MAIN_REACHED");
    }
    let args: Vec<String> = std::env::args().skip(1).collect();
    let verb = args.first().map(String::as_str).unwrap_or("");
    let inherited = match witness_socket::take(verb) {
        Ok(listener) => listener,
        Err(error) => { eprintln!("{error}"); return ExitCode::from(1); }
    };
    if verb == "--internal-witness-process" { return ExitCode::from(verbs::witness::process_group::command(&args[1..])); }
    if verb == "--internal-worker-watchdog" { return ExitCode::from(dev_worker::process::watchdog(&args[1..])); }
    quiet_broken_pipe(verb);
    if args.iter().any(|a| a == "--help" || a == "-h") || verb.is_empty() {
        // `snapback4 test --help` is about test; `snapback4 --help` lists every verb.
        println!("{}", verb_help::page(verb, HELP).unwrap_or_else(|| HELP.to_owned()));
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
        "new" if !options.flags.contains_key("template") => {
            eprintln!("Choose a template: social or chat\nusage: snapback4 new <dir> --template social\n       snapback4 new <dir> --template chat --web|--expo\nFor a small starter use snapback4 init <dir> --web (or --expo); for schema-only setup use snapback4 init <dir>.");
            2
        }
        "init" | "new" => verbs::init(&options),
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
            let phrase = options.positionals.join(" ");
            let keyword = if guide::card(&phrase).is_some() { Some(phrase.as_str()) }
                else { options.positionals.first().map(String::as_str) };
            match keyword {
                None => println!("{}", guide::listing()),
                Some(keyword) => match guide::card(keyword) {
                    // Cards embed starter sources; print them as init installs them.
                    Some(card) => {
                        let card = verbs::without_design_references(card);
                        let name = guide::resolve(keyword).unwrap_or(keyword);
                        let chosen = if options.flags.contains_key("full") { Ok(card.clone()) }
                            else if options.flags.contains_key("sections") { Ok(guide::section_index(name, &card)) }
                            else if let Some(words) = options.flags.get("section") { guide::section(name, &card, words) }
                            else if let Some(words) = options.flags.get("find") { guide::find(name, &card, words) }
                            else { Ok(guide::overview(name, &card).unwrap_or_else(|| card.clone())) };
                        match chosen {
                            Ok(text) => println!("{text}"),
                            Err(problem) => { println!("{problem}"); return ExitCode::from(1); }
                        }
                    }
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
            let mut clock_offset = options.flags.get("clock-offset").map(|text| dev_clock::offset(text)).transpose().map_err(|e| e.to_string())?.unwrap_or(0);
            if options.flags.contains_key("resume-clock") {
                // Continue the persisted store's own time after a restart (periphery; the core clock is unchanged).
                if options.flags.contains_key("clock-offset") || options.flags.contains_key("fresh") || options.flags.contains_key("memory") {
                    return Err(dev_clock::input("--resume-clock reads the persisted store's time; it cannot be combined with --clock-offset, --fresh or --memory").to_string());
                }
                let path = project.store_path();
                if path.exists() {
                    let store = snapback4_core::Store::open_read_only(&path).map_err(|e| e.to_string())?;
                    clock_offset = dev_clock_store::resume_offset(&store, snapback4_core::now_ms()).map_err(|e| e.to_string())?;
                }
                eprintln!("clock     --resume-clock: offset {clock_offset:+}ms from the store's newest commit stamp or schedule boundary");
            }
            let bind = development_bind(&options)?;
            let (port, inherited) = dev_port(options.flags.get("port").map(String::as_str), bind, inherited)?;
            let capacity = host_limits::Capacity::from_options(&options.flags, |name| std::env::var(name).ok())?;
            serve::serve(project, port, serve::Mode::Dev { trace_empty: options.flags.contains_key("trace-empty"), verbose: options.flags.contains_key("verbose"), watch: !options.flags.contains_key("no-watch"), fresh: options.flags.contains_key("fresh") || options.flags.contains_key("memory"), replay: options.flags.contains_key("replay"), hold_effects: options.flags.contains_key("hold-effects"), hold_schedules: options.flags.contains_key("hold-schedules"), clock_offset }, &bind.to_string(), inherited, capacity)
        }),
        other => {
            eprintln!("unknown verb {other}\n{HELP}");
            2
        }
    };
    ExitCode::from(code as u8)
}

/// `snapback4 test | head`: Rust ignores SIGPIPE, so a closed reader turns the
/// next `println!` into a panic, and the production build (panic = abort) dumps
/// core. A one-shot verb takes the Unix default instead and ends quietly with
/// the pipe. Hosts keep ignoring it: `dev`, `serve` and the device answer on
/// sockets and child pipes that may close under them, and their diagnostics
/// writer already discards a failed write; `deploy`/`rollback`/`token` change
/// state and are left to finish.
fn quiet_broken_pipe(verb: &str) {
    if matches!(verb, "dev" | "serve" | "device" | "witness" | "deploy" | "rollback" | "token") { return; }
    // SAFETY: process entry, before any thread or child is started.
    unsafe { libc::signal(libc::SIGPIPE, libc::SIG_DFL); }
}

/// `dev --port N`, or `--port A-B`: the first free port of an inclusive range
/// (a farm or CI host assigns each builder a range; agents wrote their own
/// scanners, two of which hung). The range is held from the first free probe
/// to the server: a loopback listener is handed to the server as bound, so no
/// other process can take the port in between. The URL stays stdout's first line.
// @ref LLP 3000.036#15.9 — a port range binds its first free port; every port taken is E_ADDRINUSE.
fn dev_port(flag: Option<&str>, bind: std::net::IpAddr, inherited: Option<std::net::TcpListener>) -> Result<(u16, Option<std::net::TcpListener>), String> {
    let Some(text) = flag else { return Ok((4400, inherited)); };
    let Some((low, high)) = text.split_once('-') else {
        return text.trim().parse::<u16>().map(|port| (port, inherited))
            .map_err(|_| format!("dev --port takes a port (0 picks a free one) or a range A-B (the first free port in it), not {text:?}"));
    };
    let range = |part: &str| part.trim().parse::<u16>().ok().filter(|port| *port > 0);
    let (Some(low), Some(high)) = (range(low), range(high)) else {
        return Err(format!("dev --port {text}: a range is two ports from 1 to 65535, low-high, for example --port 20100-20109"));
    };
    if low > high { return Err(format!("dev --port {text}: the range runs from low to high; write --port {high}-{low}")); }
    if inherited.is_some() { return Err("dev --port A-B cannot combine with an inherited listener".into()); }
    for port in low..=high {
        match std::net::TcpListener::bind((bind, port)) {
            // A loopback listener is handed over bound; a wildcard bind keeps the
            // server's own listen path (it refuses an inherited non-loopback socket).
            Ok(listener) if bind.is_loopback() => return Ok((port, Some(listener))),
            Ok(listener) => { drop(listener); return Ok((port, None)); }
            Err(error) if error.kind() == std::io::ErrorKind::AddrInUse || error.kind() == std::io::ErrorKind::PermissionDenied => continue,
            Err(error) => return Err(format!("dev --port {text}: cannot listen on {bind}:{port}: {error}")),
        }
    }
    Err(format!("E_ADDRINUSE: every port in {low}-{high} on {bind} is in use; widen the range, stop a dev you started (GET /dev/status names its pid), or use --port 0"))
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
    fn a_dev_port_range_binds_its_first_free_port_and_refuses_when_full() {
        let loopback = std::net::IpAddr::from([127, 0, 0, 1]);
        let held = std::net::TcpListener::bind((loopback, 0)).unwrap();
        let taken = held.local_addr().unwrap().port();
        // A range starting at a taken port moves on to a free one (or refuses when none is free).
        let range = format!("{taken}-{}", taken.saturating_add(20));
        let (port, listener) = super::dev_port(Some(&range), loopback, None).unwrap();
        assert!(port > taken && port <= taken.saturating_add(20), "{port}");
        assert_eq!(listener.unwrap().local_addr().unwrap().port(), port, "the chosen port is held, not probed and dropped");
        let full = super::dev_port(Some(&format!("{taken}-{taken}")), loopback, None).unwrap_err();
        assert!(full.starts_with("E_ADDRINUSE: every port in"), "{full}");
        assert_eq!(super::dev_port(Some("0"), loopback, None).unwrap().0, 0);
        assert_eq!(super::dev_port(None, loopback, None).unwrap().0, 4400);
        for bad in ["abc", "20109-20100", "0-5", "1-x"] { assert!(super::dev_port(Some(bad), loopback, None).is_err(), "{bad}"); }
    }

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
            crate::host_limits::prepare_tests();
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
        crate::host_limits::prepare_tests();
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
