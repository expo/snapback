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
    assert_eq!(refusal["rewrite"], "query list():\n-- returned result depends on capped-only site todos.list.0; its read rule is not uniform over the scanned prefix\n-- checker repair: denormalize the authorization scope onto polls and include it in the byId prefix so the rule is uniform, or declare maintain totals: count polls by <scope> and read the maintained aggregate");
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

// @ref LLP 1018.008.008.000#l2--explain-width-and-multiplicity-with-the-existing-analyzer —
// the retained day-two query and its four table declarations, with unrelated
// writers/logs removed. The optional timestamp is not selected into the output.
#[test]
fn day_two_optional_timestamp_prices_full_rows_separately_from_projections() {
    let project = poll_fixture();
    fs::remove_file(project.path.join("snapback/todos.q")).unwrap();
    let schema = r#"use identity password
table profiles:
  bucket: int ?
  at: time ?
  principal: principal
  displayName: text 1..50
  handle: text 3..20 format handle
  avatar: image <=10000000 ?
  bio: text <=200
  location: text <=50
  link: text <=2048 format url ?
  by byNameSearchAt: wordPrefixes(displayName), at, id
  by byHandleSearchAt: wordPrefixes(handle), at, id
  by byNameSearch: wordPrefixes(displayName), id
  by byHandleSearch: wordPrefixes(handle), id
  unique byPrincipal: principal
  unique byHandle: handle
  immutable principal
  public 'profiles are public'
  insert <- .principal = viewer
  update <- .principal = viewer
  delete <- deny
table conversations:
  messageCount: int
  bucket: int ?
  title: text 1..50
  description: text <=200
  accent: text <=20 ?
  background: image <=10000000 ?
  disappearing: enum('off', '24h', '7d') ?
  kind: enum('dm', 'group')
  clientId: text <=100
  creatorId: principal
  unique byCreatorClient: creatorId, clientId
  by byCreator: creatorId
  unique byIdCreator: id, creatorId
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  update <- exists memberships[.id, viewer]
  delete <- deny
  after insert <- exists memberships[.id, .creatorId, 'admin']
table memberships:
  bucket: int ?
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  deliveredAt: time ?
  readAt: time ?
  joinedAt: time
  unique byConversationPrincipal: conversationId, principal
  by byConversationPrincipalRole: conversationId, principal, role
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal, joinedAt
  read <- exists memberships[.conversationId, viewer]
  insert <- (exists memberships[.conversationId, viewer, 'admin'] or (.principal = viewer and .role = 'admin' and created conversations[.conversationId, viewer]))
  update (old, next) <- (exists memberships[old.conversationId, viewer, 'admin'] and old.role = 'member' and next.role = 'admin' or (old.principal = viewer and next.role = old.role))
  delete <- (.principal = viewer or exists memberships[.conversationId, viewer, 'admin'])
table messages:
  pollOptions: [text 1..50] <=4 ?
  digestPeriodIndex: int ?
  by byDigestPeriod: digestPeriodIndex, id
  immutable digestPeriodIndex
  digestEligible: bool ?
  bucket: int ?
  conversationId: conversations
  authorId: principal
  body: text <=2000 ?
  clientId: text <=100
  replyTo: messages ?
  edited: bool ?
  deleted: bool ?
  photo: image <=10000000 ?
  clip: video <=50000000 ?
  viewOnce: bool ?
  oncePhoto: image <=10000000 once ?
  expiresAt: time ?
  at: time
  unique byAuthorClient: authorId, clientId
  by byConvTime: conversationId, at, id
  by bySearch: conversationId, wordPrefixes(body), at, id
  immutable conversationId, authorId
  retain delivered-history
  read <- exists memberships[.conversationId, viewer]
  insert <- (.authorId = viewer and exists memberships[.conversationId, viewer])
  update <- .authorId = viewer
  delete <- .authorId = viewer
"#;
    let query = "query searchAll(term: text <=128, c: cursor ?):\n  page = merge messages after c last 20 by bySearch:\n    [m.conversationId, term] for m in memberships[viewer] first 100 by byPrincipalConversation\n  return page { id, conversationId, authorId, body, at, conversation: conversations[.conversationId] { title }, sender: profiles[.authorId] { displayName, handle } }\n";
    let pooled_query = format!("{}  return page\n", query.split("  return page").next().unwrap().replace("query searchAll(", "query search("));
    fs::write(project.path.join("snapback/messages.q"), query).unwrap();
    let mut previous = None;
    for (edited, page, expected) in [(false, 20, 4_188_952), (true, 20, 4_199_688), (true, 19, 4_110_036)] {
        fs::write(project.path.join("snapback/schema.q"), if edited {
            schema.replace("  edited: bool ?", "  edited: bool ?\n  editedAt: time ?")
        } else { schema.to_owned() }).unwrap();
        fs::write(project.path.join("snapback/messages.q"), format!("{}\n{pooled_query}", query.replace("last 20", &format!("last {page}")))).unwrap();
        let ordinary = project.run(&["check", "--json"]);
        let inspected = project.run(&["check", "--cost", "messages.searchAll", "--json"]);
        assert_eq!(ordinary.status.success(), !edited || page == 19);
        assert_eq!(inspected.status.success(), ordinary.status.success());
        let report = json_stdout(&inspected);
        let certificate = &report["results"][0]["certificate"];
        assert_eq!(certificate["max_closure_bytes"], expected, "{report}");
        let terms = certificate["cost_terms"].as_array().unwrap();
        for (meter, key) in [("closure bytes", "max_closure_bytes"), ("output bytes", "max_output_bytes")] {
            assert_eq!(terms.iter().filter(|t| t["meter"] == meter).map(term_value).sum::<i128>(),
                certificate[key].as_u64().unwrap().into(), "{meter}: {report}");
        }
        if !edited { previous = Some(certificate.clone()); }
        if edited && page == 20 {
            let old = previous.as_ref().unwrap();
            assert_eq!(certificate["max_output_bytes"], old["max_output_bytes"]);
            assert_eq!(certificate["max_steps"], old["max_steps"]);
            assert_eq!(certificate["max_rule_probes"], old["max_rule_probes"]);
            let field = terms.iter().find(|t| t["meter"] == "closure bytes" && t["source"].as_str().unwrap().contains("messages.editedAt")).unwrap();
            assert_eq!(term_value(field), 244 * 44, "{field}");
            assert!(field["source"].as_str().unwrap().contains("244 × messages.editedAt (44 bytes each; 12 field-name/framing + max(time 32, null reserve 8))"), "{field}");
            assert_eq!(field["site"], "snapback/messages.q:2:10");
            let prose = String::from_utf8_lossy(&project.run(&["check", "--cost", "messages.searchAll"]).stdout).into_owned();
            assert!(prose.lines().any(|line| line.starts_with("  snapback/messages.q:2 244 × messages.editedAt")), "{prose}");
            let refusal = &report["results"][0]["errors"][0];
            assert!(refusal["rewrite"].as_str().unwrap().contains("valid continuation that the client follows"));
            let pooled = json_stdout(&project.run(&["check", "--cost", "messages.search", "--json"]));
            let certificate = &pooled["results"][0]["certificate"];
            let terms = certificate["cost_terms"].as_array().unwrap();
            let field = terms.iter().find(|t| t["meter"] == "closure bytes" && t["source"].as_str().unwrap().contains("messages.editedAt")).unwrap();
            assert_eq!(term_value(field), 122 * 44, "{pooled}");
            assert!(terms.iter().any(|t| t["source"].as_str().unwrap().contains("separately serialized rule verdict/absence envelopes")), "{pooled}");
            assert_eq!(terms.iter().filter(|t| t["meter"] == "closure bytes").map(term_value).sum::<i128>(),
                certificate["max_closure_bytes"].as_u64().unwrap().into());
        }
    }
}

#[test]
fn cost_refusal_keeps_schedule_targets_when_certifying_other_operations() {
    let project = poll_fixture();
    let schema = fs::read_to_string(project.path.join("snapback/schema.q")).unwrap().replace("title: text <=20", "title: text <=200000");
    fs::write(project.path.join("snapback/schema.q"), schema).unwrap();
    fs::write(project.path.join("snapback/todos.q"), "query tooWide():\n  return polls[viewer] first 2 by byOwner\nmutation tick():\n  return null\nschedule recurring every 1m: tick()\n").unwrap();
    let report = json_stdout(&project.run(&["check", "--cost", "--json"]));
    let results = report["results"].as_array().unwrap();
    let refused = results.iter().find(|r| r["program"] == "todos.tooWide").unwrap();
    assert_eq!(refused["admitted"], false);
    assert!(refused["errors"].as_array().unwrap().iter().all(|e| e["code"] == "E_BOUND"), "{report}");
    assert!(results.iter().filter(|r| r["program"] != "todos.tooWide").all(|r| r["admitted"] == true), "{report}");
}
