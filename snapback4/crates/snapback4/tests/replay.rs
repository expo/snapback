//! Replay suppresses emissions; holds fence worker claims and schedule admission.
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
    fn command(&self, args: &[&str]) -> std::process::Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
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
    assert!(text.contains("--replay") && text.contains("--hold-effects") && text.contains("--hold-schedules"), "{text}");
}

#[test]
fn replay_startup_and_doctor_report_the_active_policy() {
    let f = Fixture::new("startup-policy");
    for replay in [true, false] {
        let log = f.0.join("startup.log");
        let mut command = Command::new(BIN);
        command.current_dir(&f.0).args(["dev", "--port", "0", "--no-watch"]);
        if replay { command.arg("--replay"); }
        let mut child = command.stdout(Stdio::piped()).stderr(fs::File::create(&log).unwrap()).spawn().unwrap();
        let mut line = String::new();
        BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        let host = Host { child, address: line.trim().trim_start_matches("http://").into() };
        assert!(!host.address.is_empty());
        // A response establishes that all startup banners have been written.
        assert_eq!(host.post("/m/send", json!({"id":format!("policy-{replay}"), "args":{}}), "x-snapback-persona: alice")["result"], 7);
        let startup = fs::read_to_string(log).unwrap();
        let doctor = f.command(&["doctor"]);
        assert!(doctor.status.success(), "{doctor:?}");
        let doctor = String::from_utf8(doctor.stdout).unwrap();
        println!("{startup}\n{doctor}");
        assert_eq!(startup.lines().any(|line| line == "snapback4 dev: replay on — new effects suppressed; schedules held"), replay);
        let expected = if replay { "replay    on — new effects suppressed; schedules held (persisted dev policy)" } else { "replay    off — new effects enabled; schedules enabled (persisted dev policy)" };
        assert!(doctor.lines().any(|line| line.trim_start() == expected), "{doctor}");
        drop(host);
    }
}

const WRITES: &str = "use personas alice\neffect notify\ntable items:\n  n: int\n  public 'replay test'\n  insert <- allow\n  update <- allow\nmutation put(id: id, n: int):\n  insert items {id, n}\n  emit notify {id, n}\n  return n\nmutation abort(id: id):\n  insert items {id, n: -1}\n  emit notify {id}\n  require false else ABORTED\nquery rows():\n  return items first 100 by byId\njob bump():\n  chunk row in items first 10 by byId:\n    update items[row.id] {n: row.n + 1}\n    emit notify {id: row.id}\nschedule bumping every 7d: bump\n";
const PERSONA: &str = "x-snapback-persona: alice";

fn worker(f: &Fixture) -> String {
    let out = f.command(&["token", "--service", "worker"]);
    assert!(out.status.success(), "{out:?}");
    format!("Authorization: Bearer {}", String::from_utf8(out.stdout).unwrap().trim())
}

#[test]
fn replay_suppresses_committed_emits_and_preserves_writes_jobs_and_restarts() {
    const N: usize = 32;
    for restart_with_replay in [true, false] {
        let f = Fixture::new(if restart_with_replay { "suppress-replay" } else { "suppress-normal" });
        let control = Fixture::new(if restart_with_replay { "control-replay" } else { "control-normal" });
        for fixture in [&f, &control] { fs::write(fixture.0.join("snapback/schema.q"), WRITES).unwrap(); }
        let host = f.start(&["--replay"]);
        let normal = control.start(&["--hold-schedules"]);
        let auth = worker(&f);
        for i in 0..N {
            let request = json!({"id":format!("op-{i}"), "args":{"id":format!("{i:032x}"), "n":i}});
            for server in [&host, &normal] {
                let sent = server.post("/m/put", request.clone(), PERSONA);
                assert_eq!(sent["state"], "sent", "{sent}");
                assert_eq!(sent["result"], i, "{sent}");
                let repeated = server.post("/m/put", request.clone(), PERSONA);
                assert_eq!(repeated["state"], "sent", "{repeated}");
            }
        }
        for (fixture, server) in [(&f, &host), (&control, &normal)] {
            let refused = server.post("/m/abort", json!({"id":"abort", "args":{"id":"ffffffffffffffffffffffffffffffff"}}), PERSONA);
            assert_eq!(refused["state"], "failed", "{refused}");
            assert_eq!(refused["why"]["code"], "ABORTED", "{refused}");
            let advanced = server.post("/dev/clock/advance", json!({"duration":"15d"}), PERSONA);
            assert_eq!(advanced["work"]["schedules"], 0, "{advanced}");
            assert!(fixture.engine().jobs(10).unwrap().is_empty());
        }
        let rows = host.post("/q/rows", json!({"args":{}}), PERSONA)["data"].clone();
        assert_eq!(rows.as_array().unwrap().len(), N);
        assert_eq!(rows, normal.post("/q/rows", json!({"args":{}}), PERSONA)["data"]);
        for fixture in [&f, &control] {
            let out = fixture.command(&["run", "bump", "--json"]);
            assert!(out.status.success(), "{out:?}");
            let run: Value = serde_json::from_slice(&out.stdout).unwrap();
            assert_eq!(run["rowsWritten"], N, "{run}");
        }
        let rows = host.post("/q/rows", json!({"args":{}}), PERSONA)["data"].clone();
        assert_eq!(rows, normal.post("/q/rows", json!({"args":{}}), PERSONA)["data"]);
        assert_eq!(f.engine().effect_counts().unwrap().get("suppressed"), Some(&((N * 2) as u64)));
        assert_eq!(control.engine().effect_counts().unwrap().get("queued"), Some(&((N * 2) as u64)));
        assert!(f.engine().effects(None, 100).unwrap().is_empty(), "suppression must retain no effect payloads");
        assert_eq!(host.post("/effects/claim", json!({}), &auth)["effects"], json!([]));
        let doctor = f.command(&["doctor"]);
        assert!(doctor.status.success(), "{doctor:?}");
        assert!(String::from_utf8_lossy(&doctor.stdout).contains("64 suppressed"), "{doctor:?}");
        drop(host);
        let host = f.start(if restart_with_replay { &["--replay"] } else { &[] });
        assert_eq!(host.post("/effects/claim", json!({}), &auth)["effects"], json!([]));
        assert_eq!(f.engine().effect_counts().unwrap().get("suppressed"), Some(&64));
        assert_eq!(host.post("/q/rows", json!({"args":{}}), PERSONA)["data"], rows);
        assert_eq!(f.engine().jobs(10).unwrap().len(), 1, "held schedules must not catch up on restart");
        let sent = host.post("/m/put", json!({"id":"new", "args":{"id":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "n":99}}), PERSONA);
        assert_eq!(sent["state"], "sent", "{sent}");
        let claimed = host.post("/effects/claim", json!({}), &auth);
        assert_eq!(claimed["effects"].as_array().unwrap().len(), usize::from(!restart_with_replay), "{claimed}");
        assert_eq!(f.engine().effect_counts().unwrap()["suppressed"], 64 + u64::from(restart_with_replay));
        println!("replay: mutations={N} duplicate_retries={N} refused=1 explicit_job_rows={N} equal_rows={N} suppressed=64 claimable_before=0 claimable_after=0 restart_replay={restart_with_replay} held_schedule_runs=0");
    }
}

#[test]
fn replay_is_refused_outside_dev_and_for_release_directories() {
    let f = Fixture::new("dev-only");
    assert_eq!(dev_replay::dev_only().guide.as_deref(), Some("replay"));
    for args in [vec!["serve", "missing", "--replay"], vec!["dev", "--release", "missing", "--replay"], vec!["run", "send", "--replay"], vec!["run", "send", "--release", "missing", "--replay"], vec!["deploy", "missing", "--replay"]] {
        let out = f.command(&args);
        assert!(!out.status.success(), "{args:?}");
        let diagnostic = String::from_utf8(out.stderr).unwrap();
        assert_eq!(diagnostic.trim(), "E_REPLAY_DEV_ONLY: --replay requires dev without --release; serve and releases always emit effects normally", "{args:?}");
    }
}

#[path = "../src/dev_replay.rs"]
mod dev_replay;

#[test]
fn changed_schedule_shape_releases_at_first_boundary() {
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    dev_replay::effects(&engine, true).unwrap();
    assert_eq!(engine.store().meta("dev:replay").unwrap().as_deref(), Some("true"));
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

#[test]
fn competing_starts_preserve_the_live_replay_policy() {
    for same_port in [true, false] {
        let f = Fixture::new(if same_port { "competing-port" } else { "competing-store" });
        let host = f.start(&["--replay"]);
        f.engine().store().set_meta("schedule:ticking", "0").unwrap();
        let port = if same_port { host.address.rsplit(':').next().unwrap() } else { "0" };
        let child = Command::new(BIN).current_dir(&f.0).args(["dev", "--no-watch", "--port", port])
            .stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap();
        let mut contender = Host { child, address: String::new() };
        let mut status = None;
        for _ in 0..200 {
            status = contender.child.try_wait().unwrap();
            if status.is_some() { break; }
            std::thread::sleep(Duration::from_millis(10));
        }
        drop(contender);
        let sent = host.post("/m/send", json!({"id":"after-contender", "args":{}}), PERSONA);
        assert_eq!(sent["state"], "sent", "{sent}");
        assert_eq!(f.engine().store().meta("dev:replay").unwrap().as_deref(), Some("true"));
        assert_eq!(f.engine().store().meta("dev:hold-schedules").unwrap().as_deref(), Some("true"));
        assert_eq!(f.engine().store().meta("schedule:ticking").unwrap().as_deref(), Some("0"));
        assert!(f.engine().effects(None, 10).unwrap().is_empty());
        assert_eq!(f.engine().effect_counts().unwrap()["suppressed"], 1);
        assert!(status.is_some_and(|status| !status.success()), "competing host must refuse even on a different port");
        let deploy = f.command(&["deploy", f.0.join(".snapback4").to_str().unwrap()]);
        assert!(!deploy.status.success(), "a live dev host owns the same lock as deploy");
        assert!(f.engine().store().meta("release").unwrap().is_none());
        drop(host);
        let normal = f.start(&[]);
        assert_eq!(normal.post("/m/send", json!({"id":"after-owner-exit", "args":{}}), PERSONA)["state"], "sent");
        assert_eq!(f.engine().effects(None, 10).unwrap().len(), 1);
    }
}

#[test]
fn a_busy_listener_leaves_stopped_replay_policy_unchanged() {
    let f = Fixture::new("busy-listener");
    drop(f.start(&["--replay"]));
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let out = f.command(&["dev", "--no-watch", "--port", &listener.local_addr().unwrap().port().to_string()]);
    assert!(!out.status.success());
    assert_eq!(f.engine().store().meta("dev:replay").unwrap().as_deref(), Some("true"));
    assert_eq!(f.engine().store().meta("dev:hold-schedules").unwrap().as_deref(), Some("true"));
}

#[test]
fn release_engines_ignore_dev_suppression_and_delayed_dev_policy_is_refused() {
    let f = Fixture::new("release-policy");
    drop(f.start(&["--replay"]));
    let stale = f.engine();
    let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
    let mut release = Engine::new_release(Store::open(&f.0.join(".snapback4/store.sqlite")).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program), 1, None).unwrap();
    for engine in [&mut release, &mut Engine::attach_release(Store::open(&f.0.join(".snapback4/store.sqlite")).unwrap(), 1).unwrap()] {
        let sent = engine.mutate("send", None, snapback4_core::Context::new("dev:alice", Default::default())).unwrap();
        assert!(matches!(sent.state, snapback4_core::WriteState::Sent { .. }));
    }
    assert_eq!(release.effects(None, 10).unwrap().len(), 2, "release transactions always emit");
    assert!(dev_replay::effects(&stale, false).is_err(), "a delayed dev open must not change a deployed store");
    assert_eq!(release.store().meta("dev:replay").unwrap().as_deref(), Some("true"));
}

#[test]
fn serve_emits_with_replay_metadata_left_in_the_release_store() {
    let f = Fixture::new("serve-policy");
    let dir = f.0.join("deployment");
    assert!(f.command(&["deploy", dir.to_str().unwrap()]).status.success());
    let store = Store::open(&dir.join("store.sqlite")).unwrap();
    store.set_meta("dev:replay", "true").unwrap();
    let token = f.command(&["token", "--release", dir.to_str().unwrap(), "--service", "worker"]);
    assert!(token.status.success(), "{token:?}");
    let auth = format!("Authorization: Bearer {}", String::from_utf8(token.stdout).unwrap().trim());
    let mut child = Command::new(BIN).current_dir(&f.0).args(["serve", dir.to_str().unwrap(), "--port", "0"])
        .stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
    let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let host = Host { child, address: line.trim().trim_start_matches("http://").into() };
    assert!(!host.address.is_empty(), "serve did not start");
    assert_eq!(store.meta("dev:replay").unwrap().as_deref(), Some("true"), "release startup must not rewrite dev policy");
    assert_eq!(host.post("/m/send", json!({"id":"release-send", "args":{}}), &auth)["state"], "sent");
    assert_eq!(host.post("/effects/claim", json!({}), &auth)["effects"].as_array().unwrap().len(), 1);
}
