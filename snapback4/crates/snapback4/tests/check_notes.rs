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
    assert_eq!(plain.matches(" — N_NO_HORIZON:").count(), 2);
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
    assert_eq!(plain_json["notes"].as_array().unwrap().len(), 2);
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
/// printed only under `--verbose`. The default check prints each form once,
/// under its first N_NEVER_COMPLETE, and that note says "(below)".
#[test]
fn never_complete_prints_its_compiled_form_by_default() {
    let dir = std::env::temp_dir().join(format!("sb4-check-compiled-form-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    let source = "table staff:\n  principal: principal\n  unique principal\n  read <- .principal = viewer\n  online only\n\
table tickets:\n  owner: principal\n  at: int\n  read <- .owner = viewer or exists staff[viewer]\n  online only\n\
table sessions:\n  tutor: principal\n  learner: principal\n  at: int\n  read <- .tutor = viewer or .learner = viewer\n  online only\n\
query queue(c: cursor ?):\n  return tickets last 50 by .at after c\nquery queue2(c: cursor ?):\n  return tickets last 20 by .at after c\nquery mySessions(c: cursor ?):\n  return sessions last 50 by .at after c\n";
    fs::write(dir.join("snapback/schema.q"), source).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_snapback4")).current_dir(&dir).args(["check"]).output().unwrap();
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert_eq!(text.matches("  rewrite: Branch on the grant").count(), 1, "one grant form, under the first note:\n{text}");
    assert!(text.contains("    query queue(c: cursor ?):\n      if exists staff[viewer]:\n        return tickets last 50 by .at after c\n      return tickets where .owner = viewer last 50 by .at after c"), "{text}");
    assert_eq!(text.matches("  rewrite: Replace this query with one per party").count(), 1, "{text}");
    assert!(text.contains("query mySessionsAsTutor(c: cursor ?)") && text.contains("query mySessionsAsLearner(c: cursor ?)"), "{text}");
    assert!(text.contains("pinning the owner otherwise (below)"), "{text}");
    fs::remove_dir_all(dir).unwrap();
}
