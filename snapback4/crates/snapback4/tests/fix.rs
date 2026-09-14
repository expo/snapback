//! The exact-rewrite contract is tested independently of lane L's parser arrival.
#![allow(dead_code)]

#[path = "../src/project.rs"] mod project;
#[path = "../src/verbs/fix.rs"] mod fix;

use snapback4_lang::{Diagnostic, Site, diag};

fn repair(source: &str, line: u32, col: u32, rewrite: &str) -> String {
    let diagnostic = Diagnostic::new(&Site::new("schema.q", line, col), "E_QUARRY_UNSUPPORTED", "guessed spelling", rewrite).mechanical();
    let sources = vec![("schema.q".into(), source.into())];
    let (target, start, end, text) = fix::edit(&sources, 0, &diagnostic).expect("exact mechanical repair");
    assert_eq!(target, 0);
    let mut fixed = source.to_owned();
    fixed.replace_range(start..end, &text);
    fixed
}

#[test]
fn spelling_repairs_preserve_the_rest_of_the_line() {
    for (source, rewrite, expected) in [
        ("elif x:\n", "else if x:", "else if x:\n"),
        ("len(xs) + 1 -- keep\n", "count(xs)", "count(xs) + 1 -- keep\n"),
        ("proc helper():\n", "fn helper():", "fn helper():\n"),
        ("// words\n", "-- words", "-- words\n"),
        ("# words\n", "-- words", "-- words\n"),
    ] { assert_eq!(repair(source, 1, 1, rewrite), expected); }
    assert_eq!(repair("query q():\r\n  return len(['é']) -- café\r\n", 2, 10, "count(['é'])"), "query q():\r\n  return count(['é']) -- café\r\n");
}

#[test]
fn conditional_guesses_use_the_exact_expression_span() {
    assert_eq!(repair("  return flag ? 'yes' : 'no', tail\n", 1, 15, "'yes' if flag else 'no'"), "  return ('yes' if flag else 'no'), tail\n");
    assert_eq!(repair("  return flag ? 'if' : 'else'\n", 1, 15, "'if' if flag else 'else'"), "  return ('if' if flag else 'else')\n");
    assert_eq!(repair("  return flag ? '(' : ')'\n", 1, 15, "'(' if flag else ')'"), "  return ('(' if flag else ')')\n");
    assert_eq!(repair("  return row?.title -- keep\n", 1, 13, "row.title if row != null else null"), "  return (row.title if row != null else null) -- keep\n");
    assert_eq!(repair("  return row?.title -- keep\n", 1, 10, "(row.title if row != null else null)"), "  return ((row.title if row != null else null)) -- keep\n");
}

#[test]
fn an_unmarked_or_inexact_rewrite_cannot_change_source() {
    let sources = vec![("schema.q".into(), "len(values)".into())];
    let diagnostic = Diagnostic::new(&Site::new("schema.q", 1, 1), "E_QUARRY_UNSUPPORTED", "guess", "count(values)");
    assert!(fix::edit(&sources, 0, &diagnostic).is_none());
    let wrong = Diagnostic::new(&Site::new("schema.q", 1, 1), "E_QUARRY_UNSUPPORTED", "guess", "'yes' if condition else 'no'").mechanical();
    assert!(fix::edit(&sources, 0, &wrong).is_none());
    let deserialized: Diagnostic = serde_json::from_str(r#"{"site":{"file":"schema.q","line":1,"col":1},"code":"E_QUARRY_UNSUPPORTED","message":"guess","rewrite":"count(values)","guide":"language"}"#).unwrap();
    assert!(!deserialized.mechanical);
}

#[test]
fn the_mechanical_class_is_explicit_on_constructors() {
    let site = Site::new("schema.q", 1, 1);
    assert!(diag::ambiguous(&site, "choose", "t[x] by byX").mechanical);
    assert!(diag::unknown(&site, "index t.byOwner cannot carry a cursor: it neither ends in id nor is unique", "by byOwner: owner, id").mechanical);
    for guessed in ["elif", "? :", "?.", "len", "//", "#", "proc"] { assert!(diag::unsupported(&site, guessed, "exact rewrite").mechanical); }
    assert!(!diag::unsupported(&site, "while", "use a bounded for").mechanical);
    assert!(!diag::unknown(&site, "unknown name", "did you mean something else?").mechanical);
}

#[test]
fn module_job_fix_uses_the_compilers_target_and_preserves_the_schedule() {
    let source = "table profiles:\n  public 'profiles'\njob backfillTimeline():\n  chunk p in profiles first 100 by byId:\n    return\nschedule repairTimeline every 1d at 03:00: backfillTimeline -- keep é\n";
    let mut sources = vec![("timeline.q".into(), source.into())];
    let bad = snapback4_lang::compile(&sources);
    assert_eq!(bad.diagnostics.len(), 1);
    let (target, start, end, replacement) = fix::edit(&sources, 0, &bad.diagnostics[0]).unwrap();
    sources[target].1.replace_range(start..end, &replacement);
    assert_eq!(sources[0].1, source.replace(": backfillTimeline --", ": timeline.backfillTimeline --"));
    let good = snapback4_lang::compile(&sources);
    assert!(good.diagnostics.is_empty(), "{:?}", good.diagnostics);
    assert_eq!(good.schema.schedules[0].target, "timeline.backfillTimeline");
    assert_eq!(good.schema.schedules[0].offset_ms, 3 * 60 * 60 * 1000);
}

#[test]
fn check_cost_counts_the_rule_probe_and_fix_qualifies_a_module_job() {
    let root = std::env::temp_dir().join(format!("sb4-lane-v-{}-{}", std::process::id(), snapback4_core::now_ms()));
    std::fs::create_dir_all(root.join("snapback")).unwrap();
    let source = include_str!("../../snapback4-sim/tests/fixtures/probe-equalities.q");
    for extra in ["", "  by byKeyAdmin: key, admin\n"] {
        std::fs::write(root.join("snapback/schema.q"), source.replace("  unique byKey: key\n", &format!("  unique byKey: key\n{extra}"))).unwrap();
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--cost"]).current_dir(&root).output().unwrap();
        assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
        let text = String::from_utf8(output.stdout).unwrap();
        let add = text.split("  mutation add:").nth(1).unwrap().split("  query probe:").next().unwrap();
        assert_eq!(add.matches("rule probe chats.byKey — one point read, then 1 extra equality check(s)").count(), 1, "{text}");
    }
    let module = "job repair():\n  chunk c in chats first 100 by byId:\n    return\nschedule everyMinute every 1m: repair -- keep\n";
    std::fs::write(root.join("snapback/timeline.q"), module).unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--fix"]).current_dir(&root).output().unwrap();
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    assert_eq!(std::fs::read_to_string(root.join("snapback/timeline.q")).unwrap(), module.replace(": repair --", ": timeline.repair --"));
    std::fs::remove_dir_all(root).unwrap();
}
