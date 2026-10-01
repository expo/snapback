//! Host process regressions: real subprocesses, redirected stderr, and an
//! independent process checking SQLite's POSIX locks (not just file modes).
#![allow(dead_code)]
#[path = "../src/thread_priority.rs"] mod thread_priority;
#[path = "../src/lifecycle.rs"] mod lifecycle;

use std::fs::{self, File};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::os::fd::AsRawFd;
use std::os::unix::{fs::PermissionsExt, process::ExitStatusExt};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Output, Stdio};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::{Duration, Instant};
use serde_json::{Value, json};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const SCHEMA: &str = "use personas alice\nquery alive():\n  return true\n";
const MAIN_REACHED: &str = "SNAPBACK4_TEST_MAIN_REACHED";
// Fresh macOS executables can wait in the loader before reaching our code.
// Keep that allowance separate from the unchanged 15-second readiness/exit
// deadline, which starts only after the explicit main marker.
const PROCESS_LAUNCH_TIMEOUT: Duration = Duration::from_secs(120);
const SERVER_READINESS_TIMEOUT: Duration = Duration::from_secs(15);
static SERIAL: AtomicUsize = AtomicUsize::new(0);

#[test]
fn dev_and_doctor_report_low_inherited_descriptor_limits() {
    use std::os::unix::process::CommandExt;
    let dir = Directory::new();
    for verb in ["doctor", "dev"] {
        let mut command = Command::new(BIN);
        command.arg(verb).current_dir(&dir.0);
        if verb == "dev" { command.args(["--fresh", "--replay", "--no-watch", "--port", "0"]); }
        // Change only the child's inherited limit, never the test process.
        unsafe { command.pre_exec(|| {
            let mut limit: libc::rlimit = std::mem::zeroed();
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 { return Err(std::io::Error::last_os_error()); }
            limit.rlim_cur = 64;
            if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) != 0 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        }); }
        let log = dir.0.join(format!("{verb}-limits.log"));
        let file = File::create(&log).unwrap();
        let mut child = command.stdout(file.try_clone().unwrap()).stderr(file).spawn().unwrap();
        if verb == "dev" {
            let deadline = Instant::now() + SERVER_READINESS_TIMEOUT;
            while !fs::read_to_string(&log).unwrap().contains("store: temporary") {
                assert!(child.try_wait().unwrap().is_none(), "{}", fs::read_to_string(&log).unwrap());
                if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); panic!("{}", fs::read_to_string(&log).unwrap()); }
                std::thread::sleep(Duration::from_millis(10));
            }
            unsafe { libc::kill(child.id() as i32, libc::SIGTERM); }
        }
        wait(&mut child);
        let text = fs::read_to_string(log).unwrap();
        assert!(text.contains("HTTP connections=128; uploads=2"), "{text}");
        assert!(text.contains("soft=64"), "{text}");
        assert!(text.contains("E_HTTP_LIMIT"), "{text}");
        assert!(text.contains("ulimit -n 1024"), "{text}");
    }
}

#[test]
fn service_read_disjunct_admits_a_service_token_over_q_and_keeps_the_namespace_reserved() {
    let source = "use identity\ntable members:\n  room: text <=30\n  principal: principal\n  unique byRoomPrincipal: room, principal\n  by byPrincipalRoom: principal, room, id\n  immutable room, principal\n  read <- .principal = viewer\n  sync\ntable messages:\n  room: text <=30\n  body: text <=100\n  by byRoom: room, id\n  read <- exists members[.room, viewer] or viewer = 'service:pusher'\n  sync\nquery all(room: text <=30):\n  return messages[room] first 10 by byRoom\n";
    let dir = Directory::new();
    fs::write(dir.0.join("snapback/schema.q"), source).unwrap();
    fs::create_dir_all(dir.0.join(".snapback4")).unwrap();
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let token = {
        let store = snapback4_core::Store::open(&dir.0.join(".snapback4/store.sqlite")).unwrap();
        let mut engine = snapback4_core::Engine::new(store, bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
        let row = snapback4_core::wire::row_from_json(&engine.schema().tables["messages"], &json!({"id":"m1","room":"r1","body":"private"})).unwrap();
        engine.seed([("messages".into(), row)]).unwrap();
        assert!(snapback4_core::identity::custom_session(engine.store(), "service:pusher", "ordinary", snapback4_core::now_ms(), 1).is_err());
        snapback4_core::identity::service_session(engine.store(), "pusher", snapback4_core::now_ms(), 1).unwrap().token
    };
    let host = Host::start(&dir, &["dev"]);
    let mut stream = TcpStream::connect(("127.0.0.1", host.port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let input = r#"{"args":{"room":"r1"}}"#;
    write!(stream, "POST /q/all HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nAuthorization: Bearer {token}\r\nContent-Length: {}\r\n\r\n{input}", input.len()).unwrap();
    let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
    assert!(answer.starts_with("HTTP/1.1 200 "), "{answer}");
    let body: Value = serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap();
    assert_eq!(body["data"], json!([{"id":"m1","room":"r1","body":"private"}]));
}

struct Directory(PathBuf);
impl Directory {
    fn new() -> Self {
        let path = std::env::temp_dir().join(format!("sb4-host-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(path.join("snapback")).unwrap();
        fs::write(path.join("snapback/schema.q"), SCHEMA).unwrap();
        Self(path)
    }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).args(args).current_dir(&self.0).output().unwrap() }
}
impl Drop for Directory { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }

struct Host { child: Child, stdout: PathBuf, stderr: PathBuf, port: u16 }
impl Host {
    fn start(dir: &Directory, args: &[&str]) -> Self {
        let stdout = dir.0.join("stdout"); let stderr = dir.0.join("stderr");
        let child = Command::new(BIN).args(args).args(["--port", "0"]).current_dir(&dir.0)
            .env(MAIN_REACHED, "1")
            .stdout(File::create(&stdout).unwrap()).stderr(File::create(&stderr).unwrap()).spawn().unwrap();
        let mut host = Self { child, stdout, stderr, port: 0 };
        host.until_for("process did not reach main", PROCESS_LAUNCH_TIMEOUT, |h| h.log().lines().any(|line| line == MAIN_REACHED));
        host.until_for("server did not become ready", SERVER_READINESS_TIMEOUT, |h| fs::read_to_string(&h.stdout).unwrap().contains('\n'));
        host.port = fs::read_to_string(&host.stdout).unwrap().lines().next().unwrap().rsplit(':').next().unwrap().parse().unwrap();
        host
    }
    fn log(&self) -> String { fs::read_to_string(&self.stderr).unwrap() }
    fn until_for(&mut self, label: &str, timeout: Duration, predicate: impl Fn(&Self) -> bool) {
        let deadline = Instant::now() + timeout;
        while !predicate(self) {
            if let Some(status) = self.child.try_wait().unwrap() {
                panic!("{label}: server exited with {status}; stderr:\n{}", self.log());
            }
            assert!(Instant::now() < deadline, "{label} after {timeout:?}; child still running; stderr:\n{}", self.log());
            std::thread::sleep(Duration::from_millis(10));
        }
    }
    fn until(&mut self, predicate: impl Fn(&Self) -> bool) { self.until_for("condition did not become true", SERVER_READINESS_TIMEOUT, predicate); }
    fn signal(&mut self, signal: i32) -> std::process::ExitStatus {
        assert_eq!(unsafe { libc::kill(self.child.id() as i32, signal) }, 0);
        wait(&mut self.child)
    }
}
impl Drop for Host {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() { let _ = self.child.kill(); }
        let _ = self.child.wait();
    }
}
fn wait(child: &mut Child) -> std::process::ExitStatus {
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if let Some(status) = child.try_wait().unwrap() { return status; }
        if Instant::now() >= deadline { let _ = child.kill(); let _ = child.wait(); panic!("child did not exit"); }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn wait_logged(child: &mut Child, log: &Path, label: &str) -> std::process::ExitStatus {
    let deadline = Instant::now() + SERVER_READINESS_TIMEOUT;
    loop {
        if let Some(status) = child.try_wait().unwrap() { return status; }
        if Instant::now() >= deadline {
            let _ = child.kill(); let _ = child.wait();
            panic!("{label} did not exit after {SERVER_READINESS_TIMEOUT:?}; stderr:\n{}", fs::read_to_string(log).unwrap());
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}
fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    payload.downcast_ref::<String>().cloned().or_else(|| payload.downcast_ref::<&str>().map(|message| (*message).to_owned())).unwrap_or_else(|| "non-string panic".into())
}
fn post(port: u16, path: &str, body: Value) -> Value {
    post_as(port, path, body, "x-snapback-persona: alice")
}
fn post_as(port: u16, path: &str, body: Value, credential: &str) -> Value {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    let body = body.to_string();
    write!(stream, "POST {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\n{credential}\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
    let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
    assert!(answer.starts_with("HTTP/1.1 200 "), "{answer}");
    serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap()
}
fn probe(kind: &str, dir: &Directory) -> (std::process::ExitStatus, String) {
    let log = dir.0.join("probe.log");
    let mut child = Command::new(std::env::current_exe().unwrap()).args(["--exact", "subprocess_probe", "--nocapture"])
        .env("SB4_HOST_PROBE", kind).env("SB4_HOST_DIR", &dir.0).stdout(Stdio::null()).stderr(File::create(&log).unwrap()).spawn().unwrap();
    (wait(&mut child), fs::read_to_string(log).unwrap())
}

#[test]
fn subprocess_probe() {
    let Ok(kind) = std::env::var("SB4_HOST_PROBE") else { return; };
    let dir = PathBuf::from(std::env::var_os("SB4_HOST_DIR").unwrap());
    if kind == "locks" {
        for (suffix, start) in [("-shm", 128), ("-shm", 120), ("", 0x40000002)] {
            let file = File::options().read(true).write(true).open(dir.join(format!("store.sqlite{suffix}"))).unwrap();
            let mut lock: libc::flock = unsafe { std::mem::zeroed() };
            lock.l_type = libc::F_WRLCK as _; lock.l_whence = libc::SEEK_SET as _; lock.l_start = start; lock.l_len = 1;
            let result = unsafe { libc::fcntl(file.as_raw_fd(), libc::F_SETLK, &lock) };
            assert_eq!(result, -1, "another process acquired SQLite's {suffix} lock while its owner is alive");
            assert!(matches!(std::io::Error::last_os_error().raw_os_error(), Some(libc::EACCES | libc::EAGAIN)));
        }
        return;
    }
    lifecycle::install("dev").unwrap(); lifecycle::generation(7);
    if kind == "mapping" {
        let file = File::options().create_new(true).read(true).write(true).open(dir.join("mapped")).unwrap();
        file.set_len(32768).unwrap();
        let mapped = unsafe { libc::mmap(std::ptr::null_mut(), 32768, libc::PROT_READ | libc::PROT_WRITE, libc::MAP_SHARED, file.as_raw_fd(), 0) };
        assert_ne!(mapped, libc::MAP_FAILED);
        file.set_len(0).unwrap();
        // The same OS fault as a truncated WAL mapping, while a mutex is held.
        let mutex = std::sync::Mutex::new(()); let _guard = mutex.lock().unwrap();
        unsafe { std::ptr::read_volatile(mapped.cast::<u8>().add(16384)); }
        panic!("a truncated shared mapping should fault");
    } else if kind == "partial-stderr" {
        let mut stderr = std::io::stderr().lock();
        stderr.write_all(b"snapback4 serve: http://127.0").unwrap();
        unsafe { libc::raise(libc::SIGTERM); }
        panic!("SIGTERM should terminate while stderr is locked");
    } else if kind == "panic" {
        let locked = std::sync::Mutex::new(());
        let thread = lifecycle::background("watcher", move || { let _guard = locked.lock().unwrap(); panic!("injected\npanic"); }).unwrap();
        assert!(thread.join().is_err());
    } else if kind == "return" {
        lifecycle::background("watcher", || {}).unwrap().join().unwrap();
        std::process::exit(lifecycle::finish(Err("watcher thread stopped".into())));
    } else if kind == "normal" {
        std::process::exit(lifecycle::finish(Ok(())));
    } else { panic!("unknown probe"); }
}

#[test]
fn sqlite_permissions_preserve_database_and_wal_locks() {
    let dir = Directory::new(); let path = dir.0.join("store.sqlite");
    let store = snapback4_core::Store::open(&path).unwrap();
    // Opening an existing store in this process must not close a raw
    // descriptor on either inode. SQLite alone owns those descriptor lives.
    let second = snapback4_core::Store::open(&path).unwrap();
    store.conn().execute_batch("BEGIN IMMEDIATE").unwrap();
    snapback4_core::private_fs::database_file(&path).unwrap();
    for suffix in ["", "-wal", "-shm"] {
        let path = dir.0.join(format!("store.sqlite{suffix}"));
        fs::set_permissions(&path, fs::Permissions::from_mode(0o666)).unwrap();
        snapback4_core::private_fs::existing_file(&path).unwrap();
        assert_eq!(fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
    }
    let (status, log) = probe("locks", &dir); assert!(status.success(), "{log}");
    drop(second); store.conn().execute_batch("ROLLBACK").unwrap();
    let symlink = dir.0.join("link"); std::os::unix::fs::symlink(&path, &symlink).unwrap();
    assert!(snapback4_core::private_fs::existing_file(&symlink).is_err());
    assert!(snapback4_core::private_fs::database_file(&symlink).is_err());
}

#[test]
fn off_thread_panic_and_watcher_return_have_one_line_reasons() {
    let dir = Directory::new();
    let (status, log) = probe("panic", &dir); assert!(status.success(), "{log}");
    let lines: Vec<_> = log.lines().collect(); assert_eq!(lines.len(), 2, "{log}");
    assert!(lines[0].starts_with("SNAPBACK4_PANIC verb=dev generation=7 thread=\"watcher\" action=unwind reason=\"injected\\npanic\" location="), "{log}");
    assert_eq!(lines[1], "SNAPBACK4_THREAD_EXIT verb=dev generation=7 thread=\"watcher\" reason=\"panic\"");
    let (status, log) = probe("return", &dir); assert_eq!(status.code(), Some(1));
    assert_eq!(log, "SNAPBACK4_THREAD_EXIT verb=dev generation=7 thread=\"watcher\" reason=\"unexpected return\"\nSNAPBACK4_EXIT verb=dev generation=7 status=1 reason=\"watcher thread stopped\"\n");
    let (status, log) = probe("normal", &dir); assert!(status.success());
    assert_eq!(log, "SNAPBACK4_EXIT verb=dev generation=7 status=0 reason=\"server loop returned\"\n");
}

#[test]
fn startup_refusals_name_the_unserved_generation() {
    let dir = Directory::new(); fs::remove_dir_all(dir.0.join("snapback")).unwrap();
    for (args, reason) in [
        (vec!["dev"], "no snapback/schema.q here or above; run `snapback4 init` to start one"),
        (vec!["serve"], "a deployment directory is required"),
    ] {
        let out = dir.run(&args); assert_eq!(out.status.code(), Some(1)); assert!(out.stdout.is_empty());
        assert_eq!(String::from_utf8(out.stderr).unwrap(), format!("SNAPBACK4_EXIT verb={} generation=0 status=1 reason={reason:?}\n", args[0]));
    }
}

#[test]
fn a_dead_child_reports_its_status_and_stderr_without_waiting_for_the_deadline() {
    let dir = Directory::new();
    let stdout = dir.0.join("dead.stdout"); let stderr = dir.0.join("dead.stderr");
    let child = Command::new("/bin/sh").args(["-c", "printf 'deliberate child refusal\\n' >&2; exit 23"])
        .stdout(File::create(&stdout).unwrap()).stderr(File::create(&stderr).unwrap()).spawn().unwrap();
    let mut host = Host { child, stdout, stderr, port: 0 };
    let launch_deadline = Instant::now() + PROCESS_LAUNCH_TIMEOUT;
    while !host.log().contains("deliberate child refusal") {
        assert!(Instant::now() < launch_deadline, "dead-child fixture did not launch; stderr:\n{}", host.log());
        std::thread::sleep(Duration::from_millis(10));
    }
    let started = Instant::now();
    let panic = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        host.until_for("deliberately dead child", Duration::from_secs(15), |_| false);
    })).unwrap_err();
    assert!(started.elapsed() < Duration::from_secs(2), "dead child was not diagnosed promptly: {:?}", started.elapsed());
    let message = panic_message(panic);
    assert!(message.contains("deliberately dead child: server exited with exit status: 23"), "{message}");
    assert!(message.contains("deliberate child refusal"), "{message}");
}

#[test]
fn a_real_mapping_fault_reports_before_the_os_terminates_the_process() {
    let dir = Directory::new(); let (status, log) = probe("mapping", &dir);
    assert_eq!(status.signal(), Some(libc::SIGBUS));
    assert_eq!(log, format!("\nSNAPBACK4_SIGNAL verb=dev generation=7 reason=SIGBUS signal={}\n", libc::SIGBUS));
}

#[test]
fn a_signal_diagnostic_starts_a_line_after_interrupted_stderr() {
    let dir = Directory::new(); let (status, log) = probe("partial-stderr", &dir);
    assert_eq!(status.signal(), Some(libc::SIGTERM));
    assert_eq!(log, "snapback4 serve: http://127.0\nSNAPBACK4_SIGNAL verb=dev generation=7 reason=SIGTERM signal=15\n");
}

#[test]
fn dev_and_serve_report_signals_without_a_configured_worker() {
    for verb in ["dev", "serve"] {
        for signal in [libc::SIGTERM, libc::SIGINT, libc::SIGHUP, libc::SIGBUS, libc::SIGABRT] {
            let dir = Directory::new(); let release = dir.0.join("release");
            if verb == "serve" { let out = dir.run(&["deploy", release.to_str().unwrap()]); assert!(out.status.success(), "{out:?}"); }
            let args = if verb == "dev" { vec!["dev"] } else { vec!["serve", release.to_str().unwrap()] };
            let mut host = Host::start(&dir, &args);
            if verb == "dev" {
                fs::write(dir.0.join("snapback/schema.q"), format!("{SCHEMA}\nquery changed():\n  return true\n")).unwrap();
                host.until(|h| h.log().contains("schema adopted as generation 2"));
                assert_eq!(post(host.port, "/q/changed", json!({"args": {}}))["data"], true);
            }
            let status = host.signal(signal);
            if verb == "dev" && matches!(signal, libc::SIGINT | libc::SIGTERM | libc::SIGHUP) {
                assert_eq!(status.code(), Some(128 + signal));
            } else { assert_eq!(status.signal(), Some(signal)); }
            let name = match signal { libc::SIGTERM => "SIGTERM", libc::SIGINT => "SIGINT", libc::SIGHUP => "SIGHUP", libc::SIGBUS => "SIGBUS", _ => "SIGABRT" };
            let line = format!("SNAPBACK4_SIGNAL verb={verb} generation={} reason={name} signal={signal}", if verb == "dev" { 2 } else { 1 });
            assert!(host.log().lines().any(|l| l == line), "{}", host.log());
            println!("{line}");
            assert_eq!(fs::read_to_string(&host.stdout).unwrap().lines().count(), 1);
        }
    }
}

#[test]
fn a_store_without_work_binding_columns_still_serves() {
    let dir = Directory::new();
    let mut original = Host::start(&dir, &["dev", "--no-watch"]);
    original.signal(libc::SIGTERM);
    drop(original);
    let conn = rusqlite::Connection::open(dir.0.join(".snapback4/store.sqlite")).unwrap();
    conn.execute_batch("DROP INDEX _sessions_family; ALTER TABLE _sessions DROP COLUMN family;
        DROP TABLE _principal_generations;
        ALTER TABLE _ops DROP COLUMN name; ALTER TABLE _ops DROP COLUMN args_digest;
        ALTER TABLE _ops DROP COLUMN at;
        ALTER TABLE _requests DROP COLUMN family; ALTER TABLE _requests DROP COLUMN principal_generation;
        ALTER TABLE _requests DROP COLUMN admitted_expires_at; ALTER TABLE _requests DROP COLUMN args_digest;
        ALTER TABLE _requests DROP COLUMN error_code; ALTER TABLE _requests DROP COLUMN settled_at;
        ALTER TABLE _outbox DROP COLUMN settled_at;").unwrap();
    drop(conn);
    let mut upgraded = Host::start(&dir, &["dev", "--no-watch"]);
    assert_eq!(post(upgraded.port, "/q/alive", json!({"args":{}}))["data"], true);
    upgraded.signal(libc::SIGTERM);
}

#[test]
fn a_signal_still_cleans_up_the_application_worker() {
    for verb in ["dev", "serve"] {
        let dir = Directory::new();
        let source = dir.0.join("snapback/worker.mjs");
        // Automatic dev entries run from private validated snapshots. The
        // fixture owns its observation directory independently of module URLs.
        fs::write(&source, format!(r#"
import {{ writeFileSync }} from 'node:fs';
const root = {};
process.on('SIGTERM', () => {{ writeFileSync(root + '/worker-stopped', 'yes'); process.exit(0); }});
writeFileSync(root + '/worker-pid', String(process.pid));
setInterval(() => {{}}, 1000);
"#, serde_json::to_string(&dir.0).unwrap())).unwrap();
        let release = dir.0.join("release");
        if verb == "serve" { assert!(dir.run(&["deploy", release.to_str().unwrap()]).status.success()); }
        let args = if verb == "dev" { vec!["dev"] } else { vec!["serve", release.to_str().unwrap(), "--worker", source.to_str().unwrap()] };
        let credential = if verb == "serve" {
            let out = dir.run(&["token", "--service", "probe", "--release", release.to_str().unwrap()]);
            assert!(out.status.success(), "{out:?}");
            format!("Authorization: Bearer {}", String::from_utf8(out.stdout).unwrap().trim())
        } else { "x-snapback-persona: alice".into() };
        let mut host = Host::start(&dir, &args);
        host.until(|_| fs::read_to_string(dir.0.join("worker-pid")).ok().and_then(|text| text.parse::<u32>().ok()).is_some());
        assert_eq!(post_as(host.port, "/q/alive", json!({"args":{}}), &credential)["data"], true);
        assert_eq!(host.signal(libc::SIGTERM).code(), Some(143));
        assert_eq!(fs::read_to_string(dir.0.join("worker-stopped")).unwrap(), "yes");
        assert!(host.log().contains(&format!("SNAPBACK4_SIGNAL verb={verb} generation=1 reason=SIGTERM signal=15")));
    }
}

#[test]
fn abort_profile_reports_an_off_thread_panic_to_redirected_stderr() {
    let dir = Directory::new(); let source = dir.0.join("probe.rs"); let executable = dir.0.join("abort-probe");
    let lifecycle = Path::new(env!("CARGO_MANIFEST_DIR")).join("src/lifecycle.rs");
    // This standalone abort witness never calls lifecycle::background; its
    // scheduling dependency is covered by the host's priority/readback tests.
    fs::write(&source, format!("mod thread_priority {{ pub fn background() {{}} }} #[path = {lifecycle:?}] mod lifecycle; fn main() {{ eprintln!(\"{MAIN_REACHED}\"); lifecycle::install(\"serve\").unwrap(); lifecycle::generation(9); std::thread::Builder::new().name(\"maintenance\".into()).spawn(|| panic!(\"abort witness\")).unwrap().join().unwrap(); }}")).unwrap();
    let deps = std::env::current_exe().unwrap().parent().unwrap().to_path_buf();
    let libc = fs::read_dir(&deps).unwrap().map(|e| e.unwrap().path()).find(|p| p.file_name().unwrap().to_string_lossy().starts_with("liblibc-") && p.extension().is_some_and(|s| s == "rlib")).unwrap();
    let built = Command::new("rustc").args(["--edition=2024", "-C", "panic=abort", "-A", "dead_code", "--extern"]).arg(format!("libc={}", libc.display())).arg(&source).arg("-o").arg(&executable).output().unwrap();
    assert!(built.status.success(), "{}", String::from_utf8_lossy(&built.stderr));
    let log = dir.0.join("abort.log");
    let mut child = Command::new(executable).stderr(File::create(&log).unwrap()).spawn().unwrap();
    let deadline = Instant::now() + PROCESS_LAUNCH_TIMEOUT;
    while !fs::read_to_string(&log).unwrap().lines().any(|line| line == MAIN_REACHED) {
        if let Some(status) = child.try_wait().unwrap() {
            panic!("abort probe exited before reaching main with {status}; stderr:\n{}", fs::read_to_string(&log).unwrap());
        }
        assert!(Instant::now() < deadline, "abort probe did not reach main after {PROCESS_LAUNCH_TIMEOUT:?}; stderr:\n{}", fs::read_to_string(&log).unwrap());
        std::thread::sleep(Duration::from_millis(10));
    }
    let status = wait_logged(&mut child, &log, "abort probe");
    assert_eq!(status.signal(), Some(libc::SIGABRT), "{}", fs::read_to_string(&log).unwrap());
    let log = fs::read_to_string(log).unwrap();
    assert!(log.lines().any(|l| l.starts_with("SNAPBACK4_PANIC verb=serve generation=9 thread=\"maintenance\" action=abort reason=\"abort witness\" location=")), "{log}");
    assert!(log.contains("SNAPBACK4_SIGNAL verb=serve generation=9 reason=SIGABRT signal=6"), "{log}");
}

const REPOST_BEFORE: &str = r#"use personas alice
table entries:
  actorId: principal
  postId: id
  kind: enum('original', 'repost')
  at: int
  by byTime: at, id
  immutable actorId, postId, kind, at
  public 'the Clique feed'
  sync public last 1000 by byTime
maintain repostCounts: count entries by postId, kind
  read <- allow
query entries(c: cursor ?):
  return entries after c first 100 by byId
"#;
fn repost_after() -> String {
    REPOST_BEFORE.replace("maintain repostCounts: count entries by postId, kind\n  read <- allow", r#"table repostEdges:
  actorId: principal
  postId: id
  at: int
  by byTime: at, id
  immutable actorId, postId, at
  public 'only reposts contribute to the public counter'
  sync public last 1000 by byTime
maintain activeRepostCounts: count repostEdges by postId
  read <- allow
job backfillRepostEdges():
  chunk e in entries first 100 by byId:
    if e.kind = 'repost':
      insert repostEdges { id: e.id, actorId: e.actorId, postId: e.postId, at: e.at } if absent"#)
}
fn seed(port: u16, start: usize, end: usize) {
    for base in (start..end).step_by(100) {
        let rows: Vec<_> = (base..(base + 100).min(end)).map(|i| json!({"table": "entries", "row": {"id": format!("{i:026}"), "actorId": "dev:alice", "postId": format!("post{i}"), "kind": if i < 800 && i % 13 == 0 { "repost" } else { "original" }, "at": i}})).collect();
        assert_eq!(post(port, "/seed", json!(rows))["seeded"], rows.len());
    }
}

#[test]
fn sqlite_replay_survives_counter_split_and_an_offline_cli_backfill() {
    let dir = Directory::new(); let schema = dir.0.join("snapback/schema.q");
    fs::write(&schema, REPOST_BEFORE).unwrap();
    let mut host = Host::start(&dir, &["dev"]);
    seed(host.port, 0, 800);
    let port = host.port;
    let replay = std::thread::spawn(move || {
        seed(port, 800, 1600);
        for _ in 0..20 { assert_eq!(post(port, "/q/entries", json!({"args": {"c": null}}))["complete"], true); }
    });
    fs::write(schema, repost_after()).unwrap();
    host.until(|h| h.log().contains("schema adopted as generation 2"));
    let refused = dir.run(&["run", "backfillRepostEdges", "--json"]);
    assert!(!refused.status.success()); assert!(String::from_utf8_lossy(&refused.stderr).contains("E_STORE_BUSY"));
    replay.join().unwrap();
    host.signal(libc::SIGTERM);
    let job = dir.run(&["run", "backfillRepostEdges", "--json"]);
    assert!(job.status.success(), "{job:?}");
    assert_eq!(serde_json::from_slice::<Value>(&job.stdout).unwrap()["state"], "done");
    let mut host = Host::start(&dir, &["dev"]);
    let store = snapback4_core::Store::open(&dir.0.join(".snapback4/store.sqlite")).unwrap();
    assert_eq!(store.rows("entries").unwrap().len(), 1600);
    assert_eq!(store.rows("repostEdges").unwrap().len(), 62);
    assert_eq!(post(host.port, "/q/entries", json!({"args": {"c": null}}))["complete"], true);
    assert!(host.child.try_wait().unwrap().is_none());
    assert_eq!(host.signal(libc::SIGTERM).code(), Some(143));
    assert!(host.log().contains("SNAPBACK4_SIGNAL verb=dev generation=2 reason=SIGTERM signal=15"));
}

#[test]
fn dev_default_adoption_and_check_share_the_successor_refusal() {
    let dir = Directory::new();
    let source = "use personas alice\ntable messages:\n  body: text <=100\n  read <- allow\nquery all():\n  return messages[] first 10 by byId\n";
    let path = dir.0.join("snapback/schema.q");
    fs::write(&path, source).unwrap();
    let mut host = Host::start(&dir, &["dev"]);
    assert_eq!(post(host.port, "/seed", json!((0..3).map(|i| json!({"table": "messages", "row": {"id": format!("m{i}"), "body": "old"}})).collect::<Vec<_>>()))["seeded"], 3);
    fs::write(&path, source.replace("  read", "  at: time default now\n  read")).unwrap();
    host.until(|h| h.log().contains("E_ADOPT"));
    let output = dir.run(&["check", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let diagnostic = serde_json::from_slice::<Value>(&output.stdout).unwrap()["problems"][0].clone();
    assert!(host.log().contains(diagnostic["message"].as_str().unwrap()));
    assert!(host.log().contains(diagnostic["rewrite"].as_str().unwrap()));
    fs::write(path, source.replace("  read", "  tombstone: bool default false\n  read")).unwrap();
    host.until(|h| h.log().contains("schema adopted as generation 2"));
    let rows = post(host.port, "/q/all", json!({"args": {}}))["data"].clone();
    assert_eq!(rows.as_array().unwrap().len(), 3);
    assert!(rows.as_array().unwrap().iter().all(|r| r["tombstone"] == false));
    assert!(dir.run(&["check", "--json"]).status.success());
}

#[test]
fn watcher_keeps_serving_after_a_refused_edit_and_a_parked_backfill() {
    let dir = Directory::new(); let schema = dir.0.join("snapback/schema.q");
    fs::write(&schema, REPOST_BEFORE).unwrap();
    let mut host = Host::start(&dir, &["dev"]); seed(host.port, 0, 800);
    fs::write(&schema, "table broken:\n  ???\n").unwrap();
    host.until(|h| h.log().contains("serving the previous generation"));
    assert_eq!(post(host.port, "/q/entries", json!({"args": {"c": null}}))["complete"], true);
    let refusing = repost_after().replace("first 100 by byId:\n    if", "first 1 by byId:\n    require e.at < 200 else BACKFILL_STOP\n    if");
    fs::write(&schema, refusing).unwrap();
    host.until(|h| h.log().contains("schema adopted as generation 2"));
    let store = snapback4_core::Store::open(&dir.0.join(".snapback4/store.sqlite")).unwrap();
    let mut engine = snapback4_core::Engine::open(store).unwrap();
    let id = engine.enqueue_job("backfillRepostEdges", Default::default(), snapback4_core::now_ms()).unwrap();
    host.until(|h| h.log().contains("job backfillRepostEdges parked after 200 chunks"));
    let run = engine.jobs(5).unwrap().into_iter().find(|r| r.id == id).unwrap();
    assert_eq!(run.state, snapback4_core::JobState::Parked);
    assert!(run.error.as_deref().unwrap().contains("BACKFILL_STOP"));
    assert!(run.rows_written > 0, "backfill must commit positive progress before the refusal");
    fs::write(&schema, repost_after()).unwrap();
    host.until(|h| h.log().contains("schema adopted as generation 3"));
    host.signal(libc::SIGTERM);
    let job = dir.run(&["run", "backfillRepostEdges", "--json"]); assert!(job.status.success(), "{job:?}");
    assert_eq!(serde_json::from_slice::<Value>(&job.stdout).unwrap()["state"], "done");
    let mut host = Host::start(&dir, &["dev"]);
    assert_eq!(post(host.port, "/q/entries", json!({"args": {"c": null}}))["complete"], true);
    assert_eq!(host.signal(libc::SIGTERM).code(), Some(143));
    assert!(host.log().contains("SNAPBACK4_SIGNAL verb=dev generation=3 reason=SIGTERM signal=15"));
}

#[test]
fn memory_and_sqlite_serialize_adoption_after_replay_then_run_the_backfill() {
    use snapback4_core::{Engine, Store, wire};
    use std::sync::{Arc, Mutex, mpsc};
    for disk in [false, true] {
        let dir = Directory::new();
        let before = snapback4_lang::compile(&[("schema.q".into(), REPOST_BEFORE.into())]); assert!(before.diagnostics.is_empty());
        let after = snapback4_lang::compile(&[("schema.q".into(), repost_after())]); assert!(after.diagnostics.is_empty());
        let store = if disk { Store::open(&dir.0.join("store.sqlite")).unwrap() } else { Store::memory().unwrap() };
        let engine = Arc::new(Mutex::new(Engine::new(store, before.schema, before.programs.into_iter().map(|p| p.program)).unwrap()));
        let (held_tx, held_rx) = mpsc::channel(); let (release_tx, release_rx) = mpsc::channel();
        let replay_engine = engine.clone();
        let replay = std::thread::spawn(move || {
            let mut engine = replay_engine.lock().unwrap();
            let rows: Vec<_> = (0..800).map(|i| ("entries".into(), wire::row_from_json(engine.schema().table("entries").unwrap(), &json!({"id": format!("{i:026}"), "actorId": "alice", "postId": format!("post{i}"), "kind": if i % 13 == 0 { "repost" } else { "original" }, "at": i})).unwrap())).collect();
            engine.seed(rows).unwrap(); held_tx.send(()).unwrap(); release_rx.recv().unwrap();
        });
        held_rx.recv().unwrap();
        let adoption_engine = engine.clone(); let (done_tx, done_rx) = mpsc::channel();
        let adoption = std::thread::spawn(move || {
            let mut engine = adoption_engine.lock().unwrap();
            let generation = engine.adopt(after.schema, after.programs.into_iter().map(|p| p.program)).unwrap();
            engine.enqueue_job("backfillRepostEdges", Default::default(), snapback4_core::now_ms()).unwrap();
            done_tx.send(generation).unwrap();
        });
        assert!(matches!(done_rx.recv_timeout(Duration::from_millis(20)), Err(mpsc::RecvTimeoutError::Timeout)));
        release_tx.send(()).unwrap(); replay.join().unwrap();
        assert_eq!(done_rx.recv_timeout(Duration::from_secs(5)).unwrap(), 2); adoption.join().unwrap();
        loop {
            let ran = engine.lock().unwrap().run_job_chunk(snapback4_core::now_ms()).unwrap();
            let Some(run) = ran else { break; };
            assert_ne!(run.state, snapback4_core::JobState::Parked, "{run:?}");
        }
        let engine = engine.lock().unwrap();
        assert_eq!(engine.store().rows("entries").unwrap().len(), 800);
        assert_eq!(engine.store().rows("repostEdges").unwrap().len(), 62);
    }
}

#[test]
fn development_banner_and_release_auth_boundary() {
    let dir = Directory::new();
    fs::write(dir.0.join("snapback/schema.q"), "use personas alice\nuse identity guests\ntable items:\n  body: text <=100\n  read <- allow\nquery all():\n  return items[] first 10 by byId\n").unwrap();
    let request = |port, path: &str, body: Value, credential: &str| -> (u16, Value) {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let body = body.to_string();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\n{credential}Content-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        let (head, body) = answer.split_once("\r\n\r\n").unwrap();
        (head.split_whitespace().nth(1).unwrap().parse().unwrap(), serde_json::from_str(body).unwrap())
    };
    let rows = json!([{"table":"items","row":{"id":"one","body":"development"}}]);
    let dev = Host::start(&dir, &["dev"]);
    assert_eq!(request(dev.port, "/seed", rows.clone(), ""), (200, json!({"seeded":1})));
    let (status, read) = request(dev.port, "/q/all", json!({"args":{}}), "x-snapback-persona: alice\r\n");
    assert_eq!(status, 200); assert_eq!(read["data"][0]["body"], "development");
    let banner = dev.log();
    drop(dev);
    let deployment = dir.0.join("release");
    let result = dir.run(&["deploy", deployment.to_str().unwrap()]);
    assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
    let release = Host::start(&dir, &["serve", deployment.to_str().unwrap()]);
    let (status, seed) = request(release.port, "/seed", rows, "");
    assert_eq!(status, 403); assert_eq!(seed["denied"]["message"], "seeding is a development door");
    let (status, persona) = request(release.port, "/q/all", json!({"args":{}}), "x-snapback-persona: alice\r\n");
    assert_eq!(status, 401); assert_eq!(persona["denied"]["code"], "E_AUTH");
    let (status, guest) = request(release.port, "/auth/guest", json!({}), "");
    assert_eq!(status, 200);
    let (status, read) = request(release.port, "/q/all", json!({"args":{}}), &format!("Authorization: Bearer {}\r\n", guest["session"]["token"].as_str().unwrap()));
    assert_eq!(status, 200); assert_eq!(read["data"], json!([]), "refused seed never writes release data");
    assert!(banner.contains("snapback4 dev: development only — admits loopback personas and an unauthenticated /seed; deploy with snapback4 deploy + snapback4 serve, which refuse both."), "{banner}");
}

#[test]
fn dev_refuses_an_explicit_worker_path_instead_of_ignoring_it() {
    let dir = Directory::new();
    let out = dir.run(&["dev", "--worker", "custom.mjs"]);
    assert_eq!(out.status.code(), Some(1));
    assert!(out.stdout.is_empty());
    assert!(String::from_utf8(out.stderr).unwrap().contains("dev does not accept --worker"));
}

#[test]
fn killed_supervisors_leave_only_bounded_sessions_and_startup_sweeps_their_children() {
    let dir = Directory::new();
    let source = dir.0.join("snapback/worker.mjs");
    fs::write(&source, "import { writeFileSync } from 'node:fs'; writeFileSync(new URL('../worker-pid', import.meta.url), String(process.pid)); setInterval(() => {}, 1000);\n").unwrap();
    let release = dir.0.join("release");
    assert!(dir.run(&["deploy", release.to_str().unwrap()]).status.success());
    let store = snapback4_core::Store::open(&release.join("store.sqlite")).unwrap();
    let manual = snapback4_core::identity::service_session(&store, "worker", snapback4_core::now_ms(), 30).unwrap();
    let mut host = Host::start(&dir, &["serve", release.to_str().unwrap(), "--worker", source.to_str().unwrap()]);
    host.until(|_| fs::read_to_string(dir.0.join("worker-pid")).ok().and_then(|text| text.parse::<u32>().ok()).is_some());
    struct Orphan(u32);
    impl Drop for Orphan { fn drop(&mut self) { unsafe { libc::kill(self.0 as i32, libc::SIGKILL); } } }
    let orphan = Orphan(fs::read_to_string(dir.0.join("worker-pid")).unwrap().parse().unwrap());
    let family = store.meta("worker:session-family").unwrap().unwrap();
    let lifetime: i64 = store.conn().query_row("SELECT expires_at - created_at FROM _sessions WHERE family = ?1", [&family], |row| row.get(0)).unwrap();
    assert!(lifetime > 0 && lifetime <= 86_400_000);
    assert_eq!(host.signal(libc::SIGKILL).signal(), Some(libc::SIGKILL));
    drop(host);
    drop(orphan);
    // Cleanup also runs when the next host has no worker configured.
    let mut restarted = Host::start(&dir, &["serve", release.to_str().unwrap()]);
    let stale: i64 = store.conn().query_row("SELECT COUNT(*) FROM _sessions WHERE family = ?1", [&family], |row| row.get(0)).unwrap();
    assert_eq!(stale, 0);
    assert_eq!(store.meta("worker:session-family").unwrap(), None);
    assert!(snapback4_core::identity::resolve(&store, &manual.token, snapback4_core::now_ms()).unwrap().is_some(), "a manually issued seat is not the old supervisor's credential");
    restarted.signal(libc::SIGTERM);
}

#[test]
fn w10r1b_dev_reports_the_same_cascades_as_check() {
    for verbose in [false, true] {
        let dir = Directory::new();
        let mut host = Host::start(&dir, if verbose { &["dev", "--verbose"] } else { &["dev"] });
        fs::write(dir.0.join("snapback/chat.q"), "query apiHistory():\n  return messages where .body = 'hello'\n").unwrap();
        let check = dir.run(if verbose { &["check", "--verbose"] } else { &["check"] });
        assert_eq!(check.status.code(), Some(1));
        // check puts its verdict first; the running dev host retains its
        // adoption footer. The diagnostic bodies must still be identical.
        let checked = String::from_utf8(check.stderr).unwrap();
        let (verdict, reports) = checked.split_once('\n').unwrap();
        let mut lines = reports.lines().collect::<Vec<_>>();
        let hidden = lines.last().filter(|line| line.starts_with("check:")).map(|line| line.to_string());
        if hidden.is_some() { lines.pop(); }
        let expected = format!("{}\n{} in snapback/; serving the previous generation\n{}",
            lines.join("\n"), verdict.replace("check: ", "snapback4 dev: "),
            hidden.map_or_else(String::new, |line| format!("{}\n", line.replace("check: ", "snapback4 dev: "))));
        host.until(|h| h.log().contains(expected.lines().last().unwrap()));
        println!("W10R1b dev verbose={verbose}:\n{}", host.log());
        assert!(host.log().ends_with(&expected), "expected:\n{expected}actual:\n{}", host.log());
        fs::write(dir.0.join("snapback/chat.q"), "query apiHistory():\n  return true\n").unwrap();
        host.until(|h| h.log().contains("schema adopted as generation 2"));
        assert!(dir.run(&["check"]).status.success());
    }
}
