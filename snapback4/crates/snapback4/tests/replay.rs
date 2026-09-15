//! Replay holds fence worker claims and schedule admission, not mutation commits.
use serde_json::{Value, json};
use snapback4_core::{Engine, Store};
use std::{fs, io::{BufRead, BufReader, Read, Write}, net::TcpStream, path::PathBuf, process::{Child, Command, Stdio}, time::Duration};
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "use personas alice\neffect notify\ntable items:\n  n: int\n  public 'test'\nmutation send():\n  emit notify {n: 7}\n  return 7\njob tick():\n  chunk row in items first 10 by byId:\n    update items[row.id] {n: 1}\nschedule ticking every 1m: tick\n";
struct Fixture(PathBuf);
impl Fixture {
    fn new(label: &str) -> Self {
        let path = std::env::temp_dir().join(format!("sb4-replay-{}-{label}", std::process::id()));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), SOURCE).unwrap(); Self(path)
    }
    fn engine(&self) -> Engine { Engine::open(Store::open(&self.0.join(".snapback4/store.sqlite")).unwrap()).unwrap() }
    fn start(&self, flags: &[&str]) -> Host {
        let mut child = Command::new(BIN).current_dir(&self.0).args(["dev", "--port", "0", "--no-watch"]).args(flags).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let host = Host { child, address: line.trim().trim_start_matches("http://").into() };
        assert!(!host.address.is_empty(), "dev did not start"); host
    }
}
impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
struct Host { child: Child, address: String }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
impl Host {
    fn post(&self, path: &str, body: Value, auth: &str) -> Value {
        let body = body.to_string();
        let mut stream = TcpStream::connect(&self.address).unwrap(); stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{auth}\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap_or_else(|e| panic!("{e}: {answer}"))
    }
}
#[test]
fn held_effects_remain_durable_and_claimable_after_restart() {
    let f = Fixture::new("effects");
    let host = f.start(&["--hold-effects"]);
    let sent = host.post("/m/send", json!({"id":"replay", "args":{}}), "x-snapback-persona: alice");
    assert_eq!(sent["result"], 7, "{sent}");
    let token = Command::new(BIN).current_dir(&f.0).args(["token", "--service", "worker"]).output().unwrap();
    assert!(token.status.success());
    let auth = format!("Authorization: Bearer {}", String::from_utf8(token.stdout).unwrap().trim());
    assert!(host.post("/effects/claim", json!({}), "").get("denied").is_some());
    assert_eq!(host.post("/effects/claim", json!({}), &auth)["effects"], json!([]));
    let queued = f.engine().effects(Some("queued"), 10).unwrap();
    assert_eq!(queued.len(), 1); assert_eq!(queued[0].attempts, 0);
    drop(host);
    let host = f.start(&[]);
    let claimed = host.post("/effects/claim", json!({}), &auth);
    assert_eq!(claimed["effects"].as_array().unwrap().len(), 1);
    assert_eq!(claimed["effects"][0]["payload"]["n"], 7);
}
#[test]
fn held_schedules_skip_missed_periods_and_resume_at_the_next_boundary() {
    let f = Fixture::new("schedules");
    let host = f.start(&["--hold-schedules"]);
    f.engine().store().set_meta("schedule:ticking", "0").unwrap();
    std::thread::sleep(Duration::from_millis(1300));
    assert!(f.engine().jobs(10).unwrap().is_empty());
    drop(host);
    let host = f.start(&[]);
    let mut engine = f.engine();
    let now = snapback4_core::now_ms();
    assert!(engine.fire_schedules(now).unwrap().is_empty(), "held periods must not catch up on release");
    let next = engine.schema().schedules[0].boundary(now) + 60_000;
    assert_eq!(engine.fire_schedules(next).unwrap(), vec!["ticking"]);
    assert!(engine.fire_schedules(next).unwrap().is_empty());
    assert_eq!(engine.jobs(10).unwrap().len(), 1);
    drop(host);
}
#[test]
fn help_lists_both_replay_holds() {
    let out = Command::new(BIN).arg("--help").output().unwrap();
    let text = String::from_utf8(out.stdout).unwrap();
    assert!(text.contains("--hold-effects") && text.contains("--hold-schedules"), "{text}");
}

const BATCH_SOURCE: &str = r#"use personas alice, bob
table counters:
  value: int default 0
  public 'ordered transport test'
  insert <- allow
  update <- allow
  online only
table entries:
  digit: int
  public 'ordered transport test'
  insert <- allow
  online only
mutation setup():
  insert counters {id: 'counter'}
mutation append(digit: int):
  require digit != 9 else NINE_DENIED
  counter = counters['counter'] ! else MISSING
  next = counter.value * 10 + digit
  update counters[counter] {value: next}
  insert entries {digit}
  return next
query total():
  return counters['counter'] {value}
query rows():
  return entries first 50 by byId
job tick():
  chunk row in entries first 10 by byId:
    delete entries[row.id]
"#;
const ALICE: &str = "x-snapback-persona: alice";
fn batch_fixture(label: &str) -> (Fixture, Host) {
    let f = Fixture::new(label);
    fs::write(f.0.join("snapback/schema.q"), BATCH_SOURCE).unwrap();
    let host = f.start(&[]);
    assert_eq!(host.post("/m/setup", json!({"id":"setup"}), ALICE)["state"], "sent");
    (f, host)
}
fn append(id: &str, digit: i64) -> Value {
    json!({"id": id, "op":"append", "args":{"digit": digit}, "newIds":[format!("row-{id}")]})
}

#[test]
fn ordered_mutation_batch_commits_in_order_and_replays_each_id() {
    let (_f, host) = batch_fixture("ordered");
    let writes = json!({"writes":[append("first", 1), append("second", 2)]});
    let sent = host.post("/m", writes.clone(), ALICE);
    assert_eq!(sent["writes"][0]["result"], 1, "{sent}");
    assert_eq!(sent["writes"][1]["result"], 12, "{sent}");
    assert!(sent["writes"][0]["seq"].as_u64() < sent["writes"][1]["seq"].as_u64());
    let replay = host.post("/m", writes, ALICE);
    for (n, id) in ["first", "second"].iter().enumerate() {
        assert_eq!(replay["writes"][n]["id"], *id);
        assert_eq!(replay["writes"][n]["state"], "sent");
        assert_eq!(replay["writes"][n]["replayed"], true);
        assert!(replay["writes"][n].get("result").is_none());
        let ordinary = host.post("/m/append", append(id, 8), ALICE);
        assert_eq!(ordinary["replayed"], true, "{ordinary}");
    }
    // Lookup and argument validation must not re-judge an already recorded ID.
    let changed = host.post("/m", json!({"writes":[{"id":"first","op":"removed","args":null}]}), ALICE);
    assert_eq!(changed["writes"][0]["replayed"], true, "{changed}");
    assert_eq!(host.post("/q/total", json!({}), ALICE)["data"]["value"], 12);
    let rows = host.post("/q/rows", json!({}), ALICE);
    assert_eq!(rows["data"].as_array().unwrap().len(), 2);
    assert_eq!(rows["data"][0]["id"], "row-first");
    assert_eq!(rows["data"][1]["id"], "row-second");
    // The same mutation ID belongs to a principal, not to the whole server.
    let mut other = append("first", 3); other["newIds"] = json!(["bob-row"]);
    let bob = host.post("/m", json!({"writes":[other]}), "x-snapback-persona: bob");
    assert_ne!(bob["writes"][0]["replayed"], true);
    assert_eq!(bob["writes"][0]["result"], 123);
}

#[test]
fn ordered_mutation_batch_stops_at_a_refusal_and_keeps_prior_receipts() {
    let (_f, host) = batch_fixture("ordered-refusal");
    let batch = json!({"writes":[append("first", 1), append("refused", 9), append("last", 2)]});
    for attempt in 0..2 {
        let answer = host.post("/m", batch.clone(), ALICE);
        assert_eq!(answer["writes"].as_array().unwrap().len(), 2, "{answer}");
        assert_eq!(answer["writes"][0]["state"], "sent");
        assert_eq!(answer["writes"][1]["why"]["code"], "NINE_DENIED");
        if attempt == 1 { assert_eq!(answer["writes"][1]["replayed"], true); }
        assert_eq!(host.post("/q/total", json!({}), ALICE)["data"]["value"], 1);
    }
    assert_eq!(host.post("/m/append", append("last", 2), ALICE)["result"], 12);
}

#[test]
fn ordered_mutation_batch_checks_auth_shape_kind_and_arguments() {
    let (_f, host) = batch_fixture("ordered-input");
    assert_eq!(host.post("/m", json!({"writes":[append("first", 1)]}), "")["denied"]["code"], "E_AUTH");
    for body in [json!({}), json!({"writes":[]}), json!({"writes":[append("first", 1), {}]}), json!({"writes":vec![append("first", 1); 33]})] {
        let answer = host.post("/m", body, ALICE);
        assert_eq!(answer["denied"]["code"], "E_INPUT", "{answer}");
    }
    for (op, args, code) in [("missing", json!({}), "E_OP"), ("total", json!({}), "E_OP"), ("tick", json!({}), "E_OP"), ("append", json!({"digit":"bad"}), "E_INPUT"), ("append", json!({"extra":1}), "E_INPUT")] {
        let answer = host.post("/m", json!({"writes":[{"id":format!("bad-{op}-{args}"),"op":op,"args":args},append("last", 2)]}), ALICE);
        assert_eq!(answer["writes"].as_array().unwrap().len(), 1, "{answer}");
        assert_eq!(answer["writes"][0]["why"]["code"], code, "{answer}");
    }
    assert_eq!(host.post("/q/total", json!({}), ALICE)["data"]["value"], 0);
    assert_eq!(host.post("/m", json!({"writes":[append("valid", 1)]}), ALICE)["writes"][0]["result"], 1);
}

#[test]
fn ordered_mutation_batch_enforces_bytes_and_accepts_the_count_boundary() {
    let (_f, host) = batch_fixture("ordered-bounds");
    let too_large = host.post("/m", json!({"writes":[append("large", 1)],"padding":"x".repeat(65536)}), ALICE);
    assert_eq!(too_large["denied"]["code"], "E_INPUT");
    assert!(too_large["denied"]["message"].as_str().unwrap().contains("65536-byte limit"));
    let writes: Vec<_> = (0..32).map(|n| append(&format!("zero-{n}"), 0)).collect();
    let answer = host.post("/m", json!({"writes":writes}), ALICE);
    let receipts = answer["writes"].as_array().unwrap();
    assert_eq!(receipts.len(), 32);
    assert!(receipts.iter().all(|r| r["state"] == "sent"));
    assert!(receipts.windows(2).all(|r| r[0]["seq"].as_u64() < r[1]["seq"].as_u64()));
    assert_eq!(host.post("/q/rows", json!({}), ALICE)["data"].as_array().unwrap().len(), 32);
}

#[path = "../src/dev_replay.rs"]
mod dev_replay;

#[test]
fn changed_schedule_shape_releases_at_first_boundary() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert!(engine.fire_schedules(0).unwrap().is_empty());
    dev_replay::schedules(&mut engine, true, 60_000).unwrap();
    let changed = snapback4_lang::compile(&[("schema.q".into(), SOURCE.replace("every 1m", "every 2m"))]);
    assert!(changed.diagnostics.is_empty(), "{:?}", changed.diagnostics);
    engine.adopt(changed.schema, changed.programs.into_iter().map(|p| p.program)).unwrap();
    dev_replay::schedules(&mut engine, false, 119_999).unwrap();
    assert_eq!(engine.fire_schedules(120_000).unwrap(), vec!["ticking"]);
    assert!(engine.fire_schedules(120_000).unwrap().is_empty());
    assert_eq!(engine.jobs(10).unwrap().len(), 1);
}
