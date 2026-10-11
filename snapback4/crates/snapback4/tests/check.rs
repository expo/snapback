//! check's read-only assessment of the active dev generation and its rows.
use snapback4_core::{Engine, Store, wire};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

const SOURCE: &str = "table messages:\n  body: text <=100\n  read <- allow\nquery all():\n  return messages[] first 10 by byId\n";
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");

#[path = "check/audience_bounds.rs"] mod audience_bounds;
#[path = "check/first_paste.rs"] mod first_paste;
#[path = "check/sync_window.rs"] mod sync_window;

#[test]
fn natural_forms_diagnostics_are_authored_in_plain_verbose_and_json() {
    let project = Project::new();
    for (source, code, rewrite) in [
        ("table notes:\n  title: text\n  public\nquery page(c: cursor ?):\n  return notes first 20 by .title after c\n", "E_INDEX_KEY_BYTES", "title: text <="),
        ("table notes:\n  owner: principal\n  select <- .owner = viewer\n", "E_QUARRY_RULE_SPELLING", "read <-"),
        ("job sweep every 1h:\n  return\n", "E_QUARRY_JOB_SCHEDULE", "schedule sweepEvery every 1h: sweep"),
        ("table notes:\n  public\nquery one(key: notes):\n  p = notes[key]\n  return { ...p }\n", "E_QUARRY_SPREAD", "! else NOT_FOUND"),
    ] {
        project.source(source);
        for flags in [vec!["check"], vec!["check", "--verbose"], vec!["check", "--json"]] {
            let output = project.run(&flags);
            assert_eq!(output.status.code(), Some(1));
            let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
            assert!(text.contains(code) && text.contains(rewrite), "{flags:?}: {text}");
            assert!(!text.contains("$intent:"), "{flags:?}: {text}");
            if flags.contains(&"--json") {
                let json = parsed(&output);
                let diagnostic = json["problems"].as_array().unwrap().iter().find(|d| d["code"] == code).unwrap();
                assert!(diagnostic["site"]["line"].as_u64().unwrap() > 0);
            } else { assert!(text.contains("schema.q:"), "{text}"); }
        }
        let why = project.run(&["why", code]);
        assert!(why.status.success());
        assert!(String::from_utf8_lossy(&why.stdout).contains("Full card:"));
    }
}

#[test]
fn emit_lean_prints_one_checked_file_as_the_models_case_json() {
    // LLP 3000.035 §5.2: the library emitter's command-line face.
    let project = Project::new();
    project.source("table notes:\n  owner: principal\n  read <- .owner = viewer\n  online only\nquery mine(c: cursor ?):\n  return notes where .owner = viewer first 5 by .id after c\nquery clock():\n  return now\n");
    let output = project.run(&["check", "--emit-lean", "snapback/schema.q"]);
    assert!(output.status.success(), "{output:?}");
    let json = parsed(&output);
    assert_eq!(json["programs"]["mine"]["body"][0]["ret"]["page"]["pins"], json!([["owner", "viewer"]]));
    assert_eq!(json["unsupported"]["clock"]["reason"], "now");
    project.source("table notes:\n  read <- nonsense\n");
    let refused = project.run(&["check", "--emit-lean", "snapback/schema.q"]);
    assert_eq!(refused.status.code(), Some(1));
}

#[test]
fn w10c_check_hides_only_the_redundant_operation_cascade() {
    let p = Project::new();
    p.source("query apiHistory():\n  return messages after null\n");
    let ordinary = p.run(&["check"]);
    let verbose = p.run(&["check", "--verbose"]);
    let full = p.run(&["check", "--json"]);
    for output in [&ordinary, &verbose, &full] { assert_eq!(output.status.code(), Some(1)); }
    let text = String::from_utf8(ordinary.stderr).unwrap();
    let all = String::from_utf8(verbose.stderr).unwrap();
    println!("default:\n{text}verbose:\n{all}");
    assert_eq!(all.matches(" — E_QUARRY_SYNTAX:").count(), 2);
    assert!(all.contains("query apiHistory has an empty body"));
    assert_eq!(parsed(&full)["problems"].as_array().unwrap().len(), 2);
    assert_eq!(text.matches(" — E_QUARRY_SYNTAX:").count(), 1);
    assert!(text.contains("range reads require first N or last N"));
    assert!(!text.contains("has an empty body"));
    assert!(text.contains("--verbose"));
    let excerpt = "Full card: snapback4 guide language";
    assert_eq!(text.matches(excerpt).count(), 0, "count only visible diagnostics before deciding to explain: {text}");
    assert_eq!(all.matches(excerpt).count(), 1, "verbose retains the pair and explains it once: {all}");
    assert!(full.stderr.is_empty());
    assert!(!String::from_utf8_lossy(&full.stdout).contains(excerpt), "JSON retains diagnostics without text excerpts");
    println!("W10R1 cascade: default errors=1 excerpts=0; verbose errors=2 excerpts=1; JSON errors=2 excerpts=0");
    p.source("query apiHistory():\n  return 1\n");
    assert!(p.run(&["check"]).status.success());
}

fn check_empty_job_prelude(prelude: &str) {
    let p = Project::new();
    p.source(&format!("job empty():\n{prelude}"));
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stderr).unwrap();
    println!("{text}");
    assert!(text.contains("job empty has an empty body"), "a parsed prelude does not supply a chunk: {text}");
    assert_eq!(text.matches(" — E_").count(), 2, "{text}");
    assert!(!text.contains("cascade diagnostic(s) hidden"), "{text}");
}

#[test]
fn w10r1_empty_job_keeps_its_independent_repair() {
    check_empty_job_prelude("  x = 1 == 1\n");
}

#[test]
fn w10r1_nested_job_prelude_keeps_its_independent_repair() {
    check_empty_job_prelude("  if true:\n    x = 1 == 1\n");
}

#[test]
fn w10r1_multiple_job_prelude_statements_keep_the_independent_repair() {
    check_empty_job_prelude("  x = 1 == 1\n  y = 2\n");
}

#[test]
fn w10r1_correcting_equality_still_requires_a_job_chunk() {
    let p = Project::new();
    for prelude in ["  x = 1 = 1\n", "  if true:\n    x = 1 = 1\n", "  x = 1 = 1\n  y = 2\n"] {
        p.source(&format!("job empty():\n{prelude}"));
        let output = p.run(&["check"]);
        assert_eq!(output.status.code(), Some(1));
        let text = String::from_utf8(output.stderr).unwrap();
        assert_eq!(text.matches(" — E_").count(), 1, "{text}");
        assert!(text.contains("job empty has an empty body"), "{text}");
        p.source(&format!("{SOURCE}job empty():\n{prelude}  chunk row in messages first 10 by byId:\n    value = row.body\n"));
        let complete = p.run(&["check"]);
        assert!(complete.status.success(), "{complete:?}");
    }
}

#[test]
fn w10c_check_keeps_independent_errors_and_other_operations() {
    let p = Project::new();
    p.source("query apiHistory():\n  return messages after null\n  return exists 1\n  return 1\njob empty():\n  x = 1\n");
    fs::write(p.0.join("snapback/other.q"), "query apiHistory():\n  return messages after null\n").unwrap();
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stderr).unwrap();
    println!("{text}");
    assert_eq!(text.matches("range reads require first N or last N").count(), 2);
    assert!(text.contains("exists requires an indexed read t[key]"), "the second error has independent information despite its generic rewrite");
    assert!(text.contains("job empty has an empty body"), "an earlier error in another operation cannot hide this empty body");
    assert_eq!(text.matches(" — E_").count(), 4);
}

#[test]
fn w9r1b_why_wide_merge_opens_the_notes_card() {
    let p = Project::new();
    let feeds = "table follows:\n  reader: principal\n  author: principal\n  unique byPair: reader, author\n  cap 1000 by reader\n  public 'follow graph'\n  online only\ntable entries:\n  actor: principal\n  at: time\n  by byActorTime: actor, at, id\n  public 'posts'\n  online only\nquery following(c: cursor ?):\n  return merge entries after c last 20 by byActorTime:\n    [viewer]\n    [f.author] for f in follows[viewer] first 1000 by byPair\n";
    let search = format!("{}\nquery searchAll(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    [m.roomId] for m in members[principal = viewer] first 1000 by byPrincipalRoom\n", include_str!("../../snapback4-sim/tests/search_merge/schema.q"));
    for (source, keyword) in [(feeds, "feeds"), (search.as_str(), "search")] {
        p.source(source);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let note = bound.notes.iter().find(|note| note.code == "N_WIDE_MERGE").unwrap();
        assert_eq!(note.guide, keyword);
        let output = p.run(&["why", "N_WIDE_MERGE"]);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        println!("{keyword}: {} bytes\n{text}", text.len());
        assert!(text.contains("A resumable read-meter cut while an owning uniform lazy merge drains established heads can carry `next` after its last fully shaped emitted row (§5.6), subject to final-answer eligibility, with `complete: false, cut: 'meter'`. Heap exhaustion clears the whole page even during the drain; step exhaustion aborts and output exhaustion can refuse after materialisation."), "{text}");
        assert!(text.ends_with(&format!("Full card: snapback4 guide {keyword}\n")));
        assert!(text.lines().any(|line| line.starts_with('#') && snapback4_lang::guide::card(keyword).unwrap().lines().any(|heading| heading == line)));
        assert!(text.len() <= snapback4_lang::guide::WHY_MAX_BYTES);
    }
    p.source(&format!("{feeds}\n{search}"));
    let mixed = p.run(&["why", "N_WIDE_MERGE"]);
    assert!(mixed.status.success());
    assert!(String::from_utf8_lossy(&mixed.stdout).ends_with("Full card: snapback4 guide feeds\n"), "the first matching diagnostic owns the card");
    for source in [SOURCE, "this is invalid Quarry"] {
        p.source(source);
        let fallback = p.run(&["why", "N_WIDE_MERGE"]);
        assert!(fallback.status.success());
        assert!(String::from_utf8_lossy(&fallback.stdout).ends_with("Full card: snapback4 guide search\n"));
    }
    let standalone = Command::new(BIN).current_dir(std::env::temp_dir()).args(["why", "N_WIDE_MERGE"]).output().unwrap();
    assert!(standalone.status.success());
    assert!(String::from_utf8_lossy(&standalone.stdout).ends_with("Full card: snapback4 guide search\n"));
}

struct Project(PathBuf);
impl Project {
    fn new() -> Self {
        static SERIAL: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().join(format!("sb4-cu4-check-{}-{}", std::process::id(), SERIAL.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(dir.join("snapback")).unwrap();
        let project = Self(dir);
        project.source(SOURCE);
        project
    }
    fn source(&self, source: &str) { fs::write(self.0.join("snapback/schema.q"), source).unwrap(); }
    fn store(&self) -> PathBuf { self.0.join(".snapback4/store.sqlite") }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.0).args(args).output().unwrap() }
    fn seed(&self, path: &Path, count: usize) -> Engine {
        let b = snapback4_lang::compile(&[("schema.q".into(), SOURCE.into())]);
        let mut engine = Engine::new(Store::open(path).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let table = engine.schema().tables["messages"].clone();
        engine.seed((0..count).map(|i| ("messages".into(), wire::row_from_json(&table, &json!({"id": format!("m{i}"), "body": "old"})).unwrap()))).unwrap();
        engine
    }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); } }
fn parsed(output: &Output) -> Value { serde_json::from_slice(&output.stdout).unwrap_or_else(|_| panic!("{output:?}")) }

#[test]
fn notes_stay_short_and_verbose_explains_each_code_once() {
    let p = Project::new();
    for count in [1, 2, 20] {
        let source = format!("table messages:\n  body: text <=100\n  read <- allow\n{}", (0..count).map(|i| format!("query page{i}():\n  return messages first 10 by byId\n")).collect::<String>());
        p.source(&source);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty());
        assert_eq!(bound.notes.len(), count);
        let explanation = bound.notes[0].explanation().unwrap();
        for verbose in [false, true] {
            let output = p.run(if verbose { &["check", "--verbose"] } else { &["check"] });
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            assert_eq!(text.matches("note: ").count(), count);
            assert_eq!(text.matches("  guide: reads").count(), if verbose { count } else { 0 });
            assert_eq!(text.matches("  why: snapback4 why N_NO_CURSOR").count(), if verbose { count } else { 0 });
            let excerpts = usize::from(verbose);
            assert_eq!(text.matches("Full card: snapback4 guide reads").count(), excerpts, "{text}");
            if verbose {
                assert!(text.contains(&format!("  why: snapback4 why N_NO_CURSOR\n\n{explanation}\n")), "{text}");
                assert!(explanation.contains("cannot continue") && explanation.contains("Meter cuts"), "the unvisited reads card must reach the builder: {explanation}");
                assert!(explanation.len() + 1 <= 4096);
            }
            println!("W10a check: notes={count}, inline sections={excerpts}, excerpt bytes={}", if excerpts == 0 { 0 } else { explanation.len() + 1 });
        }
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success());
        assert_eq!(parsed(&output)["notes"].as_array().unwrap().len(), count);
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn w10a_repeated_refusals_explain_once_and_preserve_json() {
    let p = Project::new();
    for count in [1, 2] {
        let source = format!("table messages:\n  body: text <=100\n  read <- allow\n{}", (0..count).map(|i| format!("query broken{i}():\n  return {i} + true\n")).collect::<String>());
        p.source(&source);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert_eq!(bound.diagnostics.len(), count);
        let output = p.run(&["check"]);
        assert_eq!(output.status.code(), Some(1));
        let text = String::from_utf8(output.stderr).unwrap();
        assert_eq!(text.matches("Full card: snapback4 guide types").count(), usize::from(count >= 2), "{text}");
        if count >= 2 {
            let explanation = bound.diagnostics[0].explanation_section().unwrap();
            assert!(explanation.split_once("\n\n").unwrap().1.contains(&bound.diagnostics[0].code), "the card excerpt must name its own code: {explanation}");
            assert!(text.contains(&format!("{}\n\n{explanation}\n\n{}", bound.diagnostics[0], bound.diagnostics[1])), "{text}");
            assert!(explanation.len() + 1 <= 4096);
        }
        let output = p.run(&["check", "--json"]);
        assert_eq!(output.status.code(), Some(1));
        assert_eq!(parsed(&output)["problems"].as_array().unwrap().len(), count);
        assert!(output.stderr.is_empty());
    }
}

#[test]
fn w10a_inline_sections_have_a_check_wide_bound_and_stable_order() {
    let p = Project::new();
    let source = "table messages:\n  body: text <=100\n  read <- allow\nquery missingA():\n  return absentA\nquery missingB():\n  return absentB\nquery typeA():\n  return 1 + true\nquery typeB():\n  return 2 + true\nquery placementA():\n  insert messages { body: 'a' }\nquery placementB():\n  insert messages { body: 'b' }\nquery emitA():\n  emit notify { body: 'a' }\nquery emitB():\n  emit notify { body: 'b' }\n";
    p.source(source);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    let mut counts = std::collections::BTreeMap::new();
    for d in &bound.diagnostics { *counts.entry((&d.code, &d.guide)).or_insert(0) += 1; }
    assert_eq!(counts.values().filter(|n| **n >= 2).count(), 4, "{:?}", bound.diagnostics);
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stderr).unwrap();
    assert_eq!(text.matches("Full card: snapback4 guide ").count(), 3, "{text}");
    assert!(!text.contains("No dedicated section"), "{text}");
    let mut expected = format!("check: {} problems\n", bound.diagnostics.len());
    let mut shown = std::collections::BTreeSet::new();
    let mut added_bytes = 0;
    for d in &bound.diagnostics {
        expected.push_str(&format!("{d}\n\n"));
        if shown.len() < 3 && shown.insert((&d.code, &d.guide)) {
            let explanation = d.explanation_section().unwrap();
            assert!(explanation.split_once("\n\n").unwrap().1.contains(&d.code), "the card excerpt must name its own code: {explanation}");
            added_bytes += explanation.len() + 2;
            expected.push_str(&format!("{explanation}\n\n"));
        }
    }
    assert_eq!(text, expected);
    assert!(added_bytes <= 3 * 4097);
    println!("W10a refusal bound: repeated kinds=4, inline sections=3, added bytes={added_bytes}, maximum added bytes=12291");
    assert_eq!(p.run(&["check"]).stderr, text.as_bytes());
}

fn why_common_refusal(code: &str, card: &str, mistake: &str, repair: &str) {
    let p = Project::new();
    let output = p.run(&["why", code]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    println!("W10R2 why {code}: {} bytes\n{text}", text.len());
    let section = text.split_once("\n\n").unwrap().1;
    assert!(!section.contains("No dedicated section"), "{text}");
    assert!(section.contains(code), "the section itself must explain its code: {text}");
    assert!(section.contains(mistake) && section.contains(repair), "show the mistake and its repair: {text}");
    assert!(text.ends_with(&format!("Full card: snapback4 guide {card}\n")), "{text}");
    assert!(text.len() <= 4096);
}

#[test]
fn w11_why_every_registered_code_returns_its_dedicated_section() {
    let p = Project::new();
    let mut largest = 0;
    for code in snapback4_lang::guide::codes() {
        let output = p.run(&["why", code]);
        assert!(output.status.success(), "{code}: {output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        let diagnostic = snapback4_lang::Diagnostic::new(&Default::default(), code, "", "");
        let section = diagnostic.explanation_section().unwrap_or_else(|| panic!("{code}: {text}"));
        assert_eq!(text, format!("{section}\n"));
        assert!(text.len() <= snapback4_lang::guide::WHY_MAX_BYTES);
        largest = largest.max(text.len());
    }
    println!("W11 why CLI: codes={} fallback=0 maximum_bytes={largest}", snapback4_lang::guide::codes().len());
}

#[test]
fn why_rule_distinguishes_readable_and_unreadable_collision_targets() {
    let output = Project::new().run(&["why", "E_RULE"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    let summary = text.split_once("\n\n").unwrap().0;
    assert!(summary.contains("An unreadable update/upsert target instead returns NOT_FOUND"), "{summary}");
    assert!(summary.contains("without row, index, column or branch detail"), "{summary}");
    let section = text.split_once("\n\n").unwrap().1.split_whitespace().collect::<Vec<_>>().join(" ");
    // Write-executing witnesses: snapback4-lang/tests/guide/rules.rs:
    // insert_collision_visibility, update_rule_refusals, admitted_hidden_updates,
    // update_collision_visibility and delete_rule_refusals.
    for fact in [
        "A unique clash with a hidden row returns E_RULE for either insert form.",
        "For a readable secondary unique clash without a custom refusal, ordinary insert returns E_CONSTRAINT naming the index, while `insert ... if absent` succeeds with null.",
        "If the update rule denies an update or upsert-patch, it returns E_RULE for a readable target and NOT_FOUND for an unreadable target.",
        "A valid update or upsert-patch admitted by the update rule can change a hidden row; if the resulting row remains hidden, it returns null.",
        "Without a custom unique refusal, an update or upsert-patch with a secondary unique clash returns NOT_FOUND if its target is unreadable, E_RULE if only the colliding row is unreadable, and E_CONSTRAINT naming the index if both are readable.",
        "Delete returns NOT_FOUND for a missing id or an unreadable refused target, and E_RULE for a readable row whose delete rule refuses.",
    ] {
        assert!(section.contains(fact), "{fact}: {section}");
    }
    assert!(!section.contains("table below"));
}

#[test]
fn w11_repeated_quarry_refusals_show_sections_and_their_repairs_check_clean() {
    let p = Project::new();
    let cases = [
        ("language", "E_QUARRY_UNSUPPORTED", "", "query NAME():\n  item = { value: 1 }\n  return item?.value\n", "query NAME():\n  item = { value: 1 }\n  return item.value\n"),
        ("programs", "E_OP_RESERVED", "", "mutation NAME():\n  require true else E_AUTH\n", "mutation NAME():\n  require true else NOT_MEMBER\n"),
        ("sync", "E_QUARRY_RETAIN", "", "table NAME:\n  body: text <=100\n  retain forever\n", "table NAME:\n  body: text <=100\n  retain delivered-history\n"),
        ("native", "E_NATIVE", "", "mutation NAME(): native\n", "mutation NAME():\n  return 1\n"),
        ("types", "E_QUARRY_TYPE", "", "query NAME():\n  return 1 + true\n", "query NAME():\n  return 1 + 2\n"),
        ("bounds", "E_UNBOUND_LOOP", "table nodes:\n  parent: nodes ?\n  read <- allow\n", "query NAME(root: nodes):\n  return walk nodes[root] up .parent depth 100\n", "query NAME(root: nodes):\n  return walk nodes[root] up .parent depth 8\n"),
        ("indexes", "E_SCHEMA_CONSTRAINT", "", "table NAME:\n  ownerId: principal\n  cap 50 by missing\n", "table NAME:\n  ownerId: principal\n  by byOwner: ownerId, id\n  cap 50 by ownerId\n"),
        ("jobs", "E_JOB_CURSOR_INDEX", "table tasks:\n  score: int\n  by byScore: score, id\n", "job NAME():\n  chunk t in tasks first 100 by byScore:\n    update tasks[t.id] { score: 1 }\n", "job NAME():\n  chunk t in tasks first 100 by byId:\n    update tasks[t.id] { score: 1 }\n"),
        ("maintains", "E_QUARRY_MAINTAIN", "table posts:\n  authorId: principal\n  at: time\n  active: bool\n  read <- allow\n", "maintain NAME: count posts where .at > now by authorId\n  read <- allow\n  online only\n", "maintain NAME: count posts where .active by authorId\n  read <- allow\n  online only\n"),
    ];
    let mut bytes = 0;
    for (card, code, schema, bad, good) in cases {
        let source = |body: &str| vec![("first.q".into(), body.replace("NAME", "firstCase")), ("schema.q".into(), schema.into()), ("second.q".into(), body.replace("NAME", "secondCase"))];
        let bad = source(bad);
        let bound = snapback4_lang::compile(&bad);
        assert_eq!(bound.diagnostics.len(), 2, "{card}: {:?}", bound.diagnostics);
        assert!(bound.diagnostics.iter().all(|d| d.code == code && d.guide == card), "{card}: {:?}", bound.diagnostics);
        for (file, text) in &bad { fs::write(p.0.join("snapback").join(file), text).unwrap(); }
        let output = p.run(&["check"]);
        assert_eq!(output.status.code(), Some(1), "{card}: {output:?}");
        let text = String::from_utf8(output.stderr).unwrap();
        let explanation = bound.diagnostics[0].explanation_section().expect(card);
        assert_eq!(text.matches(&format!("Full card: snapback4 guide {card}")).count(), 1, "{text}");
        assert!(text.contains(&format!("{}\n\n{explanation}\n\n{}", bound.diagnostics[0], bound.diagnostics[1])), "{text}");
        bytes += explanation.len() + 1;
        let good = source(good);
        let repaired = snapback4_lang::compile(&good);
        assert!(repaired.diagnostics.is_empty() && repaired.notes.is_empty(), "{card}: {:?} {:?}", repaired.diagnostics, repaired.notes);
        for (file, text) in &good { fs::write(p.0.join("snapback").join(file), text).unwrap(); }
        let output = p.run(&["check"]);
        assert!(output.status.success(), "{card}: {output:?}");
        println!("W11 Quarry fixture: card={card} code={code} errors=2 excerpts=1 repaired_errors=0 repaired_notes=0");
    }
    println!("W11 Quarry fixtures: cards={} refused_sites={} clean_repairs={} excerpt_bytes={bytes}", cases.len(), cases.len() * 2, cases.len());
}

#[test]
fn w10r2_why_syntax_has_its_own_section() {
    why_common_refusal("E_QUARRY_SYNTAX", "language", "query answer:", "query answer():");
}

#[test]
fn w10r2_why_unknown_has_its_own_section() {
    why_common_refusal("E_QUARRY_UNKNOWN", "language", "return mesage", "return message");
}

#[test]
fn w10r2_why_placement_has_its_own_section() {
    why_common_refusal("E_QUARRY_PLACEMENT", "programs", "query add():", "mutation add():");
}

#[test]
fn w10r2_why_emit_in_query_has_its_own_section() {
    why_common_refusal("E_EMIT_IN_QUERY", "programs", "query send():", "mutation send():");
}

#[test]
fn w10r2_repeated_unknown_prints_its_section_under_the_first_site() {
    let p = Project::new();
    let source = "query first():\n  return absentA\nquery second():\n  return absentB\n";
    p.source(source);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert_eq!(bound.diagnostics.len(), 2);
    assert!(bound.diagnostics.iter().all(|d| d.code == "E_QUARRY_UNKNOWN"));
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1));
    let text = String::from_utf8(output.stderr).unwrap();
    assert_eq!(text.matches("Full card: snapback4 guide language").count(), 1, "{text}");
    let section = bound.diagnostics[0].explanation_section().unwrap();
    assert!(section.split_once("\n\n").unwrap().1.contains("E_QUARRY_UNKNOWN"), "{section}");
    assert!(!text.contains("No dedicated section") && !text.contains("One file, `snapback/schema.q`"), "{text}");
    assert!(text.contains(&format!("{}\n\n{section}\n\n{}", bound.diagnostics[0], bound.diagnostics[1])), "{text}");
    println!("W10R2 repeated unknown: errors=2 excerpts=1 excerpt_bytes={}", section.len() + 1);
    p.source("query first():\n  return 1\nquery second():\n  return 2\n");
    assert!(p.run(&["check"]).status.success());
}

#[test]
fn w9b_why_prints_a_codes_card_paragraph() {
    let p = Project::new();
    for (code, card, paragraph) in [
        ("E_QUARRY_TYPE", "types", "E_QUARRY_TYPE means the expression's type does not fit its position."),
        ("N_MAINTAIN_SYNCED", "residency", "N_MAINTAIN_SYNCED names public inherited aggregates and group audiences"),
        ("N_NO_CURSOR", "reads", "N_NO_CURSOR: a returned page cannot continue"),
    ] {
        let output = p.run(&["why", code]);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        println!("{code}: {} bytes\n{text}", text.len());
        assert!(text.contains(paragraph), "{text}");
        assert!(text.ends_with(&format!("Full card: snapback4 guide {card}\n")), "{text}");
        assert!(!text.contains("No dedicated section"));
        assert!(text.len() <= 4096);
    }
}

#[test]
fn w11_expiry_synthesizes_sweep_indexes_without_source_repairs() {
    let p = Project::new();
    let source = "table first:\n  at: time\n  expire at .at\ntable second:\n  at: time\n  expire at .at\n";
    p.source(source);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    assert!(bound.schema.tables.values().all(|table| table.indexes.keys().any(|name| name.starts_with("$intent:"))));
    assert!(p.run(&["check", "--fix"]).status.success());
    assert_eq!(fs::read_to_string(p.0.join("snapback/schema.q")).unwrap(), source);
}

#[test]
fn w9b_why_operation_keeps_residency_and_cost_output() {
    let p = Project::new();
    let output = p.run(&["why", "all"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{text}");
    assert!(text.contains("query all()\n"));
    assert!(text.contains("all: runs: server"));
    assert!(text.contains("scan messages by byId: online only; selected byId (); result: page; explicit by (site schema.q:5:10 (messages[]))"), "{text}");
    assert!(text.contains("scan messages.byId first 10 — rule decided by the prefix: no probes"));
    assert!(!text.contains("Full card:"));
}

#[test]
fn w9b_new_maintains_share_one_note_without_pre_adoption_counts() {
    let p = Project::new();
    let base = include_str!("../../snapback4-lang/tests/fixtures/residency-notes.q");
    let source = format!("{base}\nmaintain ownerCounts: count likes by owner\n  read <- allow\n");
    // The current store has source rows but has never adopted either maintain.
    let old = snapback4_lang::compile(&[("schema.q".into(), base.split("\nmaintain ").next().unwrap().into())]);
    assert!(old.diagnostics.is_empty());
    let mut engine = Engine::new(Store::open(&p.store()).unwrap(), old.schema, []).unwrap();
    let table = &engine.schema().tables["likes"];
    engine.seed([("l1", "p1"), ("l2", "p2")].map(|(id, post)| ("likes".into(), wire::row_from_json(table, &json!({"id":id,"postId":post,"owner":"alice"})).unwrap()))).unwrap();
    p.source(&source);
    let output = p.run(&["check", "--json"]);
    assert!(output.status.success(), "{output:?}");
    let value = parsed(&output);
    let notes: Vec<_> = value["notes"].as_array().unwrap().iter().filter(|n| n["code"] == "N_MAINTAIN_SYNCED").collect();
    assert_eq!(notes.len(), 1);
    let note = &notes[0];
    let message = note["message"].as_str().unwrap();
    println!("{}\n  rewrite: {}\n  guide: {}", message, note["rewrite"].as_str().unwrap(), note["guide"].as_str().unwrap());
    assert_eq!(message, "2 synced maintains:\n  maintain likeCounts: sync public inherited from likes, no horizon; one value row per postId reaches every device; createPost, like, repost would stop predicting if likeCounts goes `online only` (site schema.q:10:1)\n  maintain ownerCounts: sync public inherited from likes, no horizon; one value row per owner reaches every device; no currently eligible mutation reads it (site schema.q:24:1)");
    assert!(note["rewrite"].as_str().unwrap().contains("snapback4 test --residency"));
    assert_eq!(engine.store().count("likeCounts").unwrap(), 0, "check must not adopt the proposed maintains");
}

#[test]
fn upsert_insert_proof_and_service_grants_reach_check_and_why() {
    let p = Project::new();
    p.source("table likes:\n  post: text <=30\n  principal: principal\n  on: bool\n  unique byPostPrincipal: post, principal\n  by byPrincipal: principal, post, id\n  read <- .principal = viewer or viewer = 'service:pusher'\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  sync\nmutation vote(post: text <=30):\n  upsert likes[post, viewer] {on: true}\n");
    for (args, words) in [
        (vec!["check", "--residency"], vec!["predicts: eligible", "upsert insert into likes: absence is provable when the group and insert image are held and readable", "service grants: service:pusher"]),
        (vec!["why", "vote"], vec!["predicts: eligible", "upsert insert into likes: absence is provable when the group and insert image are held and readable"]),
        (vec!["why", "likes"], vec!["service grants: service:pusher"]),
    ] {
        let output = p.run(&args);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        for word in words { assert!(text.contains(word), "{text}"); }
    }
}

#[test]
fn r3_cost_and_why_name_uniform_meter_and_nonuniform_word_bounds() {
    let p = Project::new();
    p.source(include_str!("../../snapback4-sim/tests/search_merge/round3.q"));
    for args in [vec!["check", "--cost"], vec!["why", "matching"]] {
        let output = p.run(&args);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        // R1 pins the full resumable-read qualification and heap/drain exception, not an unconditional next.
        assert!(text.contains("uniform matching scopes expand first-term words under the meter; admitted non-uniform scopes keep at most 32 (word_cut_at names a cut), later lanes continue; further terms filter; discovery/opening meter cuts have no next; resumable read-meter drain cuts may continue after a fully shaped emitted row when the owning uniform traversal and final answer are eligible; heap exhaustion clears data to null even during drain; steps abort, output may refuse, terminal pages need no next, usePage retains earlier incompleteness; meter ceilings remain query-wide"), "{text}");
    }
}

#[test]
fn check_without_a_store_and_additive_or_fitting_adoption_are_quiet() {
    let p = Project::new();
    assert!(p.run(&["check", "--json"]).status.success());
    assert!(!p.store().exists());
    let e = p.seed(&p.store(), 3);
    let before = e.store().rows("messages").unwrap();
    let seq = e.seq().unwrap();
    for source in [SOURCE.to_owned(), SOURCE.replace("  read", "  tombstone: bool default false\n  by byTombstone: tombstone, id\n  read"), SOURCE.replace("<=100", "<=3")] {
        p.source(&source);
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success(), "{output:?}");
        assert_eq!(parsed(&output)["ok"], true);
        assert!(parsed(&output).get("problems").is_none());
        assert!(!String::from_utf8_lossy(&output.stdout).contains("E_ADOPT"));
        assert!(output.stderr.is_empty());
        assert_eq!(e.store().meta("generation").unwrap().as_deref(), Some("1"));
        assert_eq!(e.store().rows("messages").unwrap(), before);
        assert_eq!(e.seq().unwrap(), seq);
    }
    let readonly = Store::open_read_only(&p.store()).unwrap();
    assert!(readonly.set_meta("cu4-must-not-write", "1").is_err());
}

#[test]
fn check_reports_all_narrowing_sites_in_text_and_json_without_adopting() {
    let p = Project::new();
    let e = p.seed(&p.store(), 3);
    p.source(&SOURCE.replace("  read", "  at: time default now\n  author: principal default viewer\n  read"));
    let output = p.run(&["check", "--json"]);
    assert_eq!(output.status.code(), Some(1));
    let report = parsed(&output);
    assert_eq!(report["ok"], false);
    assert_eq!(report["problems"].as_array().unwrap().len(), 2);
    for (i, column, kind, word, noun, line) in [(0, "at", "time", "now", "clock", 3), (1, "author", "principal", "viewer", "viewer", 4)] {
        let d = &report["problems"][i];
        assert_eq!(d["code"], "E_ADOPT");
        assert_eq!(d["site"], json!({"file": "schema.q", "line": line, "col": 3}));
        assert_eq!(d["message"], format!("column messages.{column} is added as required with default {word}; existing rows would read the adoption's {noun}"));
        assert_eq!(d["rewrite"], format!("{column}: {kind} ? or {column}: {kind} default <literal>; otherwise backfill existing rows before making the column required"));
        assert_eq!(d["guide"], "types");
    }
    p.source(&SOURCE.replace("  read", "  at: time default now\n  read"));
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1));
    assert!(output.stdout.is_empty());
    let text = String::from_utf8(output.stderr).unwrap();
    assert_eq!(text, "check: 1 problem\nschema.q:3:3 — E_ADOPT: column messages.at is added as required with default now; existing rows would read the adoption's clock\n  rewrite: at: time ? or at: time default <literal>; otherwise backfill existing rows before making the column required\n  guide: types\n\n");
    println!("{text}");
    assert_eq!(e.store().meta("generation").unwrap().as_deref(), Some("1"));
    assert_eq!(e.store().rows("messages").unwrap().len(), 3);
}

#[test]
fn check_uses_explicit_store_and_locates_index_and_table_refusals() {
    let p = Project::new();
    let path = p.0.join("other/store.sqlite");
    let _e = p.seed(&path, 3);
    for (extra, line) in [("  unique byBody: body\n", 3), ("  by byBody: body\n  cap 2 by body\n", 1)] {
        p.source(&SOURCE.replace("  read", &format!("{extra}  read")));
        assert!(p.run(&["check", "--json"]).status.success(), "no default dev store");
        let output = p.run(&["check", "--store", path.to_str().unwrap(), "--json"]);
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        let d = parsed(&output)["problems"][0].clone();
        assert_eq!(d["code"], "E_ADOPT");
        assert_eq!(d["site"]["line"], line);
    }
    let missing = p.0.join("missing.sqlite");
    assert_eq!(p.run(&["check", "--store", missing.to_str().unwrap()]).status.code(), Some(2));
    assert!(!missing.exists());
}

#[test]
fn check_accepts_contextual_defaults_for_an_empty_dev_table() {
    let p = Project::new();
    let _e = p.seed(&p.store(), 0);
    p.source(&SOURCE.replace("  read", "  at: time default now\n  author: principal default viewer\n  read"));
    let output = p.run(&["check", "--json"]);
    assert!(output.status.success(), "{output:?}");
    assert!(parsed(&output).get("problems").is_none());
}

#[test]
fn inspection_materializes_required_literals_but_not_optional_defaults() {
    let p = Project::new();
    let mut e = p.seed(&p.store(), 1);
    let source = SOURCE.replace("  read", "  tombstone: bool default false\n  score: int default -7\n  label: text <=20 default \"O'Reilly\"\n  role: enum('member', 'admin') default 'member'\n  amount: decimal 2 default 125\n  room: id default 'r'\n  optional: bool ? default true\n  read");
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    // The working source remains old: inspection must use the stored generation.
    let sql = p.run(&["sql", "SELECT tombstone, score, label, role, amount, room, optional FROM messages", "--json"]);
    assert!(sql.status.success(), "{sql:?}");
    let data = p.run(&["data", "messages"]);
    println!("inspection SQL={} data={}", String::from_utf8_lossy(&sql.stdout), String::from_utf8_lossy(&data.stdout));
    assert_eq!(parsed(&sql)["rows"], json!([[0, -7, "O'Reilly", "member", 125, "r", null]]));
    assert!(data.status.success(), "{data:?}");
    assert_eq!(parsed(&data), json!({"id":"m0", "body":"old", "tombstone":false,"score":-7,"label":"O'Reilly","role":"member","amount":125,"room":"r","optional":null}));
    assert!(e.store().rows("messages").unwrap()[0].field("tombstone").is_err());
    let explicit = json!({"id":"explicit", "body":"new", "tombstone":true,"score":0,"label":"","role":"admin","amount":0,"room":"other","optional":false});
    let row = wire::row_from_json(&e.schema().tables["messages"], &explicit).unwrap();
    e.seed([("messages".into(), row)]).unwrap();
    let sql = p.run(&["sql", "SELECT tombstone, score, label, role, amount, room, optional FROM messages WHERE id = 'explicit'", "--json"]);
    assert_eq!(parsed(&sql)["rows"], json!([[1, 0, "", "admin", 0, "other", 0]]));
    let data = p.run(&["data", "messages"]);
    let lines: Vec<Value> = String::from_utf8(data.stdout).unwrap().lines().map(|line| serde_json::from_str(line).unwrap()).collect();
    assert!(lines.contains(&explicit), "explicit values win over defaults");
}

#[test]
fn r2_n4_inspection_defaults_equal_stored_values_and_group_together() {
    use snapback4_core::{schema::{ColumnDefault, ColumnType}, Value as V};
    let p = Project::new();
    let mut e = p.seed(&p.store(), 1);
    let source = SOURCE.replace("  read", "  meta: json <=100 default false\n  null_text: json <=100 default 'Null'\n  number: json <=100 default 7\n  tombstone: bool default false\n  score: int default -7\n  label: text <=20 default \"O'Reilly\"\n  role: enum('member', 'admin') default 'member'\n  amount: decimal 2 default 125\n  price: money USD default 125\n  room: id default 'r'\n  author: principal default 'dev:alice'\n  reference: messages default 'm0'\n  at: time default 100\n  read");
    let mut b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    // Bytes have a value-model literal even though Quarry has no byte literal spelling.
    let table = b.schema.tables.get_mut("messages").unwrap();
    table.columns.insert("bytes".into(), ColumnType::Bytes { max: 100 });
    table.defaults.insert("bytes".into(), ColumnDefault::Literal(V::Bytes(vec![0, 255])));
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let mut stored = std::collections::BTreeMap::from([("id".into(), V::Id("stored".into())), ("body".into(), V::String("old".into()))]);
    for (name, default) in &e.schema().tables["messages"].defaults { stored.insert(name.clone(), default.value(0, "unused")); }
    e.seed([("messages".into(), V::Row(stored.into()))]).unwrap();
    let expected = [("meta", json!("{\"Bool\":false}")), ("null_text", json!("{\"String\":\"Null\"}")), ("number", json!("{\"Int\":7}")),
        ("tombstone", json!(0)), ("score", json!(-7)), ("label", json!("O'Reilly")), ("role", json!("member")), ("amount", json!(125)), ("price", json!(125)),
        ("room", json!("r")), ("author", json!("dev:alice")), ("reference", json!("m0")), ("at", json!(100)), ("bytes", json!("00ff"))];
    let mut failures = Vec::new();
    for (column, expected) in expected {
        let sql = p.run(&["sql", &format!("SELECT {column}, count(*) FROM messages GROUP BY {column}"), "--json"]);
        assert!(sql.status.success(), "{sql:?}");
        let groups = parsed(&sql)["rows"].clone();
        let equality = p.run(&["sql", &format!("SELECT a.{column} = b.{column} FROM messages a JOIN messages b ON a.id = 'm0' AND b.id = 'stored'"), "--json"]);
        assert!(equality.status.success(), "{equality:?}");
        let equal = parsed(&equality)["rows"].clone();
        println!("R2 N4 {column}: groups={groups}, equality={equal}");
        if groups != json!([[expected, 2]]) || equal != json!([[1]]) { failures.push(format!("{column}: groups={groups}, equality={equal}")); }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

fn invariant_default_project(unique: bool, collides: bool) -> Project {
    let p = Project::new();
    let mut e = p.seed(&p.store(), 1);
    let index = if unique { "  unique byFlag: flag\n" } else { "  by byFlag: flag, id\n  cap 1 by flag\n" };
    let source = SOURCE.replace("  read", &format!("  flag: bool default false\n{index}  read"));
    let b = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    if collides {
        let table = &e.schema().tables["messages"];
        let row = wire::row_from_json(table, &json!({"id":"explicit", "body":"new", "flag":true})).unwrap();
        e.seed([("messages".into(), row)]).unwrap();
    }
    p.source(&source.replace("default false", "default true"));
    p
}

fn changed_default_refuses(unique: bool) {
    let p = invariant_default_project(unique, true);
    let output = p.run(&["check", "--json"]);
    let dev = p.run(&["dev", "--no-watch", "--port", "0"]);
    println!("dev unique={unique}: {}", String::from_utf8_lossy(&dev.stderr));
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let report = parsed(&output);
    assert_eq!(report["problems"].as_array().unwrap().len(), 1);
    let d = &report["problems"][0];
    assert_eq!(d["code"], "E_ADOPT");
    assert_eq!(d["site"], json!({"file":"schema.q", "line":3, "col":3}));
    assert_eq!(d["message"], "column messages.flag changes its default; existing rows must fit the new definition");
    assert!(!dev.status.success());
    let text = String::from_utf8(dev.stderr).unwrap();
    // @ref LLP 3000#publication-suite-under-contention — diagnostic order is not an exit-record boundary.
    // The bounded host writer can drain after the direct lifecycle write.
    let exits: Vec<_> = text.lines().filter(|line| line.starts_with("SNAPBACK4_EXIT ")).collect();
    assert_eq!(exits.len(), 1, "{text}");
    let encoded = exits[0].strip_prefix("SNAPBACK4_EXIT verb=dev generation=0 status=1 reason=").unwrap();
    let reason: String = serde_json::from_str(encoded).unwrap();
    assert_eq!(reason, format!("E_ADOPT: {}\n  rewrite: {}", d["message"].as_str().unwrap(), d["rewrite"].as_str().unwrap()));
    println!("changed default unique={unique}: check exit=1, dev refusal={text}");
}
#[test]
fn changed_default_rechecks_unchanged_unique_index() { changed_default_refuses(true); }
#[test]
fn changed_default_rechecks_unchanged_cap() { changed_default_refuses(false); }
#[test]
fn changed_default_that_still_fits_existing_groups_is_adoptable() {
    for unique in [true, false] {
        let p = invariant_default_project(unique, false);
        assert!(p.run(&["check", "--json"]).status.success());
        let source = fs::read_to_string(p.0.join("snapback/schema.q")).unwrap();
        let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
        let mut e = Engine::open(Store::open(&p.store()).unwrap()).unwrap();
        e.adopt(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        assert_eq!(e.query("all", snapback4_core::Context::new("alice", Default::default())).unwrap().data.as_array().unwrap()[0].field("flag").unwrap(), &snapback4_core::Value::Bool(true));
    }
}

struct Dev(std::process::Child);
impl Drop for Dev { fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); } }
fn start_dev(p: &Project) -> Dev {
    use std::time::{Duration, Instant};
    let stdout = p.0.join("dev.stdout");
    let stderr = p.0.join("dev.stderr");
    let mut dev = Dev(Command::new(BIN).args(["dev", "--no-watch", "--port", "0"]).current_dir(&p.0)
        .stdout(fs::File::create(&stdout).unwrap()).stderr(fs::File::create(&stderr).unwrap()).spawn().unwrap());
    let until = Instant::now() + Duration::from_secs(15);
    while !fs::read_to_string(&stdout).unwrap().contains('\n') {
        assert!(dev.0.try_wait().unwrap().is_none(), "{}", fs::read_to_string(&stderr).unwrap());
        assert!(Instant::now() < until, "dev launch timed out: {}", fs::read_to_string(&stderr).unwrap());
        std::thread::sleep(Duration::from_millis(10));
    }
    dev
}
fn durable_bytes(p: &Project) -> Vec<(usize, String)> {
    use sha2::{Digest, Sha256};
    ["", "-wal"].iter().map(|suffix| {
        let bytes = fs::read(format!("{}{suffix}", p.store().display())).unwrap();
        (bytes.len(), format!("{:x}", Sha256::digest(&bytes)))
    }).collect()
}
#[test]
fn check_preserves_database_and_wal_bytes_with_live_and_stopped_dev() {
    let p = Project::new();
    drop(p.seed(&p.store(), 3));
    let mut dev = start_dev(&p);
    // Make a durable WAL frame while dev holds the store, with no background writes.
    {
        let store = Store::open(&p.store()).unwrap();
        store.set_meta("wal-readonly-control", "1").unwrap();
    }
    for state in ["live", "stopped", "stopped-without-shm"] {
        if state == "stopped" { dev.0.kill().unwrap(); dev.0.wait().unwrap(); }
        if state == "stopped-without-shm" { fs::remove_file(format!("{}-shm", p.store().display())).unwrap(); }
        let before = durable_bytes(&p);
        assert!(before[1].0 > 0, "exercise WAL frames");
        let output = p.run(&["check", "--json"]);
        assert!(output.status.success(), "{output:?}");
        assert_eq!(durable_bytes(&p), before, "{state}: check changed durable SQLite bytes");
        let shm = PathBuf::from(format!("{}-shm", p.store().display())).exists();
        println!("WAL {state}: db_bytes={} wal_bytes={} db_sha256={} wal_sha256={} unchanged=true shm_present={shm}", before[0].0, before[1].0, before[0].1, before[1].1);
        if state == "stopped-without-shm" && shm {
            // SQLite's normal WAL reader may create its shared read-lock index.
            // It is transient coordination, never a database or WAL write.
            assert_eq!(durable_bytes(&p), before);
        } else if state == "stopped-without-shm" { assert!(!shm); }
    }
}

#[test]
fn guide_prediction_is_a_stdout_card() {
    let output = Command::new(BIN).args(["guide", "prediction"]).output().unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("# Prediction"));
    assert!(output.stderr.is_empty());
}

#[test]
fn guide_unknown_word_suggests_cards_on_stdout() {
    let output = Command::new(BIN).args(["guide", "banana"]).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let nearest = stdout.lines().next().unwrap_or("").strip_prefix("no card named banana; nearest: ").expect("nearest list on stdout");
    assert_eq!(nearest.split(", ").count(), 3);
    assert!(stdout.contains("cards: language, from-sql, app, types"), "{stdout}");
    assert!(output.stderr.is_empty());
}

#[test]
fn guide_lists_aliases_and_resolves_them_on_stdout() {
    let output = Command::new(BIN).arg("guide").output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("cards: language, from-sql, app, types"), "{stdout}");
    assert!(stdout.contains("offline -> prediction"), "{stdout}");
    let output = Command::new(BIN).args(["guide", "pagination"]).output().unwrap();
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).starts_with("# Reads"));
}

// L12 final-check omitted all prediction-loss notes once residency.json caught up.
#[test]
fn b2_every_check_summarizes_zero_one_and_three_never_mutations() {
    let p = Project::new();
    let source = include_str!("../../snapback4-lang/tests/fixtures/residency-notes.q");
    for count in [0, 1, 3] {
        let source = if count == 0 { source.to_owned() } else { source.replace("  read <- allow", "  read <- allow\n  online only") };
        let source = if count == 1 { source[..source.find("mutation createPost").unwrap()].to_owned() } else { source };
        p.source(&source);
        for _ in 0..2 {
            let output = p.run(&["check"]);
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            println!("{text}");
            let lines: Vec<_> = text.lines().filter(|line| line.contains("never predict")).collect();
            if count == 0 { assert!(lines.is_empty()); } else {
                let names = if count == 1 { "like (reads online-only maintain likeCounts)" } else { "createPost (reads online-only maintain likeCounts), like (reads online-only maintain likeCounts), repost (reads online-only maintain likeCounts)" };
                let head = if count == 1 { "1 mutation never predicts".to_owned() } else { format!("{count} mutations never predict") };
                assert_eq!(lines, [format!("{head}: {names} (they run on the server when called; no action needed for an online app) — snapback4 why <op>")]);
            }
        }
    }
}

#[test]
fn b2_why_fanout_keeps_its_example_with_bounded_card_context() {
    let p = Project::new();
    let output = p.run(&["why", "E_STRUCTURAL_FANOUT"]);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{text}");
    assert!(text.contains("Example:"));
    assert!(text.contains("cap 50 by room"));
    assert!(text.len() <= snapback4_lang::guide::WHY_MAX_BYTES);
    assert!(text.ends_with("Full card: snapback4 guide programs\n"));
}

#[test]
fn b2_maintain_note_points_to_the_measured_cold_snapshot() {
    let p = Project::new();
    let source = format!("{}\nmaintain ownerCounts: count likes by owner\n  read <- allow\n", include_str!("../../snapback4-lang/tests/fixtures/residency-notes.q"));
    p.source(&source);
    let b = snapback4_lang::compile(&[("schema.q".into(), source)]);
    let mut e = Engine::new(Store::open(&p.store()).unwrap(), b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    let table = &e.schema().tables["likes"];
    e.seed([( "l1", "p1"), ("l2", "p1"), ("l3", "p2")].map(|(id, post)| ("likes".into(), wire::row_from_json(table, &json!({"id":id,"postId":post,"owner":"alice"})).unwrap()))).unwrap();
    assert_eq!(e.store().count("likeCounts").unwrap(), 2);
    let compact = p.run(&["check"]);
    assert!(compact.status.success());
    let compact = String::from_utf8(compact.stdout).unwrap();
    assert!(compact.contains("N_MAINTAIN_SYNCED: 2 synced maintains: likeCounts, ownerCounts."), "{compact}");
    assert!(compact.contains("createPost, like, repost would stop predicting"), "{compact}");
    assert!(!compact.contains("maintain likeCounts:"), "{compact}");
    let output = p.run(&["check", "--residency", "--verbose"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{text}");
    assert!(!text.contains("current store measurement:") && !text.contains("before adoption"), "{text}");
    assert_eq!(text.matches(" — N_MAINTAIN_SYNCED:").count(), 1);
    assert_eq!(text.matches("Full card: snapback4 guide residency").count(), 1);
    assert!(text.contains("maintain likeCounts:") && text.contains("maintain ownerCounts:"));
    assert!(text.contains("measure cold rows with `snapback4 test --residency`"));
    assert!(text.contains("createPost, like, repost would stop predicting"));
    let output = p.run(&["test", "--residency", "--verbose", "--as", "alice"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{text}");
    assert!(text.contains("alice likeCounts: 2 rows"), "{text}");
    assert!(text.contains("alice ownerCounts: 1 rows"), "{text}");
    assert!(text.contains("maintain ownerCounts (measurement): 1 value rows in the fixture/store — N_MAINTAIN_SYNCED"), "{text}");
}

#[test]
fn horizon_check_and_why_keep_the_same_advice_across_checks() {
    let p = Project::new();
    p.source("");
    fs::write(p.0.join("snapback/chat.q"), include_str!("../../snapback4-lang/tests/fixtures/prediction-horizons.q")).unwrap();
    let first = p.run(&["check", "--json"]);
    assert!(first.status.success(), "{first:?}");
    let first = parsed(&first);
    assert_eq!(first["notes"].as_array().unwrap().len(), 5);
    let summary = first["predictionSummary"].as_str().unwrap();
    assert!(summary.contains("chat.send (messages[messageId] (chat.q:83:22))"), "{summary}");
    for _ in 0..3 {
        let next = p.run(&["check", "--json"]);
        assert!(next.status.success(), "{next:?}");
        let next = parsed(&next);
        assert_eq!(next["notes"], first["notes"]);
        assert_eq!(next["predictionSummary"], first["predictionSummary"]);
        let text = p.run(&["check", "--verbose"]);
        assert!(text.status.success(), "{text:?}");
        assert_eq!(String::from_utf8_lossy(&text.stdout).matches(summary).count(), 1);
        let why = p.run(&["why", "chat.send"]);
        assert!(why.status.success(), "{why:?}");
        assert!(String::from_utf8_lossy(&why.stdout).lines().any(|line| line == "  chat.send: predicts: eligible except past the horizon at messages[messageId] (chat.q:83:22)"));
    }
    println!("persistent CLI: 4 JSON checks, 3 text checks, 3 why calls; 4 notes each");
}

#[test]
fn b2_l12_final_ranked_writes_and_entry_counts_remain_visible_in_json_and_text() {
    let p = Project::new();
    p.source("table ranked:\n  score: int\n  read <- allow\n  insert <- allow\ntable entries:\n  postId: id\n  by byPost: postId, id\n  public 'feed'\n  sync\nmaintain entryCounts: count entries by postId\n  read <- allow\n  online only\nmutation repost(postId: id):\n  return entryCounts[postId]\nmutation like():\n  insert ranked { score: 1 }\nmutation createPost():\n  insert ranked { score: 0 }\n");
    let summary = "3 mutations never predict: createPost (writes online-only table ranked), like (writes online-only table ranked), repost (reads online-only maintain entryCounts) (they run on the server when called; no action needed for an online app) — snapback4 why <op>";
    for args in [vec!["check"], vec!["check", "--json"], vec!["check", "--residency"]] {
        let output = p.run(&args);
        assert!(output.status.success(), "{output:?}");
        if args.contains(&"--json") { assert_eq!(parsed(&output)["predictionSummary"], summary); }
        else { assert_eq!(String::from_utf8_lossy(&output.stdout).matches(summary).count(), 1); }
    }
    let output = p.run(&["why", "repost"]);
    assert!(String::from_utf8_lossy(&output.stdout).contains("remove `online only` from view entryCounts"));
}

#[test]
fn b2_predicts_assertion_refuses_check_and_is_quiet_when_satisfied() {
    let p = Project::new();
    let source = "mutation dispatch() predicts: server\n  return null\n";
    p.source(source);
    let output = p.run(&["check"]);
    println!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("schema.q:1:1 — E_NOT_PREDICTABLE"));
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 mutation never predicts: dispatch (author marked this mutation : server)"));
    let verbose = p.run(&["check", "--verbose"]);
    assert!(String::from_utf8_lossy(&verbose.stdout).contains("1 mutation never predicts: dispatch"));
    p.source(&source.replace(": server", ":"));
    let output = p.run(&["check", "--json"]);
    assert!(output.status.success(), "{output:?}");
    assert_eq!(parsed(&output)["predictionSummary"], Value::Null);
}

struct AdoptionHost { child: std::process::Child, address: String, log: PathBuf }
impl Drop for AdoptionHost { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
impl AdoptionHost {
    fn start(p: &Project, watch: bool) -> Self {
        use std::io::{BufRead, BufReader};
        let log = p.0.join("host.log");
        let mut command = Command::new(BIN);
        command.current_dir(&p.0).args(["dev", "--port", "0", "--hold-schedules"]);
        if !watch { command.arg("--no-watch"); }
        let mut child = command.stdout(std::process::Stdio::piped()).stderr(fs::File::create(&log).unwrap()).spawn().unwrap();
        let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
        assert!(line.starts_with("http://"), "{}", fs::read_to_string(&log).unwrap());
        Self { child, address: line.trim().trim_start_matches("http://").into(), log }
    }
    fn logs(&self) -> String { fs::read_to_string(&self.log).unwrap() }
    fn has_log_line(&self, message: &str) -> bool {
        self.logs().split_inclusive('\n').any(|line| line.ends_with('\n') && line.contains(message))
    }
    fn query(&self) -> Value {
        self.request("/q/version", "x-snapback-persona: alice\r\n", "{\"args\":{}}")
    }
    fn request(&self, path: &str, headers: &str, body: &str) -> Value {
        use std::io::{Read, Write};
        let mut stream = std::net::TcpStream::connect(&self.address).unwrap();
        stream.set_read_timeout(Some(std::time::Duration::from_secs(30))).unwrap();
        write!(stream, "POST {path} HTTP/1.1\r\nHost: localhost\r\n{headers}Connection: close\r\nContent-Length: {}\r\n\r\n{body}", body.len()).unwrap();
        let mut answer = String::new(); stream.read_to_string(&mut answer).unwrap();
        serde_json::from_str(answer.split_once("\r\n\r\n").unwrap().1).unwrap()
    }
}
fn wait_adoption(mut ready: impl FnMut() -> bool) {
    let started = std::time::Instant::now();
    while !ready() {
        assert!(started.elapsed() < std::time::Duration::from_secs(35), "adoption did not recover/report within 35 s");
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
}
#[path = "check_adoption/mod.rs"]
mod check_adoption;

#[test]
fn check_explains_held_dispatch_and_generates_the_client_marker() {
    let p = Project::new();
    p.source("query heldValue() held:\n  return [1, 2]\n");
    let checked = p.run(&["check", "--verbose"]);
    assert!(checked.status.success(), "{}", String::from_utf8_lossy(&checked.stderr));
    assert!(String::from_utf8_lossy(&checked.stdout).contains("heldValue: runs: device (held; server refuses E_QUERY_HELD; no server fallback)"));
    let api = fs::read_to_string(p.0.join("snapback/generated/api.ts")).unwrap();
    assert!(api.contains("held: true") && api.contains("Read.cut: meter | words | null"), "{api}");
    let checked = p.run(&["check", "--json"]);
    let json: Value = serde_json::from_slice(&checked.stdout).unwrap();
    assert_eq!(json["heldQueries"], json!(["heldValue"]));
}

#[test]
fn w8r1b_test_names_held_queries_without_failing_other_queries_or_residency() {
    let p = Project::new();
    p.source(&format!("{SOURCE}query heldRows() held:\n  return [1, 2]\nuse personas alice, bob\n"));
    let fixture = p.0.join("fixture"); fs::create_dir(&fixture).unwrap();
    fs::write(fixture.join("messages.jsonl"), "{\"id\":\"one\",\"body\":\"hello\"}\n").unwrap();
    for args in [vec!["test"], vec!["test", "--fixture", fixture.to_str().unwrap()], vec!["test", "--residency", "--verbose", "--fixture", fixture.to_str().unwrap()]] {
        let output = p.run(&args);
        let text = String::from_utf8_lossy(&output.stdout);
        println!("{args:?}\n{text}");
        assert!(output.status.success(), "{output:?}");
        assert_eq!(text.matches("not run: heldRows is held (device only)").count(), 1, "{text}");
        assert!(text.contains("all (alice)") && text.contains("all (bob)"), "{text}");
        assert!(!text.contains("denied E_QUERY_HELD"), "{text}");
        if args.contains(&"--residency") { assert!(text.contains("loaded 1 rows") && text.contains("cold"), "{text}"); }
    }
}

#[test]
fn w8r1b_release_from_a_used_dev_store_never_returns_read_meters() {
    use std::io::{BufRead, BufReader};
    let p = Project::new(); p.source(&format!("use identity guests\n{SOURCE}"));
    let host = AdoptionHost::start(&p, false);
    assert_eq!(host.request("/seed", "", r#"[{"table":"messages","row":{"id":"one","body":"from dev"}}]"#)["seeded"], 1);
    let dev = host.request("/q/all", "x-snapback-persona: alice\r\n", "{}");
    assert_eq!(dev["data"][0]["body"], "from dev");
    assert!(dev["meter"].is_object(), "{dev}");
    drop(host);
    let identity = Store::open_read_only(&p.store()).unwrap().meta("store_id").unwrap();
    let release = p.0.join(".snapback4");
    let deployed = p.run(&["deploy", release.to_str().unwrap()]);
    assert!(deployed.status.success(), "{deployed:?}");
    assert_eq!(Store::open_read_only(&p.store()).unwrap().meta("store_id").unwrap(), identity);
    let log = p.0.join("release.log");
    let mut child = Command::new(BIN).current_dir(&p.0).args(["serve", release.to_str().unwrap(), "--port", "0"])
        .stdout(std::process::Stdio::piped()).stderr(fs::File::create(&log).unwrap()).spawn().unwrap();
    let mut line = String::new(); BufReader::new(child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    let host = AdoptionHost { child, address: line.trim().trim_start_matches("http://").into(), log };
    assert!(line.starts_with("http://"), "{}", host.logs());
    let guest = host.request("/auth/guest", "", "{}");
    let token = guest["session"]["token"].as_str().unwrap();
    for meter in ["", "x-snapback-meter: 1\r\n"] {
        let reply = host.request("/q/all", &format!("Authorization: Bearer {token}\r\n{meter}"), "{}");
        assert_eq!(reply["data"][0]["body"], "from dev", "{reply}");
        assert!(reply.get("meter").is_none() && reply.get("metered").is_none(), "{reply}");
    }
    println!("release from dev: retained_rows=1 same_store_identity=1 dev_meter_fields=1 release_meter_fields=0 requests=2");
}

#[test]
fn w9a_check_states_held_source_coverage_only_without_horizons() {
    let p = Project::new();
    let source = "table messages:\n  body: text <=100\n  public 'messages'\n  sync\ntable labels:\n  body: text <=100\n  public 'labels'\n  sync\nquery heldRows(c: cursor ?) held:\n  a = messages after c first 20 by byId\n  b = labels after c first 20 by byId\n  return { a, b }\nquery ordinary(c: cursor ?):\n  return messages after c first 20 by byId\n";
    let positive = "    horizon-free source coverage — all sources sync without a horizon; answer completeness still depends on runtime authorization and limits";
    for horizon in [false, true] {
        p.source(&if horizon { source.replacen("  sync\n", "  sync last 20 by byId\n", 1) } else { source.into() });
        for args in [vec!["check", "--verbose"], vec!["check", "--cost"], vec!["check", "--residency"], vec!["why", "heldRows"]] {
            let output = p.run(&args);
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8_lossy(&output.stdout);
            assert_eq!(text.lines().filter(|line| *line == positive).count(), usize::from(!horizon), "{args:?}: {text}");
            assert!(text.contains("heldRows: runs: device (held; server refuses E_QUERY_HELD; no server fallback)"), "{text}");
            if horizon { assert!(text.contains("incomplete past the horizon; no server fallback"), "{text}"); }
            if args.contains(&"--cost") { assert!(text.contains("scan messages.byId first 20"), "{text}"); }
        }
    }
    let output = p.run(&["why", "ordinary"]);
    assert!(!String::from_utf8_lossy(&output.stdout).contains("horizon-free source coverage"));
}

#[test]
fn w9c_check_validates_unique_refusal_codes_like_require() {
    let p = Project::new();
    let source = |code: &str| format!("table profiles:\n  handle: text <=30\n  unique byHandle: handle else {code}\n  public 'profiles'\n  insert <- allow\nmutation create(handle: text <=30):\n  return insert profiles {{ handle }}\n");
    for (code, expected) in [("badCode", "E_QUARRY_UNKNOWN"), ("E_HANDLE_TAKEN", "E_OP_RESERVED")] {
        p.source(&source(code));
        let result = p.run(&["check"]);
        assert_eq!(result.status.code(), Some(1), "{result:?}");
        let text = format!("{}{}", String::from_utf8_lossy(&result.stdout), String::from_utf8_lossy(&result.stderr));
        assert!(text.contains(expected), "{text}");
        println!("{text}");
    }
    p.source(&source("HANDLE_TAKEN 'That handle is taken.'"));
    let result = p.run(&["check"]);
    assert!(result.status.success(), "{result:?}");
}

#[test]
fn w10r1b_unscoped_cursor_note_never_proposes_a_whole_table_cap() {
    let p = Project::new();
    p.source(SOURCE);
    let checked = p.run(&["check", "--verbose"]);
    assert!(checked.status.success());
    let text = String::from_utf8(checked.stdout).unwrap();
    println!("{text}");
    assert!(text.contains("N_NO_CURSOR") && text.contains("if the screen pages"), "{text}");
    assert!(!text.contains("or declare `cap"), "{text}");
    p.source(&SOURCE.replace("query all():", "query all(c: cursor ?):").replace("messages[] first", "messages[] after c first"));
    assert!(!String::from_utf8_lossy(&p.run(&["check", "--verbose"]).stdout).contains("N_NO_CURSOR"));
}

#[test]
fn w10r1b_missing_fixture_refuses_instead_of_measuring_an_empty_store() {
    let p = Project::new();
    for missing in ["absent", "not-a-directory"] {
        if missing == "not-a-directory" { fs::write(p.0.join(missing), "file").unwrap(); }
        let output = p.run(&["test", "--memory", "--residency", "--fixture", missing, "--as", "alice"]);
        println!("fixture {missing}: {}", String::from_utf8_lossy(&output.stderr));
        assert_eq!(output.status.code(), Some(1), "{output:?}");
        assert!(String::from_utf8_lossy(&output.stderr).contains("cannot read fixture directory"));
        assert!(!String::from_utf8_lossy(&output.stdout).contains("loaded 0 rows"));
        assert!(!String::from_utf8_lossy(&output.stdout).contains("measurement"));
    }
    fs::create_dir(p.0.join("fixture")).unwrap();
    fs::write(p.0.join("fixture/messages.jsonl"), "{\"id\":\"one\",\"body\":\"hello\"}\n").unwrap();
    let output = p.run(&["test", "--memory", "--residency", "--fixture", "fixture", "--as", "alice"]);
    assert!(output.status.success(), "{output:?}");
    assert!(String::from_utf8_lossy(&output.stdout).contains("loaded 1 rows"));
}

#[test]
fn w11c_residency_cost_order_and_bounded_reconciled_totals_on_both_verbs() {
    let p = Project::new();
    let mut source = String::new();
    let fixture = p.0.join("fixture"); fs::create_dir(&fixture).unwrap();
    for n in 0..100 {
        let name = format!("small{n:03}");
        source.push_str(&format!("table {name}:\n  body: text <=2000\n  public 'fixture'\n  cap 100\n  sync\n"));
        fs::write(fixture.join(format!("{name}.jsonl")), "{\"id\":\"s\",\"body\":\"x\"}\n").unwrap();
    }
    source.push_str("table zzPayload:\n  body: text <=2000\n  public 'fixture'\n  cap 100\n  sync\n");
    let rows = (0..10).map(|n| json!({"id":format!("p{n}"),"body":"x".repeat(1000)}).to_string()).collect::<Vec<_>>().join("\n");
    fs::write(fixture.join("zzPayload.jsonl"), &rows).unwrap();
    p.source(&source);
    for verb in ["test", "check"] {
        let output = p.run(&[verb, "--residency", "--fixture", "fixture", "--as", "alice"]);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        println!("{verb}:\n{text}");
        let report = text.split_once("residency (measurements)").expect("measurement at both entry points").1;
        let rows: Vec<_> = report.lines().filter(|line| line.starts_with("  alice ")).collect();
        assert_eq!(rows[0], "  alice zzPayload: 10 rows, 10210 bytes");
        assert!(report.contains("other 93 table/persona pairs: 93 rows, 1953 bytes"), "{report}");
        assert!(report.contains("total across personas: 110 rows, 12310 bytes"), "{report}");
        assert!(text.lines().count() <= 18, "{} lines: {text}", text.lines().count());
    }
}

#[test]
fn w11c_check_acquisition_uses_active_schema_read_only_and_fixture_uses_current_schema() {
    let p = Project::new();
    let source = "table notes:\n  owner: principal\n  at: time\n  by byOwnerTime: owner, at, id\n  read <- .owner = viewer\n  sync last 2 by byOwnerTime\nuse personas alice, bob\n";
    p.source(source);
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::new(Store::open(&p.store()).unwrap(), bound.schema, []).unwrap();
    let definition = &engine.schema().tables["notes"];
    let rows = (0..6).map(|n| ("notes".into(), wire::row_from_json(definition,
        &json!({"id":format!("n{n}"),"owner":if n < 3 { "dev:alice" } else { "dev:bob" },"at":n})).unwrap())).collect::<Vec<_>>();
    engine.seed(rows.clone()).unwrap();
    drop(engine);
    let before = fs::read(p.store()).unwrap();
    // An unadopted horizon change must not change the current-store measurement.
    p.source(&source.replace("last 2", "last 1"));
    let output = p.run(&["check", "--residency"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("alice notes: 2 rows") && text.contains("bob notes: 2 rows"), "{text}");
    assert!(text.contains("total across personas: 4 rows"));
    assert!(text.contains("active dev-store schema"));
    assert_eq!(fs::read(p.store()).unwrap(), before, "check did not adopt or write application rows");
    let fixture = p.0.join("fixture"); fs::create_dir(&fixture).unwrap();
    fs::write(fixture.join("notes.jsonl"), rows.iter().map(|(_, row)| wire::to_json(row).to_string()).collect::<Vec<_>>().join("\n")).unwrap();
    for verb in ["test", "check"] {
        let output = p.run(&[verb, "--residency", "--fixture", "fixture"]);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("alice notes: 1 rows") && text.contains("bob notes: 1 rows"), "{text}");
        assert!(text.contains("total across personas: 2 rows"));
    }
    let output = p.run(&["check", "--residency", "--fixture", "fixture", "--json"]);
    assert!(output.status.success(), "{output:?}");
    assert!(parsed(&output)["acquisition"].as_str().unwrap().contains("total across personas: 2 rows"));
    for verb in ["test", "check"] {
        assert!(!p.run(&[verb, "--residency", "--fixture", "missing"]).status.success());
    }
}

#[test]
fn w11r1c_help_describes_residency_without_query_meters() {
    let p = Project::new();
    p.source("query answer():\n  return 42\n");
    let help = p.run(&["--help"]);
    let text = String::from_utf8(help.stdout).unwrap();
    assert!(text.contains("--residency: acquisition report only; add --verbose to run queries and print meters"), "{text}");
    let report = p.run(&["test", "--residency"]);
    assert!(report.status.success(), "{report:?}");
    assert!(!String::from_utf8_lossy(&report.stdout).contains("answer ("));
    let verbose = p.run(&["test", "--residency", "--verbose"]);
    assert!(verbose.status.success(), "{verbose:?}");
    assert!(String::from_utf8_lossy(&verbose.stdout).contains("answer ("), "{verbose:?}");
}

#[test]
fn w11r1c_toolchain_why_explains_node_start_failure_too() {
    let p = Project::new();
    p.source("query answer():\n  return 42\n");
    fs::write(p.0.join("snapback/server.ts"), "export default {};\n").unwrap();
    fs::create_dir(p.0.join("node_modules")).unwrap();
    std::os::unix::fs::symlink(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node_modules/typescript"), p.0.join("node_modules/typescript")).unwrap();
    let output = Command::new(BIN).arg("check").env("SNAPBACK_NODE", p.0.join("missing-node")).current_dir(&p.0).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stderr).contains("E_SERVER_TOOLCHAIN: cannot start Node 24 to check server handlers:"));
    let why = p.run(&["why", "E_SERVER_TOOLCHAIN"]);
    let text = String::from_utf8(why.stdout).unwrap();
    let summary = text.lines().next().unwrap();
    let paragraph = snapback4_lang::guide::card("actions").unwrap().split("\n\n").find(|p| p.starts_with("E_SERVER_TOOLCHAIN means ")).unwrap();
    for (part, content) in [("summary", summary), ("dedicated paragraph", paragraph)] {
        for fact in ["Node 24", "SNAPBACK_NODE", "TypeScript"] {
            assert!(content.contains(fact), "{part} omits {fact}: {content}");
        }
    }
    assert!(text.contains(paragraph), "why must include the dedicated paragraph: {text}");
    let repaired = p.run(&["check"]);
    assert!(repaired.status.success(), "{repaired:?}");
}

#[test]
fn farm2_typescript_7_is_refused_by_version_not_crashed_on() {
    // TypeScript 7's package exports only `version` (the native compiler);
    // the farm's unpinned installs crashed the checker reading `ts.sys`.
    let p = Project::new();
    p.source("query answer():\n  return 42\n");
    fs::write(p.0.join("snapback/server.ts"), "export default {};\n").unwrap();
    let ts7 = p.0.join("node_modules/typescript");
    fs::create_dir_all(&ts7).unwrap();
    fs::write(ts7.join("package.json"), r#"{"name":"typescript","version":"7.0.2","main":"index.js"}"#).unwrap();
    fs::write(ts7.join("index.js"), "module.exports = { version: '7.0.2', versionMajorMinor: '7.0' };\n").unwrap();
    let output = p.run(&["check"]);
    assert_eq!(output.status.code(), Some(1), "{output:?}");
    let stderr = String::from_utf8_lossy(&output.stderr);
    assert!(stderr.contains("E_SERVER_TOOLCHAIN: this application's TypeScript 7.0.2 has no compiler API"), "{stderr}");
    assert!(stderr.contains("typescript@5.9.3") && !stderr.contains("TypeError"), "{stderr}");
    let json = p.run(&["check", "--json"]);
    assert_eq!(parsed(&json)["problems"][0]["code"], "E_SERVER_TOOLCHAIN", "{json:?}");
    fs::remove_dir_all(&ts7).unwrap();
    std::os::unix::fs::symlink(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../node_modules/typescript"), &ts7).unwrap();
    let repaired = p.run(&["check"]);
    assert!(repaired.status.success(), "{repaired:?}");
}


#[test]
fn w11r2_generic_application_refusals_do_not_claim_the_feed_recipe() {
    let p = Project::new();
    p.source("mutation missing():\n  require false else POST_NOT_FOUND\nmutation author():\n  require false else AUTHOR_NOT_FOUND\nquery answer():\n  return 42\n");
    assert!(p.run(&["check"]).status.success());
    for code in ["POST_NOT_FOUND", "AUTHOR_NOT_FOUND", "CANNOT_FOLLOW_SELF"] {
        let output = p.run(&["why", code]);
        let text = format!("{}{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        assert!(!text.contains("guide feeds") && !text.contains("Following"), "{code}: {text}");
    }
    let output = p.run(&["why", "FEED_POST_NOT_FOUND"]);
    assert!(output.status.success());
    assert!(String::from_utf8_lossy(&output.stdout).contains("Full card: snapback4 guide feeds"));
}

#[test]
fn w13b_test_names_reads_past_half_a_ceiling_and_bounds_the_summary() {
    let p = Project::new();
    let table = "use personas alice\ntable entries:\n  public 'fixture'\n  sync public\n";
    let query = "query everywhere():\n  return entries[] first 5000 by byId\n";
    p.source(&format!("{table}{query}"));
    let fixture = p.0.join("fixture"); fs::create_dir(&fixture).unwrap();
    fs::write(fixture.join("entries.jsonl"), (0..4312).map(|n| format!("{{\"id\":\"r{n}\"}}\n")).collect::<String>()).unwrap();
    let output = p.run(&["test", "--memory", "--fixture", "fixture"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap(); println!("{text}");
    assert!(text.contains("everywhere (alice) examined 4,312 of 8,192"), "{text}");
    p.source(&format!("{table}{}", (0..12).map(|n| query.replace("everywhere", &format!("everywhere{n}"))).collect::<String>()));
    let output = p.run(&["test", "--memory", "--fixture", "fixture"]);
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(output.status.success(), "{text}");
    assert_eq!(text.lines().filter(|line| line.starts_with("near ceiling:")).count(), 11, "{text}");
    assert!(text.contains("near ceiling: 2 more query/persona reads passed half a ceiling without a cut"), "{text}");
    p.source(&format!("{table}{query}"));
    fs::write(fixture.join("entries.jsonl"), "{\"id\":\"one\"}\n").unwrap();
    let output = p.run(&["test", "--memory", "--fixture", "fixture"]);
    assert!(output.status.success());
    assert!(!String::from_utf8(output.stdout).unwrap().contains("near ceiling:"));
    // A real cut already has the ordinary capped row, not an approach warning.
    p.source(&format!("{table}query everywhere():\n  return entries[] first 1 by byId where .id = 'absent'\n"));
    fs::write(fixture.join("entries.jsonl"), (0..8200).map(|n| format!("{{\"id\":\"r{n}\"}}\n")).collect::<String>()).unwrap();
    let output = p.run(&["test", "--memory", "--fixture", "fixture"]);
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("capped")); assert!(!text.contains("near ceiling:"));
}

#[test]
fn w13b_starter_has_no_near_ceiling_summary() {
    let p = Project::new();
    let init = p.run(&["init", "starter"]);
    assert!(init.status.success(), "{init:?}");
    let output = Command::new(BIN).current_dir(p.0.join("starter")).arg("test").output().unwrap();
    assert!(output.status.success(), "{output:?}");
    assert!(!String::from_utf8(output.stdout).unwrap().contains("near ceiling:"));
}

#[path = "../src/read_cost.rs"]
mod read_cost;

#[test]
fn w13b_cut_log_suppresses_per_operation_and_site_with_a_count() {
    use std::time::{Duration, Instant};
    let bound = snapback4_lang::compile(&[("schema.q".into(), "query value():\n  return 42\n".into())]);
    let mut engine = Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap();
    let mut read = engine.query("value", snapback4_core::Context::new("alice", Default::default())).unwrap();
    let mut log = read_cost::ReadCuts::default();
    let now = Instant::now();
    assert!(log.line("value", "alice", &read, now).is_none());
    read.capped_at = Some((snapback4_core::error::MeterKind::Examined, "scan:1".into()));
    read.metered.examined = 8193;
    let first = log.line("value", "alice", &read, now).unwrap();
    assert!(first.contains("cut by examined rows at scan:1; examined=8193"), "{first}");
    for _ in 0..5 { assert!(log.line("value", "alice", &read, now).is_none()); }
    let changed = log.line("value", "bob", &read, now).unwrap();
    assert!(changed.ends_with("suppressed 5 repeated read cuts"), "{changed}");
    for principal in ["carol", "alice", "bob"] { assert!(log.line("value", principal, &read, now).is_none()); }
    let next = log.line("value", "alice", &read, now + Duration::from_secs(60)).unwrap();
    assert!(next.ends_with("suppressed 3 repeated read cuts"), "{next}");
    assert!(log.line("other", "alice", &read, now).is_some());
    read.capped_at = None; read.word_cut_at = Some("search:2".into());
    assert!(log.line("value", "alice", &read, now).unwrap().contains("cut by words (32 first-term words per admitted non-uniform scope) at search:2"));
    println!("W13b suppression: first window emitted=2 suppressed=8; next window reports=3; distinct operation/site independent");
}

#[test]
fn w13b_near_ceiling_requires_more_than_half_and_reports_each_counter() {
    use snapback4_core::{Ceilings, meter::Metered};
    let c = Ceilings::default();
    let mut m = Metered { examined: c.examined / 2, ..Default::default() };
    assert!(read_cost::near_ceiling(m, c).is_none());
    m.examined += 1; m.heap_bytes = c.heap_bytes / 2 + 1;
    assert_eq!(read_cost::near_ceiling(m, c).unwrap(), "examined 4,097 of 8,192; heap bytes 8,388,609 of 16,777,216");
}

#[test]
fn w13c_cost_reports_meter_domains_and_prefix_existence_as_scans() {
    let p = Project::new();
    p.source(include_str!("../../snapback4-sim/tests/fixtures/prefix-reads.q"));
    let output = p.run(&["check", "--cost"]);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("rows ≤ meter (8,192 examined)"), "{text}");
    assert!(text.contains("lanes ≤ meter"), "{text}");
    assert!(text.contains("scan messages.byRoomTime first 1"), "{text}");
    assert!(text.contains("exists: first match, no page overflow or cursor"), "{text}");
    assert!(!text.contains("N_WIDE_MERGE"));
    println!("{text}");
}

#[test]
fn w13c_check_fix_parenthesizes_an_inner_matching_read() {
    let p = Project::new();
    let source = include_str!("../../snapback4-sim/tests/fixtures/prefix-reads.q");
    for spelling in ["messages[roomId = .roomId] by byRoomWords matching q", "(messages[roomId = .roomId] by byRoomWords) matching q"] {
        p.source(&source.replace("(messages[roomId = .roomId] by byRoomWords matching q)", spelling));
        let refused = p.run(&["check", "--json"]);
        assert_eq!(parsed(&refused)["problems"][0]["code"], "E_QUARRY_MODIFIER_SCOPE");
        let repaired = p.run(&["check", "--fix"]);
        assert!(repaired.status.success(), "{}", String::from_utf8_lossy(&repaired.stderr));
        assert!(p.run(&["check"]).status.success());
    }
}

#[test]
fn w13c2_cost_folds_range_widths_and_keeps_unknown_lanes_meter_bounded() {
    let p = Project::new();
    p.source(include_str!("../../snapback4-sim/tests/fixtures/lane-domains.q"));
    let output = p.run(&["check", "--cost"]);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("lanes ≤ meter"), "{text}");
    assert!(text.contains("up to 25 lanes"), "{text}");
    assert!(text.contains("up to 50 lanes"), "{text}");
    assert!(!text.contains("N_WIDE_MERGE"), "{text}");
    println!("{text}");
}

#[test]
fn w13cr1_cost_keeps_differently_grouped_range_expressions_dynamic() {
    let p = Project::new();
    p.source("table posts:\n  hourKey: int\n  by byHour: hourKey, id\n  public 'posts'\nquery page(start: int, end: int, c: cursor ?):\n  return merge posts after c first 10 by byHour:\n    [h] for h in range((start + end) * 2, start + end * 2)\n");
    let output = p.run(&["check", "--cost"]);
    assert!(output.status.success(), "{}", String::from_utf8_lossy(&output.stderr));
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{text}");
    assert!(text.contains("lanes ≤ meter"), "{text}");
    assert!(!text.contains("up to 0 lanes"), "{text}");
}

#[test]
fn column_trending_cost_has_one_merge_and_derived_bounds() {
    let recipe = snapback4_lang::guide::quarry(snapback4_lang::guide::card("feeds").unwrap()).into_iter().find(|s| s.contains("likeCount: count likes\n")).unwrap();
    let p=Project::new(); p.source(&format!("{recipe}\njob prune():\n  chunk like in likes first 1000 by byId:\n    delete likes[like.id]\n"));
    let out=p.run(&["check","--cost"]);
    assert!(out.status.success(),"{out:?}");
    let text=String::from_utf8(out.stdout).unwrap();
    assert_eq!(text.matches("merge posts: lanes ≤ meter").count(),1,"{text}");
    assert!(text.contains("maintained columns from likes: posts.likeCount"),"{text}");
    assert!(text.contains("own derived stream bytes") && text.contains("0 row-event bytes"),"{text}");
    assert!(text.contains("8192-row job chunk ceiling") && text.contains("composed job chunk: <= 1638"),"{text}");
    let why=p.run(&["why","posts"]);
    assert!(why.status.success());
    assert!(String::from_utf8_lossy(&why.stdout).contains("maintained column posts.likeCount"));
    let residency=p.run(&["test","--residency"]);
    assert!(residency.status.success(),"{residency:?}");
    assert!(String::from_utf8_lossy(&residency.stdout).contains("maintained column posts.likeCount"));
}

#[test]
fn maintained_column_inspection_is_public_and_missing_storage_reads_zero() {
    use snapback4_core::{engine::LoadMode,value::{object,Value as V}};
    let p=Project::new();
    let source=include_str!("../../snapback4-lang/tests/fixtures/maintained-columns.q");
    p.source(source);
    fs::create_dir_all(p.0.join(".snapback4")).unwrap();
    let b=snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let private=b.schema.maintains.iter().find(|m|m.private.as_ref().is_some_and(|o|o.column=="likeCount")).unwrap().target.clone();
    let mut e=Engine::new(Store::open(&p.store()).unwrap(),b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.load_mode([("posts".into(),object([("id",V::Id("p".into())),("at",V::Int(1))]))],LoadMode::Restore).unwrap();
    let stored=e.store().rows("posts").unwrap();
    for field in ["likeCount","selected","total"] {assert!(stored[0].field(field).is_err());}
    assert!(e.schema().tables["posts"].defaults.is_empty());
    drop(e);
    let sql=p.run(&["sql","SELECT likeCount, selected, total FROM posts","--json"]);
    assert!(sql.status.success(),"{sql:?}");
    assert_eq!(parsed(&sql)["rows"],json!([[0,0,0]]));
    let data=p.run(&["data","posts","--json"]);
    assert!(data.status.success(),"{data:?}");
    let data_json=parsed(&data);
    for result in [&data,&sql] {assert!(!String::from_utf8_lossy(&result.stdout).contains(&private));}
    for field in ["likeCount","selected","total"] {assert_eq!(data_json[field],json!(0),"{data_json}");}
    for command in ["data","why"] {
        let result=p.run(&[command,&private]);
        assert!(!result.status.success());
        assert!(result.stdout.is_empty());
        let text=format!("{}{}",String::from_utf8_lossy(&result.stdout),String::from_utf8_lossy(&result.stderr));
        assert!(text.contains("posts.likeCount") && !text.contains("$column"),"{text}");
    }
    for identifier in [private.clone(), private.to_uppercase()] {
        let sql = p.run(&["sql", &format!("SELECT * FROM \"{identifier}\""), "--json"]);
        assert!(!sql.status.success());
        assert!(parsed(&sql).get("rows").is_none());
        let text = format!("{}{}", String::from_utf8_lossy(&sql.stdout), String::from_utf8_lossy(&sql.stderr));
        assert!(text.contains("posts.likeCount"), "{text}");
        assert!(!text.to_lowercase().contains("$column:"), "{text}");
    }
    let absent=p.run(&["sql","SELECT * FROM genuinely_absent","--json"]);
    assert!(!absent.status.success());
    assert!(!String::from_utf8_lossy(&absent.stdout).contains("posts.likeCount"));
    let check=p.run(&["check","--json"]);let doctor=p.run(&["doctor","--json"]);
    assert!(check.status.success() && doctor.status.success(),"{check:?} {doctor:?}");
    for result in [&check,&doctor] {assert!(!format!("{}{}",String::from_utf8_lossy(&result.stdout),String::from_utf8_lossy(&result.stderr)).contains(&private));}
    assert_eq!(parsed(&check)["tables"],2);
    assert!(parsed(&doctor)["lines"].as_array().unwrap().iter().any(|s|s.as_str().unwrap().starts_with("schema    ok: 2 tables")));
}

#[test]
fn row_view_check_matches_engine_chunk_size_and_commit_count() {
    use snapback4_core::{Context, value::{Value as V, object}, engine::row_views::{RECOUNT_CHUNK,WRITER_RECOUNT}};
    let p=Project::new();
    let source=include_str!("../../snapback4-lang/tests/fixtures/row-keyed-view.q").replace("  expire at .until\n", "");
    p.source(&source);
    let checked=p.run(&["check","--json"]);
    assert!(checked.status.success(),"{checked:?}");
    let row=parsed(&checked)["rowViews"][0].clone();
    assert_eq!(row["recountChunk"],RECOUNT_CHUNK);
    assert_eq!(row["writerRecount"],WRITER_RECOUNT);
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let id=|s:&str|V::Id(s.into());
    let mut seed=vec![("members".into(),object([("id",id("b")),("conversationId",id("c")),("principal",id("bob")),("readUpTo",V::Int(0)),("joinedAt",V::Int(0))]))];
    const POPULATION:usize=1200;
    seed.extend((1..=POPULATION).map(|n|("messages".into(),object([("id",id(&format!("m{n:05}"))),("conversationId",id("c")),("senderId",id("alice")),("ordinal",V::Int(n as i64)),("tombstone",V::Bool(false)),("until",V::Null)]))));
    e.seed_at(seed,1).unwrap();
    let marked=e.mutate("mark",None,Context::new("bob",[("member".into(),id("b")),("readUpTo".into(),V::Int(POPULATION as i64))].into()).at(1)).unwrap();
    assert!(matches!(marked.state,snapback4_core::WriteState::Sent{..}));
    let start=e.seq().unwrap();
    let mut commits=0;
    while e.run_view_chunk(1).unwrap().is_some() { commits+=1; assert!(commits<100); }
    assert_eq!(commits,POPULATION.div_ceil(RECOUNT_CHUNK));
    assert_eq!(e.seq().unwrap()-start,commits as u64);
    assert_eq!(e.changes(start,100).unwrap().len(),commits);
}

#[test]
fn er_expiry_cost_names_backlog_attempt_and_atomic_refusal() {
    let p = Project::new();
    let schema = "table messages:\n  owner: principal\n  expiresAt: time ?\n  read <- .owner = viewer\n  expire at .expiresAt\n  sync to .owner\n";
    for read in ["messages where .owner = viewer first 1 by .id", "exists messages where .owner = viewer", "count(messages where .owner = viewer)"] {
        p.source(&format!("{schema}mutation inspect(): server\n  return {read}\n"));
        let output=p.run(&["check","--cost"]);
        assert!(output.status.success(),"{}",String::from_utf8_lossy(&output.stderr));
        let text=String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("expired messages rows not yet swept"),"{text}");
        assert!(text.contains("examined ceiling 8192"),"{text}");
        assert!(text.contains("scan attempt also costs one examined unit"),"{text}");
        assert!(text.contains("E_BOUND, with no write"),"{text}");
        assert!(!text.contains("a pass over the first"),"{text}");
        assert!(text.contains("scale: examined ceiling 8192; E_BOUND, with no write, if exceeded"), "{text}");
        if read.starts_with("count(") {
            assert!(!text.contains("sort/group/sum/count consume this page"), "{text}");
            assert!(text.contains("no partial total"), "{text}");
        }
    }
}

#[test]
fn fixture_test_reports_cursorless_top_n_complete() {
    let p = Project::new();
    let source = "use personas alice\ntable posts:\n  at: time\n  public 'posts'\nquery top():\n  return posts last 10 by .at\n";
    p.source(source);
    fs::create_dir(p.0.join("fixture")).unwrap();
    let rows = (0..1000).map(|n| format!("{{\"id\":\"p{n:04}\",\"at\":{n}}}\n")).collect::<String>();
    fs::write(p.0.join("fixture/posts.jsonl"), rows).unwrap();
    let output = p.run(&["test", "--fixture", "fixture"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8_lossy(&output.stdout);
    let measured = text.lines().find(|line| line.contains("top (alice)")).expect(&text);
    assert!(measured.contains("complete in") && !measured.contains("capped"), "{text}");
}

// Large cards truncate in agent tools: an index and one section at a time.
#[test]
fn guide_prints_a_cards_heading_index_and_one_section() {
    let index = Command::new(BIN).args(["guide", "language", "--sections"]).output().unwrap();
    assert!(index.status.success() && index.stderr.is_empty(), "{index:?}");
    let index = String::from_utf8_lossy(&index.stdout);
    assert!(index.starts_with("language: ") && index.contains("Older spellings that still compile ("), "{index}");
    for keyword in snapback4_lang::guide::KEYWORDS {
        let card = Command::new(BIN).args(["guide", keyword, "--full"]).output().unwrap();
        let card = String::from_utf8_lossy(&card.stdout).into_owned();
        for (_, heading, _, _) in snapback4_lang::guide::sections(&card) {
            let output = Command::new(BIN).args(["guide", keyword, "--section", &heading]).output().unwrap();
            let text = String::from_utf8_lossy(&output.stdout);
            // Repeated headings (a card may have two "Example" sections) refuse as ambiguous.
            if !output.status.success() { assert!(text.contains("matches") && text.contains("sections of guide"), "{keyword} {heading}: {text}"); continue; }
            let body = text.split_once("\n\n").map(|(_, body)| body).unwrap_or(&text).trim_end();
            assert!(body.starts_with("##") && card.contains(body), "{keyword} --section {heading}");
        }
    }
    let output = Command::new(BIN).args(["guide", "reads", "--section", "no such heading"]).output().unwrap();
    assert_eq!(output.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&output.stdout).contains("Limits ("), "{output:?}");
    let listing = Command::new(BIN).arg("guide").output().unwrap();
    let listing = String::from_utf8_lossy(&listing.stdout);
    assert!(listing.contains("--section <heading or number>") && listing.contains("--full"), "{listing}");
}

// Wave 3 (LLP 3000.037): 33 lanes lost batched card output to truncation. A card
// longer than a tool window prints its opening and a numbered index by default.
#[test]
fn a_long_card_prints_its_opening_and_index_and_full_prints_it_all() {
    let guide = |args: &[&str]| { let o = Command::new(BIN).arg("guide").args(args).output().unwrap(); (o.status.code(), String::from_utf8_lossy(&o.stdout).into_owned()) };
    for keyword in snapback4_lang::guide::KEYWORDS {
        let (code, full) = guide(&[keyword, "--full"]);
        assert_eq!(code, Some(0), "{keyword}");
        let card = snapback4_lang::guide::card(keyword).unwrap();
        assert_eq!(full.trim_end().lines().count(), card.trim_end().lines().count(), "{keyword} --full prints the whole card");
        let (_, default) = guide(&[keyword]);
        if card.lines().count() <= snapback4_lang::guide::FULL_LINES || snapback4_lang::guide::sections(card).is_empty() {
            assert_eq!(default, full, "{keyword}: a short card prints whole");
        } else {
            assert!(default.lines().count() <= 70, "{keyword}: the overview fits a tool window ({} lines)", default.lines().count());
            // Wave 4: the title, then how to read more (a short opening once read as the whole card), then the lead.
            let (title, rest) = full.split_once('\n').unwrap();
            let (hint, rest_of_default) = default.strip_prefix(&format!("{title}\n")).and_then(|d| d.split_once('\n')).unwrap_or_else(|| panic!("{keyword}: the overview opens with the title: {default}"));
            assert!(hint.contains(&format!("snapback4 guide {keyword} --section <number or words> prints one section")) && hint.contains("--find") && hint.contains("--full"), "{keyword}: the second line says how to read more: {hint}");
            assert!(rest_of_default.starts_with(rest.split("\n\n").next().unwrap()), "{keyword}: the overview continues with the lead");
            assert!(default.contains(&format!("snapback4 guide {keyword} --section <number or words>")) && default.contains("--full prints all"), "{keyword}: {default}");
        }
    }
    // Sections resolve by number, any case, prefix and words; a miss names what mentions the words.
    let (_, by_name) = guide(&["types", "--section", "Engine-assigned per-parent sequences"]);
    for words in ["6", "ENGINE-ASSIGNED", "per-parent", "engine sequences"] {
        assert_eq!(guide(&["types", "--section", words]), (Some(0), by_name.clone()), "{words}");
    }
    // Wave 4: a topic word no heading names prints the section holding most of
    // its mentions, or every mention when they spread; only an unmentioned word refuses.
    let (code, topic) = guide(&["types", "--section", "Integer"]);
    assert_eq!(code, Some(0), "{topic}");
    assert!(topic.starts_with("No heading of guide types is named \"Integer\"; ") && topic.contains("an integer within") && !topic.contains("## Tables"), "{topic}");
    let (code, audience) = guide(&["sync", "--section", "audience"]);
    assert_eq!(code, Some(0), "{audience}");
    assert!(audience.contains("\n\n# Sync") && audience.contains("audience"), "{audience}");
    let (code, spread) = guide(&["client", "--section", "React"]);
    assert_eq!(code, Some(0), "{spread}");
    assert!(spread.contains("its mentions span") && spread.contains("snapback4/react") && !spread.contains("nearest heading"), "{spread}");
    let (code, near) = guide(&["types", "--section", "Detials"]);
    assert_eq!(code, Some(1));
    assert!(near.contains("nearest heading: 2. Details") && near.contains("no line mentions it"), "{near}");
    let (code, either) = guide(&["types", "--find", "E_OVERFLOW|E_DIV_ZERO"]);
    assert_eq!(code, Some(0));
    assert!(either.contains("E_OVERFLOW") && either.contains("E_DIV_ZERO"), "{either}");
    let (code, opening) = guide(&["actions", "--section", "opening"]);
    assert_eq!(code, Some(0));
    assert!(opening.starts_with("# Actions") && !opening.contains("\n## "), "{opening}");
    let (code, found) = guide(&["language", "--find", "day("]);
    assert_eq!(code, Some(0));
    assert!(found.contains("Details") && found.contains(": query today():"), "{found}");
    assert_eq!(guide(&["language", "--find", "no such words anywhere"]).0, Some(1));
}

// Wave 4: the recipes card's cases are what `test` answers against its schemas.
#[test]
fn the_recipes_cards_cases_pass_against_their_schemas() {
    let card = snapback4_lang::guide::card("recipes").unwrap();
    let fenced = |text: &str, tag: &str| -> Vec<String> {
        text.split(&format!("```{tag}\n")).skip(1).map(|rest| rest.split_once("\n```").unwrap().0.to_owned()).collect()
    };
    for (heading, fixtures) in [
        ("## Roles", vec![("tickets", r#"{"id":"t1","author":"dev:bob","title":"Leaky tap"}"#)]),
        ("## Two parties", vec![("listings", r#"{"id":"l1","seller":"dev:alice","title":"Bike","price":12000}"#)]),
        ("## Booking", vec![("slots", r#"{"id":"s1","host":"dev:alice","startsAt":4102444800000,"seats":1}"#)]),
    ] {
        let section = card.split_once(heading).unwrap().1.split("\n## ").next().unwrap();
        let p = Project::new();
        p.source(&fenced(section, "quarry")[0]);
        fs::create_dir(p.0.join("fixture")).unwrap();
        let jsonl = fenced(section, "jsonl");
        // The roles recipe seeds its first admin with the card's own fixture row.
        if heading == "## Roles" { fs::write(p.0.join("fixture/roles.jsonl"), format!("{}\n", jsonl[0])).unwrap(); }
        for (table, row) in fixtures { fs::write(p.0.join(format!("fixture/{table}.jsonl")), format!("{row}\n")).unwrap(); }
        let cases = jsonl.last().unwrap();
        fs::write(p.0.join("fixture/test.cases.jsonl"), format!("{cases}\n")).unwrap();
        let output = p.run(&["test", "--fixture", "fixture"]);
        let text = String::from_utf8_lossy(&output.stdout);
        assert!(output.status.success(), "{heading}: {text}{}", String::from_utf8_lossy(&output.stderr));
        assert!(text.contains(&format!("cases: {} passed, 0 failed", cases.lines().count())), "{heading}: {text}");
    }
}
