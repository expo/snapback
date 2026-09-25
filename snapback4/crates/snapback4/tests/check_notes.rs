//! Advisory notes stay terse on every save; the full explanation is opt-in.
use std::{fs, process::Command};

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
    assert_eq!(plain.matches("why: snapback4 why N_NO_HORIZON").count(), 2);
    assert!(plain.contains("schema.q:1:1") && plain.contains("schema.q:5:1"), "{plain}");
    assert!(plain.contains("rewrite: sync public last 500 by .id"));
    assert!(!plain.contains("Full card:"), "{plain}");
    let verbose = run(&["check", "--verbose"]);
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
    let text = run(&["check"]);
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
