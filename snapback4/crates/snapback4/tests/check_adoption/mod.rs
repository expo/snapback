use super::*;

const ADOPTION_SOURCE: &str = "table expiring:\n  expiresAt: time ?\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  read <- allow\nquery version():\n  return 1\n";

#[test]
fn populated_adoption_preview_is_read_only_and_names_its_measured_rate() {
    let p = Project::new();
    drop(p.seed(&p.store(), 7));
    p.source(&format!("{SOURCE}view counts: count messages by .body\n"));
    let paths = [p.store(), PathBuf::from(format!("{}-wal", p.store().display()))];
    // A read-only WAL connection may create an empty sidecar. Compare bytes,
    // treating absent and empty WAL as the same absence of written frames.
    let before: Vec<_> = paths.iter().map(|p| fs::read(p).unwrap_or_default()).collect();
    let output = p.run(&["check", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let data = parsed(&output);
    let note = data["notes"].as_array().unwrap().iter().find(|n| n["code"] == "N_ADOPTION_PAUSE").unwrap();
    let text = note["message"].as_str().unwrap();
    assert!(text.contains("messages=7") && text.contains("eb1000") && text.contains("not a host/load SLO"), "{text}");
    assert!(text.contains("not a floor") && text.contains("147 MiB") && text.contains("SNAPBACK4_ADOPTION_CACHE_MIB"), "{text}");
    let configured = Command::new(BIN).current_dir(&p.0).args(["check", "--json"])
        .env("SNAPBACK4_ADOPTION_CACHE_MIB", "0").output().unwrap();
    assert!(configured.status.success(), "{configured:?}");
    let configured = parsed(&configured);
    let note = configured["notes"].as_array().unwrap().iter().find(|n| n["code"] == "N_ADOPTION_PAUSE").unwrap();
    assert!(note["message"].as_str().unwrap().contains("memory: caller cache setting"));
    for (path, bytes) in paths.iter().zip(before) { assert_eq!(fs::read(path).unwrap_or_default(), bytes, "{} changed", path.display()); }
    let fresh = Project::new();
    fresh.source(&format!("{SOURCE}view counts: count messages by .body\n"));
    let output = fresh.run(&["check", "--json"]);
    assert!(output.status.success());
    assert!(!String::from_utf8_lossy(&output.stdout).contains("N_ADOPTION_PAUSE"));
}

#[test]
fn check_warns_about_removed_rows_and_removed_indexes_without_build_work() {
    const SOURCE: &str = "table entries:\n  n: int\n  by byN: n\n  public\n";
    for (candidate, expected) in [
        ("query version():\n  return 1\n", "1000 stored rows and 2000 index entries"),
        ("table entries:\n  n: int\n  public\n", "0 stored rows and 1000 index entries"),
    ] {
        let p = Project::new();
        p.source(SOURCE);
        let bound = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        assert!(bound.diagnostics.is_empty());
        let mut engine = Engine::new(Store::open(&p.store()).unwrap(), bound.schema,
            bound.programs.into_iter().map(|p| p.program)).unwrap();
        let table = engine.schema().tables["entries"].clone();
        engine.seed((0..1000).map(|n| ("entries".into(), wire::row_from_json(&table, &json!({"id": format!("r{n}"), "n": n})).unwrap()))).unwrap();
        drop(engine);
        p.source(candidate);
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success(), "{output:?}");
        let data = parsed(&output);
        let note = data["notes"].as_array().unwrap().iter().find(|n| n["code"] == "N_ADOPTION_PAUSE").unwrap();
        let message = note["message"].as_str().unwrap();
        assert!(message.contains("unestimated write pause") && message.contains(expected), "{message}");
    }
}

#[test]
fn w8c_adoption_lock_failure_repeats_on_sweep_and_retries_without_another_save() {
    let p = Project::new(); p.source(ADOPTION_SOURCE);
    let host = AdoptionHost::start(&p, true);
    let conn = rusqlite::Connection::open(p.store()).unwrap();
    conn.execute_batch("BEGIN IMMEDIATE").unwrap();
    p.source(&ADOPTION_SOURCE.replace("return 1", "return 2"));
    wait_adoption(|| host.logs().contains("the new schema was not adopted"));
    wait_adoption(|| host.logs().contains("the expiry sweep failed"));
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
    unsafe { assert_eq!(libc::kill(host.child.id() as i32, libc::SIGSTOP), 0); }
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
    wait_adoption(|| host.logs().contains("no requests, jobs or sweeps are running; retrying automatically") || host.child.try_wait().unwrap().is_some());
    conn.execute_batch("COMMIT").unwrap();
    assert!(host.logs().contains("no requests, jobs or sweeps are running; retrying automatically"), "{}", host.logs());
    let mut line = String::new(); BufReader::new(host.child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    host.address = line.trim().trim_start_matches("http://").into();
    assert_eq!(host.query()["data"], 1);
    println!("adoption: startup_retries=1 recovered_generation=1 restarts=0");
}
