//! The exact-rewrite contract is tested independently of lane L's parser arrival.
#![allow(dead_code)]

#[path = "../src/project.rs"] mod project;
#[path = "../src/worker_graph.rs"] mod worker_graph;
#[path = "../src/client_compatibility.rs"] mod client_compatibility;
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
fn review_check_fix_parenthesizes_the_inner_index_without_changing_other_bytes() {
    let schema = "table posts:\n  author: principal\n  by byReverse: author, id\n  public 'posts'\ntable follows:\n  follower: principal\n  followed: principal\n  unique byPair: follower, followed\n  by byReverse: followed, follower\n  public 'follows'\n";
    for (read, fixed_read) in [
        ("exists follows[viewer, .author] by byReverse", "exists (follows[viewer, .author] by byReverse)"),
        ("exists follows[viewer , .author] by byReverse", "exists (follows[viewer , .author] by byReverse)"),
        ("follows[viewer, .author] by byPair != null", "(follows[viewer, .author] by byPair) != null"),
        ("exists (follows[viewer, .author]) by byReverse", "exists ((follows[viewer, .author]) by byReverse)"),
        ("exists ((follows[viewer, .author])) by byReverse", "exists (((follows[viewer, .author])) by byReverse)"),
    ] {
        let source = format!("{schema}query page():\n  return posts[author = 'bob'] by byReverse first 1 where {read} -- keep café\n").replace('\n', "\r\n");
        let expected = source.replace(read, fixed_read);
        check_fix(&[("schema.q", &source, &expected)], true);
    }
}

#[test]
fn conditional_guesses_use_the_exact_expression_span() {
    assert_eq!(repair("  return flag ? 'yes' : 'no', tail\n", 1, 15, "'yes' if flag else 'no'"), "  return ('yes' if flag else 'no'), tail\n");
    assert_eq!(repair("  return flag ? 'if' : 'else'\n", 1, 15, "'if' if flag else 'else'"), "  return ('if' if flag else 'else')\n");
    assert_eq!(repair("  return flag ? '(' : ')'\n", 1, 15, "'(' if flag else ')'"), "  return ('(' if flag else ')')\n");
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

fn check_fix(files: &[(&str, &str, &str)], success: bool) -> std::process::Output {
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
    output
}

#[test]
fn check_fix_leaves_strict_not_equal_unchanged() {
    let source = "query q():\n  return 1 !== 2\n";
    let output = check_fix(&[("schema.q", source, source)], false);
    let text = String::from_utf8(output.stderr).unwrap();
    assert!(text.contains("expected expression, got \"=\""), "{text}");
    assert!(!text.contains("query q has an empty body"), "{text}");
    assert!(text.contains("1 redundant cascade diagnostic(s) hidden; use --verbose"), "{text}");
    assert!(!text.contains("equality is = in Quarry"), "{text}");
}

#[test]
fn check_fix_repairs_equality_and_keeps_the_independent_error() {
    let source = "query q():\n  yes = 1 == 1\n  return :\n";
    let expected = source.replace("==", "=");
    let before = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert_eq!(before.diagnostics.len(), 2);
    let output = check_fix(&[("schema.q", source, &expected)], false);
    let text = String::from_utf8(output.stderr).unwrap();
    assert!(text.contains("expected expression, got \":\""), "{text}");
    assert!(!text.contains("equality is = in Quarry"), "{text}");
    let after = snapback4_lang::compile(&[("schema.q".into(), expected)]);
    assert_eq!(after.diagnostics.len(), 1);
    assert_eq!(after.diagnostics[0].to_string(), before.diagnostics[1].to_string());
}

#[test]
fn check_fix_applies_repairs_and_preserves_accepted_forms_byte_exact() {
    for (source, corrected) in [
        (MISSING_INDEX, MISSING_INDEX.into()),
        (ARG_ONCE, ARG_ONCE.replace(" once", "")),
        (WILDCARD, WILDCARD.into()),
        (EMPTY_ARGS, EMPTY_ARGS.replace("trending:", "trending():")),
    ] { check_fix(&[("schema.q", source, &corrected)], true); }
    let out = check_fix(&[("schema.q", MISSING_PROBE, MISSING_PROBE)], false);
    assert!(String::from_utf8_lossy(&out.stderr).contains("E_QUARRY_POINT_KEY"));
}

#[test]
fn check_fix_repairs_double_equals_byte_exact_in_helpers_and_multiple_files() {
    let helper = include_str!("../../snapback4-lang/tests/fixtures/repair-equality.q");
    check_fix(&[("schema.q", helper, &helper.replace("==", "="))], true);
    let source = "query q():\r\n  return ('é'=='é') and (2 == 2) and ('==' != '=') -- == keep café\r\n";
    let expected = source.replace("'é'=='é'", "'é'='é'").replace("2 == 2", "2 = 2");
    check_fix(&[("one.q", source, &expected), ("two.q", source, &expected)], true);
    for source in ["query q():\n  return '==' != '=' -- ==\n", "query q():\n  return 1 != 2\n"] {
        check_fix(&[("schema.q", source, source)], true);
    }
    let triple = "query q():\n  return 1 === 1\n";
    check_fix(&[("schema.q", triple, triple)], false);
}

#[test]
fn double_equals_edit_rechecks_tokens_at_the_exact_site() {
    let source = "query q():\n  return 1 == 1\n";
    let d = snapback4_lang::compile(&[("schema.q".into(), source.into())]).diagnostics.remove(0);
    let sources = vec![("schema.q".into(), source.into())];
    let (target, start, end, replacement) = fix::edit(&sources, 0, &d).unwrap();
    assert_eq!(target, 0);
    assert_eq!(&source[start..end], "==");
    assert_eq!(replacement, "=");
    for changed in [
        source.replace("==", "="), source.replace("==", "!="), source.replace("==", "==="),
        source.replace("==", "= ="), source.replace("==", "=\n="),
        "query q():\n  return 1 '=='\n".into(), "query q():\n  return '--=='\n".into(),
        "query q():\n  return 1--==\n".into(), "query q():\n  return 1//==\n".into(),
        format!("{}query later():\n  return 1 == 1\n", source.replace("==", "=")),
    ] { assert!(fix::edit(&[("schema.q".into(), changed.clone())], 0, &d).is_none(), "{changed}"); }
    let mut unmarked = d.clone();
    unmarked.mechanical = false;
    assert!(fix::edit(&sources, 0, &unmarked).is_none());
    let mut wrong = d;
    wrong.rewrite = "!=".into();
    assert!(fix::edit(&sources, 0, &wrong).is_none());
}

#[test]
fn planned_indexes_leave_source_and_indentation_unchanged_across_files() {
    let (table, query) = MISSING_INDEX.split_once("query ").unwrap();
    let table = table.replace("  ", "    ").replace("    public", "    unique byOther: id\n    public").replace('\n', "\r\n");
    let corrected = table.clone();
    let query = format!("query {query}");
    check_fix(&[("tables.q", &table, &corrected), ("queries.q", &query, &query)], true);
    let table = table.lines().filter(|line| !line.trim_start().starts_with("by ") && !line.trim_start().starts_with("unique ")).collect::<Vec<_>>().join("\n") + "\n";
    let corrected = table.clone();
    check_fix(&[("tables.q", &table, &corrected), ("queries.q", &query, &query)], true);
}

#[test]
fn repair_variants_preserve_surrounding_source() {
    for source in [ARG_ONCE.replace(" ?", ""), ARG_ONCE.replace("photo", "picture"), ARG_ONCE.replace("once ?", "once ? -- comment\n") ] {
        // A newline inside the argument list is already legal; the comment survives.
        check_fix(&[("schema.q", &source, &source.replace(" once", ""))], true);
    }
    for shape in ["{ tombstone, * }", "{ *, tombstone, extra: 1 }", "{ *, extra: 1, tombstone }"] {
        let source = WILDCARD.replace("{ *, tombstone }", shape);
        let expected = source.clone();
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
        "table photos:\n  movie: video <=10000000 once\n".into(),
        WILDCARD.replace("*, tombstone", "*, tombstone: false, tombstone: true"),
        EMPTY_ARGS.replace("trending:", "trending x:"),
    ] { check_fix(&[("schema.q", &source, &source)], false); }
    // A stale diagnostic cannot remove a different token or insert parentheses twice.
    for source in [ARG_ONCE, EMPTY_ARGS] {
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
    let query = format!("query {query}").replace("  return members", "  same = 1 == 1\n  return members");
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

#[test]
fn filtered_page_shapes_compile_without_cli_edits() {
    let prefix = "table posts:\n  parentId: posts ?\n  body: text <=100\n  tombstone: bool default false\n  public 'posts'\nshape postCard = { id, body }\n";
    for suffix in ["where .parentId = null postCard -- café postCard", "where not .tombstone postCard -- keep", "where (not .tombstone postCard)", "where not (.tombstone postCard)", "where .body = 'postCard' postCard", "where (.parentId = (null postCard))"] {
        let source = format!("{prefix}query q(c: cursor ?):\n  return posts after c first 20 by byId {suffix}\n");
        check_fix(&[("schema.q", &source, &source)], true);
    }
}

#[test]
fn calibration_bool_shape_compiles_without_cli_edits() {
    let prefix = "table messages:\n  conversationId: id\n  body: text <=2000\n  tombstone: bool default false\n  ordinal: int\n  by byConversationWords: conversationId, words(body), ordinal, id\n  public 'messages'\nshape messageCard = { id, body }\n";
    let source = format!("{prefix}{}query searchChat(conversationId: id, q: text <=100, c: cursor ?):\n  return messages[conversationId] matching q after c last 20 by byConversationWords where not .tombstone messageCard\n", "\n".repeat(257 - prefix.lines().count() - 1));
    check_fix(&[("chat.q", &source, &source)], true);
}

#[test]
fn optional_chain_cli_repair_preserves_comments_and_a_second_check_is_clean() {
    let source = "table posts:\n  body: text <=100\n  public 'posts'\nfn lookup(id: posts): posts[id]\nquery title(id: posts):\n  row = posts[id]\n  return { title: row?.body, literal: 'row?.body', direct: (posts[id])?.body, helper: lookup(id)?.body, parens: ((row))?.body } -- café row?.body\n";
    let expected = source.replace("title: row?.body", "title: row.body").replace(")?.body", ").body");
    check_fix(&[("schema.q", source, &expected)], true);
}

#[test]
fn positional_ambiguity_refuses_until_fix_opts_into_a_verified_named_choice() {
    let source = "table follows:\n  follower: principal\n  followed: principal\n  unique byPair: follower, followed\n  unique byFollowed: followed, follower\n  public 'follows'\nquery followed():\n  return exists follows[viewer, 'bob'] -- keep\n";
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_QUARRY_POSITIONAL_SCAN"));
    let named = source.replace("follows[viewer, 'bob']", "follows[follower = viewer, followed = 'bob'] by byPair");
    let output = check_fix(&[("schema.q", source, &named)], true);
    assert!(String::from_utf8_lossy(&output.stderr).contains("E_QUARRY_POSITIONAL_SCAN"));
    check_fix(&[("schema.q", &named, &named)], true);
}

#[test]
fn calibration_cursor_index_has_specific_code_and_cli_repair() {
    let source = "table rankedPosts:\n  score: int\n  at: time\n  postId: id\n  by byScore: score, at, postId\n  public 'Current 24-hour original-post ranking'\nquery trending(c: cursor ?):\n  return rankedPosts after c last 10 by byScore { rankScore: .score }\n";
    let bad = snapback4_lang::compile(&[("insights.q".into(), source.into())]);
    println!("{}", bad.diagnostics[0]);
    assert_eq!(bad.diagnostics[0].code, "E_CURSOR_INDEX");
    assert_eq!(bad.diagnostics[0].guide, "indexes");
    check_fix(&[("insights.q", source, &source.replace("by byScore: score, at, postId", "by byScore: score, at, postId, id"))], true);
    let (schema, query) = source.split_once("query trending").unwrap();
    let query = format!("query trending{query}");
    check_fix(&[("schema.q", schema, &schema.replace("by byScore: score, at, postId", "by byScore: score, at, postId, id")), ("insights.q", &query, &query)], true);
}

#[test]
fn calibration_guide_cli_resolves_the_builders_words() {
    for (word, target) in [("maintain", "maintains"), ("maintains", "maintains"), ("time", "time"), ("clock", "time"), ("schedule", "jobs"), ("mutations", "writes"), ("replay", "personas"), ("seed", "personas")] {
        let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4")).args(["guide", word, "--full"]).output().unwrap();
        assert!(output.status.success(), "{word}: {output:?}");
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim_end(), snapback4_lang::guide::card(target).unwrap().trim_end());
    }
}
