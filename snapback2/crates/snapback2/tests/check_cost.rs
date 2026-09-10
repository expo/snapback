mod common;
use common::{Project, json_stdout};
use std::fs;

fn poll_fixture() -> Project {
    let project = Project::new();
    assert!(project.init("todos", "none").status.success());
    fs::write(project.path.join("snapback/schema.q"), r#"use identity
table polls:
  owner: principal
  title: text <=20
  by byOwner: owner, id
  cap 10000 by owner
  immutable owner
  read <- .owner = viewer
  insert <- allow
  update <- allow
  delete <- allow
table votes:
  poll: polls
  public 'votes'
  insert <- allow
  update <- allow
  delete <- allow
maintain tallies: count votes by poll
  read <- allow
"#).unwrap();
    fs::write(project.path.join("snapback/seed.ts"), "import { seed } from 'snapback2'; export default seed({ personas: ['alice'], rows: {} });\n").unwrap();
    fs::remove_dir_all(project.path.join("snapback/tests")).unwrap();
    project
}

// @ref LLP 1020#a7-two-reproductions-before-any-ruling — the M7 poll tally: a maintained point
// read in a page shape admits; only a structural sink over the capped-only page refuses.
#[test]
fn m7_poll_tally_reproduction_records_capped_only_refusal() {
    let project = poll_fixture();
    // `polls[] first 20 by byId` is capped-only: `.owner = viewer` is not uniform over an empty
    // prefix. The M7 leg's `#pollTallies[...]` parsed as an aggregate (a structural count) before
    // LLP 1011 B2 deleted `#`; today's `tallies[.id]` lowers to a Get, which is never structural.
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  page = polls[] first 20 by byId\n  return page { *, tally: tallies[.id] }\n").unwrap();
    let before = project.run(&["check", "--json"]);
    assert!(before.status.success(), "{}", String::from_utf8_lossy(&before.stdout));
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  page = polls[] first 20 by byId\n  return { rows: page { *, tally: tallies[.id] }, count: count(page) }\n").unwrap();
    let refused = project.run(&["check", "--json"]);
    let text = String::from_utf8_lossy(&refused.stdout).into_owned();
    assert!(!refused.status.success());
    let refusal: serde_json::Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(refusal["code"], "E_STRUCTURAL_COUNT");
    assert_eq!(refusal["message"], "returned result depends on capped-only site todos.list.0; its read rule is not uniform over the scanned prefix");
    assert_eq!(refusal["rewrite"], "query list():\n-- returned result depends on capped-only site todos.list.0; its read rule is not uniform over the scanned prefix");
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  page = polls[viewer] first 20 by byOwner\n  return { rows: page { *, tally: tallies[.id] }, count: count(page) }\n").unwrap();
    let repaired = project.run(&["check", "--json"]);
    assert!(repaired.status.success(), "{}", String::from_utf8_lossy(&repaired.stdout));
}

// @ref LLP 1020#a7-two-reproductions-before-any-ruling — the M7 bulk job: `wordPrefixes(body)`
// re-derivation was charged on every updated messages row; it is now charged only when the
// patch writes a column the search index reads, and a body rewrite still needs a smaller chunk.
#[test]
fn m7_bulk_job_prices_derivation_only_for_patches_that_write_a_derived_column() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    // Before this landing: E_STEPS, "steps 94517328 exceeds ceiling 1000000; product: derived
    // index work = 94515300 + ..." for a patch that never touches `body`.
    let job = |patch: &str, take: u32| format!("job touch():\n  chunk m in messages first {take} by byId:\n    update messages[m.id] {{ {patch} }}\n");
    fs::write(project.path.join("snapback/jobs.q"), job("expiresAt: m.at", 10)).unwrap();
    let admitted = project.run(&["check", "--json"]);
    assert!(admitted.status.success(), "{}", String::from_utf8_lossy(&admitted.stdout));
    let cost = json_stdout(&project.run(&["check", "--cost", "jobs.touch", "--json"]));
    // A job certificate carries its first chunk's meters; the chunk is the priced unit.
    assert_eq!(cost["results"][0]["certificate"]["derived_steps"], 0, "{cost}");

    fs::write(project.path.join("snapback/jobs.q"), job("body: m.body", 10)).unwrap();
    let refused = project.run(&["check", "--json"]);
    let text = String::from_utf8_lossy(&refused.stdout).into_owned();
    assert!(!refused.status.success());
    let refusal: serde_json::Value = serde_json::from_str(text.lines().next().unwrap()).unwrap();
    assert_eq!(refusal["code"], "E_STEPS");
    let message = refusal["message"].as_str().unwrap();
    assert!(message.contains("derived index work for messages Update × 10 = 9451530 + "), "{message}");
    let cost = project.run(&["check", "--cost", "jobs.touch", "--json"]);
    assert!(!cost.status.success());
    let cost = json_stdout(&cost);
    assert!(cost["results"][0]["errors"].as_array().unwrap().iter().any(|error| error["message"] == message), "{cost}");
    assert_eq!(cost["results"][0]["certificate"]["derived_steps"], 9451530, "{cost}");

    fs::write(project.path.join("snapback/jobs.q"), job("body: m.body", 1)).unwrap();
    let rewritten = project.run(&["check", "--json"]);
    assert!(rewritten.status.success(), "{}", String::from_utf8_lossy(&rewritten.stdout));
}

#[test]
fn check_cost_has_priced_plan_for_admitted_and_refused_programs() {
    let project = poll_fixture();
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  return polls[viewer] first 20 by byOwner\n").unwrap();
    let cost = project.run(&["check", "--cost", "todos.list", "--json"]);
    assert!(cost.status.success(), "{}{}", String::from_utf8_lossy(&cost.stdout), String::from_utf8_lossy(&cost.stderr));
    let cost = json_stdout(&cost);
    let terms = cost["results"][0]["certificate"]["cost_terms"].as_array().unwrap();
    assert!(terms.iter().any(|term| term["site"].as_str().is_some_and(|site| cost["sources"][site]["line"] == 2)), "statement sources: {cost}");
    let prose = project.run(&["check", "--cost", "todos.list"]);
    let prose = String::from_utf8_lossy(&prose.stdout);
    assert!(prose.contains("snapback/todos.q:2"));
    assert!(prose.contains("ceilings\t10240\t10240\t10240\t1000000\t8388608\t1048576\t4194304\t2048"));

    // One declared maximum row fits, two exceed output. The report is generated
    // from this fixture's analyzer terms, including on the refused side.
    let schema = fs::read_to_string(project.path.join("snapback/schema.q")).unwrap().replace("title: text <=20", "title: text <=200000");
    fs::write(project.path.join("snapback/schema.q"), schema).unwrap();
    for take in [1, 2] {
        fs::write(project.path.join("snapback/todos.q"), format!("query list():\n  return polls[viewer] first {take} by byOwner\n")).unwrap();
        let regular = project.run(&["check", "--json"]);
        let cost = project.run(&["check", "--cost", "--json"]);
        assert_eq!(regular.status.success(), take == 1);
        assert_eq!(cost.status.success(), regular.status.success());
        let report = json_stdout(&cost);
        let result = &report["results"][0];
        assert!(result["certificate"].is_object(), "partial certificate missing: {report}");
        if take == 2 {
            let refusals: Vec<serde_json::Value> = String::from_utf8_lossy(&regular.stdout).lines().map(|line| serde_json::from_str(line).unwrap()).collect();
            for refusal in refusals {
                assert!(result["errors"].as_array().unwrap().iter().any(|error| error["message"] == refusal["message"]), "report/refusal disagreement: {report} vs {refusal}");
            }
            let refused = project.run(&["check", "--cost"]);
            let refused = String::from_utf8_lossy(&refused.stdout);
            assert!(refused.contains("partial certificate"));
            assert!(refused.contains(&format!("output bytes {} exceeds ceiling", result["certificate"]["max_output_bytes"])));
        }
    }
}

#[test]
fn named_lazy_merge_fixture_reconciles_every_term_and_preserves_source_lines() {
    let project = poll_fixture();
    let schema = fs::read_to_string(project.path.join("snapback/schema.q")).unwrap()
        .replace("read <- .owner = viewer", "public 'polls are public'")
        .replace("  by byOwner: owner, id\n", "  by byOwner: owner, id\n  by byTitle: title, id\n");
    fs::write(project.path.join("snapback/schema.q"), schema).unwrap();
    fs::write(project.path.join("snapback/todos.q"), "query merged():\n  page = merge polls first 20 by byTitle:\n    ['a']\n    ['b']\n  return page\n").unwrap();
    let cost = project.run(&["check", "--cost", "todos.merged", "--json"]);
    assert!(cost.status.success(), "{}", String::from_utf8_lossy(&cost.stdout));
    let report = json_stdout(&cost);
    let certificate = &report["results"][0]["certificate"];
    let terms = certificate["cost_terms"].as_array().unwrap();
    for (meter, field) in [("examined entries", "max_examined"), ("index entries", "max_index_entries"), ("rule probes", "max_rule_probes"),
        ("steps", "max_steps"), ("heap bytes", "max_heap_bytes"), ("output bytes", "max_output_bytes"), ("closure bytes", "max_closure_bytes")] {
        let sum: i128 = terms.iter().filter(|t| t["meter"] == meter).map(term_value).sum();
        assert_eq!(sum, i128::from(certificate[field].as_u64().unwrap()), "{meter}: {report}");
    }
    // The merge's own terms sit on the merge site, which the compiler spells as its location;
    // its heap work sits on the lowered statement, whose source is the same authored line.
    let heads = terms.iter().find(|t| t["source"].as_str().unwrap().contains("lanes heads")).unwrap_or_else(|| panic!("{report}"));
    assert_eq!(heads["site"], "snapback/todos.q:2:10", "{report}");
    let heap = terms.iter().find(|t| t["source"].as_str().unwrap().ends_with("heap work")).unwrap_or_else(|| panic!("{report}"));
    assert_eq!(report["sources"][heap["site"].as_str().unwrap()]["line"], 2, "{report}");
    let prose = String::from_utf8_lossy(&project.run(&["check", "--cost", "todos.merged"]).stdout).into_owned();
    assert!(prose.lines().any(|row| row.starts_with("  snapback/todos.q:2 merge snapback/todos.q:2:10: 2 lanes heads")), "{prose}");
    assert!(prose.lines().any(|row| row.starts_with("  snapback/todos.q:2 merge snapback/todos.q:2:10: heap work")), "{prose}");
}

/// A `--json` term value is a JSON integer, or a decimal string past 64-bit range (`snapback2 guide check`).
fn term_value(term: &serde_json::Value) -> i128 {
    match &term["value"] {
        serde_json::Value::Number(n) => n.as_i64().map(i128::from).or_else(|| n.as_u64().map(i128::from)).unwrap(),
        serde_json::Value::String(s) => s.parse().unwrap(),
        other => panic!("cost term value {other}"),
    }
}

#[test]
fn check_cost_attributes_a_shapes_nested_reads_to_the_shapes_authored_line() {
    let project = poll_fixture();
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  page = polls[viewer] first 20 by byOwner\n  return page { *, tally: tallies[.id] }\n").unwrap();
    let cost = project.run(&["check", "--cost", "todos.list", "--json"]);
    assert!(cost.status.success(), "{}", String::from_utf8_lossy(&cost.stdout));
    let cost = json_stdout(&cost);
    let terms = cost["results"][0]["certificate"]["cost_terms"].as_array().unwrap();
    let line = |term: &serde_json::Value| cost["sources"][term["site"].as_str().unwrap_or("")]["line"].clone();
    let source = |term: &serde_json::Value| term["source"].as_str().unwrap().to_owned();
    let nested: Vec<_> = terms.iter().filter(|term| source(term).contains("point read on tallies")).collect();
    assert!(!nested.is_empty(), "{cost}");
    for term in &nested { assert_eq!(line(term), 3, "{term}"); }
    // The shape's own expression work lands on the shape's line, not the query header.
    assert!(terms.iter().any(|term| source(term).starts_with("expressions") && line(term) == 3), "{cost}");
    assert!(terms.iter().any(|term| source(term).contains("todos.list.0 take 20") && line(term) == 2), "{cost}");
    let prose = String::from_utf8_lossy(&project.run(&["check", "--cost", "todos.list"]).stdout).into_owned();
    assert!(prose.lines().any(|row| row.starts_with("  snapback/todos.q:3 ") && row.contains("point read on tallies")), "{prose}");
}

#[test]
fn check_cost_refuses_unknown_and_ambiguous_operation_names() {
    let project = poll_fixture();
    fs::write(project.path.join("snapback/todos.q"), "query list():\n  return polls[viewer] first 20 by byOwner\n").unwrap();
    fs::write(project.path.join("snapback/extra.q"), "query list():\n  return polls[viewer] first 1 by byOwner\n").unwrap();
    for name in ["nope", "list"] {
        let refused = project.run(&["check", "--cost", name, "--json"]);
        let text = String::from_utf8_lossy(&refused.stdout).into_owned();
        assert_eq!(refused.status.code(), Some(2), "{name}: {text}");
        assert!(text.contains(&format!("cost operation {name} is unknown or ambiguous")), "{text}");
        assert!(text.contains("extra.list") && text.contains("todos.list"), "{text}");
    }
    assert!(project.run(&["check", "--cost", "todos.list", "--json"]).status.success());
}

#[test]
fn check_cost_reports_a_job_that_fails_analysis_as_unavailable() {
    let project = Project::new();
    assert!(project.init("chat", "none").status.success());
    // `byCreator` orders the sweep by a key a write can move: the only chunk fails
    // `E_JOB_CURSOR_INDEX`, so no chunk is priced and the plan is unavailable, not invented.
    fs::write(project.path.join("snapback/jobs.q"), "job retitle():\n  chunk c in conversations first 10 by byCreator:\n    update conversations[c.id] { title: c.title }\n").unwrap();
    let cost = project.run(&["check", "--cost", "jobs.retitle"]);
    let text = String::from_utf8_lossy(&cost.stdout).into_owned();
    assert!(!cost.status.success(), "{text}");
    assert!(text.contains("jobs.retitle (Job) — refused; partial certificate\n  priced plan unavailable: program could not be analyzed\n"), "{text}");
    assert!(text.contains("refused E_JOB_CURSOR_INDEX at <project>:jobs.retitle"), "{text}");
    let report = json_stdout(&project.run(&["check", "--cost", "jobs.retitle", "--json"]));
    assert!(report["results"][0]["certificate"].is_null(), "{report}");
    assert!(report["results"][0]["errors"].as_array().unwrap().iter().any(|error| error["code"] == "E_JOB_CURSOR_INDEX"), "{report}");
}
