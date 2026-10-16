//! Advisory notes stay terse on every save; the full explanation is opt-in.
use std::{fs, process::Command};

#[test]
fn sync_order_note_is_printed_on_every_check_and_clears_with_matching_window() {
    let dir = std::env::temp_dir().join(format!("sb4-check-sync-order-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let source = include_str!("../../snapback4-lang/tests/fixtures/sync-windows.q");
    fs::write(dir.join("snapback/schema.q"), source.replace("sync last 10000 by .at, .ordinal", "sync last 10000 by .at")).unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    for _ in 0..2 {
        let text = run(&["check"]);
        assert_eq!(text.matches(" — N_SYNC_ORDER:").count(), 1, "{text}");
        assert!(text.contains("schema.q:22:10") && text.contains("index [conversationId, at, id]"), "{text}");
    }
    let result: serde_json::Value = serde_json::from_str(&run(&["check", "--json"])).unwrap();
    assert_eq!(result["notes"].as_array().unwrap().iter().filter(|note| note["code"] == "N_SYNC_ORDER").count(), 1);
    assert!(run(&["why", "N_SYNC_ORDER"]).contains("newest-first"));
    fs::write(dir.join("snapback/schema.q"), source).unwrap();
    assert!(!run(&["check"]).contains("N_SYNC_ORDER"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn no_horizon_notes_are_compact_in_check_and_explained_by_verbose_or_why() {
    let dir = std::env::temp_dir().join(format!("sb4-check-notes-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let source = "table first:\n  body: text <=100\n  public\n  sync public\ntable second:\n  body: text <=100\n  public\n  sync public\n";
    fs::write(dir.join("snapback/schema.q"), source).unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    let plain = run(&["check"]);
    assert_eq!(plain.matches(" — N_NO_HORIZON:").count(), 1, "{plain}");
    assert!(plain.contains("note: N_NO_HORIZON (as above) also for table second (schema.q:5:1)"), "{plain}");
    assert!(plain.contains("check --verbose"));
    assert!(plain.contains("schema.q:1:1") && plain.contains("schema.q:5:1"), "{plain}");
    assert!(!plain.contains("rewrite:"));
    assert!(!plain.contains("Full card:"), "{plain}");
    let verbose = run(&["check", "--verbose"]);
    assert!(verbose.contains("rewrite: sync public last 500 by .id"));
    assert_eq!(verbose.matches("Full card: snapback4 guide sync").count(), 1, "{verbose}");
    let why = run(&["why", "N_NO_HORIZON"]);
    assert!(why.ends_with("Full card: snapback4 guide sync\n"), "{why}");
    assert!(verbose.contains(why.trim()), "{verbose}");
    let plain_json: serde_json::Value = serde_json::from_str(&run(&["check", "--json"])).unwrap();
    let verbose_json: serde_json::Value = serde_json::from_str(&run(&["check", "--verbose", "--json"])).unwrap();
    assert_eq!(plain_json["notes"], verbose_json["notes"]);
    let notes = plain_json["notes"].as_array().unwrap();
    assert_eq!(notes.iter().filter(|note| note["code"] == "N_NO_HORIZON").count(), 2);
    assert_eq!(notes.iter().filter(|note| note["code"] == "N_NO_PRODUCTION_WRITER").count(), 2);
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn json_and_text_both_name_every_sequence_counter() {
    let dir = std::env::temp_dir().join(format!("sb4-check-sequences-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::write(dir.join("snapback/schema.q"), "table parents:\n  public\ntable children:\n  parent: parents\n  first: sequence by parent\n  second: sequence by parent\n  public\n").unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    assert!(!run(&["check"]).contains("sequence children."));
    let text = run(&["check", "--verbose"]);
    let json: serde_json::Value = serde_json::from_str(&run(&["check", "--json"])).unwrap();
    let lines = json["sequences"].as_array().unwrap();
    assert_eq!(lines.len(), 2);
    for (column, line) in ["first", "second"].into_iter().zip(lines) {
        let expected = format!("sequence children.{column}: counter per parents row through .parent; immutable, provisional while pending");
        assert_eq!(line, &serde_json::Value::String(expected.clone()));
        assert!(text.lines().any(|line| line.trim() == expected));
    }
    fs::remove_dir_all(dir).unwrap();
}

/// Wave 5 (#3b, 19 lanes): the compiled owner-or-grant and per-party queries
/// print only under `--verbose`. The default groups the notes and keeps the
/// first one to verdict/who/what. As written these pages now merge their
/// branches (LLP 3000.036.001) and `check` is clean; arithmetic in the
/// predicate keeps one index, and the notes.
#[test]
fn never_complete_is_compact_by_default_and_verbose_prints_each_compiled_form() {
    let dir = std::env::temp_dir().join(format!("sb4-check-compiled-form-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let source = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n\
table tickets:\n  owner: principal\n  at: int\n  read <- .owner = viewer or exists staff[viewer]\n  online only\n\
table sessions:\n  tutor: principal\n  learner: principal\n  at: int\n  read <- .tutor = viewer or .learner = viewer\n  online only\n\
query queue(c: cursor ?):\n  return tickets last 50 by .at after c\nquery queue2(c: cursor ?):\n  return tickets last 20 by .at after c\nquery mySessions(c: cursor ?):\n  return sessions last 50 by .at after c\n";
    fs::write(dir.join("snapback/schema.q"), source).unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    let merged = run(&["check"]);
    assert!(!merged.contains("N_NEVER_COMPLETE"), "{merged}");
    let source = source.replace(" last 50 by .at", " where .at + 1 > 0 last 50 by .at").replace(" last 20 by .at", " where .at + 1 > 0 last 20 by .at");
    fs::write(dir.join("snapback/schema.q"), source).unwrap();
    let plain = run(&["check"]);
    assert_eq!(plain.matches(" — N_NEVER_COMPLETE — verdict:").count(), 1, "grouped default:\n{plain}");
    assert!(plain.contains("note: N_NEVER_COMPLETE (as above) also for query queue2") && plain.contains("query mySessions"), "{plain}");
    let lines: Vec<_> = plain.lines().collect();
    let note = lines.iter().position(|line| line.contains(" — N_NEVER_COMPLETE — verdict:")).unwrap();
    assert_eq!(lines[note + 1], "  who: callers admitted by `exists staff[viewer]` have a complete page", "{plain}");
    assert_eq!(lines[note + 2], "  what: query queue: missing pin .owner; choose the intended audience without dropping other readers; check --verbose shows the checked repair", "{plain}");
    assert!(!lines[note + 3].starts_with("  "), "the default completeness note is exactly verdict/who/what: {plain}");
    assert!(!plain.contains("  rewrite:") && !plain.contains("query mySessionsAsTutor"), "{plain}");

    let verbose = run(&["check", "--verbose"]);
    assert_eq!(verbose.matches("  rewrite: Branch on the grant").count(), 2, "one full grant form per affected query:\n{verbose}");
    assert!(verbose.contains("query queue(c: cursor ?):\n  if exists staff[viewer]:\n    return tickets where .at + 1 > 0 last 50 by .at after c\n  return tickets where .owner = viewer and .at + 1 > 0 last 50 by .at after c"), "{verbose}");
    assert!(verbose.contains("query queue2(c: cursor ?):\n  if exists staff[viewer]:"), "{verbose}");
    assert_eq!(verbose.matches("  rewrite: Replace this query with one per party").count(), 1, "{verbose}");
    assert!(verbose.contains("query mySessionsAsTutor(c: cursor ?)") && verbose.contains("query mySessionsAsLearner(c: cursor ?)"), "{verbose}");
    assert!(verbose.contains("pinning `.owner` otherwise (check --verbose)"), "{verbose}");
    fs::remove_dir_all(dir).unwrap();
}

/// Wave 6 #20 (6 lanes): a maintained view is counted as a view, not a table
/// a fixture fills.
#[test]
fn check_counts_views_apart_from_tables() {
    let dir = std::env::temp_dir().join(format!("sb4-check-views-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let source = "table slots:\n  seats: int\n  public 'p'\n  online only\ntable bookings:\n  slot: slots\n  guest: principal\n  read <- .guest = viewer\n  insert <- .guest = viewer\n  online only\nview taken: count bookings by .slot\n  read <- allow\n";
    fs::write(dir.join("snapback/schema.q"), source).unwrap();
    let run = |args: &[&str]| String::from_utf8(Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap().stdout).unwrap();
    let text = run(&["check"]);
    assert!(text.starts_with("check: ok — 2 tables, 1 view (0 synced), 0 operations"), "{text}");
    let json: serde_json::Value = serde_json::from_str(&run(&["check", "--json"])).unwrap();
    assert_eq!((json["tables"].as_u64(), json["views"].as_u64()), (Some(2), Some(1)), "{json}");
    fs::remove_dir_all(dir).unwrap();
}

/// Wave 7 #11 (LLP 3000.036 §17.7): an all-online schema's check prints no
/// "never predict" paragraph (every mutation runs on the server, by design;
/// `--verbose` keeps it), and every note line leads with its verdict.
#[test]
fn an_online_only_check_drops_the_never_predict_paragraph_and_each_note_leads_with_a_verdict() {
    let dir = std::env::temp_dir().join(format!("sb4-check-verdicts-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(args).output().unwrap();
        assert!(output.status.success(), "{output:?}");
        String::from_utf8(output.stdout).unwrap()
    };
    // Arithmetic in the predicate keeps one index, so the owner-or-staff page
    // still draws its note (as written it merges, LLP 3000.036.001).
    let online = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\ntable tickets:\n  owner: principal\n  at: time\n  immutable owner\n  read <- .owner = viewer or exists staff[viewer]\n  insert <- .owner = viewer\n  online only\nquery all():\n  return tickets where .at + 1 > 0 first 50 by .at\nmutation open(at: time):\n  return insert tickets { owner: viewer, at }\n";
    fs::write(dir.join("snapback/schema.q"), online).unwrap();
    let plain = run(&["check"]);
    assert!(!plain.contains("server-run"), "{plain}");
    let verbose = run(&["check", "--verbose"]);
    assert!(verbose.contains("1 mutation is server-run (online app: no action): open"));
    assert!(verbose.contains("N_NEVER_COMPLETE: query all:") && verbose.contains("rewrite: Branch on the grant"), "{verbose}");
    let notes: Vec<&str> = plain.lines().filter(|line| line.starts_with("note: schema.q")).collect();
    assert!(!notes.is_empty(), "{plain}");
    for line in &notes {
        assert!(line.contains(" — verdict:") || ["fix:", "review", "no action"].iter().any(|verdict| line.contains(&format!(": {verdict}"))), "{line}");
    }
    let lines: Vec<_> = plain.lines().collect();
    let completeness = lines.iter().position(|line| line.contains(" — N_NEVER_COMPLETE — verdict:")).expect("compact completeness note");
    assert_eq!(lines[completeness + 1], "  who: callers admitted by `exists staff[viewer]` have a complete page", "{plain}");
    assert!(lines[completeness + 2].starts_with("  what:") && lines[completeness + 2].contains("check --verbose"), "{plain}");
    assert!(!lines[completeness + 3].starts_with("  "), "the default completeness note is exactly three lines: {plain}");
    assert!(plain.contains("N_NO_CURSOR: no action for a top-N list."), "{plain}");
    // A synced table keeps the paragraph.
    fs::write(dir.join("snapback/schema.q"), "table notes:\n  owner: principal\n  immutable owner\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  sync\ntable log:\n  owner: principal\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation add():\n  insert log { owner: viewer }\n  return insert notes { owner: viewer }\n").unwrap();
    assert!(run(&["check"]).contains("server-run"), "{}", run(&["check"]));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn upgrade_delta_reports_real_completeness_changes_and_old_snapshot_gaps() {
    let dir = std::env::temp_dir().join(format!("sb4-rel3-completeness-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::write(dir.join("snapback/schema.q"), "query alive():\n  return true\n").unwrap();
    let run = || Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).arg("check").output().unwrap();
    assert!(run().status.success());
    let path = dir.join(".snapback4/check-surface.json");
    let current: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    for with_baseline in [true, false] {
        let mut old = current.clone();
        old["version"] = "0.4.27".into();
        if with_baseline { old["completeness"]["alive"] = "capped: absence not proved".into(); }
        else { old.as_object_mut().unwrap().remove("completeness"); }
        fs::write(&path, old.to_string()).unwrap();
        let result = run();
        assert!(result.status.success(), "{result:?}");
        let text = String::from_utf8(result.stdout).unwrap();
        if with_baseline { assert!(text.contains("query completeness alive: capped: absence not proved → eligible:"), "{text}"); }
        else { assert!(text.contains("previous proof classes unavailable"), "{text}"); }
    }
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn direct_install_history_prints_exact_device_rebuild_once_even_on_failed_check() {
    for json in [false, true] {
        let dir = std::env::temp_dir().join(format!("sb4-rel3-rebuild-{}-{json}", std::process::id()));
        fs::create_dir_all(dir.join("snapback")).unwrap();
        fs::create_dir_all(dir.join("app")).unwrap();
        fs::create_dir_all(dir.join(".snapback4")).unwrap();
        fs::write(dir.join("snapback/schema.q"), "query alive():\n  return true\n").unwrap();
        fs::write(dir.join("app/app.json"), r#"{"typescript":{"sources":{"backend":"../snapback/generated","snapback4":"vendor/snapback4/ts"}}}"#).unwrap();
        fs::write(dir.join(".snapback4/runtime-version.json"), r#"{"version":"0.4.27"}"#).unwrap();
        let run = || {
            let mut command = Command::new(env!("CARGO_BIN_EXE_snapback4"));
            command.current_dir(&dir).arg("check");
            if json { command.arg("--json"); }
            command.output().unwrap()
        };
        let first = run();
        assert!(!first.status.success(), "missing wasm must refuse");
        let text = String::from_utf8(if json { first.stderr } else { first.stdout }).unwrap();
        assert_eq!(text.matches("Exact device: bun exact.mjs snapback --rebuild").count(), 1, "{text}");
        let second = run();
        assert!(!String::from_utf8_lossy(&second.stdout).contains("Exact device:"));
        assert!(!String::from_utf8_lossy(&second.stderr).contains("Exact device:"));
        fs::remove_dir_all(dir).unwrap();
    }
}

#[test]
fn runtime_change_with_online_exact_mount_does_not_request_a_device_rebuild() {
    let dir = std::env::temp_dir().join(format!("sb4-rel3-online-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::create_dir_all(dir.join("app")).unwrap();
    fs::create_dir_all(dir.join(".snapback4")).unwrap();
    fs::write(dir.join("snapback/schema.q"), "query alive():\n  return true\n").unwrap();
    fs::write(dir.join("app/app.json"), r#"{"typescript":{"sources":{"backend":"../snapback/generated","snapback4":"vendor/snapback4-online/ts"}}}"#).unwrap();
    fs::write(dir.join(".snapback4/runtime-version.json"), r#"{"version":"0.4.27"}"#).unwrap();
    let out = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).arg("check").output().unwrap();
    assert!(out.status.success(), "{out:?}");
    assert!(!String::from_utf8_lossy(&out.stdout).contains("Exact device:"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn check_fix_replays_documented_unique_renames_without_touching_other_constraints_or_hidden_conflicts() {
    let dir = std::env::temp_dir().join(format!("sb4-rel3-rename-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::create_dir_all(dir.join("fixtures")).unwrap();
    fs::write(dir.join("snapback/schema.q"), "use personas alice\ntable names:\n  name: text <=30\n  unique byName: name\n  public\n  insert <- true\n  online only\nmutation add(id: names, name: text <=30):\n  return insert names {id, name}\ntable hiddenNames:\n  name: text <=30\n  owner: principal\n  unique byName: name\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  online only\nmutation hidden(id: hiddenNames, name: text <=30, owner: principal):\n  return insert hiddenNames {id, name, owner}\n").unwrap();
    fs::write(dir.join("fixtures/names.jsonl"), "{\"id\":\"one\",\"name\":\"existing\"}\n").unwrap();
    fs::write(dir.join("fixtures/hiddenNames.jsonl"), "{\"id\":\"private\",\"name\":\"existing\",\"owner\":\"dev:bob\"}\n").unwrap();
    let cases = " {\"op\":\"add\", \"args\":{\"id\":\"two\",\"name\":\"existing\"},\"expect\" : \"E_CONSTRAINT\",\"label\":\"E_CONSTRAINT\"}\r\n{\"op\":\"add\",\"args\":{\"id\":\"one\",\"name\":\"different\"},\"expect\":\"E_CONSTRAINT\"}\r\n{\"op\":\"hidden\",\"args\":{\"id\":\"another\",\"name\":\"existing\",\"owner\":\"dev:alice\"},\"expect\":\"E_CONSTRAINT\"}\r\n";
    let path=dir.join("fixtures/test.cases.jsonl"); fs::write(&path,cases).unwrap();
    let out=Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(["check","--fix","--json"]).output().unwrap();
    assert!(out.status.success(),"{out:?}");
    serde_json::from_slice::<serde_json::Value>(&out.stdout).expect("check --json stays one object during private replay");
    let fixed=fs::read_to_string(&path).unwrap();
    assert_eq!(fixed,cases.replacen("\"expect\" : \"E_CONSTRAINT\"","\"expect\" : \"E_UNIQUE\"",1));
    let repeat=Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(["check","--fix","--json"]).output().unwrap();
    assert!(repeat.status.success(),"{repeat:?}");
    assert_eq!(fs::read_to_string(&path).unwrap(),fixed);
    assert!(!dir.join(".snapback4/store.sqlite").exists(),"fixture replay must not create the dev store");
    fs::remove_dir_all(dir).unwrap();
}
