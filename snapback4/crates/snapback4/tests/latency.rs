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
    fn start(&self) -> Host {
        let mut child = Command::new(BIN).current_dir(&self.0).args(["dev", "--no-watch", "--port", "0"]).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
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
