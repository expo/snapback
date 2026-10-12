//! Real writer barriers: retry ends before the operation's admission boundary.
use snapback4_core::{Engine, Store};
use std::{fs, path::PathBuf, process::{Child, Command, Output, Stdio}, sync::{atomic::{AtomicUsize, Ordering}, mpsc}, time::{Duration, Instant}};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SOURCE: &str = "table items:\n  owner: principal\n  active: bool\n  n: int\n  public 'test'\n  insert <- allow\n  update <- allow\nmaintain totals: count items where .active by owner\n  read <- allow\n  online only\nmutation put():\n  insert items {owner: viewer, active: false, n: 0}\nquery rows():\n  return items first 100 by byId\njob backfill():\n  chunk row in items first 10 by byId:\n    update items[row.id] {n: row.n + 1}\n";

struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let path = std::env::temp_dir().join(format!("snapback4-run-admission-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(path.join("snapback")).unwrap();
        let p = Self(path.canonicalize().unwrap()); p.source(SOURCE); p
    }
    fn source(&self, text: &str) { fs::write(self.0.join("snapback/schema.q"), text).unwrap(); }
    fn store(&self) -> PathBuf { self.0.join(".snapback4/store.sqlite") }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn conn(&self) -> rusqlite::Connection { rusqlite::Connection::open(self.store()).unwrap() }
    fn jobs(&self) -> i64 { self.conn().query_row("SELECT count(*) FROM _jobs", [], |r| r.get(0)).unwrap() }
    fn generation(&self) -> String { self.conn().query_row("SELECT value FROM _meta WHERE key='generation'", [], |r| r.get(0)).unwrap() }
    fn initialize(&self) { let out = self.run(&["run", "put", "--json"]); assert!(out.status.success(), "{out:?}"); }
    fn rows(&self) -> serde_json::Value {
        let out = self.run(&["run", "rows", "--json"]); assert!(out.status.success(), "{out:?}");
        serde_json::from_slice(&out.stdout).unwrap()
    }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

struct Running { child: Child, log: PathBuf, started: Instant }
impl Running {
    fn start(p: &Project, name: &str, args: &[&str]) -> Self {
        Self::with_stdout(p, name, args, Stdio::piped())
    }
    fn with_stdout(p: &Project, name: &str, args: &[&str], stdout: Stdio) -> Self {
        let log = p.0.join(format!("{name}.log"));
        let child = Command::new(BIN).current_dir(&p.0).args(args).stdout(stdout)
            .stderr(fs::File::create(&log).unwrap()).spawn().unwrap();
        Self { child, log, started: Instant::now() }
    }
    fn logs(&self) -> String { fs::read_to_string(&self.log).unwrap() }
    fn waiting(&mut self) {
        wait(|| {
            let text = self.logs();
            assert!(self.child.try_wait().unwrap().is_none(), "run exited before lock release: {text}");
            text.contains("waiting before admission")
        });
    }
    fn finish(&mut self) -> (std::process::ExitStatus, serde_json::Value) {
        use std::io::Read;
        let mut status = None;
        wait(|| { status = self.child.try_wait().unwrap(); status.is_some() });
        let mut out = String::new(); self.child.stdout.take().unwrap().read_to_string(&mut out).unwrap();
        (status.unwrap(), serde_json::from_str(&out).unwrap_or(serde_json::Value::Null))
    }
}
impl Drop for Running { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
fn wait(mut ready: impl FnMut() -> bool) {
    let deadline = Instant::now() + Duration::from_secs(25);
    while !ready() { assert!(Instant::now() < deadline, "barrier deadline"); std::thread::sleep(Duration::from_millis(10)); }
}
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}

/// Stop an actual activation after it wrote its new generation but before commit.
/// Readers still see the old activation; the writer lock is held by real adoption.
fn pause_activation(store: &Store) -> (mpsc::Receiver<()>, mpsc::Sender<()>) {
    let (arrive, arrived) = mpsc::channel(); let (release, released) = mpsc::channel();
    let mut paused = false;
    store.conn().update_hook(Some(move |_: rusqlite::hooks::Action, _: &str, table: &str, _: i64| {
        if table == "_generations" && !paused { paused = true; arrive.send(()).unwrap(); released.recv_timeout(Duration::from_secs(25)).unwrap(); }
    })).unwrap();
    (arrived, release)
}

#[test]
fn startup_adoption_and_run_wait_then_admit_once() {
    let p = Project::new();
    let store = Store::open(&p.store()).unwrap();
    let (arrived, release) = pause_activation(&store);
    let b = bound(SOURCE);
    let adopter = std::thread::spawn(move || Engine::new(store, b.schema, b.programs.into_iter().map(|p| p.program)).unwrap());
    arrived.recv_timeout(Duration::from_secs(5)).unwrap();
    let mut run = Running::start(&p, "startup", &["run", "put", "--json"]);
    run.waiting();
    release.send(()).unwrap(); drop(adopter.join().unwrap());
    let (status, result) = run.finish(); assert!(status.success(), "{}", run.logs());
    assert_eq!(result["state"], "sent");
    assert_eq!(p.rows()["data"].as_array().unwrap().len(), 1);
    assert_eq!(p.generation(), "1");
    println!("startup_adoption_wait_ms={} admitted_rows=1", run.started.elapsed().as_millis());
}

#[test]
fn changed_maintain_writer_and_backfill_outlast_the_old_five_second_wait() {
    let p = Project::new(); p.initialize();
    let old = bound(SOURCE);
    let mut engine = Engine::new(Store::open(&p.store()).unwrap(), old.schema, old.programs.into_iter().map(|p| p.program)).unwrap();
    let (arrived, release) = pause_activation(engine.store());
    let changed = SOURCE.replace("count items where .active by owner", "count items by owner");
    p.source(&changed); let new = bound(&changed);
    let adopter = std::thread::spawn(move || engine.adopt(new.schema, new.programs.into_iter().map(|p| p.program)).unwrap());
    arrived.recv_timeout(Duration::from_secs(5)).unwrap();
    let mut run = Running::start(&p, "backfill", &["run", "backfill", "--json"]);
    run.waiting();
    assert_eq!(p.generation(), "1", "uncommitted activation is invisible");
    assert_eq!(p.jobs(), 0);
    // The barrier, not a scheduling guess, owns the lock for the entire wait.
    std::thread::sleep(Duration::from_millis(5500));
    assert!(run.child.try_wait().unwrap().is_none(), "{}", run.logs());
    release.send(()).unwrap(); assert_eq!(adopter.join().unwrap(), 2);
    let (status, result) = run.finish(); assert!(status.success(), "{} {result}", run.logs());
    assert_eq!(result["state"], "done"); assert_eq!(p.jobs(), 1);
    assert_eq!(p.generation(), "2"); assert_eq!(p.rows()["data"][0]["n"], 1);
    println!("changed_maintain_wait_ms={} jobs=1 generations=2", run.started.elapsed().as_millis());
}

#[test]
fn deadline_refuses_before_job_admission_or_activation() {
    let p = Project::new(); p.initialize();
    p.source(&SOURCE.replace("count items where .active by owner", "count items by owner"));
    let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut run = Running::start(&p, "deadline", &["run", "backfill", "--json"]);
    run.waiting(); let (status, result) = run.finish();
    assert_eq!(status.code(), Some(2)); assert_eq!(result, serde_json::Value::Null);
    assert!(run.logs().contains("E_RUN_BUSY: run backfill"), "{}", run.logs());
    assert!(run.logs().contains("no operation was admitted"));
    assert!(run.started.elapsed() >= Duration::from_secs(15));
    assert!(run.started.elapsed() < Duration::from_secs(18), "deadline did not add another SQLite wait");
    assert_eq!(p.jobs(), 0); assert_eq!(p.generation(), "1");
    conn.execute_batch("ROLLBACK").unwrap();
    println!("deadline_ms={} jobs=0 generations=1", run.started.elapsed().as_millis());
}

#[test]
fn source_edit_while_waiting_refuses_original_intent() {
    let p = Project::new(); p.initialize();
    let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut run = Running::start(&p, "edit", &["run", "backfill", "--json"]); run.waiting();
    p.source(&SOURCE.replace("row.n + 1", "row.n + 100"));
    let (status, _) = run.finish(); assert_eq!(status.code(), Some(2));
    assert!(run.logs().contains("E_RUN_SOURCE_CHANGED"), "{}", run.logs());
    assert_eq!(p.jobs(), 0); assert_eq!(p.generation(), "1");
    conn.execute_batch("ROLLBACK").unwrap();
}

#[test]
fn competing_cli_refuses_before_admission_then_can_retry_after_owner_exit() {
    let p = Project::new(); p.initialize();
    let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut first = Running::start(&p, "first", &["run", "backfill", "--json"]);
    first.waiting();
    let mut second = Running::start(&p, "second", &["run", "backfill", "--json"]);
    let (b, _) = second.finish();
    assert!(!b.success()); assert!(second.logs().contains("E_STORE_BUSY"));
    assert_eq!(p.jobs(), 0);
    drop(conn); // Owner exits without committing; SQLite rolls its lock back.
    let (a, ar) = first.finish();
    let retry = p.run(&["run", "backfill", "--json"]);
    assert!(a.success() && retry.status.success(), "{}\n{retry:?}", first.logs());
    let br: serde_json::Value = serde_json::from_slice(&retry.stdout).unwrap();
    assert_ne!(ar["id"], br["id"]); assert_eq!(p.jobs(), 2);
    assert_eq!(p.rows()["data"][0]["n"], 2);
}

#[test]
fn live_dev_forwards_run_refuses_other_offline_writers_with_its_address_and_releases_on_exit() {
    for watch in [false, true] {
        let p = Project::new(); p.initialize();
        let args = if watch { vec!["dev", "--port", "0"] } else { vec!["dev", "--port", "0", "--no-watch"] };
        let host = Running::start(&p, "host", &args);
        wait(|| host.logs().split_inclusive('\n').any(|line| line.ends_with('\n') && line.contains("snapback4 dev: http://")));
        let address = host.logs().split("snapback4 dev: ").nth(1).unwrap().split_whitespace().next().unwrap().to_owned();
        let generation = p.generation();
        // `run` goes through the live host's wire as the persona; nothing opens a second writer.
        for (args, route) in [(vec!["run", "backfill", "--json"], "/dev/jobs/backfill"), (vec!["run", "put", "--as", "dev:bob", "--json"], "/m/put as x-snapback-persona: bob"), (vec!["run", "rows", "--json"], "/q/rows as x-snapback-persona: alice")] {
            let out = p.run(&args);
            let error = String::from_utf8_lossy(&out.stderr);
            assert!(out.status.success(), "{args:?}: {out:?}");
            assert!(error.contains(&format!("live under snapback4 dev at {address}; forwarding to POST {route}")), "{error}");
            let reply: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
            match args[1] {
                "backfill" => assert_eq!(reply["state"], "done", "{reply}"),
                "put" => { assert_eq!(reply["state"], "sent", "{reply}"); assert_eq!(reply["result"]["owner"], "dev:bob", "{reply}"); }
                _ => assert_eq!(reply["data"].as_array().unwrap().len(), 2, "{reply}"),
            }
        }
        // A local clock pin cannot be forwarded; the refusal names the runnable alternative.
        let pinned = p.run(&["run", "rows", "--now", "+1h"]);
        let error = String::from_utf8_lossy(&pinned.stderr);
        assert!(!pinned.status.success() && error.contains("E_STORE_BUSY") && error.contains(&format!("curl -s -X POST {address}/q/rows -H 'x-snapback-persona: alice'")), "{error}");
        let before = Instant::now();
        let out = p.run(&["test"]);
        let error = String::from_utf8(out.stderr).unwrap();
        assert!(!out.status.success());
        assert!(error.contains("E_STORE_BUSY") && error.contains(&address) && error.contains("store.sqlite") && error.contains("rerun"), "{error}");
        assert!(before.elapsed() < Duration::from_secs(5), "must not enter SQLite's writer wait");
        assert_eq!(p.jobs(), 1); assert_eq!(p.generation(), generation);
        let minted = p.run(&["token", "--service", "any"]);
        assert!(minted.status.success(), "{minted:?}");
        // The dev inspector still understands the lock's first-line legacy port.
        assert!(p.run(&["doctor", "--json"]).status.success());
        let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
        let inspected = p.run(&["data", "items", "--json"]);
        assert!(inspected.status.success(), "{inspected:?}");
        let rows: Vec<serde_json::Value> = String::from_utf8_lossy(&inspected.stdout).lines().map(|line| serde_json::from_str(line).unwrap()).collect();
        assert_eq!(rows.len(), 2); assert_eq!(rows[0]["n"], 1, "the forwarded backfill ran on the live host");
        conn.execute_batch("ROLLBACK").unwrap();
        drop(host);
        // The leftover lock file and address alone must never refuse work.
        let out = p.run(&["run", "backfill", "--json"]);
        assert!(out.status.success(), "{out:?}"); assert_eq!(p.jobs(), 2);
        assert!(!String::from_utf8_lossy(&out.stderr).contains("forwarding"), "{out:?}");
    }
}

#[test]
fn cli_ownership_refuses_server_startup_and_store_symlinks_share_the_lock() {
    let p = Project::new(); p.initialize();
    let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut cli = Running::start(&p, "cli-owner", &["run", "backfill", "--json"]);
    cli.waiting();
    let out = p.run(&["dev", "--port", "0", "--no-watch"]);
    assert!(!out.status.success()); assert!(String::from_utf8_lossy(&out.stderr).contains("E_STORE_BUSY"));
    #[cfg(unix)] {
        let alias = Project::new();
        fs::create_dir_all(alias.0.join(".snapback4")).unwrap();
        std::os::unix::fs::symlink(p.store(), alias.store()).unwrap();
        let out = alias.run(&["run", "backfill"]);
        assert!(!out.status.success()); assert!(String::from_utf8_lossy(&out.stderr).contains("E_STORE_BUSY"));
    }
    drop(conn);
    assert!(cli.finish().0.success()); assert_eq!(p.jobs(), 1);
}

#[cfg(unix)]
fn shared_releases(p: &Project) -> (PathBuf, PathBuf, PathBuf) {
    let a = p.0.join("release-a");
    let b = p.0.join("release-b");
    for dir in [&a, &b] {
        for _ in 0..2 {
            let out = p.run(&["deploy", dir.to_str().unwrap()]);
            assert!(out.status.success(), "{out:?}");
        }
    }
    let external = p.0.join("external");
    fs::create_dir(&external).unwrap();
    let database = external.join("store.sqlite");
    fs::rename(a.join("store.sqlite"), &database).unwrap();
    fs::remove_file(b.join("store.sqlite")).unwrap();
    for dir in [&a, &b] {
        std::os::unix::fs::symlink(&database, dir.join("store.sqlite")).unwrap();
    }
    (a, b, database)
}

fn assert_owner_refusal(p: &Project, args: &[&str], owner: &str) {
    let mut contender = Running::start(p, "contender", args);
    let (status, _) = contender.finish();
    let error = contender.logs();
    assert!(!status.success(), "unexpected second owner: {error}");
    assert!(error.contains("E_STORE_BUSY") && error.contains(owner), "{error}");
    assert!(!error.contains("No such file or directory"), "{error}");
}

#[cfg(unix)]
#[test]
fn release_database_symlinks_share_one_announced_owner_for_all_writers() {
    for reversed in [false, true] {
        let p = Project::new();
        let (a, b, database) = shared_releases(&p);
        let lock = database.parent().unwrap().join("serve.lock");
        assert!(!lock.exists(), "startup must create its actual lock, without token priming it");
        let (first, second) = if reversed { (&b, &a) } else { (&a, &b) };
        let first = first.to_str().unwrap();
        let second = second.to_str().unwrap();
        let mut host = Running::start(&p, "release-host", &["serve", first, "--port", "0"]);
        wait(|| {
            let text = host.logs();
            assert!(host.child.try_wait().unwrap().is_none(), "startup failed: {text}");
            text.split_inclusive('\n').any(|line| line.ends_with('\n') && line.contains("snapback4 serve: http://"))
        });
        let address = host.logs().split("snapback4 serve: ").nth(1).unwrap().split_whitespace().next().unwrap().to_owned();
        assert!(fs::read_to_string(&lock).unwrap().contains(&address));
        assert_owner_refusal(&p, &["serve", second, "--port", "0"], &address);
        // Hot activation uses this deployment's immutable source, despite the external database.
        let deployed = p.run(&["deploy", first]);
        assert!(deployed.status.success(), "{deployed:?}");
        assert!(String::from_utf8_lossy(&deployed.stdout).contains("activated in the running server"), "{deployed:?}");
        let rolled = p.run(&["rollback", first, "--to", "2"]);
        assert!(rolled.status.success(), "{rolled:?}");
        // Another deployment sharing the database must not activate its unrelated source through this owner.
        let pointer = fs::read_to_string(PathBuf::from(second).join("current")).unwrap();
        for args in [vec!["deploy", second], vec!["rollback", second]] {
            assert_owner_refusal(&p, &args, &address);
        }
        assert_eq!(fs::read_to_string(PathBuf::from(second).join("current")).unwrap(), pointer);
        assert!(!PathBuf::from(second).join("releases/3").exists());
        for dir in [first, second] {
            let minted = p.run(&["token", "--release", dir, "--service", "worker"]);
            assert!(minted.status.success(), "{minted:?}");
        }
        assert!(host.child.try_wait().unwrap().is_none());
        drop(host);
        let token = p.run(&["token", "--release", second, "--service", "worker"]);
        assert!(token.status.success(), "{token:?}");
    }
}

#[cfg(unix)]
#[test]
// @ref LLP 3000#publication-suite-under-contention — preserve semantics independently of host scheduling.
fn release_token_owns_the_resolved_database_before_sqlite_open() {
    use std::{io::{Read, Write}, os::{fd::OwnedFd, unix::net::UnixStream}};
    let p = Project::new();
    let (a, b, database) = shared_releases(&p);
    // Keep the command alive at its final stdout write, independently of the
    // SQLite busy budget. Competitor startup may take arbitrarily longer than
    // that budget on a shared Mac. Only the first ownership observation below
    // needs SQLite held; it still proves exclusion precedes opening the store.
    let (mut output, mut blocked) = UnixStream::pair().unwrap();
    blocked.set_nonblocking(true).unwrap();
    let mut padding = 0;
    loop {
        match blocked.write(&[0; 4096]) {
            Ok(n) => { assert!(n > 0); padding += n; }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(error) => panic!("fill output barrier: {error}"),
        }
    }
    // A failed large write need not prove that a short token cannot fit.
    loop {
        match blocked.write(&[0]) {
            Ok(1) => padding += 1,
            Ok(n) => panic!("one-byte output barrier write returned {n}"),
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => break,
            Err(error) => panic!("finish output barrier: {error}"),
        }
    }
    blocked.set_nonblocking(false).unwrap();
    let conn = rusqlite::Connection::open(&database).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let lock = database.parent().unwrap().join("serve.lock");
    fs::write(&lock, "previous owner\n").unwrap();
    let mut token = Running::with_stdout(&p, "token-owner", &["token", "--release", a.to_str().unwrap(), "--service", "worker"], Stdio::from(OwnedFd::from(blocked)));
    wait(|| {
        assert!(token.child.try_wait().unwrap().is_none(), "{}", token.logs());
        fs::metadata(&lock).is_ok_and(|metadata| metadata.len() == 0)
    });
    // @ref LLP 3000.019#3.4 — the sidecar flock grants ownership; the address hint does not.
    let sidecar = fs::File::open(snapback4_core::private_fs::owner_path(&database)).unwrap();
    let held = sidecar.try_lock();
    assert!(matches!(held, Err(fs::TryLockError::WouldBlock)), "ownership must already exclude another writer while SQLite is blocked: {held:?}");
    drop(sidecar);
    conn.execute_batch("ROLLBACK").unwrap();
    let b = b.to_str().unwrap();
    for args in [vec!["token", "--release", b, "--service", "other"], vec!["serve", b, "--port", "0"], vec!["deploy", b], vec!["rollback", b]] {
        assert_owner_refusal(&p, &args, "owned by another CLI command or a server starting up (address pending);");
    }
    assert!(token.child.try_wait().unwrap().is_none(), "output barrier must retain the owner");
    output.read_exact(&mut vec![0; padding]).unwrap();
    token.child.stdout = Some(OwnedFd::from(output).into());
    assert!(token.finish().0.success(), "{}", token.logs());
}

#[test]
fn interrupting_a_waiter_does_not_admit_a_job() {
    let p = Project::new(); p.initialize();
    let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut run = Running::start(&p, "interrupt", &["run", "backfill", "--json"]); run.waiting();
    unsafe { assert_eq!(libc::kill(run.child.id() as i32, libc::SIGINT), 0); }
    assert!(!run.child.wait().unwrap().success());
    conn.execute_batch("ROLLBACK").unwrap(); assert_eq!(p.jobs(), 0);
}

#[test]
fn invalid_source_and_non_lock_store_errors_keep_their_meaning() {
    let p = Project::new(); p.initialize();
    p.source("query nope():\n  return notDeclared\n");
    let out = p.run(&["run", "nope"]);
    assert!(!out.status.success()); assert!(!String::from_utf8_lossy(&out.stderr).contains("E_RUN_BUSY"));
    p.source(SOURCE); drop(Store::open(&p.store()).unwrap());
    let conn = p.conn(); conn.execute("UPDATE _meta SET value='invalid' WHERE key='version'", []).unwrap(); drop(conn);
    let started = Instant::now(); let out = p.run(&["run", "backfill"]);
    let text = String::from_utf8_lossy(&out.stderr);
    assert!(!out.status.success()); assert!(text.contains("E_STORE"), "{text}");
    assert!(!text.contains("E_RUN_BUSY")); assert!(started.elapsed() < Duration::from_secs(3));
}

#[test]
fn uncontended_run_keeps_the_short_path() {
    let p = Project::new(); p.initialize();
    let started = Instant::now(); let out = p.run(&["run", "rows", "--json"]);
    assert!(out.status.success(), "{out:?}");
    assert!(!String::from_utf8_lossy(&out.stderr).contains("waiting before admission"));
    println!("uncontended_run_ms={}", started.elapsed().as_millis());
}

#[test]
fn adaptive_job_run_and_doctor_report_chunk_size_and_retries() {
    let p = Project::new();
    p.source("table items:\n  n: int default 0\n  public 'test'\n  insert <- allow\n  update <- allow\n  online only\nmutation put():\n  insert items { n: 0 }\njob sweep():\n  for item in items:\n    update items[item.id] { n: item.n + 1 }\n");
    p.initialize();
    let out = p.run(&["run", "sweep", "--json"]);
    assert!(out.status.success(), "{out:?}");
    let run: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(run["chunkSize"], 64); assert_eq!(run["retries"], 0); assert!(run["heapPeak"].as_u64().unwrap() > 0);
    let doctor = p.run(&["doctor"]);
    let text = String::from_utf8(doctor.stdout).unwrap();
    assert!(text.contains("chunk size 64, retries 0"), "{text}");
}

#[test]
fn unavailable_cli_body_remains_incomplete_for_exit_zero_consumers() {
    let p = Project::new();
    p.source("query costly():\n  text = ''\n  for n in range(0, 10000):\n    text = text + 'an allocation that stays bounded by the heap meter'\n  return [text]\n");
    let out = p.run(&["run", "costly", "--json"]);
    assert!(out.status.success(), "{out:?}");
    let reply: serde_json::Value = serde_json::from_slice(&out.stdout).unwrap();
    assert_eq!(reply["loading"], true);
    assert!(reply.get("data").is_some_and(serde_json::Value::is_null));
    assert_eq!(reply["complete"], false);
}

#[cfg(unix)]
#[path = "run_admission/identity.rs"]
mod identity;

fn post(address: &str, path: &str, body: &str) -> serde_json::Value {
    use std::io::{Read, Write};
    let mut stream = std::net::TcpStream::connect(address.trim_start_matches("http://")).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(30))).unwrap();
    write!(stream, "POST {path} HTTP/1.0\r\nHost: localhost\r\nx-snapback-persona: alice\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut reply = String::new(); stream.read_to_string(&mut reply).unwrap();
    serde_json::from_str(reply.split_once("\r\n\r\n").unwrap().1).unwrap()
}

#[test]
fn no_watch_names_an_unadopted_edit_and_seed_names_the_id_form() {
    let p = Project::new(); p.initialize();
    let host = Running::start(&p, "host", &["dev", "--port", "0", "--no-watch"]);
    wait(|| host.logs().split_inclusive('\n').any(|line| line.ends_with('\n') && line.contains("snapback4 dev: http://")));
    assert!(host.logs().contains("--no-watch — schema edits are not re-adopted"), "{}", host.logs());
    let address = host.logs().split("snapback4 dev: ").nth(1).unwrap().split_whitespace().next().unwrap().to_owned();
    // Before any edit an unknown operation is only unknown.
    let unknown = post(&address, "/q/later", "{}");
    assert_eq!(unknown["denied"]["code"], "E_OP"); assert!(!unknown["denied"]["message"].as_str().unwrap().contains("--no-watch"), "{unknown}");
    p.source(&format!("{SOURCE}query later():\n  return 7\n"));
    let stale = post(&address, "/q/later", "{}");
    assert!(stale["denied"]["message"].as_str().unwrap().contains("--no-watch and snapback/ changed on disk"), "{stale}");
    assert!(stale["denied"]["rewrite"].as_str().unwrap().contains("restart `snapback4 dev`"), "{stale}");
    // The forwarded run prints the same refusal.
    let run = p.run(&["run", "later"]);
    assert!(!run.status.success()); assert!(String::from_utf8_lossy(&run.stdout).contains("--no-watch"), "{run:?}");
    let seed = post(&address, "/seed", r#"[{"table":"items","row":{"owner":"dev:alice","active":true,"n":3}}]"#);
    assert_eq!(seed["denied"]["code"], "E_FIELD", "{seed}");
    assert!(seed["denied"]["message"].as_str().unwrap().contains("seed row 0 (items) has no string id"), "{seed}");
    assert!(seed["denied"]["rewrite"].as_str().unwrap().contains("26-character"), "{seed}");
    let seeded = post(&address, "/seed", r#"[{"table":"items","row":{"id":"0000000000000000000000SEED","owner":"dev:alice","active":true,"n":3}}]"#);
    assert_eq!(seeded["seeded"], 1, "{seeded}");
}
