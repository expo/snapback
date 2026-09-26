use super::*;
use std::{io::{BufRead, BufReader, Write}, os::unix::fs::{symlink, PermissionsExt}};

fn server(p: &Project, name: &str) -> Running {
    let mut host = Running::start(p, name, &["dev", "--port", "0", "--no-watch"]);
    wait(|| {
        assert!(host.child.try_wait().unwrap().is_none(), "{}", host.logs());
        host.logs().contains("snapback4 dev: http://")
    });
    host
}

#[test]
fn removing_or_replacing_the_address_record_never_admits_another_owner() {
    let p = Project::new(); p.initialize();
    let mut host = server(&p, "identity-host");
    let record = p.0.join(".snapback4/serve.lock");
    assert_eq!(fs::metadata(&record).unwrap().permissions().mode() & 0o777, 0o600);
    for replacement in [false, true] {
        if record.exists() { fs::remove_file(&record).unwrap(); }
        if replacement { fs::write(&record, "").unwrap(); }
        for args in [vec!["dev", "--port", "0", "--no-watch"], vec!["run", "put"], vec!["token", "--service", "worker"]] {
            assert_owner_refusal(&p, &args, "owned by another CLI command or a server starting up (address pending);");
        }
        assert!(host.child.try_wait().unwrap().is_none());
    }
    assert_eq!(p.conn().query_row("SELECT count(*) FROM r", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn moving_a_live_database_and_its_sidecars_preserves_ownership() {
    let p = Project::new(); p.initialize();
    let mut host = server(&p, "moving-host");
    let dir = p.0.join("moved"); fs::create_dir(&dir).unwrap();
    let target = dir.join("store.sqlite");
    for suffix in ["", "-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", p.store().display()));
        assert!(from.exists(), "live sidecar missing: {}", from.display());
        fs::rename(from, PathBuf::from(format!("{}{suffix}", target.display()))).unwrap();
    }
    symlink(&target, p.store()).unwrap();
    for args in [vec!["dev", "--port", "0", "--no-watch"], vec!["run", "put"], vec!["token", "--service", "worker"]] {
        assert_owner_refusal(&p, &args, "E_STORE_BUSY");
    }
    assert!(host.child.try_wait().unwrap().is_none());
    assert!(!dir.join("serve.lock").exists(), "a contender must not create a second owner record");
}

fn http(host: &Running, path: &str, body: Option<&str>) -> serde_json::Value {
    let address = host.logs().split("snapback4 dev: ").nth(1).unwrap().split_whitespace().next().unwrap().to_owned();
    let mut curl = Command::new("curl");
    curl.args(["--silent", "--show-error", "--fail", "--max-time", "10", "-H", "x-snapback-persona: alice"]);
    if let Some(body) = body { curl.args(["-H", "Content-Type: application/json", "--data", body]); }
    let out = curl.arg(format!("{address}{path}")).output().unwrap();
    assert!(out.status.success(), "{out:?}\n{}", host.logs());
    serde_json::from_slice(&out.stdout).unwrap()
}

#[test]
fn sync_and_changes_keep_the_owned_database_after_its_path_is_replaced() {
    let source = SOURCE.replace("  public 'test'", "  public 'test'\n  sync public last 100 by byId");
    let p = Project::new(); p.source(&source); p.initialize();
    let replacement = Project::new(); replacement.source(&source); replacement.initialize(); replacement.initialize();
    let replacement_id: String = replacement.conn().query_row("SELECT value FROM _meta WHERE key='store_id'", [], |r| r.get(0)).unwrap();
    let host = server(&p, "replaced-reader-host");
    let before = http(&host, "/sync", Some(r#"{"from":0,"limit":100}"#));
    assert_eq!(before["watermark"], 1, "{before}");
    assert_eq!(before["events"].as_array().unwrap().len(), 1, "{before}");
    assert_ne!(before["store_id"], replacement_id);
    let target = p.0.join("moved.sqlite");
    for suffix in ["", "-wal", "-shm"] {
        fs::rename(PathBuf::from(format!("{}{suffix}", p.store().display())), PathBuf::from(format!("{}{suffix}", target.display()))).unwrap();
    }
    fs::copy(replacement.store(), p.store()).unwrap();
    assert_eq!(p.conn().query_row("SELECT count(*) FROM r", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
    // Both snapshot and stream readers must fall back to the original engine.
    for stream in [false, true] {
        let after = http(&host, "/sync", Some(&format!(r#"{{"from":0,"limit":100,"stream":{stream}}}"#)));
        assert_eq!(after["store_id"], before["store_id"], "{after}");
        assert_eq!(after["watermark"], 1, "replacement rows must never wear the original store_id: {after}");
        assert_eq!(after["events"].as_array().unwrap().len(), 1, "{after}");
    }
    let changes = http(&host, "/changes?since=1&wait=0", None);
    assert_eq!(changes["store_id"], before["store_id"], "{changes}");
    assert_eq!(changes["seq"], 1, "{changes}");
}

#[test]
fn a_run_retry_keeps_database_a_when_its_alias_is_retargeted_to_live_b() {
    let a = Project::new(); a.initialize();
    let b = Project::new(); b.initialize();
    let _host = server(&b, "database-b");
    let original = a.0.join("original.sqlite");
    fs::rename(a.store(), &original).unwrap(); symlink(&original, a.store()).unwrap();
    let writer = rusqlite::Connection::open(&original).unwrap();
    writer.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut cli = Running::start(&a, "pinned-run", &["run", "put", "--json"]);
    cli.waiting();
    fs::remove_file(a.store()).unwrap(); symlink(b.store(), a.store()).unwrap();
    writer.execute_batch("ROLLBACK").unwrap();
    assert!(cli.finish().0.success(), "{}", cli.logs());
    assert_eq!(writer.query_row("SELECT count(*) FROM r", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
    assert_eq!(b.conn().query_row("SELECT count(*) FROM r", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
}

#[test]
fn address_symlinks_and_nonregular_files_are_refused_without_truncation() {
    for kind in ["database", "unrelated", "directory", "fifo", "hardlink"] {
        let p = Project::new(); p.initialize();
        let record = p.0.join(".snapback4/serve.lock");
        fs::remove_file(&record).unwrap();
        let unrelated = p.0.join("unrelated");
        fs::write(&unrelated, "keep this unrelated file intact\n").unwrap();
        let database_before = fs::read(p.store()).unwrap();
        match kind {
            "database" => symlink(p.store(), &record).unwrap(),
            "unrelated" => symlink(&unrelated, &record).unwrap(),
            "directory" => fs::create_dir(&record).unwrap(),
            "fifo" => {
                let path = std::ffi::CString::new(record.to_str().unwrap()).unwrap();
                assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);
            }
            "hardlink" => fs::hard_link(p.store(), &record).unwrap(),
            _ => unreachable!(),
        }
        let out = p.run(&["run", "put"]);
        assert!(!out.status.success(), "{kind}: {out:?}");
        let error = String::from_utf8_lossy(&out.stderr);
        assert!(error.contains("E_STORE") && error.contains("serve.lock") && error.contains("retry"), "{kind}: {error}");
        assert_eq!(fs::read(p.store()).unwrap(), database_before, "{kind}");
        assert_eq!(fs::read_to_string(&unrelated).unwrap(), "keep this unrelated file intact\n");
    }
}

fn backend_file(p: &Project) -> PathBuf {
    let b = bound(SOURCE);
    let backend = snapback4_device::device::Backend { generation: 1, schema: b.schema, programs: b.programs.into_iter().map(|p| p.program).collect() };
    let path = p.0.join("backend.json");
    fs::write(&path, serde_json::to_vec(&backend).unwrap()).unwrap();
    path
}

#[test]
fn device_cannot_clear_a_running_servers_rows() {
    let p = Project::new(); p.initialize();
    let _host = server(&p, "device-fence-host");
    let backend = backend_file(&p);
    let mut child = Command::new(BIN).args(["device", p.store().to_str().unwrap(), backend.to_str().unwrap()])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(b"{\"op\":\"clear_rows\"}\n").unwrap();
    let out = child.wait_with_output().unwrap();
    assert!(!out.status.success(), "{out:?}");
    assert!(String::from_utf8_lossy(&out.stderr).contains("E_STORE_BUSY"), "{out:?}");
    assert_eq!(p.conn().query_row("SELECT count(*) FROM r", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
    let side_tables: i64 = p.conn().query_row("SELECT count(*) FROM sqlite_master WHERE name LIKE '_device_%'", [], |r| r.get(0)).unwrap();
    assert_eq!(side_tables, 0, "refusal must precede device initialization");
}

#[test]
fn multiple_device_processes_share_ownership_and_exclude_backend_writers() {
    let p = Project::new(); p.initialize();
    let backend = backend_file(&p);
    let mut devices = Vec::new();
    for n in 0..2 {
        let log = p.0.join(format!("device-{n}.log"));
        let child = Command::new(BIN).args(["device", p.store().to_str().unwrap(), backend.to_str().unwrap()])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(fs::File::create(&log).unwrap()).spawn().unwrap();
        let mut process = Running { child, log, started: Instant::now() };
        let mut line = String::new();
        BufReader::new(process.child.stdout.as_mut().unwrap()).read_line(&mut line).unwrap();
        assert!(serde_json::from_str::<serde_json::Value>(&line).unwrap().get("ok").is_some(), "{line}");
        devices.push(process);
    }
    for args in [vec!["dev", "--port", "0", "--no-watch"], vec!["run", "put"], vec!["token", "--service", "worker"]] {
        assert_owner_refusal(&p, &args, "E_STORE_BUSY");
    }
    drop(devices.pop());
    assert_owner_refusal(&p, &["run", "put"], "E_STORE_BUSY");
    drop(devices);
    assert!(p.run(&["run", "put"]).status.success());
}
