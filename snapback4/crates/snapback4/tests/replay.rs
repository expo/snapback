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
