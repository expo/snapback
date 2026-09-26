use super::*;

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

#[test]
fn production_accept_loop_reads_while_exited_worker_waits_for_adoption() {
    let dir = ReaderTestDirectory::new();
    let schema = format!("{}\nuse server\neffect mail\nmutation emitMail():\n  emit mail {{n: 1}}\n", reads::SOURCE);
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.0.join("worker.db")).unwrap(), &schema);
    assert_eq!(body(&host.request("POST", "/m/add", "x-snapback-persona: alice\r\n", r#"{"args":{"id":"before"}}"#))["state"], "sent");
    assert_eq!(body(&host.request("POST", "/m/emitMail", "x-snapback-persona: alice\r\n", "{}"))["state"], "sent");
    let source = dir.0.join("worker.mjs");
    std::fs::write(&source, "import fs from 'node:fs';\nfs.writeFileSync('ready', process.env.SNAPBACK_SERVICE_TOKEN, {mode: 0o600});\nsetInterval(() => { if (fs.existsSync('exit')) process.exit(17); }, 10);\n").unwrap();
    let project = crate::project::Project { root: dir.0.clone() };
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
    wait_until(|| dir.0.join("ready").exists() && worker_status()["state"] == "running");
    let family = lock(&host.shared.engine).store().meta("worker:session-family").unwrap().unwrap();
    let token = std::fs::read_to_string(dir.0.join("ready")).unwrap();
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
        assert!(adoption::adopt_candidate(&shared, &mut engine, &candidate, || panic!("not a generation refusal")).is_err());
        engine.store().conn().authorizer(None::<fn(rusqlite::hooks::AuthContext<'_>) -> rusqlite::hooks::Authorization>).unwrap();
    });
    wait_until(|| gate.entered.load(Ordering::Acquire) == 1);
    std::fs::write(dir.0.join("exit"), "").unwrap();
    // Only supervision can queue here: the adoption owns the writer, and
    // this production loop has no maintenance thread or concurrent writers.
    wait_until(|| host.shared.engine.waiting() == 1);
    // Queue the dead child's claim immediately behind supervision. A refused
    // adoption cannot fence it through worker_revision as a success would.
    let claim = thread::spawn(move || exchange(address, &format!("POST /effects/claim HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer {token}\r\nContent-Length: 2\r\n\r\n{{}}")));
    wait_until(|| host.shared.engine.waiting() == 2);
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
    wait_until(|| host.shared.engine.waiting() == 3);
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
    let (remaining, before_restart, effects) = observation.recv_timeout(Duration::from_secs(2)).unwrap();
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
    wait_until(|| worker_status()["starts"].as_u64().unwrap_or(0) >= 2 && worker_status()["state"] == "running");
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
