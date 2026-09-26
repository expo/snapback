//! Development time drives the actual HTTP host and both device stores without sleeping through a period.
use serde_json::{Value, json};
use snapback4_device::{call::call, device::{Backend, Device}, memory::MemoryStore, store::DeviceStore};
use std::{fs, io::{BufRead, BufReader, Read, Write}, net::TcpStream, path::PathBuf, process::{Child, Command, Output, Stdio}, time::{Duration, Instant}};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "use personas alice\ntable stories:\n  at: time\n  expiresAt: time ?\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  public 'clock test'\n  insert <- allow\n  sync public\ntable counters:\n  n: int\n  at: time\n  public 'clock test'\n  insert <- allow\n  sync public\nmutation post():\n  return insert stories {at: now, expiresAt: now + 180000}\nmutation counter():\n  return insert counters {n: 0, at: now}\nquery stories():\n  return stories first 10 by byId\nquery counters():\n  return counters first 10 by byId\nquery time():\n  return now\njob tick():\n  chunk c in counters first 10 by byId:\n    update counters[c.id] {n: c.n + 1, at: now}\nschedule ticking every 2m: tick\n";

struct Fixture(PathBuf);

#[test]
fn doctor_reports_the_exact_schedule_period_without_minute_truncation() {
    for (period, shown) in [("90s", "90s"), ("90001ms", "90001ms"), ("120s", "2m")] {
        let f = Fixture::new(&format!("period-{period}"));
        fs::write(f.0.join("snapback/schema.q"), SOURCE.replace("every 2m:", &format!("every {period}:"))).unwrap();
        let _host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
        let output = f.command(&["doctor"]);
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        assert!(text.contains(&format!("schedule  ticking every {shown} → tick")), "{text}");
    }
}

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
        self.auth_request(method, path, body, "x-snapback-persona: alice")
    }
    fn auth_request(&self, method: &str, path: &str, body: Value, auth: &str) -> Value {
        let body = body.to_string();
        let mut stream = TcpStream::connect(&self.address).unwrap(); stream.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
        write!(stream, "{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{auth}\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap_or_else(|e| panic!("{e}: {answer}"))
    }
    fn post(&self, path: &str, body: Value) -> Value { self.request("POST", path, body) }
    fn query(&self, name: &str) -> Value { self.post(&format!("/q/{name}"), json!({"args":{}}))["data"].clone() }
}

fn device_sync<S: DeviceStore>(mut device: Device<S>, snapshot: &Value, stream: &Value, local_now: i64) {
    let applied = call(&mut device, json!({"op":"apply", "page":snapshot, "first":true}));
    assert!(applied.get("denied").is_none(), "{applied}");
    let read = |device: &mut Device<S>, name| call(device, json!({"op":"query", "name":name, "viewer":"dev:alice", "args":{}, "now":local_now}));
    assert_eq!(read(&mut device, "stories")["ok"]["data"].as_array().unwrap().len(), 1);
    let applied = call(&mut device, json!({"op":"apply", "page":stream, "first":false}));
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
fn clock_advance_expires_presence_grace_and_a_new_poll_reconnects() {
    let f = Fixture::new("presence");
    fs::write(f.0.join("snapback/schema.q"), format!("{SOURCE}\nquery connections():\n  return connected[viewer]\n")).unwrap();
    let host = f.start(&["dev", "--no-watch", "--hold-schedules", "--clock-offset", "+25h"]);
    assert_eq!(host.query("connections"), 0);
    host.request("GET", "/changes?wait=0", json!(null));
    assert_eq!(host.query("connections"), 1, "an answered poll has grace");
    let start = Instant::now();
    let port = host.address.rsplit(':').next().unwrap();
    let advanced = output_json(f.command(&["clock", "advance", "36s", "--port", port]));
    assert_eq!(advanced["advancedMs"], 36_000);
    assert_eq!(host.query("connections"), 0, "development time must expire an ended poll's grace");
    host.request("GET", "/changes?wait=0", json!(null));
    assert_eq!(host.query("connections"), 1, "a new poll reconnects at the advanced time");
    let advanced = host.post("/dev/clock/advance", json!({"duration":"36s"}));
    assert_eq!(advanced["advancedMs"], 36_000);
    assert_eq!(host.query("connections"), 0);
    println!("presence: advances=2 advanced_ms=72000 grace_ms=35000 wall_ms={}", start.elapsed().as_millis());
    let seq = host.request("GET", "/probe", json!(null))["seq"].as_u64().unwrap();
    let mut poll = TcpStream::connect(&host.address).unwrap();
    poll.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    write!(poll, "GET /changes?since={seq}&wait=25&heartbeat=1 HTTP/1.1\r\nHost: localhost\r\nx-snapback-persona: alice\r\nConnection: close\r\n\r\n").unwrap();
    let mut poll = BufReader::new(poll);
    let mut header = String::new(); poll.read_line(&mut header).unwrap();
    assert!(header.starts_with("HTTP/1.1 200"), "{header}");
    // Receiving the streaming header proves the poll entered, without a sleep.
    for _ in 0..2 {
        assert_eq!(host.post("/dev/clock/advance", json!({"duration":"36s"}))["advancedMs"], 36_000);
        assert_eq!(host.query("connections"), 1, "an open poll survives clock advances");
    }
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
        // Bracket both server reads so scheduling the first reply is counted.
        let wall = snapback4_core::now_ms();
        let before = host.query("time").as_i64().unwrap();
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
fn run_now_refuses_live_dev_and_pins_offline_query_mutation_and_job() {
    let f = Fixture::new("run");
    let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
    let then = 1_789_352_669_447i64;
    let at = then.to_string();
    let refused = f.command(&["run", "time", "--now", &at, "--json"]);
    assert!(!refused.status.success()); assert!(String::from_utf8_lossy(&refused.stderr).contains("E_STORE_BUSY"));
    assert!(host.query("time").as_i64().unwrap() <= snapback4_core::now_ms());
    drop(host);
    let queried = output_json(f.command(&["run", "time", "--now", &at, "--json"]));
    assert_eq!(queried["data"], then);
    let post = output_json(f.command(&["run", "post", "--now", &at, "--json"]));
    assert_eq!(post["result"]["at"], then);
    assert_eq!(post["result"]["expiresAt"], then + 180_000);
    let counter = output_json(f.command(&["run", "counter", "--now", &at, "--json"]));
    assert_eq!(counter["result"]["at"], then);
    let ran = output_json(f.command(&["run", "tick", "--now", &at, "--json"]));
    assert_eq!(ran["state"], "done");
    let wall = snapback4_core::now_ms();
    let relative = output_json(f.command(&["run", "time", "--now", "+25h", "--json"]));
    assert!(relative["data"].as_i64().unwrap() >= wall + 90_000_000);
    let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
    assert_eq!(host.query("counters")[0]["at"], then);
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

#[test]
fn writes_use_dev_clock_for_timestamps_expiry_and_replay() {
    let f = Fixture::new("write-offset");
    let host = f.start(&["dev", "--no-watch", "--hold-schedules", "--clock-offset", "+25h"]);
    let before = host.query("time").as_i64().unwrap();
    let writes = [
        json!({"id":"write-one", "args":{}, "newIds":["write-row-one"]}),
        json!({"id":"write-two", "args":{}, "newIds":["write-row-two"]}),
    ];
    let receipts: Vec<Value> = writes.iter().map(|write| host.post("/m/post", write.clone())).collect();
    let after = host.query("time").as_i64().unwrap();
    for receipt in &receipts {
        assert_eq!(receipt["state"], "sent", "{receipt}");
        let at = receipt["result"]["at"].as_i64().unwrap();
        println!("write clock: id={} at={at} server_before={before} server_after={after} expires_at={}", receipt["id"], receipt["result"]["expiresAt"]);
        assert!((before..=after).contains(&at), "a write must use the dev clock: {receipt}");
        assert_eq!(receipt["result"]["expiresAt"], at + 180_000);
    }
    let rows = host.query("stories");
    assert_eq!(rows.as_array().unwrap().len(), 2, "fresh rows must not already be expired");
    let advanced = host.post("/dev/clock/advance", json!({"duration":"1s"}));
    assert_eq!(advanced["advancedMs"], 1000);
    for (write, first) in writes.iter().zip(&receipts) {
        let replay = host.post("/m/post", write.clone());
        assert_eq!(replay["state"], "sent");
        assert_eq!(replay["replayed"], true);
        assert_eq!(replay["seq"], first["seq"]);
        assert!(replay.get("result").is_none());
    }
    assert_eq!(host.query("stories"), rows, "replay preserves row IDs, timestamps and expiry without another insert");
}

fn effect_fixture(label: &str) -> Fixture {
    let f = Fixture::new(label);
    fs::write(f.0.join("snapback/schema.q"), format!("{SOURCE}\neffect notify\nmutation notify():\n  emit notify {{at: now}}\n  return now\n")).unwrap();
    f
}

fn effect_token(f: &Fixture, release: bool) -> String {
    if !release { assert!(f.command(&["test", "--residency"]).status.success()); }
    let args = if release { vec!["token", "--service", "worker", "--release", "deployment"] } else { vec!["token", "--service", "worker"] };
    let out = f.command(&args);
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    format!("Authorization: Bearer {}", String::from_utf8(out.stdout).unwrap().trim())
}

#[test]
fn clock_advance_preserves_a_live_effect_claim_and_settlement() {
    let f = effect_fixture("effect-live");
    let auth = effect_token(&f, false);
    let host = f.start(&["dev", "--no-watch", "--hold-schedules", "--clock-offset", "+25h"]);
    assert_eq!(host.post("/m/notify", json!({"id":"notify", "args":{}}))["state"], "sent");
    let claimed = host.auth_request("POST", "/effects/claim", json!({"lease":60}), &auth);
    let effect = &claimed["effects"][0];
    assert_eq!(effect["state"], "running", "{claimed}");
    let start = Instant::now();
    let port = host.address.rsplit(':').next().unwrap();
    let advanced = output_json(f.command(&["clock", "advance", "120s", "--port", port]));
    assert_eq!(advanced["advancedMs"], 120_000);
    let after = host.auth_request("GET", "/effects", json!(null), &auth);
    let settled = host.auth_request("POST", &format!("/effects/{}/done", effect["id"].as_str().unwrap()), json!({"result":"sent once"}), &auth);
    println!("effect clock: after_advance={after} settlement={settled}");
    assert_eq!(settled["ok"], true, "{settled}");
    assert_eq!(after["effects"][0]["state"], "running", "{after}");
    assert_eq!(after["effects"][0]["leaseUntil"].as_i64().unwrap() - effect["leaseUntil"].as_i64().unwrap(), 120_000);
    assert_eq!(settled["effect"]["attempt"], 1);
    assert_eq!(host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"], json!([]));
    println!("effect clock: advanced_ms=120000 lease_ms=60000 requeues=0 attempts=1 wall_ms={}", start.elapsed().as_millis());
}

#[test]
fn clock_advance_preserves_a_live_action_claim_session_and_settlement() {
    let f = Fixture::new("action-live");
    fs::write(f.0.join("snapback/schema.q"), format!("use server\n{SOURCE}\naction notify()\neffect ping\nmutation ping():\n  emit ping {{}}\n")).unwrap();
    let auth = effect_token(&f, false);
    let host = f.start(&["dev", "--no-watch", "--hold-schedules", "--clock-offset", "+25h"]);
    assert_eq!(host.post("/a/notify?wait=0", json!({"id":"action-live", "args":{}}))["state"], "pending");
    let claimed = host.auth_request("POST", "/actions/claim", json!({"lease":120, "session":60}), &auth);
    let action = &claimed["requests"][0];
    assert_eq!(action["attempt"], 1);
    let token = action["session"]["token"].as_str().unwrap();
    let viewer = format!("Authorization: Bearer {token}");
    let settle_auth = format!("{auth}\r\nx-snapback-action-lease: {token}");
    let original_expiry = action["session"]["expiresAt"].as_i64().unwrap();
    let conn = rusqlite::Connection::open(f.0.join(".snapback4/store.sqlite")).unwrap();
    assert_eq!(host.post("/m/ping", json!({"args":{}}))["state"], "sent");
    let effect = host.auth_request("POST", "/effects/claim", json!({"lease":60}), &auth)["effects"][0].clone();
    let effect_deadline = || conn.query_row("SELECT lease_until FROM _outbox", [], |row| row.get::<_, i64>(0)).unwrap();
    let original_effect_expiry = effect_deadline();
    let deadlines = || conn.query_row("SELECT r.lease_until, s.expires_at FROM _requests r JOIN _sessions s ON s.token_digest = r.session_digest WHERE r.id = 'action-live'", [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?))).unwrap();
    assert_eq!(deadlines(), (original_expiry, original_expiry));
    let service_expiry = || conn.query_row("SELECT expires_at FROM _sessions WHERE kind = 'service'", [], |row| row.get::<_, i64>(0)).unwrap();
    let original_service_expiry = service_expiry();
    assert_eq!(host.post("/dev/clock/advance", json!({"duration":"9007199254740991ms"}))["denied"]["code"], "E_CLOCK_INPUT");
    assert_eq!(deadlines(), (original_expiry, original_expiry), "invalid advances leave every deadline untouched");
    // Force the last lease update to fail: sessions, effects and the clock
    // must all retain their earlier deadlines before an ordinary retry.
    conn.execute_batch("CREATE TRIGGER refuse_action_shift BEFORE UPDATE OF lease_until ON _requests BEGIN SELECT RAISE(ABORT, 'test refuses action shift'); END;").unwrap();
    let wall = snapback4_core::now_ms();
    let before = host.query("time").as_i64().unwrap();
    assert_eq!(host.post("/dev/clock/advance", json!({"duration":"120s"}))["denied"]["code"], "E_STORE");
    assert_eq!(deadlines(), (original_expiry, original_expiry));
    assert_eq!(effect_deadline(), original_effect_expiry);
    let elapsed = host.query("time").as_i64().unwrap() - before;
    // `wall` was read before `before` and this read follows the second server read, so the server
    // interval is nested inside the wall interval: load cannot fail this, an applied 120 s advance cannot pass it.
    let bracket = snapback4_core::now_ms() - wall;
    assert!(elapsed <= bracket + 50 && bracket < 100_000, "a refused lease transaction must not advance the clock: server {elapsed} ms inside a wall bracket of {bracket} ms");
    conn.execute_batch("DROP TRIGGER refuse_action_shift;").unwrap();
    let start = Instant::now();
    let port = host.address.rsplit(':').next().unwrap();
    let advanced = output_json(f.command(&["clock", "advance", "120s", "--port", port]));
    assert_eq!(advanced["advancedMs"], 120_000);
    let state: String = conn.query_row("SELECT state FROM _requests WHERE id = 'action-live'", [], |row| row.get(0)).unwrap();
    println!("action clock: after_advance_state={state}");
    assert_eq!(state, "running", "clock advance must not sweep the worker's live action claim");
    assert_eq!(deadlines(), (original_expiry + 120_000, original_expiry + 120_000));
    assert_eq!(host.post("/dev/clock/advance", json!({"duration":"120s"}))["advancedMs"], 120_000);
    assert_eq!(deadlines(), (original_expiry + 240_000, original_expiry + 240_000));
    assert_eq!(effect_deadline(), original_effect_expiry + 240_000);
    assert_eq!(service_expiry(), original_service_expiry, "an advance does not renew ordinary service credentials");
    assert!(host.auth_request("POST", "/q/time", json!({"args":{}}), &viewer)["data"].is_number(), "the original viewer session remains usable");
    assert_eq!(host.auth_request("POST", "/actions/claim", json!({}), &auth)["requests"], json!([]), "another claim cannot steal the running request");
    let settled = host.auth_request("POST", "/actions/action-live/done", json!({"result":"sent once"}), &settle_auth);
    assert_eq!(settled["ok"], true, "{settled}");
    assert_eq!(settled["request"]["state"], "done");
    assert_eq!(settled["request"]["result"], "sent once");
    assert_eq!(host.auth_request("POST", "/q/time", json!({"args":{}}), &viewer)["denied"]["code"], "E_AUTH", "settlement still revokes the original viewer session");
    assert_eq!(host.auth_request("POST", &format!("/effects/{}/done", effect["id"].as_str().unwrap()), json!({}), &auth)["ok"], true);
    println!("action clock: advances=2 advanced_ms=240000 lease_ms=60000 session_extension_ms=240000 requeues=0 attempts=1 wall_ms={}", start.elapsed().as_millis());
}

#[test]
fn action_retry_times_follow_dev_clock_and_real_expiry_still_fences_dev_and_serve() {
    for release in [false, true] {
        let f = Fixture::new(if release { "action-expiry-release" } else { "action-expiry-dev" });
        fs::write(f.0.join("snapback/schema.q"), format!("use server\n{SOURCE}\naction notify()\n")).unwrap();
        if release { assert!(f.command(&["deploy", "deployment"]).status.success()); }
        let auth = effect_token(&f, release);
        let host = f.start(if release { &["serve", "deployment"] } else { &["dev", "--no-watch", "--hold-schedules"] });
        assert_eq!(host.auth_request("POST", "/a/notify?wait=0", json!({"id":"expiry", "args":{}}), &auth)["state"], "pending");
        let first = host.auth_request("POST", "/actions/claim", json!({"lease":1, "session":1}), &auth)["requests"][0].clone();
        let token = first["session"]["token"].as_str().unwrap();
        let expiry = first["session"]["expiresAt"].as_i64().unwrap();
        let start = Instant::now();
        while snapback4_core::now_ms() <= expiry { std::thread::sleep(Duration::from_millis(10)); }
        if !release { assert_eq!(host.post("/dev/clock/advance", json!({"duration":"120s"}))["advancedMs"], 120_000); }
        assert_eq!(host.auth_request("POST", "/q/time", json!({"args":{}}), &format!("Authorization: Bearer {token}"))["denied"]["code"], "E_AUTH", "an overdue action session stays overdue after an advance");
        let second = host.auth_request("POST", "/actions/claim", json!({}), &auth)["requests"][0].clone();
        assert_eq!(second["attempt"], 2);
        let refused = host.auth_request("POST", "/actions/expiry/done", json!({}), &format!("{auth}\r\nx-snapback-action-lease: {token}"));
        assert_eq!(refused["denied"]["code"], "E_ACTION_LEASE");
        let second_auth = format!("{auth}\r\nx-snapback-action-lease: {}", second["session"]["token"].as_str().unwrap());
        println!("action expiry: release={release} lease_ms=1000 requeues=1 attempts=2 wall_ms={}", start.elapsed().as_millis());
        if release { assert_eq!(host.auth_request("POST", "/actions/expiry/done", json!({}), &second_auth)["ok"], true); }
        else {
            assert_eq!(host.auth_request("POST", "/actions/expiry/failed", json!({"error":"provider unavailable", "retry":true}), &second_auth)["ok"], true);
            let conn = rusqlite::Connection::open(f.0.join(".snapback4/store.sqlite")).unwrap();
            let next_at = || conn.query_row("SELECT next_at FROM _requests WHERE id = 'expiry'", [], |row| row.get::<_, i64>(0)).unwrap();
            let next = next_at();
            assert_eq!(host.post("/dev/clock/advance", json!({"duration":"4s"}))["advancedMs"], 4_000);
            assert_eq!(next_at(), next, "an advance does not postpone a queued retry");
            let third = host.auth_request("POST", "/actions/claim", json!({}), &auth)["requests"][0].clone();
            assert_eq!(third["attempt"], 3);
            assert_eq!(host.auth_request("POST", "/actions/expiry/done", json!({}), &format!("{auth}\r\nx-snapback-action-lease: {}", third["session"]["token"].as_str().unwrap()))["ok"], true);
            println!("action retry: advanced_ms=4000 attempts=3 next_at_shift_ms=0");
        }
    }
}

#[test]
fn effect_retry_next_at_still_follows_the_dev_clock() {
    let f = effect_fixture("effect-retry");
    let auth = effect_token(&f, false);
    let host = f.start(&["dev", "--no-watch", "--hold-schedules", "--clock-offset", "+25h"]);
    host.post("/m/notify", json!({"id":"notify", "args":{}}));
    let claimed = host.auth_request("POST", "/effects/claim", json!({}), &auth);
    let id = claimed["effects"][0]["id"].as_str().unwrap();
    let before = host.query("time").as_i64().unwrap();
    let failed = host.auth_request("POST", &format!("/effects/{id}/failed"), json!({"error":"try again", "retry":true}), &auth);
    let next = failed["effect"]["nextAt"].as_i64().unwrap();
    assert!(next >= before + 4_000 && next <= host.query("time").as_i64().unwrap() + 4_000, "{failed}");
    assert_eq!(host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"], json!([]));
    let start = Instant::now();
    assert_eq!(host.post("/dev/clock/advance", json!({"duration":"4s"}))["advancedMs"], 4_000);
    let retry = host.auth_request("POST", "/effects/claim", json!({}), &auth);
    assert_eq!(retry["effects"][0]["id"], id, "{retry}");
    assert_eq!(retry["effects"][0]["attempt"], 2);
    assert_eq!(host.auth_request("POST", &format!("/effects/{id}/done"), json!({}), &auth)["ok"], true);
    println!("effect retry: backoff_ms=4000 advanced_ms=4000 attempts=2 wall_ms={}", start.elapsed().as_millis());
}

#[test]
fn real_time_effect_lease_loss_requeues_in_dev_and_serve() {
    for release in [false, true] {
        let f = effect_fixture(if release { "effect-wall-release" } else { "effect-wall-dev" });
        if release { assert!(f.command(&["deploy", "deployment"]).status.success()); }
        let auth = effect_token(&f, release);
        let host = f.start(if release { &["serve", "deployment"] } else { &["dev", "--no-watch", "--hold-schedules"] });
        assert_eq!(host.auth_request("POST", "/m/notify", json!({"id":"notify", "args":{}}), &auth)["state"], "sent");
        let claimed = host.auth_request("POST", "/effects/claim", json!({"lease":1}), &auth);
        let id = claimed["effects"][0]["id"].as_str().unwrap();
        let start = Instant::now();
        loop {
            let effects = host.auth_request("GET", "/effects", json!(null), &auth);
            if effects["effects"][0]["state"] == "queued" { break; }
            assert!(start.elapsed() < Duration::from_secs(20), "{effects}");
            std::thread::sleep(Duration::from_millis(50));
        }
        let late = host.auth_request("POST", &format!("/effects/{id}/done"), json!({}), &auth);
        assert_eq!(late["denied"]["code"], "E_EFFECT_LEASE", "{late}");
        let retry = host.auth_request("POST", "/effects/claim", json!({}), &auth);
        assert_eq!(retry["effects"][0]["id"], id);
        assert_eq!(retry["effects"][0]["attempt"], 2);
        assert_eq!(host.auth_request("POST", &format!("/effects/{id}/done"), json!({}), &auth)["ok"], true);
        println!("effect wall: release={release} lease_ms=1000 requeues=1 attempts=2 wall_ms={}", start.elapsed().as_millis());
    }
}


#[test]
fn grace_push_is_deferred_until_clock_advance_then_delivered_once() {
    let f = effect_fixture("grace-push");
    fs::write(f.0.join("snapback/schema.q"), format!("{SOURCE}\neffect notify\nmutation push():\n  insert counters {{n: 1, at: now}}\n  if not exists connected[viewer]:\n    emit notify {{recipient: viewer}}\n")).unwrap();
    let auth = effect_token(&f, false);
    let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
    host.request("GET", "/changes?wait=0", json!(null));
    assert_eq!(host.post("/m/push", json!({"id":"push", "args":{}}))["state"], "sent");
    let admitted_by = snapback4_core::now_ms();
    let queued = host.auth_request("GET", "/effects", json!(null), &auth);
    assert_eq!(queued["effects"].as_array().unwrap().len(), 1, "grace must defer the push, not lose it: {queued}");
    let effect = &queued["effects"][0];
    let delay = effect["nextAt"].as_i64().unwrap() - effect["at"].as_i64().unwrap();
    // Presence samples its clock after the mutation's `at` was captured.
    // Admission completion brackets that sample without adding clock tolerance.
    assert!(delay > 0 && effect["nextAt"].as_i64().unwrap() <= admitted_by + 35_000, "{effect}");
    assert_eq!(host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"], json!([]));
    let before = output_json(f.command(&["doctor", "--json"]));
    let lines = before["lines"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n");
    assert!(lines.contains("1 deferred (next at "), "{lines}");
    assert!(lines.contains(&effect["nextAt"].to_string()), "{lines}");
    let start = Instant::now();
    let port = host.address.rsplit(':').next().unwrap();
    assert_eq!(output_json(f.command(&["clock", "advance", "36s", "--port", port]))["advancedMs"], 36_000);
    let after = output_json(f.command(&["doctor", "--json"]));
    let lines = after["lines"].as_array().unwrap().iter().map(|v| v.as_str().unwrap()).collect::<Vec<_>>().join("\n");
    assert!(lines.contains("0 deferred"), "{lines}");
    let claimed = host.auth_request("POST", "/effects/claim", json!({}), &auth);
    assert_eq!(claimed["effects"].as_array().unwrap().len(), 1, "{claimed}");
    assert_eq!(claimed["effects"][0]["id"], effect["id"]);
    assert_eq!(claimed["effects"][0]["attempt"], 1);
    let id = effect["id"].as_str().unwrap();
    assert_eq!(host.auth_request("POST", &format!("/effects/{id}/done"), json!({}), &auth)["ok"], true);
    assert_eq!(host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"], json!([]));
    assert_eq!(host.post("/m/push", json!({"id":"push", "args":{}}))["replayed"], true);
    assert_eq!(host.query("counters").as_array().unwrap().len(), 1);
    println!("grace push: delay_ms={delay} advanced_ms=36000 delivered=1 attempts=1 duplicate_claims=0 wall_ms={}", start.elapsed().as_millis());
}


#[test]
fn grace_push_reconnect_is_satisfied_even_after_restart_and_disconnect() {
    for reconnect in [false, true] {
        let f = effect_fixture(if reconnect { "grace-reconnect" } else { "grace-restart" });
        fs::write(f.0.join("snapback/schema.q"), format!("{SOURCE}\neffect notify\nmutation push():\n  if not exists connected[viewer]:\n    emit notify {{recipient: viewer}}\n")).unwrap();
        let auth = effect_token(&f, false);
        let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
        host.request("GET", "/changes?wait=0", json!(null));
        assert_eq!(host.post("/m/push", json!({"id":"push", "args":{}}))["state"], "sent");
        let queued = host.auth_request("GET", "/effects", json!(null), &auth)["effects"][0].clone();
        assert_eq!(queued["state"], "queued");
        if reconnect { host.request("GET", "/changes?wait=0", json!(null)); }
        drop(host);
        let host = f.start(&["dev", "--no-watch", "--hold-schedules"]);
        assert_eq!(host.auth_request("GET", "/effects", json!(null), &auth)["effects"][0]["nextAt"], queued["nextAt"]);
        assert_eq!(host.post("/dev/clock/advance", json!({"duration":"36s"}))["advancedMs"], 36_000);
        let claimed = host.auth_request("POST", "/effects/claim", json!({}), &auth);
        if reconnect {
            assert_eq!(claimed["effects"], json!([]));
            let effect = host.auth_request("GET", "/effects?state=satisfied", json!(null), &auth)["effects"][0].clone();
            assert_eq!(effect["id"], queued["id"]);
            assert_eq!(effect["attempt"], 0);
            assert_eq!(effect["result"], json!({"outcome":"presence_reconnected"}));
        } else {
            assert_eq!(claimed["effects"].as_array().unwrap().len(), 1);
            assert_eq!(claimed["effects"][0]["id"], queued["id"]);
            let id = queued["id"].as_str().unwrap();
            assert_eq!(host.auth_request("POST", &format!("/effects/{id}/done"), json!({}), &auth)["ok"], true);
        }
        assert_eq!(host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"], json!([]));
        println!("grace HTTP restart: reconnect={reconnect} delivered={} attempts={}", u8::from(!reconnect), u8::from(!reconnect));
    }
}

#[test]
fn grace_push_serve_keeps_deadline_and_reconnect_record_for_claim_after_restart() {
    let f = effect_fixture("grace-serve");
    fs::write(f.0.join("snapback/schema.q"), "effect notify\nmutation push():\n  if not exists connected[viewer]:\n    emit notify {recipient: viewer}\n").unwrap();
    assert!(f.command(&["deploy", "deployment"]).status.success());
    let auth = effect_token(&f, true);
    let host = f.start(&["serve", "deployment"]);
    // No connection/grace: immediate, also on the release host.
    assert_eq!(host.auth_request("POST", "/m/push", json!({"id":"immediate", "args":{}}), &auth)["state"], "sent");
    let immediate = host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"][0].clone();
    assert_eq!(immediate["state"], "running");
    assert_eq!(host.auth_request("POST", &format!("/effects/{}/done", immediate["id"].as_str().unwrap()), json!({}), &auth)["ok"], true);
    host.auth_request("GET", "/changes?wait=0", json!(null), &auth);
    assert_eq!(host.auth_request("POST", "/m/push", json!({"id":"deferred", "args":{}}), &auth)["state"], "sent");
    let admitted_by = snapback4_core::now_ms();
    let queued = host.auth_request("GET", "/effects?state=queued", json!(null), &auth)["effects"][0].clone();
    let deadline = queued["nextAt"].as_i64().unwrap();
    assert!(deadline > queued["at"].as_i64().unwrap() && deadline <= admitted_by + 35_000, "{queued}");
    assert_eq!(host.auth_request("POST", "/effects/claim", json!({}), &auth)["effects"], json!([]));
    host.auth_request("GET", "/changes?wait=0", json!(null), &auth);
    drop(host);
    // Reopen the real release store and pin claim time at its durable
    // deadline; production has no clock-control route and needs no sleep.
    let mut engine = snapback4_core::Engine::open(snapback4_core::Store::open(&f.0.join("deployment/store.sqlite")).unwrap()).unwrap();
    assert!(engine.claim_effects("service:worker", None, 10, 60_000, deadline).unwrap().is_empty());
    let satisfied = engine.effects(Some("satisfied"), 10).unwrap();
    assert_eq!(satisfied.len(), 1);
    assert_eq!(satisfied[0].attempts, 0);
    assert_eq!(satisfied[0].result.as_ref().unwrap().field("outcome").unwrap().as_str().unwrap(), "presence_reconnected");
    println!("grace serve: immediate_delivered=1 deferred_delivered=0 satisfied=1 attempts=0 restarts=1");
}

#[test]
fn maintained_column_activation_uses_offset_clock_in_watch_startup_and_cli() {
    const BEFORE: &str = "use personas alice\ntable posts:\n  at: time\n  expiresAt: time ?\n  by byExpiry: expiresAt, id\n  expire at .expiresAt\n  public\n  sync public\ntable likes:\n  postId: posts\n  public\n  online only\nquery one():\n  return posts['p']\nquery time():\n  return now\n";
    let after = BEFORE.replacen("  at: time", "  at: time\n  likeCount: count likes by postId", 1);
    for path in ["watch", "startup", "cli"] {
        let f = Fixture::new(&format!("column-{path}"));
        fs::write(f.0.join("snapback/schema.q"), BEFORE).unwrap();
        let host = f.start(&["dev", "--clock-offset", "-2h", "--hold-schedules"]);
        let now = host.query("time").as_i64().unwrap();
        let expires = now + 3_600_000;
        assert!(now < expires && expires < snapback4_core::now_ms());
        let seeded = host.post("/seed", json!([
            {"table":"posts", "row":{"id":"p", "at":17, "expiresAt":expires}},
            {"table":"likes", "row":{"id":"l", "postId":"p"}}
        ]));
        assert_eq!(seeded["seeded"], 2, "{seeded}");
        if path == "watch" {
            fs::write(f.0.join("snapback/schema.q"), &after).unwrap();
            let end = Instant::now() + Duration::from_secs(15);
            loop {
                let row = host.query("one");
                if row["likeCount"] == 1 { assert_eq!(row["at"], 17); break; }
                assert!(Instant::now() < end, "offset-clock adoption did not mirror live parent: {row}");
                std::thread::sleep(Duration::from_millis(20));
            }
        } else {
            drop(host);
            fs::write(f.0.join("snapback/schema.q"), &after).unwrap();
            if path == "cli" {
                let reply = output_json(f.command(&["run", "one", "--as", "alice", "--now", &now.to_string()]));
                assert_eq!(reply["data"]["likeCount"], 1, "{reply}");
            } else {
                let host = f.start(&["dev", "--clock-offset", "-2h", "--no-watch", "--hold-schedules"]);
                assert_eq!(host.query("one")["likeCount"], 1);
            }
        }
    }
}
