use super::*;

const ADOPTION_SOURCE: &str = "table expiring:\n  expiresAt: time ?\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  read <- allow\nquery version():\n  return 1\n";

#[test]
fn w8c_adoption_lock_failure_repeats_on_sweep_and_retries_without_another_save() {
    let p = Project::new(); p.source(ADOPTION_SOURCE);
    let host = AdoptionHost::start(&p, true);
    let conn = rusqlite::Connection::open(p.store()).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    p.source(&ADOPTION_SOURCE.replace("return 1", "return 2"));
    wait_adoption(|| host.has_log_line("the new schema was not adopted: E_STORE: database is locked; serving generation 1"));
    wait_adoption(|| host.has_log_line("the expiry sweep failed") && host.has_log_line("adoption still pending: E_STORE: database is locked"));
    let logs = host.logs();
    let pending = p.run(&["doctor", "--json"]);
    let pending = parsed(&pending);
    assert_eq!(pending["ok"], false, "{pending}");
    assert!(pending.to_string().contains("adoption  pending: E_STORE: database is locked"), "{pending}");
    conn.execute_batch("COMMIT").unwrap();
    assert!(logs.contains("the new schema was not adopted: E_STORE: database is locked; serving generation 1"), "{logs}");
    assert!(logs.contains("adoption still pending: E_STORE: database is locked"), "{logs}");
    wait_adoption(|| host.query()["data"] == 2);
    let doctor = p.run(&["doctor", "--json"]);
    assert!(doctor.status.success(), "{doctor:?}");
    // The diagnostic writer can finish after query recovery and doctor.
    wait_adoption(|| host.has_log_line("schema adopted as generation 2"));
    assert!(host.logs().contains("schema adopted as generation 2"), "{}", host.logs());
    println!("adoption: locked_refusal_repeated=1 recovered_generation=2 extra_saves=0");
}

#[test]
fn w8c_doctor_names_live_generation_mismatch_even_when_source_matches_store() {
    let p = Project::new(); p.source(ADOPTION_SOURCE);
    let host = AdoptionHost::start(&p, false);
    p.source(&ADOPTION_SOURCE.replace("return 1", "return 2"));
    let run = p.run(&["run", "version", "--json"]);
    assert!(!run.status.success()); assert!(String::from_utf8_lossy(&run.stderr).contains("E_STORE_BUSY"));
    let bound = snapback4_lang::compile(&[("schema.q".into(), ADOPTION_SOURCE.replace("return 1", "return 2"))]);
    Engine::new(Store::open(&p.store()).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    assert_eq!(host.query()["denied"]["code"], "E_GENERATION");
    let doctor = p.run(&["doctor", "--json"]);
    let output = parsed(&doctor);
    assert_eq!(output["ok"], false, "{output}");
    let text = output.to_string();
    assert!(text.contains("E_GENERATION: host generation 1 differs from store generation 2"), "{text}");
    assert!(!doctor.status.success());
    drop(host);
    let host = AdoptionHost::start(&p, true);
    assert_eq!(host.query()["data"], 2);
    assert!(p.run(&["doctor", "--json"]).status.success());
}

#[test]
fn w8c_watching_host_reopens_after_external_adoption_while_cli_refuses() {
    let p = Project::new(); p.source(ADOPTION_SOURCE);
    let host = AdoptionHost::start(&p, true);
    // Park only while the fixture owns the writer lock: stopping a sweep in
    // its transaction would prevent the external adoption below from writing.
    let barrier = rusqlite::Connection::open(p.store()).unwrap();
    barrier.busy_timeout(std::time::Duration::from_secs(35)).unwrap();
    barrier.execute_batch("BEGIN IMMEDIATE").unwrap();
    unsafe { assert_eq!(libc::kill(host.child.id() as i32, libc::SIGSTOP), 0); }
    wait_adoption(|| {
        let mut status = 0;
        let pid = unsafe { libc::waitpid(host.child.id() as i32, &mut status, libc::WUNTRACED | libc::WNOHANG) };
        assert!(pid >= 0, "{}", std::io::Error::last_os_error());
        if pid == 0 { return false; }
        assert!(libc::WIFSTOPPED(status), "host exited before the external adoption");
        true
    });
    barrier.execute_batch("COMMIT").unwrap();
    p.source(&ADOPTION_SOURCE.replace("return 1", "return 2"));
    let run = p.run(&["run", "version", "--json"]);
    assert!(!run.status.success()); assert!(String::from_utf8_lossy(&run.stderr).contains("E_STORE_BUSY"));
    let bound = snapback4_lang::compile(&[("schema.q".into(), ADOPTION_SOURCE.replace("return 1", "return 2"))]);
    Engine::new(Store::open(&p.store()).unwrap(), bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    unsafe { assert_eq!(libc::kill(host.child.id() as i32, libc::SIGCONT), 0); }
    wait_adoption(|| host.query()["data"] == 2);
    assert!(p.run(&["doctor", "--json"]).status.success());
    println!("adoption: external_generation=2 recovered_generation=2 restarts=0");
}

#[test]
fn w8c_startup_waits_for_the_adoption_lock_to_clear() {
    use std::io::{BufRead, BufReader};
    let p = Project::new(); p.source(ADOPTION_SOURCE);
    assert!(p.run(&["run", "version", "--json"]).status.success());
    let conn = rusqlite::Connection::open(p.store()).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    let log = p.0.join("startup.log");
    let child = Command::new(BIN).current_dir(&p.0).args(["dev", "--port", "0", "--no-watch"])
        .stdout(std::process::Stdio::piped()).stderr(fs::File::create(&log).unwrap()).spawn().unwrap();
    let mut host = AdoptionHost { child, address: String::new(), log };
    // Wait for the whole line: a partial read of the log must not end the wait.
    wait_adoption(|| host.has_log_line("no requests, jobs or sweeps are running; retrying automatically") || host.child.try_wait().unwrap().is_some());
    conn.execute_batch("COMMIT").unwrap();
    assert!(host.logs().contains("no requests, jobs or sweeps are running; retrying automatically"), "{}", host.logs());
    let mut line = String::new(); BufReader::new(host.child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    host.address = line.trim().trim_start_matches("http://").into();
    assert_eq!(host.query()["data"], 1);
    println!("adoption: startup_retries=1 recovered_generation=1 restarts=0");
}
