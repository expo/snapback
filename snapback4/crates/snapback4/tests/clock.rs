//! Development time drives the actual HTTP host and both device stores without sleeping through a period.
use serde_json::{Value, json};
use snapback4_device::{call::call, device::{Backend, Device}, memory::MemoryStore, store::DeviceStore};
use std::{fs, io::{BufRead, BufReader, Read, Write}, net::TcpStream, path::PathBuf, process::{Child, Command, Output, Stdio}, time::{Duration, Instant}};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "use personas alice\ntable stories:\n  at: time\n  expiresAt: time ?\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  public 'clock test'\n  insert <- allow\n  sync public\ntable counters:\n  n: int\n  at: time\n  public 'clock test'\n  insert <- allow\n  sync public\nmutation post():\n  return insert stories {at: now, expiresAt: now + 180000}\nmutation counter():\n  return insert counters {n: 0, at: now}\nquery stories():\n  return stories first 10 by byId\nquery counters():\n  return counters first 10 by byId\nquery time():\n  return now\njob tick():\n  chunk c in counters first 10 by byId:\n    update counters[c.id] {n: c.n + 1, at: now}\nschedule ticking every 2m: tick\n";

struct Fixture(PathBuf);
impl Fixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("sb4-clock-{}-{label}", std::process::id()));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), SOURCE).unwrap(); Self(path)
    }
    fn command(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn start(&self, args: &[&str]) -> Host {
        let mut child = Command::new(BIN).current_dir(&self.0).args(args).args(["--port", "0"]).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let host = Host { child, address: line.trim().trim_start_matches("http://").into() };
        assert!(!host.address.is_empty(), "host did not start"); host
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
struct Host { child: Child, address: String }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
impl Host {
    fn request(&self, method: &str, path: &str, body: Value) -> Value {
        let body = body.to_string();
        let mut stream = TcpStream::connect(&self.address).unwrap(); stream.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap_or_else(|e| panic!("{e}: {answer}"))
    }
    fn post(&self, path: &str, body: Value) -> Value { self.request("POST", path, body) }
    fn query(&self, name: &str) -> Value { self.post(&format!("/q/{name}"), json!({"args":{}}))["data"].clone() }
}

fn device_sync<S: DeviceStore>(mut device: Device<S>, snapshot: &Value, stream: &Value, local_now: i64) {
    let applied = call(&mut device, &json!({"op":"apply", "page":snapshot, "first":true}));
    assert!(applied.get("denied").is_none(), "{applied}");
    let read = |device: &mut Device<S>, name| call(device, &json!({"op":"query", "name":name, "viewer":"dev:alice", "args":{}, "now":local_now}));
    assert_eq!(read(&mut device, "stories")["ok"]["data"].as_array().unwrap().len(), 1);
    let applied = call(&mut device, &json!({"op":"apply", "page":stream, "first":false}));
    assert!(applied.get("denied").is_none(), "{applied}");
    assert_eq!(read(&mut device, "stories")["ok"]["data"], json!([]), "deletion must sync even with the device clock unchanged");
    assert_eq!(read(&mut device, "counters")["ok"]["data"][0]["n"], 1);
}

#[test]
fn advancing_clock_expires_rows_and_fires_two_minute_schedule_on_server_and_both_stores() {
    let f = Fixture::new("sync");
    let host = f.start(&["dev", "--no-watch"]);
    let sent = host.post("/m/post", json!({"id":"story", "args":{}})); assert_eq!(sent["state"], "sent", "{sent}");
    let sent = host.post("/m/counter", json!({"id":"counter", "args":{}})); assert_eq!(sent["state"], "sent", "{sent}");
    let local_now = host.query("time").as_i64().unwrap();
    let snapshot = host.post("/sync", json!({"from":0}));
    assert_eq!(host.query("stories").as_array().unwrap().len(), 1);
    assert_eq!(host.query("counters")[0]["n"], 0);
    let start = Instant::now();
    let advanced = host.post("/dev/clock/advance", json!({"duration":"185s"}));
    assert!(advanced.get("denied").is_none(), "{advanced}");
    assert_eq!(host.query("stories"), json!([]), "expiry currently needs a real 185-second wait");
    assert_eq!(host.query("counters")[0]["n"], 1, "every 2m fires once after missed boundaries");
    let stream = host.post("/sync", json!({"from":snapshot["watermark"], "stream":true}));
    assert!(!stream["events"].as_array().unwrap().is_empty(), "{stream}");
    let backend: Backend = serde_json::from_value(host.request("GET", "/schema", json!(null))).unwrap();
    device_sync(Device::open_store(MemoryStore::new(), Some(backend.clone())).unwrap(), &snapshot, &stream, local_now);
    device_sync(Device::open(&f.0.join("device.sqlite"), Some(backend)).unwrap(), &snapshot, &stream, local_now);
    println!("clock: advanced_ms=185000 expiry_rows=1 schedule_runs=1 device_stores=2 wall_ms={}", start.elapsed().as_millis());
}

fn output_json(out: Output) -> Value {
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn offset_cli_advance_and_rejected_inputs_keep_time_monotone() {
    let f = Fixture::new("offset");
    let before = snapback4_core::now_ms();
    let host = f.start(&["dev", "--no-watch", "--fresh", "--clock-offset", "+25h"]);
    let now = host.query("time").as_i64().unwrap();
    assert!(now >= before + 90_000_000 && now <= snapback4_core::now_ms() + 90_000_000);
    let port = host.address.rsplit(':').next().unwrap();
    let advanced = output_json(f.command(&["clock", "advance", "+2m", "--port", port]));
    assert_eq!(advanced["advancedMs"], 120_000);
    assert!(advanced["now"].as_i64().unwrap() >= now + 120_000);
    for duration in ["-1s", "0s", "1", "1.5m", "++2m", "-0s", "", "99999999999999999999999999d", "9007199254740991ms"] {
        let before = host.query("time").as_i64().unwrap();
        let wall = snapback4_core::now_ms();
        let refused = host.post("/dev/clock/advance", json!({"duration":duration}));
        assert_eq!(refused["denied"]["code"], "E_CLOCK_INPUT", "{duration}: {refused}");
        let after = host.query("time").as_i64().unwrap();
        assert!(after >= before && after - before <= snapback4_core::now_ms() - wall + 5, "an invalid advance changed the clock");
    }
    assert_eq!(host.post("/dev/clock/advance", json!({"duration":2}))["denied"]["code"], "E_CLOCK_INPUT");
    let out = f.command(&["dev", "--clock-offset", "999999999999999999999d"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("E_CLOCK_INPUT"));
}

#[test]
fn run_now_pins_query_mutation_and_job_without_changing_running_dev() {
    let f = Fixture::new("run");
    let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
    let then = 1_789_352_669_447i64;
    let at = then.to_string();
    let queried = output_json(f.command(&["run", "time", "--now", &at, "--json"]));
    assert_eq!(queried["data"], then);
    let post = output_json(f.command(&["run", "post", "--now", &at, "--json"]));
    assert_eq!(post["result"]["at"], then);
    assert_eq!(post["result"]["expiresAt"], then + 180_000);
    let counter = output_json(f.command(&["run", "counter", "--now", &at, "--json"]));
    assert_eq!(counter["result"]["at"], then);
    let ran = output_json(f.command(&["run", "tick", "--now", &at, "--json"]));
    assert_eq!(ran["state"], "done");
    assert_eq!(host.query("counters")[0]["at"], then);
    let wall = snapback4_core::now_ms();
    let relative = output_json(f.command(&["run", "time", "--now", "+25h", "--json"]));
    assert!(relative["data"].as_i64().unwrap() >= wall + 90_000_000);
    assert!(host.query("time").as_i64().unwrap() <= snapback4_core::now_ms(), "run --now must not advance the host");
    for invalid in ["yesterday", "-1", "9007199254740992", "+999999999999999999999d"] {
        let out = f.command(&["run", "time", "--now", invalid]);
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("E_CLOCK_INPUT"));
    }
}

#[test]
fn release_refuses_clock_flags_and_the_endpoint() {
    let f = Fixture::new("release");
    for args in [vec!["serve", "missing", "--clock-offset", "+2m"], vec!["serve", "missing", "--now", "1"], vec!["clock", "advance", "2m", "--release", "missing"], vec!["run", "time", "--now", "1", "--release", "missing"]] {
        let out = f.command(&args);
        assert!(!out.status.success());
        assert!(String::from_utf8_lossy(&out.stderr).contains("E_CLOCK_DEV_ONLY"), "{out:?}");
    }
    let deployed = f.command(&["deploy", "deployment"]);
    assert!(deployed.status.success(), "{}", String::from_utf8_lossy(&deployed.stderr));
    let host = f.start(&["serve", "deployment"]);
    let refused = host.post("/dev/clock/advance", json!({"duration":"+25h"}));
    assert_eq!(refused["denied"]["code"], "E_CLOCK_DEV_ONLY");
    let port = host.address.rsplit(':').next().unwrap();
    let refused = f.command(&["clock", "advance", "2m", "--port", port]);
    assert!(!refused.status.success());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("E_CLOCK_DEV_ONLY"));
}

#[test]
fn advance_preserves_replay_holds_and_restart_does_not_replay_held_boundaries() {
    let f = Fixture::new("hold");
    let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
    host.post("/m/counter", json!({"id":"counter", "args":{}}));
    let advanced = host.post("/dev/clock/advance", json!({"duration":"25h"}));
    assert_eq!(advanced["work"]["schedules"], 0);
    assert_eq!(host.query("counters")[0]["n"], 0);
    drop(host);
    let host = f.start(&["dev", "--no-watch", "--clock-offset", "+25h"]);
    assert_eq!(host.query("counters")[0]["n"], 0, "releasing a hold starts at the next boundary");
    let advanced = host.post("/dev/clock/advance", json!({"duration":"2m"}));
    assert_eq!(advanced["work"]["schedules"], 1);
    assert_eq!(host.query("counters")[0]["n"], 1);
}

#[test]
fn advance_drains_expiry_across_multiple_bounded_sweeps() {
    let f = Fixture::new("sweep");
    let host = f.start(&["dev", "--no-watch", "--clock-offset", "+25h"]);
    let now = host.query("time").as_i64().unwrap();
    let rows: Vec<_> = (0..2005).map(|n| json!({"table":"stories", "row":{"id":format!("s{n}"), "at":now, "expiresAt":now + 3_600_000}})).collect();
    assert_eq!(host.post("/seed", json!(rows))["seeded"], 2005);
    let advanced = host.post("/dev/clock/advance", json!({"duration":"2h"}));
    assert_eq!(advanced["work"]["expired"], 2005, "{advanced}");
    let engine = snapback4_core::Engine::open(snapback4_core::Store::open(&f.0.join(".snapback4/store.sqlite")).unwrap()).unwrap();
    let remaining: i64 = engine.store().conn().query_row("SELECT count(*) FROM r WHERE t = 'stories'", [], |row| row.get(0)).unwrap();
    assert_eq!(remaining, 0, "the endpoint waits for physical deletion, not only logical expiry");
}

#[test]
fn clock_alias_and_refusals_are_discoverable() {
    assert_eq!(snapback4_lang::guide::card("clock"), snapback4_lang::guide::card("jobs"));
    for code in ["E_CLOCK_INPUT", "E_CLOCK_DEV_ONLY"] { assert!(snapback4_lang::guide::explain_code(code).is_some()); }
    let help = Command::new(BIN).arg("--help").output().unwrap();
    let help = String::from_utf8(help.stdout).unwrap();
    for form in ["--clock-offset", "--now", "clock advance"] { assert!(help.contains(form)); }
}
