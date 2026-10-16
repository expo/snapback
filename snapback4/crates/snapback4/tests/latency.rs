//! Doctor's documented commands against the real dev process and lifetime lock.
#[allow(dead_code)]
#[path = "../src/host_limits.rs"] mod host_limits;
#[path = "support/local_interface.rs"] mod local_interface;
use serde_json::{Value, json};
use std::{fs, io::{BufRead, BufReader, Read, Write}, net::TcpStream, path::PathBuf, process::{Child, Command, Output, Stdio}, time::{Duration, Instant}};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "use personas alice\nquery fast():\n  return 1\nquery idle():\n  return 2\n";
struct Fixture(PathBuf);
impl Fixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("sb4-latency-{}-{label}", std::process::id()));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), SOURCE).unwrap(); Self(path)
    }
    fn command(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn start(&self) -> Host { self.start_with(&[]) }
    fn start_with(&self, args: &[&str]) -> Host {
        let mut child = Command::new(BIN).current_dir(&self.0).args(["dev", "--no-watch", "--port", "0"]).args(args).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let host = Host { child, address: line.trim().trim_start_matches("http://").into() };
        assert!(!host.address.is_empty()); host
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
struct Host { child: Child, address: String }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
// @ref LLP 3000#publication-suite-under-contention — preserve semantics independently of host scheduling.
impl Host {
    // The HTTP body can arrive before Sample::drop records the completed turn.
    // Wait for that event before freezing a before/after diagnostic snapshot.
    fn latency_after(&self, path: &str, count: u64) -> Value {
        let started = Instant::now();
        loop {
            let snapshot = self.request("GET", "/dev/latency", Value::Null);
            let completed = snapshot["operations"][path]["n"].as_u64().expect("completed request count");
            assert!(completed <= count, "unexpected extra latency sample for {path}: {snapshot}");
            if completed == count { return snapshot; }
            assert!(started.elapsed() < Duration::from_secs(60), "latency sample {path} did not reach {count}: {snapshot}");
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn request(&self, method: &str, path: &str, body: Value) -> Value {
        let body = body.to_string();
        let mut stream = TcpStream::connect(&self.address).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap()
    }
}
fn success(output: Output) -> String {
    assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    String::from_utf8(output.stdout).unwrap()
}

#[test]
fn dev_process_wildcard_listener_omits_timing_for_loopback_and_external_peers() {
    let fixture = Fixture::new("wildcard-timing");
    let host = fixture.start_with(&["--bind", "0.0.0.0", "--i-understand-cleartext"]);
    let bound: std::net::SocketAddr = host.address.parse().unwrap();
    assert!(bound.ip().is_unspecified(), "{}", host.address);
    host_limits::prepare_tests();
    let external = local_interface::address();
    assert!(!external.is_loopback());
    for (ip, expected) in [("127.0.0.1".parse().unwrap(), 200), (external, 403)] {
        let mut stream = TcpStream::connect(std::net::SocketAddr::new(ip, bound.port())).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        stream.write_all(b"POST /q/fast HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 2\r\n\r\n{}").unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        let (headers, body) = reply.split_once("\r\n\r\n").unwrap();
        assert_eq!(headers.split_whitespace().nth(1).unwrap().parse::<u16>().unwrap(), expected, "{reply}");
        assert!(!headers.lines().any(|line| line.split_once(':')
            .is_some_and(|(name, _)| name.eq_ignore_ascii_case("Server-Timing"))),
            "wildcard dev disclosed timing to {ip}: {reply}");
        if expected == 200 {
            assert_eq!(serde_json::from_str::<Value>(body).unwrap()["data"], 1);
        }
    }
}

#[test]
fn doctor_idle_cpu_is_empty_before_traffic_and_after_reset() {
    let fixture = Fixture::new("idle-cpu");
    let host = fixture.start();
    for reset in [false, true] {
        if reset {
            host.request("POST", "/q/fast", json!({"args":{}}));
            host.latency_after("/q/fast", 1);
            success(fixture.command(&["doctor", "--latency", "--reset"]));
        }
        let text = success(fixture.command(&["doctor", "--latency"]));
        let operations: Vec<_> = text.lines().filter(|line| line.contains(": n=")).collect();
        assert_eq!(operations.len(), 9, "{text}");
        for line in operations {
            assert!(line.contains(": n=0 refused=0 ") && line.ends_with("; cpu n=0"), "{line}");
        }
        assert!(!text.contains("cpu unavailable"), "{text}");
        let snapshot: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--json"]))).unwrap();
        for operation in snapshot["operations"].as_object().unwrap().values() {
            assert_eq!(operation["n"], 0);
            assert_eq!(operation["cpu_n"], 0);
            assert_eq!(operation["cpu"], json!({"p50":0.0,"p95":0.0,"p99":0.0,"max":0.0}));
        }
    }
}

#[test]
fn doctor_latency_json_default_summary_all_operations_and_reset() {
    let fixture = Fixture::new("small");
    let host = fixture.start();
    for _ in 0..5 { assert_eq!(host.request("POST", "/q/fast", json!({"args":{}}))["data"], 1); }
    host.latency_after("/q/fast", 5);
    let snapshot: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--json"]))).unwrap();
    assert_eq!(snapshot["operations"]["/q/fast"]["n"], 5);
    assert_eq!(snapshot["operations"]["/q/idle"]["n"], 0);
    assert!(snapshot["since"].is_i64());
    let ordinary = success(fixture.command(&["doctor"]));
    assert!(ordinary.contains("/q/fast: n=5 refused=0 total p50="), "{ordinary}");
    assert!(ordinary.contains("worst wait:"), "{ordinary}");
    assert!(!ordinary.contains("/q/idle:"));
    let all = success(fixture.command(&["doctor", "--latency"]));
    assert!(all.contains("/q/idle: n=0"), "{all}");
    assert!(all.contains("; engine p50=") && all.contains("; cpu n="), "{all}");
    assert_eq!(snapshot["operations"]["/q/fast"]["cpu_n"], 5);
    let ordinary_json: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--json"]))).unwrap();
    assert_eq!(ordinary_json["latency"]["operations"]["/q/fast"]["n"], 5);
    let reset: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--reset", "--json"]))).unwrap();
    assert_eq!(reset["operations"]["/q/fast"]["n"], 0);
    host.request("POST", "/q/fast", json!({"args":{}}));
    host.latency_after("/q/fast", 1);
    let snapshot: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--json"]))).unwrap();
    assert_eq!(snapshot["operations"]["/q/fast"]["n"], 1);
    assert!(!fixture.command(&["doctor", "--reset"]).status.success());
    assert!(!fixture.command(&["doctor", "--latency", "--release", "."]).status.success());
    drop(host);
    assert!(!fixture.command(&["doctor", "--latency"]).status.success());
}

#[test]
fn doctor_latency_reads_and_resets_snapshots_above_the_http_chunk_threshold() {
    let fixture = Fixture::new("large");
    let source = format!("{SOURCE}{}", (0..300).map(|n| format!("query sample{n}():\n  return {n}\n")).collect::<String>());
    fs::write(fixture.0.join("snapback/schema.q"), source).unwrap();
    let _host = fixture.start();
    for args in [vec!["doctor", "--latency", "--json"], vec!["doctor", "--latency", "--reset", "--json"]] {
        let text = success(fixture.command(&args));
        assert!(text.len() > 32768, "exercise the server's chunking threshold");
        let snapshot: Value = serde_json::from_str(&text).unwrap();
        assert_eq!(snapshot["operations"].as_object().unwrap().len(), 309);
        assert_eq!(snapshot["operations"]["/q/sample299"]["n"], 0);
    }
}


fn no_discovery_record(fixture: &Fixture) {
    if let Ok(entries) = fs::read_dir(fixture.0.join(".snapback4")) {
        for entry in entries {
            assert!(!entry.unwrap().file_name().to_string_lossy().starts_with("dev-address-"));
        }
    }
}
fn answer(fixture: &Fixture, args: &[&str]) -> Value {
    serde_json::from_str(&success(fixture.command(args))).unwrap()
}
fn refused(fixture: &Fixture, args: &[&str]) -> String {
    let output = fixture.command(args);
    assert!(!output.status.success(), "{}", String::from_utf8_lossy(&output.stdout));
    String::from_utf8(output.stderr).unwrap()
}

#[test]
fn doctor_discovers_fresh_and_memory_and_also_accepts_the_printed_url() {
    for flag in ["--fresh", "--memory"] {
        let fixture = Fixture::new(flag);
        let host = fixture.start_with(&[flag]);
        let url = format!("http://{}", host.address);
        let data = fixture.0.join(".snapback4");
        assert!(!data.join("store.sqlite").exists());
        assert!(!data.join("serve.lock").exists());
        no_discovery_record(&fixture);
        host.request("POST", "/q/fast", json!({"args":{}}));
        host.latency_after("/q/fast", 1);
        for args in [vec!["doctor", "--latency", "--json", "--url", &url], vec!["doctor", "--json", "--url", &url]] {
            let answer = answer(&fixture, &args);
            let snapshot = if args.contains(&"--latency") { &answer } else { assert_eq!(answer["ok"], true); &answer["latency"] };
            assert_eq!(snapshot["operations"]["/q/fast"]["n"], 1);
        }
        let text = success(fixture.command(&["doctor", "--url", &url]));
        assert!(text.contains("temporary dev store"), "{text}");
        let text = success(fixture.command(&["doctor", "--latency", "--url", &url]));
        assert!(text.contains("/q/idle: n=0"), "{text}");
        let reset = answer(&fixture, &["doctor", "--latency", "--reset", "--json", "--url", &url]);
        assert_eq!(reset["operations"]["/q/fast"]["n"], 0);
        assert_eq!(answer(&fixture, &["doctor", "--latency", "--json"])["operations"]["/q/fast"]["n"], 0);
        let ordinary=success(fixture.command(&["doctor"]));
        assert!(ordinary.contains("temporary dev store"), "{ordinary}");
        drop(host);
        refused(&fixture, &["doctor", "--latency", "--url", &url]);
        no_discovery_record(&fixture);
    }
}

#[test]
fn doctor_discovers_persisted_host_and_url_selects_a_simultaneous_temporary_host() {
    let fixture = Fixture::new("alongside");
    let persisted = fixture.start();
    let store_id = persisted.request("GET", "/dev/status", Value::Null)["storeId"].clone();
    let fresh = fixture.start_with(&["--fresh"]);
    let fresh_id = fresh.request("GET", "/dev/status", Value::Null)["storeId"].clone();
    assert_ne!(fresh_id, store_id);
    no_discovery_record(&fixture);
    let address = fs::read_to_string(fixture.0.join(".snapback4/serve.lock")).unwrap();
    assert!(address.contains(&persisted.address));
    fresh.request("POST", "/q/idle", json!({"args":{}}));
    persisted.request("POST", "/q/fast", json!({"args":{}}));
    persisted.latency_after("/q/fast", 1);
    fresh.latency_after("/q/idle", 1);
    let ambiguous=refused(&fixture, &["doctor", "--json"]);
    assert!(ambiguous.contains("multiple live dev hosts") && ambiguous.contains(&fresh.address) && ambiguous.contains(&persisted.address), "{ambiguous}");
    let persisted_url=format!("http://{}",persisted.address);
    let normal = answer(&fixture, &["doctor", "--json", "--url", &persisted_url]);
    assert_eq!(normal["latency"]["operations"]["/q/fast"]["n"], 1);
    assert_eq!(normal["latency"]["operations"]["/q/idle"]["n"], 0);
    assert!(normal["storage"].is_object());
    let url = format!("http://{}", fresh.address);
    let explicit = answer(&fixture, &["doctor", "--json", "--url", &url]);
    assert_eq!(explicit["latency"]["operations"]["/q/idle"]["n"], 1);
    assert_eq!(explicit["storage"], Value::Null);
    assert!(explicit["lines"].as_array().unwrap().iter().any(|line| line.as_str().unwrap().contains(
        &format!("temporary dev store {};", fresh_id.as_str().unwrap()))));
    let reset = answer(&fixture, &["doctor", "--latency", "--reset", "--json", "--url", &url]);
    assert_eq!(reset["operations"]["/q/idle"]["n"], 0);
    assert_eq!(answer(&fixture, &["doctor", "--latency", "--json", "--url", &persisted_url])["operations"]["/q/fast"]["n"], 1);
}

#[test]
fn doctor_checks_the_servers_project_before_read_or_reset_for_both_address_sources() {
    let a = Fixture::new("project-a");
    let b = Fixture::new("project-b");
    // Persist a store in A, then point its old serve.lock address at B.
    drop(a.start());
    let server = b.start();
    let url = format!("http://{}", server.address);
    server.request("POST", "/q/fast", json!({"args":{}}));
    let status = server.request("GET", "/dev/status", Value::Null);
    assert_eq!(status["project"], json!(b.0.canonicalize().unwrap()));
    fs::write(a.0.join(".snapback4/serve.lock"), format!("{}\n{url}\n", server.address.rsplit(':').next().unwrap())).unwrap();
    let before = server.latency_after("/q/fast", 1);
    for args in [vec!["doctor", "--url", &url], vec!["doctor", "--json", "--url", &url], vec!["doctor", "--latency", "--json", "--url", &url], vec!["doctor", "--latency", "--reset", "--json", "--url", &url]] {
        let failure=refused(&a,&args);
        assert!(failure.contains(b.0.to_str().unwrap()) && failure.contains("serves project"),"{failure}");
    }
    let no_host=refused(&a,&["doctor","--latency"]);
    assert!(no_host.contains("no running dev server"),"{no_host}");
    assert_eq!(server.request("GET", "/dev/latency", Value::Null), before, "neither the counter nor the window may change");
}

#[test]
fn doctor_ignores_stale_serve_lock_when_live_registration_identifies_the_memory_host() {
    let fixture = Fixture::new("stale-store");
    drop(fixture.start());
    let fresh = fixture.start_with(&["--fresh"]);
    fresh.request("POST", "/q/fast", json!({"args":{}}));
    fs::write(fixture.0.join(".snapback4/serve.lock"), format!("{}\nhttp://{}\n", fresh.address.rsplit(':').next().unwrap(), fresh.address)).unwrap();
    let before = fresh.latency_after("/q/fast", 1);
    for args in [vec!["doctor", "--json"], vec!["doctor", "--latency", "--reset", "--json"]] {
        assert!(fixture.command(&args).status.success());
    }
    assert_eq!(before["operations"]["/q/fast"]["n"], 1);
    assert_eq!(fresh.request("GET", "/dev/latency", Value::Null)["operations"]["/q/fast"]["n"], 0);
}

#[test]
fn doctor_url_refuses_non_loopback_and_supports_localhost() {
    let fixture = Fixture::new("url");
    for url in ["http://192.0.2.1:4400", "http://example.com:4400", "http://0.0.0.0:4400", "http://[2001:db8::1]:4400", "http://localhost@192.0.2.1:4400", "http://127.0.0.1:4400/path"] {
        for args in [vec!["doctor", "--url", url], vec!["doctor", "--latency", "--reset", "--json", "--url", url]] {
            let failure = refused(&fixture, &args);
            assert!(failure.contains("loopback HTTP origin"), "{failure}");
        }
    }
    let host = fixture.start();
    let url = format!("http://localhost:{}/", host.address.rsplit(':').next().unwrap());
    let result = answer(&fixture, &["doctor", "--url", &url, "--json"]);
    assert_eq!(result["ok"], true);
    assert!(result["storage"].is_object(), "persisted status must retain store health");
    assert!(result["latency"]["operations"].is_object());
    no_discovery_record(&fixture);
}

#[test]
fn symlinked_snapback_directory_starts_and_serves_in_every_dev_mode() {
    use std::os::unix::fs::symlink;
    for args in [vec![], vec!["--fresh"], vec!["--memory"]] {
        let fixture = Fixture::new(&format!("symlink-{}", args.first().unwrap_or(&"persisted")));
        let external = fixture.0.join("external");
        // Reopen an existing persisted store through the same directory alias
        // lane R supports, rather than creating a new store through a symlink.
        let previous_id = if args.is_empty() {
            let original = fixture.start();
            let id = original.request("GET", "/dev/status", Value::Null)["storeId"].clone();
            drop(original);
            fs::rename(fixture.0.join(".snapback4"), &external).unwrap();
            Some(id)
        } else { fs::create_dir(&external).unwrap(); None };
        symlink(&external, fixture.0.join(".snapback4")).unwrap();
        let host = fixture.start_with(&args);
        assert_eq!(host.request("POST", "/q/fast", json!({"args":{}}))["data"], 1);
        host.latency_after("/q/fast", 1);
        if let Some(id) = previous_id { assert_eq!(host.request("GET", "/dev/status", Value::Null)["storeId"], id); }
        assert!(fs::symlink_metadata(fixture.0.join(".snapback4")).unwrap().file_type().is_symlink());
        let url = format!("http://{}", host.address);
        let mut doctor = vec!["doctor", "--latency", "--json"];
        if args.is_empty() {
            assert!(external.join("store.sqlite").is_file());
            assert!(fs::read_to_string(external.join("serve.lock")).unwrap().contains(&url));
        } else {
            doctor.extend(["--url", &url]);
            assert!(!external.join("store.sqlite").exists());
            assert!(!external.join("serve.lock").exists());
        }
        let result = answer(&fixture, &doctor);
        assert_eq!(result["operations"]["/q/fast"]["n"], 1);
        no_discovery_record(&fixture);
    }
}

#[test]
fn doctor_url_inspects_and_resets_ipv6_loopback() {
    let fixture = Fixture::new("ipv6");
    let host = fixture.start_with(&["--fresh", "--bind", "::1"]);
    let url = format!("http://{}", host.address);
    assert!(url.starts_with("http://[::1]:"));
    host.request("POST", "/q/fast", json!({"args":{}}));
    host.latency_after("/q/fast", 1);
    let result = answer(&fixture, &["doctor", "--latency", "--json", "--url", &url]);
    assert_eq!(result["operations"]["/q/fast"]["n"], 1);
    let reset = answer(&fixture, &["doctor", "--latency", "--reset", "--json", "--url", &url]);
    assert_eq!(reset["operations"]["/q/fast"]["n"], 0);
    no_discovery_record(&fixture);
}


#[test]
fn bounds_guide_growth_recipe_runs_verbatim_against_dev() {
    let fixture = Fixture::new("guide");
    let host = fixture.start();
    let card = success(fixture.command(&["guide", "bounds", "--full"]));
    for alias in ["latency", "performance", "p95", "benchmark", "load test"] {
        assert_eq!(success(fixture.command(&["guide", alias, "--full"])), card);
    }
    let recipe = card.split("```sh\n").find(|s| s.starts_with("# Growth curve checkpoint"))
        .unwrap().split("```").next().unwrap();
    let bin = fixture.0.join("bin"); fs::create_dir(&bin).unwrap();
    std::os::unix::fs::symlink(BIN, bin.join("snapback4")).unwrap();
    let result = Command::new("sh").arg("-eu").arg("-c").arg(recipe)
        .current_dir(&fixture.0).env("SB4_URL", format!("http://{}", host.address))
        .env("SB4_OP", "fast").env("SB4_ARGS", "{}").env("SB4_PERSONA", "alice")
        .env("PATH", format!("{}:{}", bin.display(), std::env::var("PATH").unwrap()))
        .output().unwrap();
    success(result);
    let probes: Value = serde_json::from_slice(&fs::read(fixture.0.join("checkpoint-probes.json")).unwrap()).unwrap();
    let server: Value = serde_json::from_slice(&fs::read(fixture.0.join("checkpoint-server.json")).unwrap()).unwrap();
    let samples = probes["samples"].as_array().unwrap();
    assert_eq!(samples.len(), 23);
    assert_eq!(samples.iter().filter(|s| s["warmup"] == false).count(), 20);
    for sample in samples {
        for metric in ["total", "wait", "engine", "cpu"] { assert!(sample["server"][metric].is_number(), "{sample}"); }
    }
    assert_eq!(server["operations"]["/q/fast"]["n"], 23);
    assert_eq!(server["operations"]["/q/fast"]["cpu_n"], 23);
    assert_eq!(probes["before"]["load"].as_array().unwrap().len(), 3);
}
