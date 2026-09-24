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
        let p = Self(path); p.source(SOURCE); p
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
        let log = p.0.join(format!("{name}.log"));
        let child = Command::new(BIN).current_dir(&p.0).args(args).stdout(Stdio::piped())
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
fn independent_clis_each_admit_their_job_once_after_owner_exit() {
    let p = Project::new(); p.initialize();
    let conn = p.conn(); conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let mut first = Running::start(&p, "first", &["run", "backfill", "--json"]);
    let mut second = Running::start(&p, "second", &["run", "backfill", "--json"]);
    first.waiting(); second.waiting(); assert_eq!(p.jobs(), 0);
    drop(conn); // Owner exits without committing; SQLite rolls its lock back.
    let (a, ar) = first.finish(); let (b, br) = second.finish();
    assert!(a.success() && b.success(), "{}\n{}", first.logs(), second.logs());
    assert_ne!(ar["id"], br["id"]); assert_eq!(p.jobs(), 2);
    assert_eq!(p.rows()["data"][0]["n"], 2);
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
