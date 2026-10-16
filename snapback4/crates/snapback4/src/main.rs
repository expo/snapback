//! The Snapback 4 binary (LLP 3000 §5, week 2): one small program with the
//! loop verbs. `check` compiles the schema in milliseconds and writes the
//! client's types; `dev` serves it and re-adopts it on every save; `run`,
//! `test`, `why`, `guide`, `doctor`, `data` and `init` do what they say.

mod client_compatibility;
mod witness_socket;
mod listen_refusal;
mod verb_help;
mod cli_flags;
mod guide_find;
mod device_handshake;
mod exact_device;
mod note_rank;
mod persona_principals;
mod assets;
mod host_limits;
mod auth;
mod native;
mod release_control;
mod release_requests;
mod release_files;
mod project;
mod serve;
mod dev_worker;
mod dev_replay;
mod dev_clock;
mod dev_reset;
mod dev_clock_store;
mod lifecycle;
mod thread_priority;
mod verbs;
mod port_flag;
mod timeline_cost;
mod column_cost;
mod scale;
mod presentation;
mod sync_wire;
mod store_owner;
mod supervisor;

use snapback4_lang::guide;
use std::process::ExitCode;


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
    if let Err(error) = cli_flags::validate(&args) {
        eprintln!("{error}"); return ExitCode::from(2);
    }
    let inherited = match witness_socket::take(verb) {
        Ok(listener) => listener,
        Err(error) => { eprintln!("{error}"); return ExitCode::from(1); }
    };
    if verb == "--internal-witness-process" { return ExitCode::from(verbs::witness::process_group::command(&args[1..])); }
    if verb == "--internal-worker-watchdog" { return ExitCode::from(dev_worker::process::watchdog(&args[1..])); }
    quiet_broken_pipe(verb);
    let options = verbs::parse(&args);
    if options.flags.contains_key("help") || matches!(verb, "--help" | "-h") || verb.is_empty() {
        // `snapback4 test --help` is about test; `snapback4 --help` lists every verb.
        println!("{}", verb_help::page(verb).unwrap_or_else(cli_flags::top_help));
        return ExitCode::SUCCESS;
    }
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
            eprintln!("Choose a template: social or chat\nusage: {}\nFor a small starter use snapback4 init <dir> --web (or --expo); for schema-only setup use snapback4 init <dir>.", cli_flags::synopsis("new"));
            2
        }
        "init" | "new" => verbs::init(&options),
        "upgrade" => verbs::upgrade::run(&args[1..]),
        "deploy" => verbs::deploy(&options),
        "rollback" => verbs::rollback(&options),
        "prune" => verbs::prune(&options),
        "releases" => verbs::releases(&options),
        "serve" => lifecycle::run("serve", || verbs::serve_release(&options)),
        "check" => verbs::check(&options),
        "types" => verbs::types(&options),
        "run" => verbs::run(&options),
        "clock" => dev_clock::command(&options),
        "reset" => dev_reset::command(&options),
        "test" => verbs::test(&options),
        "why" => verbs::why(&options),
        "data" => verbs::data(&options),
        "sql" => verbs::sql(&options),
        "token" => verbs::token(&options),
        "doctor" => verbs::doctor(&options),
        "witness" => verbs::witness::run(&args[1..]),
        "device" => verbs::device(&options),
        "guide" => {
            if options.flags.contains_key("list") { println!("{}", guide::listing()); return ExitCode::SUCCESS; }
            // The longest leading words that name a card; with --find or
            // --section, unquoted words after it continue the search words.
            let named = (1..=options.positionals.len()).rev().find(|&n| guide::card(&options.positionals[..n].join(" ")).is_some()).unwrap_or(1);
            let phrase = options.positionals[..named.min(options.positionals.len())].join(" ");
            let keyword = (!options.positionals.is_empty()).then_some(phrase.as_str());
            let rest = options.positionals.get(named..).unwrap_or_default().join(" ");
            let words_of = |flag: &str| options.flags.get(flag).map(|words| if rest.is_empty() { words.clone() } else { format!("{words} {rest}") });
            match keyword {
                None => if let Some(words) = options.flags.get("find") {
                    match guide_find::find(words) { Ok(text) => println!("{text}"), Err(problem) => { println!("{problem}"); return ExitCode::from(1); } }
                } else { println!("{}", guide::listing()); },
                Some("aliases") if guide::card("aliases").is_none() => println!("{}", guide::aliases()),
                Some(keyword) => match guide::card(keyword) {
                    // Cards embed starter sources; print them as init installs them.
                    Some(card) => {
                        let card = verbs::without_design_references(card);
                        let name = guide::resolve(keyword).unwrap_or(keyword);
                        let chosen = if options.flags.contains_key("full") { Ok(card.clone()) }
                            else if options.flags.contains_key("sections") { Ok(guide::section_index(name, &card)) }
                            else if let Some(words) = words_of("section") { guide::section(name, &card, &words) }
                            else if let Some(words) = words_of("find") { guide::find(name, &card, &words) }
                            // An alias that names a section prints it; piped (an agent's tool), a
                            // card prints whole; use --section to narrow it.
                            // @ref LLP 3000.007#20.1 — wave 6: aliases land on their section; wave 7 cap superseded by LLP 3000.011.003.000 §9: full non-TTY cards.
                            else if let Some(landing) = guide::alias_landing(keyword, name, &card) { Ok(landing) }
                            else if std::io::IsTerminal::is_terminal(&std::io::stdout()) { Ok(guide::overview(name, &card).unwrap_or_else(|| card.clone())) }
                            else { Ok(guide::piped(name, &card)) };
                        // A section of another card (`wire --section acceptance`) arrives unstripped.
                        match chosen.map(|text| verbs::without_design_references(&text)) {
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
            let (port, inherited) = port_flag::listen("dev", port_flag::parse("dev", options.flags.get("port").map(String::as_str))?, bind, inherited)?;
            let capacity = host_limits::Capacity::from_options(&options.flags, |name| std::env::var(name).ok())?;
            serve::serve(project, port, serve::Mode::Dev { trace_empty: options.flags.contains_key("trace-empty"), verbose: options.flags.contains_key("verbose"), watch: !options.flags.contains_key("no-watch"), fresh: options.flags.contains_key("fresh") || options.flags.contains_key("memory"), replay: options.flags.contains_key("replay"), hold_effects: options.flags.contains_key("hold-effects"), hold_schedules: options.flags.contains_key("hold-schedules"), clock_offset }, &bind.to_string(), inherited, capacity)
        }),
        // @ref LLP 3000.007#20.1 — wave 7 (060): resolveBinary() runs the platform binary; web-shell lives in the npm wrapper.
        "web-shell" => {
            eprintln!("web-shell is the npm wrapper's verb, not the platform binary's: run node_modules/.bin/snapback4 web-shell dist (or `npx snapback4 web-shell dist`); resolveBinary() from snapback4/bin-path is only for the native verbs (dev, check, test, …)");
            2
        }
        other => {
            eprintln!("unknown verb {other}\n{}", cli_flags::top_help());
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
    if matches!(verb, "dev" | "serve" | "device" | "witness" | "deploy" | "rollback" | "prune" | "token") { return; }
    // SAFETY: process entry, before any thread or child is started.
    unsafe { libc::signal(libc::SIGPIPE, libc::SIG_DFL); }
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
        for verb in ["init", "check", "types", "dev", "deploy", "rollback", "serve", "run", "test", "why", "guide", "data", "sql", "token", "doctor", "device", "witness", "web-shell"] {
            assert!(crate::cli_flags::top_help().lines().any(|line| line.trim_start().starts_with(&format!("snapback4 {verb}"))), "HELP omits {verb}");
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
