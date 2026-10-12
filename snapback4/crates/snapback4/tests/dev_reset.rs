//! `POST /dev/reset` and `snapback4 reset` against a real `snapback4 dev`:
//! per-test isolation on one running host. Real subprocesses of the binary.
use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::PathBuf;
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};

#[path = "support/local_interface.rs"]
mod local_interface;

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
static SERIAL: AtomicUsize = AtomicUsize::new(0);
const SCHEMA: &str = "use personas alice, bob
table lists:
  owner: principal
  title: text <=40
  immutable owner
  read <- .owner = viewer
  insert <- .owner = viewer
  sync to .owner
table items:
  list: lists
  text: text <=40
  immutable list
  read through .list
  insert <- .list.owner = viewer
view itemCount: count items by .list
mutation addItem(list: lists, text: text <=40):
  return insert items { list, text }
query mine():
  return lists where .owner = viewer first 100
query count(list: lists):
  return itemCount[list]
";

struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("sb4-dev-reset-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::write(dir.join("snapback/schema.q"), SCHEMA).unwrap();
        Project(dir)
    }
    fn write(&self, path: &str, text: &str) {
        let path = self.0.join(path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, text).unwrap();
    }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn start(&self, args: &[&str]) -> Host {
        let stderr = fs::File::create(self.0.join(format!("stderr-{}.log", SERIAL.fetch_add(1, Ordering::Relaxed)))).unwrap();
        let mut child = Command::new(BIN).current_dir(&self.0).args(args).stdout(Stdio::piped()).stderr(stderr).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let host = Host(child, line.trim().trim_start_matches("http://").parse().unwrap_or_else(|_| panic!("{line:?}")));
        assert!(line.starts_with("http://"), "{line:?}");
        host
    }
    fn dev(&self, extra: &[&str]) -> Host { self.start(&[&["dev", "--fresh", "--no-watch", "--port", "0"], extra].concat()) }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

struct Host(Child, SocketAddr);
impl Drop for Host { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
impl Host {
    fn port(&self) -> String { self.1.port().to_string() }
    fn request_from(&self, peer: SocketAddr, path: &str, persona: Option<&str>, body: &str) -> (u16, Value) {
        let mut stream = TcpStream::connect(peer).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let persona = persona.map(|p| format!("x-snapback-persona: {p}\r\n")).unwrap_or_default();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\n{persona}Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut reply = String::new();
        stream.read_to_string(&mut reply).unwrap();
        let status = reply.split_whitespace().nth(1).unwrap().parse().unwrap();
        (status, serde_json::from_str(reply.split_once("\r\n\r\n").unwrap().1).unwrap_or(Value::Null))
    }
    fn post(&self, path: &str, persona: Option<&str>, body: Value) -> (u16, Value) {
        let peer = SocketAddr::new("127.0.0.1".parse().unwrap(), self.1.port());
        self.request_from(peer, path, persona, &body.to_string())
    }
    fn titles(&self) -> Vec<Value> {
        let (status, reply) = self.post("/q/mine", Some("alice"), json!({"args": {}}));
        assert_eq!(status, 200, "{reply}");
        reply["data"].as_array().unwrap().iter().map(|row| row["title"].clone()).collect()
    }
}

fn list(id: &str, title: &str) -> Value { json!({"table": "lists", "row": {"id": id, "owner": "dev:alice", "title": title}}) }

fn stdout_json(output: &Output) -> Value {
    assert!(output.status.success(), "{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    serde_json::from_slice(&output.stdout).unwrap()
}

#[test]
fn the_cli_mirror_resets_and_reseeds_from_a_fixture_directory_or_a_rows_file() {
    let project = Project::new();
    let host = project.dev(&[]);
    assert_eq!(host.post("/seed", None, json!([list("L0", "Before")])).1["seeded"], 1);
    project.write("fixtures/lists.jsonl", "{\"id\":\"L1\",\"owner\":\"dev:alice\",\"title\":\"Fixture\"}\n\n");
    project.write("fixtures/items.jsonl", "{\"id\":\"I1\",\"list\":\"L1\",\"text\":\"one\"}\n{\"id\":\"I2\",\"list\":\"L1\",\"text\":\"two\"}\n");
    project.write("fixtures/test.cases.jsonl", "{\"as\":\"alice\",\"op\":\"mine\",\"count\":1}\n");
    let reply = stdout_json(&project.run(&["reset", "--port", &host.port(), "--seed", "fixtures"]));
    assert_eq!(reply["reset"], true, "{reply}");
    assert_eq!(reply["seeded"], 3, "the case file is not a table: {reply}");
    assert_eq!(host.titles(), [json!("Fixture")]);
    assert_eq!(host.post("/q/count", Some("alice"), json!({"args": {"list": "L1"}})).1["data"], 2, "views count the reseed");

    project.write("rows.json", &json!([list("L2", "File")]).to_string());
    let next = stdout_json(&project.run(&["reset", "--port", &host.port(), "--seed", "rows.json"]));
    assert_eq!(next["previousStoreId"], reply["storeId"]);
    assert_eq!(host.titles(), [json!("File")]);
    let empty = stdout_json(&project.run(&["reset", "--port", &host.port()]));
    assert_eq!(empty["seeded"], 0);
    assert_eq!(host.titles(), Vec::<Value>::new());

    // A refused reseed resets nothing and says why on stderr, exit 1.
    project.write("bad/lists.jsonl", "{\"id\":\"L3\",\"owner\":\"alice\",\"title\":\"Bare principal\"}\n");
    assert_eq!(host.post("/seed", None, json!([list("L4", "Kept")])).1["seeded"], 1);
    let refused = project.run(&["reset", "--port", &host.port(), "--seed", "bad"]);
    assert_eq!(refused.status.code(), Some(1));
    let stderr = String::from_utf8_lossy(&refused.stderr);
    assert!(stderr.starts_with("E_INPUT:") && stderr.contains("guide: testing"), "{stderr}");
    assert_eq!(host.titles(), [json!("Kept")]);
    let usage = project.run(&["reset", "--port", &host.port(), "--clock", "back"]);
    assert_eq!(usage.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&usage.stderr).contains("E_CLOCK_INPUT"));
    assert!(String::from_utf8_lossy(&project.run(&["reset", "--help"]).stdout).contains("/dev/reset"));
}

#[test]
fn reset_is_fast_enough_to_run_before_every_test() {
    let project = Project::new();
    let host = project.dev(&[]);
    let seed: Vec<Value> = (0..20).map(|n| list(&format!("L{n:02}"), "Seed")).collect();
    let mut elapsed = Vec::new();
    for round in 0..30 {
        for text in ["a", "b", "c"] { assert_eq!(host.post("/m/addItem", Some("alice"), json!({"args": {"list": format!("L{:02}", round % 20), "text": text}})).0, 200); }
        let started = Instant::now();
        let (status, reply) = host.post("/dev/reset", None, json!({"seed": seed}));
        elapsed.push(started.elapsed());
        assert_eq!((status, &reply["seeded"]), (200, &json!(20)), "{reply}");
    }
    elapsed.sort();
    let median = elapsed[elapsed.len() / 2];
    eprintln!("POST /dev/reset with a 20-row reseed: median {median:?}, max {:?}", elapsed.last().unwrap());
    assert!(median < Duration::from_millis(100), "median {median:?}");
}

#[test]
fn a_wildcard_dev_refuses_a_non_loopback_peer() {
    let project = Project::new();
    let host = project.dev(&["--bind", "0.0.0.0", "--i-understand-cleartext"]);
    assert_eq!(host.post("/seed", None, json!([list("L1", "Kept")])).1["seeded"], 1);
    let external = SocketAddr::new(local_interface::address(), host.1.port());
    let (status, reply) = host.request_from(external, "/dev/reset", None, "");
    assert_eq!(status, 403, "{reply}");
    assert_eq!(reply["denied"]["code"], "E_AUTH");
    assert_eq!(host.titles(), [json!("Kept")]);
    assert_eq!(host.post("/dev/reset", None, json!({})).0, 200);
    assert_eq!(host.titles(), Vec::<Value>::new());
}

#[test]
fn serve_refuses_reset_like_seed() {
    let project = Project::new();
    let deployed = project.run(&["deploy", "release"]);
    assert!(deployed.status.success(), "{}", String::from_utf8_lossy(&deployed.stderr));
    let host = project.start(&["serve", "release", "--port", "0"]);
    for path in ["/seed", "/dev/reset"] {
        let (status, reply) = host.post(path, None, json!([]));
        assert_eq!(status, 403, "{path}: {reply}");
        assert_eq!(reply["denied"]["code"], "E_AUTH", "{path}: {reply}");
    }
    let refused = project.run(&["reset", "--release", "release"]);
    assert_eq!(refused.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("E_AUTH"));
}
