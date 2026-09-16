//! check's read-only assessment of the active dev generation and its rows.
use snapback4_core::{Engine, Store, wire};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

const SOURCE: &str = "table messages:\n  body: text <=100\n  read <- allow\nquery all():\n  return messages[] first 10 by byId\n";
const BIN: &str = env!("CARGO_BIN_EXE_snapback4");

#[test]
fn w10c_check_hides_only_the_redundant_operation_cascade() {
    let p = Project::new();
    p.source("query apiHistory():\n  return messages where .body = 'hello'\n");
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
    p.source("query apiHistory():\n  return messages where .body = 'hello'\n  return exists 1\n  return 1\njob empty():\n  x = 1\n");
    fs::write(p.0.join("snapback/other.q"), "query apiHistory():\n  return messages where .body = 'bye'\n").unwrap();
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
    let search = format!("{}\nquery searchAll(q: text <=100, c: cursor ?):\n  return merge messages matching q after c last 20 by byRoomWords:\n    [m.roomId] for m in members[viewer] first 1000 by byPrincipalRoom\n", include_str!("../../snapback4-sim/tests/search_merge/schema.q"));
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
fn w10a_repeated_notes_explain_once_under_the_first_occurrence() {
    let p = Project::new();
    for count in [1, 2, 20] {
        let source = format!("table messages:\n  body: text <=100\n  read <- allow\n{}", (0..count).map(|i| format!("query page{i}():\n  return messages first 10 by byId\n")).collect::<String>());
        p.source(&source);
        let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
        assert!(bound.diagnostics.is_empty());
        assert_eq!(bound.notes.len(), count);
        let explanation = bound.notes[0].explanation().unwrap();
        for _ in 0..2 {
            let output = p.run(&["check"]);
            assert!(output.status.success(), "{output:?}");
            let text = String::from_utf8(output.stdout).unwrap();
            assert_eq!(text.matches("note: ").count(), count);
            assert_eq!(text.matches("  guide: reads").count(), count);
            let excerpts = usize::from(count >= 2);
            assert_eq!(text.matches("Full card: snapback4 guide reads").count(), excerpts, "{text}");
            if count >= 2 {
                assert!(text.contains(&format!("note: {}\n\n{explanation}\n\nnote: {}", bound.notes[0], bound.notes[1])), "{text}");
                assert!(explanation.contains("Read.cut") && explanation.contains("Read.meter"), "the unvisited reads card must reach the builder: {explanation}");
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
    let mut expected = String::new();
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
    expected.push_str(&format!("check: {} problems\n", bound.diagnostics.len()));
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
        ("N_NO_CURSOR", "reads", "`complete: false` with no `next` (N_NO_CURSOR)"),
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
fn w9b_why_without_a_section_prints_the_card_opening() {
    let p = Project::new();
    let output = p.run(&["why", "E_STORE"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{} bytes\n{text}", text.len());
    assert!(text.contains("No dedicated section for E_STORE; opening of guide refusals:"), "{text}");
    assert!(text.contains("Every refusal is `{ code, family, message, detail?, site?, rewrite?, guide?, rule?,"), "{text}");
    assert!(text.ends_with("Full card: snapback4 guide refusals\n"));
    assert!(text.len() <= 4096);
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
    assert!(text.contains("scan messages by byId: online only (site schema.q:5:10 (messages[]))"), "{text}");
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
    assert_eq!(message, "2 synced maintains:\n  maintain likeCounts: sync public inherited from likes; one value row per postId reaches every device; createPost, like, repost would stop predicting if likeCounts goes `online only` (site schema.q:10:1)\n  maintain ownerCounts: sync public inherited from likes; one value row per owner reaches every device; no currently eligible mutation reads it (site schema.q:24:1)");
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
fn r3_cost_and_why_name_the_lane_local_word_bound() {
    let p = Project::new();
    p.source(include_str!("../../snapback4-sim/tests/search_merge/round3.q"));
    for args in [vec!["check", "--cost"], vec!["why", "matching"]] {
        let output = p.run(&args);
        assert!(output.status.success(), "{output:?}");
        let text = String::from_utf8(output.stdout).unwrap();
        assert!(text.contains("past 32 words a lane is incomplete (word_cut_at names it), later lanes continue; meter ceilings remain query-wide"), "{text}");
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
    assert_eq!(text, "schema.q:3:3 — E_ADOPT: column messages.at is added as required with default now; existing rows would read the adoption's clock\n  rewrite: at: time ? or at: time default <literal>; otherwise backfill existing rows before making the column required\n  guide: types\n\ncheck: 1 problem\n");
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
    let reason: String = serde_json::from_str(text.split_once("reason=").unwrap().1.trim()).unwrap();
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
    assert!(stdout.contains("cards: language, types"), "{stdout}");
    assert!(output.stderr.is_empty());
}

#[test]
fn guide_lists_aliases_and_resolves_them_on_stdout() {
    let output = Command::new(BIN).arg("guide").output().unwrap();
    assert!(output.status.success());
    let stdout = String::from_utf8_lossy(&output.stdout);
    assert!(stdout.contains("cards: language, types"), "{stdout}");
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
            let lines: Vec<_> = text.lines().filter(|line| line.contains("never predict:")).collect();
            if count == 0 { assert!(lines.is_empty()); } else {
                let names = if count == 1 { "like (reads online-only maintain likeCounts)" } else { "createPost (reads online-only maintain likeCounts), like (reads online-only maintain likeCounts), repost (reads online-only maintain likeCounts)" };
                assert_eq!(lines, [format!("{count} mutations never predict: {names} — snapback4 why <op>")]);
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
    let output = p.run(&["check", "--residency"]);
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    println!("{text}");
    assert!(!text.contains("current store measurement:") && !text.contains("before adoption"), "{text}");
    assert_eq!(text.matches("N_MAINTAIN_SYNCED:").count(), 1);
    assert!(text.contains("maintain likeCounts:") && text.contains("maintain ownerCounts:"));
    assert!(text.contains("measure cold rows with `snapback4 test --residency`"));
    assert!(text.contains("createPost, like, repost would stop predicting"));
    let output = p.run(&["test", "--residency", "--as", "alice"]);
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
    assert_eq!(first["notes"].as_array().unwrap().len(), 4);
    let summary = first["predictionSummary"].as_str().unwrap();
    assert!(summary.contains("chat.send (messages[messageId] (chat.q:83:22))"), "{summary}");
    for _ in 0..3 {
        let next = p.run(&["check", "--json"]);
        assert!(next.status.success(), "{next:?}");
        let next = parsed(&next);
        assert_eq!(next["notes"], first["notes"]);
        assert_eq!(next["predictionSummary"], first["predictionSummary"]);
        let text = p.run(&["check"]);
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
    let summary = "3 mutations never predict: createPost (writes online-only table ranked), like (writes online-only table ranked), repost (reads online-only maintain entryCounts) — snapback4 why <op>";
    for args in [vec!["check"], vec!["check", "--json"], vec!["check", "--residency"]] {
        let output = p.run(&args);
        assert!(output.status.success(), "{output:?}");
        if args.contains(&"--json") { assert_eq!(parsed(&output)["predictionSummary"], summary); }
        else { assert_eq!(String::from_utf8_lossy(&output.stdout).matches(summary).count(), 1); }
    }
    let output = p.run(&["why", "repost"]);
    assert!(String::from_utf8_lossy(&output.stdout).contains("remove `online only` from maintain entryCounts"));
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
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 mutations never predict: dispatch"));
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
const ADOPTION_SOURCE: &str = "table expiring:\n  expiresAt: time ?\n  by byExpiry: expiresAt\n  expire at .expiresAt\n  read <- allow\nquery version():\n  return 1\n";

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
    let run = p.run(&["run", "version", "--json"]); assert!(run.status.success(), "{run:?}");
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
fn w8c_watching_host_reopens_after_cli_adopts_the_pending_source() {
    let p = Project::new(); p.source(ADOPTION_SOURCE);
    let host = AdoptionHost::start(&p, true);
    unsafe { assert_eq!(libc::kill(host.child.id() as i32, libc::SIGSTOP), 0); }
    p.source(&ADOPTION_SOURCE.replace("return 1", "return 2"));
    let run = p.run(&["run", "version", "--json"]);
    unsafe { assert_eq!(libc::kill(host.child.id() as i32, libc::SIGCONT), 0); }
    assert!(run.status.success(), "{run:?}");
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
    wait_adoption(|| host.logs().contains("startup schema adoption failed") || host.child.try_wait().unwrap().is_some());
    conn.execute_batch("COMMIT").unwrap();
    assert!(host.logs().contains("no requests, jobs or sweeps are running; retrying automatically"), "{}", host.logs());
    let mut line = String::new(); BufReader::new(host.child.stdout.take().unwrap()).read_line(&mut line).unwrap();
    host.address = line.trim().trim_start_matches("http://").into();
    assert_eq!(host.query()["data"], 1);
    println!("adoption: startup_retries=1 recovered_generation=1 restarts=0");
}

#[test]
fn check_explains_held_dispatch_and_generates_the_client_marker() {
    let p = Project::new();
    p.source("query heldValue() held:\n  return [1, 2]\n");
    let checked = p.run(&["check"]);
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
    for args in [vec!["test"], vec!["test", "--fixture", fixture.to_str().unwrap()], vec!["test", "--residency", "--fixture", fixture.to_str().unwrap()]] {
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
    let positive = "    horizon-free source coverage — all sources sync without a horizon; answer completeness still depends on runtime authorization, limits and continuation";
    for horizon in [false, true] {
        p.source(&if horizon { source.replacen("  sync\n", "  sync last 20 by byId\n", 1) } else { source.into() });
        for args in [vec!["check"], vec!["check", "--cost"], vec!["check", "--residency"], vec!["why", "heldRows"]] {
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
    let checked = p.run(&["check"]);
    assert!(checked.status.success());
    let text = String::from_utf8(checked.stdout).unwrap();
    println!("{text}");
    assert!(text.contains("N_NO_CURSOR") && text.contains("still needs continuation"), "{text}");
    assert!(!text.contains("or declare `cap"), "{text}");
    p.source(&SOURCE.replace("query all():", "query all(c: cursor ?):").replace("messages[] first", "messages[] after c first"));
    assert!(!String::from_utf8_lossy(&p.run(&["check"]).stdout).contains("N_NO_CURSOR"));
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
