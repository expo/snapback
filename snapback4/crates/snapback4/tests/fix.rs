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

const MISSING_INDEX: &str = include_str!("../../snapback4-lang/tests/fixtures/repair-index.q");
const MISSING_PROBE: &str = include_str!("../../snapback4-lang/tests/fixtures/repair-probe.q");
const ARG_ONCE: &str = include_str!("../../snapback4-lang/tests/fixtures/repair-once.q");
const WILDCARD: &str = include_str!("../../snapback4-lang/tests/fixtures/repair-shape.q");
const EMPTY_ARGS: &str = include_str!("../../snapback4-lang/tests/fixtures/repair-parens.q");

fn check_fix(files: &[(&str, &str, &str)], success: bool) {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let root = std::env::temp_dir().join(format!("sb4-cu5-{}-{}-{}", std::process::id(), snapback4_core::now_ms(), NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)));
    std::fs::create_dir_all(root.join("snapback")).unwrap();
    if !files.iter().any(|(name, _, _)| *name == "schema.q") { std::fs::write(root.join("snapback/schema.q"), "").unwrap(); }
    for (name, source, _) in files { std::fs::write(root.join("snapback").join(name), source).unwrap(); }
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["check", "--fix"]).current_dir(&root).output().unwrap();
    assert_eq!(output.status.success(), success, "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    if !success { assert_eq!(output.status.code(), Some(1)); }
    for (name, _, expected) in files { assert_eq!(std::fs::read_to_string(root.join("snapback").join(name)).unwrap(), *expected, "{name}"); }
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn check_fix_applies_the_four_reproduced_repairs_byte_exact() {
    for (source, corrected) in [
        (MISSING_INDEX, MISSING_INDEX.replace("  by byRoom: room, id\n", "  by byRoom: room, id\n  by byRoomPrincipal: room, principal, id\n")),
        (MISSING_PROBE, MISSING_PROBE.replace("  by byKey: key, id\n", "  by byKey: key, id\n  by byKeyAdmin: key, admin\n")),
        (ARG_ONCE, ARG_ONCE.replace(" once", "")),
        (WILDCARD, WILDCARD.replace("*, tombstone", "*")),
        (EMPTY_ARGS, EMPTY_ARGS.replace("trending:", "trending():")),
    ] { check_fix(&[("schema.q", source, &corrected)], true); }
}

#[test]
fn missing_index_inserts_after_last_index_across_files_with_matching_indentation() {
    let (table, query) = MISSING_INDEX.split_once("query ").unwrap();
    let table = table.replace("  ", "    ").replace("    public", "    unique byOther: id\n    public").replace('\n', "\r\n");
    let corrected = table.replace("    unique byOther: id\r\n", "    unique byOther: id\r\n    by byRoomPrincipal: room, principal, id\r\n");
    let query = format!("query {query}");
    check_fix(&[("tables.q", &table, &corrected), ("queries.q", &query, &query)], true);
    let table = table.lines().filter(|line| !line.trim_start().starts_with("by ") && !line.trim_start().starts_with("unique ")).collect::<Vec<_>>().join("\n") + "\n";
    let corrected = table.replace("    principal: principal\n", "    principal: principal\n    by byRoomPrincipal: room, principal, id\n");
    check_fix(&[("tables.q", &table, &corrected), ("queries.q", &query, &query)], true);
}

#[test]
fn repair_variants_preserve_surrounding_source() {
    for source in [ARG_ONCE.replace(" ?", ""), ARG_ONCE.replace("photo", "picture"), ARG_ONCE.replace("once ?", "once ? -- comment\n") ] {
        // A newline inside the argument list is already legal; the comment survives.
        check_fix(&[("schema.q", &source, &source.replace(" once", ""))], true);
    }
    for shape in ["{ tombstone, * }", "{ *, tombstone, extra: 1 }", "{ *, extra: 1, tombstone }", "{ *, tombstone, tombstone }"] {
        let source = WILDCARD.replace("{ *, tombstone }", shape);
        let expected = source.replace("tombstone, *", " *").replace(", tombstone", "");
        check_fix(&[("schema.q", &source, &expected)], true);
    }
    for kind in ["query", "mutation"] {
        let source = EMPTY_ARGS.replace("query", kind).replace("trending:", "trending : -- keep é");
        check_fix(&[("schema.q", &source, &source.replace("trending :", "trending() :"))], true);
    }
}

#[test]
fn non_applicable_repairs_leave_source_and_exit_unchanged() {
    for source in [
        MISSING_INDEX.replace("room = room, principal = p", "room, p"),
        MISSING_INDEX.replace("  by byRoom: room, id", "  by byRoomPrincipal: room, id"),
        "table photos:\n  movie: video <=10000000 once\n".into(),
        WILDCARD.replace("*, tombstone", "*, tombstone: false"),
        EMPTY_ARGS.replace("trending:", "trending x:"),
    ] { check_fix(&[("schema.q", &source, &source)], false); }
    // A stale diagnostic cannot remove a different token or insert parentheses twice.
    for source in [ARG_ONCE, WILDCARD, EMPTY_ARGS] {
        let d = snapback4_lang::compile(&[("schema.q".into(), source.into())]).diagnostics.remove(0);
        let corrected = source.replace(" once", "").replace(", tombstone", "").replace("trending:", "trending():");
        assert!(fix::edit(&[("schema.q".into(), corrected.clone())], 0, &d).is_none());
        let later_guess = format!("{corrected}\nmutation later(photo: image <=10000000 once):\n  return photo\n");
        assert!(fix::edit(&[("schema.q".into(), later_guess)], 0, &d).is_none());
    }
}

fn concurrent_fix(stage: &str, changed_file: &str) {
    let root = std::env::temp_dir().join(format!("sb4-r1b-fix-{}-{stage}-{changed_file}", std::process::id()));
    std::fs::create_dir_all(root.join("snapback")).unwrap();
    let project = project::Project { root: root.clone() };
    let (table, query) = MISSING_INDEX.split_once("query ").unwrap();
    let query = format!("query {query}");
    for (name, source) in [("schema.q", ""), ("tables.q", table), ("queries.q", &query)] { std::fs::write(project.schema_dir().join(name), source).unwrap(); }
    let edited = if changed_file == "tables.q" { format!("{table}-- editor's table save\n") } else { "query edited():\n  return missingName\n".into() };
    let output = std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact", "concurrent_fix_subprocess", "--nocapture"])
        .env("SB4_R1B_FIX_ROOT", &root).env("SB4_R1B_FIX_STAGE", stage).env("SB4_R1B_FIX_FILE", changed_file).output().unwrap();
    assert_eq!(output.status.code(), Some(2), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    let error = String::from_utf8(output.stderr).unwrap();
    assert!(error.contains(changed_file), "{error}");
    assert!(error.contains("changed while check --fix was running; rerun"), "{error}");
    assert_eq!(std::fs::read_to_string(project.schema_dir().join(changed_file)).unwrap(), edited);
    if changed_file != "tables.q" { assert_eq!(std::fs::read_to_string(project.schema_dir().join("tables.q")).unwrap(), table); }
    println!("{stage}: {error}");
    std::fs::remove_dir_all(root).unwrap();
}
#[test]
fn cross_file_fix_refuses_a_changed_query_before_apply() { concurrent_fix("compiled", "queries.q"); }
#[test]
fn cross_file_fix_refuses_a_changed_destination_before_apply() { concurrent_fix("compiled", "tables.q"); }
#[test]
fn cross_file_fix_rereads_destination_immediately_before_write() { concurrent_fix("write", "tables.q"); }
#[test]
fn r3_cross_file_fix_rereads_query_immediately_before_write() { concurrent_fix("write", "queries.q"); }
#[test]
fn fix_final_compile_reads_the_current_project() {
    let root = std::env::temp_dir().join(format!("sb4-r1b-final-{}", std::process::id()));
    std::fs::create_dir_all(root.join("snapback")).unwrap();
    let project = project::Project { root: root.clone() };
    std::fs::write(project.schema_dir().join("schema.q"), "query ok():\n  return 1\n").unwrap();
    let mut saved = false;
    let result = fix::compile_observed(&project, |at| {
        if !saved && at == "compiled" { std::fs::write(project.schema_dir().join("schema.q"), "query edited():\n  return missingName\n").unwrap(); saved = true; }
    }).unwrap();
    assert_eq!(result.diagnostics.len(), 1, "success must describe current disk sources");
    assert!(result.diagnostics[0].message.contains("missingName"));
    std::fs::remove_dir_all(root).unwrap();
}

#[test]
fn concurrent_fix_subprocess() {
    let Ok(root) = std::env::var("SB4_R1B_FIX_ROOT") else { return; };
    let stage = std::env::var("SB4_R1B_FIX_STAGE").unwrap();
    let file = std::env::var("SB4_R1B_FIX_FILE").unwrap();
    let project = project::Project { root: root.into() };
    let path = project.schema_dir().join(&file);
    let edited = if file == "tables.q" { std::fs::read_to_string(&path).unwrap() + "-- editor's table save\n" } else { "query edited():\n  return missingName\n".into() };
    let mut saved = false;
    let result = fix::compile_observed(&project, |at| {
        if !saved && at == stage { std::fs::write(&path, &edited).unwrap(); saved = true; }
    });
    // Use the production check command's error text and exit-code mapping.
    std::process::exit(match fix::checked(result) { Err(code) => code, Ok(bound) => if bound.diagnostics.is_empty() { 0 } else { 1 } });
}
