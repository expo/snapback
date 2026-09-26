//! Doctor's documented commands against the real dev process and lifetime lock.
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
impl Host {
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
fn doctor_latency_json_default_summary_all_operations_and_reset() {
    let fixture = Fixture::new("small");
    let host = fixture.start();
    for _ in 0..5 { assert_eq!(host.request("POST", "/q/fast", json!({"args":{}}))["data"], 1); }
    let started = Instant::now();
    while host.request("GET", "/dev/latency", Value::Null)["operations"]["/q/fast"]["n"] != 5 {
        assert!(started.elapsed() < Duration::from_secs(3));
    }
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
    let ordinary_json: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--json"]))).unwrap();
    assert_eq!(ordinary_json["latency"]["operations"]["/q/fast"]["n"], 5);
    let reset: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--reset", "--json"]))).unwrap();
    assert_eq!(reset["operations"]["/q/fast"]["n"], 0);
    host.request("POST", "/q/fast", json!({"args":{}}));
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


#[test]
fn doctor_discovers_fresh_and_memory_without_a_persisted_store_and_cleans_up() {
    use std::os::unix::process::ExitStatusExt;
    for flag in ["--fresh", "--memory"] {
        let fixture = Fixture::new(flag);
        let mut host = fixture.start_with(&[flag]);
        let data = fixture.0.join(".snapback4");
        assert!(!data.join("store.sqlite").exists());
        assert!(!data.join("serve.lock").exists(), "discovery must not impersonate store ownership");
        host.request("POST", "/q/fast", json!({"args":{}}));
        for args in [vec!["doctor", "--latency", "--json"], vec!["doctor", "--json"]] {
            let answer: Value = serde_json::from_str(&success(fixture.command(&args))).unwrap();
            let snapshot = if args.contains(&"--latency") { &answer } else { assert_eq!(answer["ok"], true); &answer["latency"] };
            assert_eq!(snapshot["operations"]["/q/fast"]["n"], 1);
        }
        let reset: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--reset", "--json"]))).unwrap();
        assert_eq!(reset["operations"]["/q/fast"]["n"], 0);
        let record = data.join(format!("dev-address-{}.json", host.address.rsplit(':').next().unwrap()));
        assert!(record.is_file());
        unsafe { libc::kill(host.child.id() as i32, libc::SIGTERM); }
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            if let Some(status) = host.child.try_wait().unwrap() { assert_eq!(status.signal(), Some(libc::SIGTERM)); break; }
            assert!(Instant::now() < deadline); std::thread::sleep(Duration::from_millis(10));
        }
        assert!(!record.exists(), "orderly exit removes the address record");
        assert!(!fixture.command(&["doctor", "--latency"]).status.success());
    }
}

#[test]
fn doctor_uses_live_temporary_host_even_beside_an_older_persisted_store() {
    let fixture = Fixture::new("alongside");
    let persisted = fixture.start();
    let store_id = persisted.request("GET", "/dev/status", Value::Null)["storeId"].clone();
    let fresh = fixture.start_with(&["--fresh"]);
    assert_ne!(fresh.request("GET", "/dev/status", Value::Null)["storeId"], store_id);
    fresh.request("POST", "/q/idle", json!({"args":{}}));
    let answer: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--json"]))).unwrap();
    assert_eq!(answer["latency"]["operations"]["/q/idle"]["n"], 1);
    assert!(answer["lines"].as_array().unwrap().iter().any(|line| line.as_str().unwrap().contains("temporary dev store")));
    drop(fresh); // SIGKILL leaves a stale file; discovery must ignore its unlocked record.
    let answer: Value = serde_json::from_str(&success(fixture.command(&["doctor", "--latency", "--json"]))).unwrap();
    assert_eq!(answer["operations"]["/q/idle"]["n"], 0);
}

#[test]
fn doctor_refuses_mismatched_address_identity_without_resetting() {
    let fixture = Fixture::new("wrong-identity");
    let host = fixture.start_with(&["--fresh"]);
    host.request("POST", "/q/fast", json!({"args":{}}));
    let path = fixture.0.join(".snapback4").join(format!("dev-address-{}.json", host.address.rsplit(':').next().unwrap()));
    let original = fs::read(&path).unwrap();
    let mut wrong: Value = serde_json::from_slice(&original).unwrap();
    wrong["store_id"] = json!("a different store");
    fs::write(&path, wrong.to_string()).unwrap();
    assert!(!fixture.command(&["doctor", "--latency", "--reset", "--json"]).status.success());
    assert_eq!(host.request("GET", "/dev/latency", Value::Null)["operations"]["/q/fast"]["n"], 1);
    fs::write(path, original).unwrap();
    success(fixture.command(&["doctor", "--latency", "--json"]));
}
