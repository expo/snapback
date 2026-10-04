use super::*;

#[test]
fn serve_rotation_fences_a_valid_credential_while_retirement_is_locked() {
    for named in [false, true] {
        let dir = ReaderTestDirectory::new();
        let database = dir.0.join("rotation.sqlite");
        let host = Host::with_store(false, snapback4_core::Store::open(&database).unwrap(),
            "effect notify\nquery who():\n  return viewer\nmutation noop():\n  return true\n");
        // Only the test clock changes: HTTP and supervisor both use serve mode.
        *lock(&host.shared.clock) = crate::dev_clock::Clock::new(true, 0).unwrap();
        let entry = if named { dir.0.join("snapback/workers/push.mjs") } else { dir.0.join("worker.mjs") };
        std::fs::create_dir_all(entry.parent().unwrap()).unwrap();
        std::fs::write(&entry, r#"
import {writeFileSync,renameSync} from 'node:fs';
writeFileSync('ready.tmp',process.env.SNAPBACK_SERVICE_TOKEN);renameSync('ready.tmp','ready');
setInterval(()=>{},1000);
"#).unwrap();
        let project = crate::project::Project {root:dir.0.clone()};
        let url = format!("http://{}", host.address);
        let conventional = if named { None } else {
            Some(crate::dev_worker::DevWorker::start_source(&project,host.shared.clone(),url.clone(),entry,true).unwrap())
        };
        let supervisor = crate::dev_worker::Supervisor::start(project,host.shared.clone(),url,false,conventional).unwrap();
        wait_setup("serve worker ready",||dir.0.join("ready").exists());
        let token = std::fs::read_to_string(dir.0.join("ready")).unwrap();
        let headers = format!("Authorization: Bearer {token}\r\n");
        assert_eq!(status(&host.request("POST","/q/who",&headers,"{}")),200);
        let manual = {
            let engine = lock(&host.shared.engine);
            engine.store().conn().busy_timeout(Duration::from_millis(5)).unwrap();
            // Ordinary expiry must not be the reason the retired bearer fails.
            engine.store().conn().execute("UPDATE _sessions SET expires_at=expires_at+86400000 WHERE kind='service'",[]).unwrap();
            snapback4_core::identity::service_session(engine.store(),"manual",host.shared.now(),3).unwrap()
        };
        let holder = rusqlite::Connection::open(&database).unwrap();
        holder.execute_batch("BEGIN IMMEDIATE").unwrap();
        lock(&host.shared.clock).advance(86_400_000).unwrap();
        // Always release the external writer before stopping the supervisor,
        // including when this regression is run on the previous implementation.
        let fenced = (0..200).any(|_| {
            if host.shared.worker_revision.load(Ordering::Acquire)>0 {return true;}
            thread::sleep(Duration::from_millis(10)); false
        });
        let response = host.request("POST","/q/who",&headers,"{}");
        assert!(holder.query_row("SELECT count(*) FROM _sessions WHERE kind='service' AND expires_at>?1",[host.shared.now()],|r|r.get::<_,i64>(0)).unwrap()>=2);
        let mutation = host.request("POST","/m/noop",&headers,"{}");
        let refresh = host.request("POST","/auth/refresh",&headers,"{}");
        let manual_response=host.request("POST","/q/who",&format!("Authorization: Bearer {}\r\n",manual.token),"{}");
        holder.execute_batch("ROLLBACK").unwrap();
        if fenced {
            wait_setup("serve replacement",||std::fs::read_to_string(dir.0.join("ready")).is_ok_and(|next|next!=token));
            let next=std::fs::read_to_string(dir.0.join("ready")).unwrap();
            assert_eq!(status(&host.request("POST","/q/who",&format!("Authorization: Bearer {next}\r\n"),"{}")),200);
        }
        drop(supervisor);
        assert!(fenced,"failed serve retirement must advance the credential fence");
        for response in [response,mutation,refresh] {assert_eq!(status(&response),401,"{response}");}
        assert_eq!(status(&manual_response),200,"manual seats stay live");
    }
}

struct Serving {
    stop: Arc<std::sync::atomic::AtomicBool>,
    thread: Option<JoinHandle<Result<(), String>>>,
}
impl Drop for Serving {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        self.thread.take().unwrap().join().unwrap().unwrap();
    }
}

// Each barrier permits one child startup or one queued supervisor turn. Shared
// Darwin hosts can delay executable scanning and queued supervisor work.
// This is a per-stage hang guard; the two-second read-latency assertions below
// still apply after the explicitly observed worker/adoption state is reached.
const SETUP_TIMEOUT: Duration = Duration::from_secs(60);
#[track_caller]
fn wait_setup(stage: &str, mut predicate: impl FnMut() -> bool) {
    wait_setup_before(stage, Instant::now() + SETUP_TIMEOUT, &mut predicate);
}
fn wait_setup_before(stage: &str, deadline: Instant, mut predicate: impl FnMut() -> bool) {
    while !predicate() {
        assert!(Instant::now() < deadline, "worker/adoption setup did not reach {stage}");
        thread::sleep(Duration::from_millis(5));
    }
}

#[test]
fn production_accept_loop_reads_while_exited_worker_waits_for_adoption() {
    reads_while_exited_worker_waits(0, false);
}

#[test]
fn production_accept_loop_reads_after_delayed_worker_exit() {
    reads_while_exited_worker_waits(2200, false);
}

#[test]
fn production_accept_loop_waits_for_complete_worker_readiness() {
    reads_while_exited_worker_waits(0, true);
}

fn reads_while_exited_worker_waits(exit_delay_ms: u64, hold_ready: bool) {
    let dir = ReaderTestDirectory::new();
    let schema = format!("{}\nuse server\neffect mail\nmutation emitMail():\n  emit mail {{n: 1}}\n", reads::SOURCE);
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("worker.db")).unwrap(), &schema);
    assert_eq!(body(&host.request("POST", "/m/add", "x-snapback-persona: alice\r\n", r#"{"args":{"id":"before"}}"#))["state"], "sent");
    assert_eq!(body(&host.request("POST", "/m/emitMail", "x-snapback-persona: alice\r\n", "{}"))["state"], "sent");
    let source = dir.0.join("worker.mjs");
    // File creation precedes its contents. Publish readiness only after the
    // complete token is closed, or a loaded host can read an empty bearer.
    std::fs::write(&source, format!("const exitDelay = {exit_delay_ms};\nconst holdReady = {hold_ready};\n") + r#"
import fs from 'node:fs';
const fd = fs.openSync('ready.tmp', 'w', 0o600);
if (holdReady) {
  fs.writeFileSync('ready-started', '');
  while (!fs.existsSync('finish-ready')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
}
fs.writeFileSync(fd, process.env.SNAPBACK_SERVICE_TOKEN);
fs.closeSync(fd);
fs.renameSync('ready.tmp', 'ready');
setInterval(() => { if (fs.existsSync('exit')) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, exitDelay); process.exit(17); } }, 10);
"#).unwrap();
    let project = crate::project::Project { root: dir.0.clone() };
    crate::host_limits::prepare_tests();
    let server = Arc::new(Server::http(("127.0.0.1", 0)).unwrap());
    let address = server.server_addr().to_ip().unwrap();
    let url = format!("http://{address}");
    let worker = crate::dev_worker::DevWorker::start_source(&project, host.shared.clone(), url.clone(), source, true).unwrap();
    let supervisor = crate::dev_worker::Supervisor::start(project, host.shared.clone(), url, false, Some(worker)).unwrap();
    let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let stopping = stop.clone();
    let shared = host.shared.clone();
    // Exercise the production accept/supervisor loop, not Host's dispatch loop.
    let serving = Serving { stop, thread: Some(thread::spawn(move || serve_requests(server, shared, supervisor, Vec::new(), || stopping.load(Ordering::Acquire)))) };
    let worker_status = || -> Json {
        let engine = lock(&host.shared.engine);
        serde_json::from_str(&engine.store().meta("worker:status").unwrap().unwrap_or("{}".into())).unwrap()
    };
    if hold_ready {
        wait_setup("worker token file opened", || dir.0.join("ready-started").exists());
        assert!(!dir.0.join("ready").exists(), "an unfinished token must not publish readiness");
        std::fs::write(dir.0.join("finish-ready"), "").unwrap();
    }
    wait_setup("worker ready", || dir.0.join("ready").exists() && worker_status()["state"] == "running");
    let family = lock(&host.shared.engine).store().meta("worker:session-family").unwrap().unwrap();
    let token = std::fs::read_to_string(dir.0.join("ready")).unwrap();
    assert!(!token.is_empty(), "worker readiness must carry its complete bearer");
    let revision = host.shared.worker_revision.load(Ordering::Acquire);
    let gate = Arc::new(WorkGate::default());
    let release_on_panic = ReleaseGate(gate.clone());
    let held = gate.clone();
    let shared = host.shared.clone();
    let adoption = thread::spawn(move || {
        let mut engine = lock(&shared.engine);
        let once = std::sync::atomic::AtomicBool::new(false);
        engine.store().conn().authorizer(Some(move |ctx: rusqlite::hooks::AuthContext<'_>| {
            if matches!(ctx.action, rusqlite::hooks::AuthAction::Insert { table_name: "i" }) && !once.swap(true, Ordering::SeqCst) {
                held.park();
                return rusqlite::hooks::Authorization::Deny;
            }
            rusqlite::hooks::Authorization::Allow
        })).unwrap();
        let candidate = snapback4_lang::compile(&[("schema.q".into(), format!("{schema}{}", reads::VIEWS))]);
        assert!(candidate.diagnostics.is_empty(), "{:?}", candidate.diagnostics);
        let error = adoption::adopt_candidate(&shared, &mut engine, &candidate, || panic!("not a generation refusal")).unwrap_err();
        assert_eq!(error.refusal().code, "E_STORE");
        assert!(error.to_string().contains("not authorized"), "the held authorizer must cause the refusal: {error}");
        engine.store().conn().authorizer(None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>).unwrap();
    });
    wait_setup("adoption held at the authorizer", || gate.entered.load(Ordering::Acquire) == 1);
    std::fs::write(dir.0.join("exit"), "").unwrap();
    // Only supervision can queue here: the adoption owns the writer, and
    // this production loop has no maintenance thread or concurrent writers.
    wait_setup("exited worker queued for the writer", || host.shared.engine.waiting() == 1);
    // Queue the dead child's claim immediately behind supervision. A refused
    // adoption cannot fence it through worker_revision as a success would.
    // Share one setup budget after starting the held client, then allow both
    // read probes and their metric waits before release. Client: 40 + 15 s.
    let claim_setup = Duration::from_secs(30);
    let claim_deadline = Instant::now() + claim_setup;
    let claim = thread::spawn(move || exchange_held(address, claim_setup + 2 * (CLIENT_TIMEOUT + WAIT_TIMEOUT), &format!("POST /effects/claim HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer {token}\r\nContent-Length: 2\r\n\r\n{{}}")));
    wait_setup_before("dead worker claim queued", claim_deadline, || host.shared.engine.waiting() == 2);
    // This third writer turn holds supervision before it can finish status
    // persistence or start a replacement. Inspect the family and effect there.
    let inspect = Arc::new(WorkGate::default());
    let release_inspection_on_panic = ReleaseGate(inspect.clone());
    let held = inspect.clone();
    let shared = host.shared.clone();
    let (observed, observation) = mpsc::channel();
    let inspection = thread::spawn(move || {
        let engine = lock(&shared.engine);
        let remaining: i64 = engine.store().conn().query_row("SELECT count(*) FROM _sessions WHERE COALESCE(family, token_digest) = ?1", [&family], |row| row.get(0)).unwrap();
        let status: Json = serde_json::from_str(&engine.store().meta("worker:status").unwrap().unwrap()).unwrap();
        observed.send((remaining, status, engine.effects(None, 10).unwrap())).unwrap();
        held.park();
    });
    wait_setup_before("inspection queued", claim_deadline, || host.shared.engine.waiting() == 3);
    for path in ["/q/who", "/sync"] {
        let start = Instant::now();
        let response = exchange(address, &format!("POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nx-snapback-persona: alice\r\nContent-Length: 2\r\n\r\n{{}}"));
        assert_eq!(status(&response), 200, "{response}");
        let reply = body(&response);
        assert!(reply.get("denied").is_none(), "{reply}");
        if path == "/q/who" { assert_eq!(reply["data"], "dev:alice"); assert_eq!(reply["complete"], true); }
        else { assert!(reply.to_string().contains("before"), "{reply}"); }
        assert!(start.elapsed() < Duration::from_secs(2));
        assert!(!adoption.is_finished(), "response must precede adoption release");
        wait_until(|| host.shared.latency.snapshot(false).operations[path].n == 1);
        let snapshot = host.shared.latency.snapshot(false);
        let sample = &snapshot.operations[path];
        assert_eq!(sample.refused, 0);
        assert!(sample.wait.max > 0.0, "detached engine acquisition must be stamped");
        assert!(sample.total.max >= sample.wait.max);
    }
    std::fs::remove_file(dir.0.join("exit")).unwrap();
    gate.release();
    adoption.join().unwrap();
    let (remaining, before_restart, effects) = observation.recv_timeout(SETUP_TIMEOUT).unwrap();
    assert_eq!(host.shared.worker_revision.load(Ordering::Acquire), revision, "no adoption revision fence");
    assert_eq!(before_restart["starts"], 1, "replacement must not have started");
    assert_eq!(remaining, 0, "crash path must revoke before any later writer turn");
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].state, "queued", "dead child's bearer must not lease work");
    assert_eq!(effects[0].attempts, 0);
    let response = claim.join().unwrap();
    assert_eq!(status(&response), 401, "{response}");
    assert_eq!(body(&response)["denied"]["code"], "E_AUTH");
    inspect.release();
    inspection.join().unwrap();
    drop(release_inspection_on_panic);
    wait_setup("replacement worker running", || worker_status()["starts"].as_u64().unwrap_or(0) >= 2 && worker_status()["state"] == "running");
    assert_eq!(worker_status()["crashes"], 1);
    for path in ["/q/who", "/sync"] {
        assert_eq!(host.shared.latency.snapshot(false).operations[path].n, 1, "supervision must not inherit request timing");
    }
    let pid = worker_status()["pid"].as_i64().unwrap() as libc::pid_t;
    drop(release_on_panic);
    drop(serving);
    assert_eq!(worker_status()["state"], "stopped");
    assert!(lock(&host.shared.engine).store().meta("worker:session-family").unwrap().is_none());
    assert_eq!(unsafe { libc::kill(pid, 0) }, -1, "shutdown must reap the owned child");
    assert_eq!(std::io::Error::last_os_error().raw_os_error(), Some(libc::ESRCH));
}
