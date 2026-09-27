//! Retained 0.2.6 Astra Clique shapes, embedded rather than read from a lane.
//! LLP 3000.007 §6: inference changes spelling, never the delivered audience.
use snapback4_core::{Context, Engine, Value, Ceilings};
use snapback4_core::rows::{MemoryRows, Rows};
use snapback4_core::schema::{Audience, SiteClass};
use snapback4_core::value::object;
use snapback4_lang::{Bound, bind::residency};
use std::collections::BTreeMap;
#[path = "common/held_coverage.rs"] mod held_coverage;

const CLIQUE: &str = r#"
use personas alice, bob
table profiles:
  principal: principal
  displayName: text <=50
  unique byPrincipal: principal
  public 'profile cards'
  sync public
table conversations:
  creatorId: principal
  read <- exists memberships[.id, viewer]
  insert <- .creatorId = viewer
  sync to memberships[.id]
table memberships:
  conversationId: conversations
  principal: principal
  role: enum('member', 'admin')
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal
  read <- exists memberships[.conversationId, viewer]
  insert <- exists memberships[.conversationId, viewer] or created conversations[.conversationId]
  sync to memberships[.conversationId]
table messages:
  conversationId: conversations
  senderId: principal
  text: text <=2000
  sequence: int
  at: time
  by byConversationTime: conversationId, sequence, id
  read <- exists memberships[.conversationId, viewer]
  insert <- .senderId = viewer and exists memberships[.conversationId, viewer]
  sync to memberships[.conversationId] last 2 by byConversationTime
table dmPairs:
  low: principal
  high: principal
  conversationId: conversations
  unique byPair: low, high
  read <- .low = viewer or .high = viewer
  insert <- .low = viewer or .high = viewer
  online only
table receipts:
  principal: principal
  at: time
  by byPrincipal: principal, at, id
  read <- .principal = viewer
  sync to .principal last 2 by byPrincipal
table posts:
  authorId: principal
  at: time
  by byTime: at, id
  public 'public posts'
  sync public last 2 by byTime
table repostEdges:
  actorId: principal
  postId: posts
  at: time
  unique byActorPost: actorId, postId
  by byTime: at, id
  by byPost: postId, id
  public 'public repost edges'
  insert <- .actorId = viewer
  sync public last 2 by byTime
maintain activeRepostCounts: count repostEdges by postId
  read <- allow
query history(conversationId: conversations, c: cursor ?):
  return messages[conversationId] after c last 2 by byConversationTime
query me():
  return profiles[principal = viewer]
query dm(other: principal):
  return dmPairs[other, viewer]
query presence(other: principal):
  return exists connected[other]
query nativeCard(): native
mutation send(id: id, conversationId: conversations, text: text <=2000):
  require exists memberships[conversationId, viewer] else NOT_MEMBER
  insert messages { id, conversationId, senderId: viewer, text, sequence: 1, at: now }
  return { id }
mutation createDM(id: id, other: principal, conversationId: conversations):
  insert dmPairs { id, low: viewer, high: other, conversationId }
  return { id }
"#;
fn compile(source: &str) -> Bound {
    let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{}", bound.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n"));
    bound
}
fn id(value: &str) -> Value { Value::Id(value.into()) }
fn engine(bound: &Bound) -> Engine { Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone()).filter(|p| !p.native)).unwrap() }
fn inferred() -> String {
    CLIQUE.replace("sync public", "sync").replace("sync to memberships[.id]", "sync").replace("sync to memberships[.conversationId]", "sync").replace("sync to .principal", "sync")
}

fn held_coverage_case(case: &str, op: &str, complete: bool, count: usize, covered: bool) {
    let bound = compile(&held_coverage::source(case));
    let mut engine = engine(&bound);
    engine.seed(held_coverage::seed()).unwrap();
    let (events, _) = engine.snapshot_at("alice", 1000).unwrap();
    let rows = MemoryRows::new();
    for event in events { if let Some(row) = event.data { rows.put(&event.table, &bound.schema.tables[&event.table], &row, None).unwrap(); } }
    let args = if op == "searchHeld" { BTreeMap::from([("q".into(), Value::String("cof".into())), ("c".into(), Value::Null)]) } else { BTreeMap::new() };
    let program = &bound.programs.iter().find(|p| p.program.name == op).unwrap().program;
    let read = snapback4_core::engine::local::query(&rows, &bound.schema, program, Context::new("alice", args).at(1000), Ceilings::default()).unwrap();
    assert_eq!(read.complete, complete, "{read:?}");
    assert_eq!(read.data.as_array().unwrap().len(), count);
    assert!(read.capped_at.is_none() && read.word_cut_at.is_none());
    held_coverage::assert_line(&bound.schema, op, covered);
}

#[test]
fn w9r1a_temporary_audience_coverage_does_not_promise_completeness() {
    held_coverage_case("temporary", "searchHeld", false, 2, true);
}

#[test]
fn w9r1a_truncated_held_page_coverage_does_not_promise_completeness() {
    held_coverage_case("full", "firstHeld", true, 1, true);
}

#[test]
fn w9r1a_clique_source_coverage_has_nonvacuous_positive_and_negative_controls() {
    held_coverage_case("full", "searchHeld", true, 2, true);
    held_coverage_case("horizon", "searchHeld", false, 1, false);
    held_coverage_case("online", "searchHeld", false, 0, false);
    let bound = compile(&held_coverage::source("full"));
    assert!(bound.schema.operations["constantHeld"].sites.is_empty());
    held_coverage::assert_line(&bound.schema, "constantHeld", false);
}

fn nested_coverage_case(case: &str) {
    let bound = compile(&held_coverage::nested_source(case));
    let mut engine = engine(&bound);
    engine.seed(held_coverage::nested_seed()).unwrap();
    let (events, _) = engine.snapshot_at("alice", 1000).unwrap();
    let rows = MemoryRows::new();
    for event in events { if let Some(row) = event.data { rows.put(&event.table, &bound.schema.tables[&event.table], &row, None).unwrap(); } }
    let read = snapback4_core::engine::local::query(&rows, &bound.schema, &bound.programs[0].program, Context::new("alice", BTreeMap::new()).at(1000), Ceilings::default()).unwrap();
    held_coverage::assert_nested_read(&read, case);
    held_coverage::assert_nested(&bound.schema, case);
}

#[test]
fn w9r2_matching_online_source() { nested_coverage_case("online"); }
#[test]
fn w9r2_matching_horizon_source() { nested_coverage_case("horizon"); }
#[test]
fn w9r2_matching_full_source() { nested_coverage_case("full"); }

#[test]
fn w9r2_scan_modifier_sources() {
    use snapback4_core::ir::{self, Expr, IndexKeyExpr, Range, Stmt};
    let bound = compile(&held_coverage::nested_source("online"));
    let mut program = bound.programs[0].program.clone();
    let scans = ir::scans(&program);
    let outer = (*scans.iter().find(|scan| scan.table == "messages").unwrap()).clone();
    let nested = Expr::Scan((*scans.iter().find(|scan| scan.table == "terms").unwrap()).clone());
    let mut missing = Vec::new();
    for modifier in ["scalar", "matching", "where", "gt", "gte", "lt", "lte", "after", "before"] {
        let mut scan = outer.clone();
        scan.prefix.clear();
        let expr = Some(Box::new(nested.clone()));
        match modifier {
            "scalar" => scan.prefix.push(IndexKeyExpr::Scalar(nested.clone())),
            "matching" => scan.prefix.push(IndexKeyExpr::WordPrefix(nested.clone())),
            "where" => scan.filter = expr,
            "after" => scan.after = expr,
            "before" => scan.before = expr,
            _ => {
                let mut range = Range { gt: None, gte: None, lt: None, lte: None };
                match modifier { "gt" => range.gt = expr, "gte" => range.gte = expr, "lt" => range.lt = expr, "lte" => range.lte = expr, _ => unreachable!() }
                scan.range = Some(range);
            }
        }
        // Exercise IR traversal directly: Quarry currently lowers cursors only
        // to `after`, and the other slots have different runtime value types.
        program.body = vec![Stmt::Return(Expr::Scan(scan))];
        let fact = residency::execution(&bound.schema, &program);
        if !fact.sites.iter().any(|site| site.table == "terms" && site.class == SiteClass::Server) { missing.push(modifier); }
    }
    assert!(missing.is_empty(), "omitted scan sources: {missing:?}");
}

#[test]
fn clique_operations_have_words_sites_and_api_documentation() {
    let bound = compile(CLIQUE);
    assert_eq!(bound.schema.operations.len(), bound.programs.len());
    for (name, runs) in [("history", "device"), ("me", "device"), ("dm", "server"), ("presence", "server"), ("nativeCard", "server")] {
        assert_eq!(bound.schema.operations[name].runs.as_deref(), Some(runs));
    }
    assert_eq!(bound.schema.operations["send"].predicts.as_deref(), Some("eligible"));
    assert_eq!(bound.schema.operations["createDM"].predicts.as_deref(), Some("never"));
    assert!(bound.notes.iter().any(|note| note.code == "N_MAINTAIN_SYNCED" && note.message.contains("activeRepostCounts")));
    let api = snapback4_lang::emit::typescript(&bound);
    for text in ["runs: \"device\"", "runs: \"server\"", "predicts: \"eligible\"", "predicts: \"never\"", "Arguments:", "Result:", "Require codes: NOT_MEMBER"] { assert!(api.contains(text), "{text}: {api}"); }
    let programs = snapback4_lang::emit::backend_programs(&bound);
    assert_eq!(programs.iter().find(|p| p["name"] == "dm").unwrap()["runs"], "server");
}

#[test]
fn a_new_id_guard_warns_without_falsely_removing_eligibility_and_names_the_runtime_key() {
    let before = compile(CLIQUE);
    let guarded = CLIQUE.replace("  insert messages {", "  require not exists messages[id] else DUPLICATE\n  insert messages {");
    let after = compile(&guarded);
    let fact = &after.schema.operations["send"];
    assert_eq!(fact.predicts.as_deref(), Some("eligible"));
    assert!(fact.sites.iter().any(|site| site.table == "messages" && site.index == "byId" && site.class == SiteClass::Horizon));
    let notes = residency::change_notes(&after, &before.schema.operations);
    assert!(notes.iter().any(|note| note.code == "N_NOT_PREDICTABLE" && note.message.contains("messages by byId") && note.message.contains("remains eligible")));
    assert!(residency::change_notes(&after, &after.schema.operations).is_empty());
    let rows = MemoryRows::new();
    let member = object([("id", id("a")), ("conversationId", id("c1")), ("principal", id("dev:alice")), ("role", Value::String("admin".into()))]);
    rows.put("memberships", &after.schema.tables["memberships"], &member, None).unwrap();
    let args = BTreeMap::from([("id".into(), id("not-held")), ("conversationId".into(), id("c1")), ("text".into(), Value::String("hi".into()))]);
    let call = Context::new("dev:alice", args.clone()).at(10);
    let program = |b: &Bound| b.programs.iter().find(|p| p.program.name == "send").unwrap().program.clone();
    let why = snapback4_core::engine::local::predict(&rows, &after.schema, &program(&after), call, Ceilings::default()).unwrap_err().refusal();
    assert_eq!(why.code, "E_PREDICT");
    for text in ["messages", "byId", "not-held", "site"] { assert!(why.message.contains(text), "{why:?}"); }
    // A device host rolls the failed prediction back before another call.
    let held = rows.get("messages", "not-held").unwrap().unwrap();
    rows.delete("messages", &after.schema.tables["messages"], &held).unwrap();
    // The same mutation without its redundant absence check predicts.
    snapback4_core::engine::local::predict(&rows, &before.schema, &program(&before), Context::new("dev:alice", args).at(10), Ceilings::default()).unwrap();
}

// A final-exists proof that runs out of budget while establishing device
// coverage is the device's uncertainty: queue (E_PREDICT), never a refusal.
#[test]
fn a_final_exists_proof_that_exhausts_the_meter_queues_instead_of_refusing() {
    let source = "table members:\n  group: id\n  principal: principal\n  unique byGroupPrincipal: group, principal\n  by byPrincipalGroup: principal, group, id\n  read <- .principal = viewer\n  insert <- deny\n  sync\ntable targets:\n  group: id\n  name: text <=10\n  unique byGroupName: group, name\n  read <- exists members[.group, viewer]\n  insert <- exists members[.group, viewer]\n  sync to members[.group]\ntable sources:\n  owner: principal\n  group: id\n  name: text <=10\n  by byOwner: owner, id\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  after insert <- exists targets[.group, .name]\n  sync\nmutation add(group: id, name: text <=10):\n  insert sources { owner: viewer, group, name }\n";
    let bound = compile(source);
    let program = bound.programs.iter().find(|p| p.program.name == "add").unwrap().program.clone();
    let rows = MemoryRows::new();
    let args = BTreeMap::from([("group".into(), id("g2")), ("name".into(), Value::String("x".into()))]);
    let tight = Ceilings { rule_probes: 0, ..Ceilings::default() };
    let why = snapback4_core::engine::local::predict(&rows, &bound.schema, &program, Context::new("dev:bob", args).at(10), tight).unwrap_err().refusal();
    assert_eq!(why.code, "E_PREDICT", "{why:?}");
}

#[test]
fn inference_preserves_all_three_audiences_and_the_cold_partition() {
    let explicit = compile(CLIQUE);
    let inferred = compile(&inferred());
    for (name, table, sync) in explicit.schema.synced() {
        assert_eq!(Some(sync), inferred.schema.tables[name].sync.as_ref(), "{name}");
        assert_eq!(table.rules, inferred.schema.tables[name].rules);
    }
    assert_eq!(inferred.schema.tables["receipts"].sync.as_ref().unwrap().audience, Audience::Column("principal".into()));
    let seed = vec![
        ("posts".into(), object([("id", id("p1")), ("authorId", id("dev:alice")), ("at", Value::Int(1))])),
        ("repostEdges".into(), object([("id", id("r1")), ("actorId", id("dev:alice")), ("postId", id("p1")), ("at", Value::Int(1))])),
        ("activeRepostCounts".into(), object([("id", id(&snapback4_core::schema::maintained_id(&[id("p1")]))), ("postId", id("p1")), ("value", Value::Int(1))])),
        ("dmPairs".into(), object([("id", id("dm")), ("low", id("dev:alice")), ("high", id("dev:bob")), ("conversationId", id("c1"))])),
    ];
    let mut one = engine(&explicit); let mut two = engine(&inferred);
    one.load(seed.clone()).unwrap(); two.load(seed).unwrap();
    for viewer in ["dev:alice", "dev:bob"] {
        let (a, _) = one.snapshot_at(viewer, 10).unwrap(); let (b, _) = two.snapshot_at(viewer, 10).unwrap();
        assert_eq!(a, b);
        assert!(a.iter().any(|e| e.table == "activeRepostCounts"));
        assert!(!a.iter().any(|e| e.table == "dmPairs"));
    }
}

#[test]
fn online_only_opts_a_maintain_out_and_class_changes_name_the_site() {
    let before = compile(CLIQUE);
    let source = CLIQUE.replace("maintain activeRepostCounts: count repostEdges by postId\n  read <- allow", "maintain activeRepostCounts: count repostEdges by postId\n  read <- allow\n  online only").replace("  sync public\n", "  online only\n").replace("  sync to memberships[.conversationId]\n", "  online only\n");
    let after = compile(&source);
    assert!(after.schema.tables["activeRepostCounts"].sync.is_none());
    assert!(!after.notes.iter().any(|note| note.code == "N_MAINTAIN_SYNCED"));
    let notes = residency::change_notes(&after, &before.schema.operations);
    assert!(notes.iter().any(|note| note.code == "N_NOW_SERVER" && note.message.contains("profiles")));
    assert!(notes.iter().any(|note| note.code == "N_NOT_PREDICTABLE" && note.message.contains("memberships")));
    let absent = compile(&CLIQUE.replace("  online only\n", ""));
    assert!(!absent.schema.tables["dmPairs"].residency.online_only);
    assert_eq!(absent.schema.tables["dmPairs"].sync, before.schema.tables["dmPairs"].sync);
}

#[test]
fn inference_refuses_noninvertible_rules_and_requires_an_ambiguous_recipient() {
    for read in [".principal = viewer or .principal = 'dev:alice'", ".principal = viewer and .at = 1"] {
        for sync in ["sync", "sync to .principal"] {
            let source = format!("table receipts:\n  principal: principal\n  at: time\n  by byPrincipal: principal, at, id\n  read <- {read}\n  {sync} last 2 by byPrincipal\n");
            let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
            assert!(bound.diagnostics.iter().any(|d| d.code == "E_SYNC"));
        }
    }
    let ambiguous = inferred().replace("table memberships:\n", "table memberships:\n  addedBy: principal\n");
    let bound = snapback4_lang::compile(&[("schema.q".into(), ambiguous.clone())]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.message.contains("by .principal")));
    compile(&ambiguous.replace("  sync\n", "  sync by .principal\n").replace("  sync last 2 by byConversationTime", "  sync by .principal last 2 by byConversationTime").replace("  public 'profile cards'\n  sync by .principal", "  public 'profile cards'\n  sync"));
    let mismatch = CLIQUE.replace("sync to .principal last", "sync public last");
    assert!(snapback4_lang::compile(&[("schema.q".into(), mismatch)]).diagnostics.iter().any(|d| d.code == "E_SYNC"));
}

#[test]
fn muse_membership_audience_iterations_compile_as_one_inference_edit() {
    // The minimal endpoint of Muse's E_SYNC loop: one existing membership
    // audience, no created-members disjunct in read, no restated sync target.
    let source = r#"
table conversations:
  creator: principal
  read <- exists members[.id, viewer]
  insert <- .creator = viewer
  sync
table members:
  conversationId: conversations
  principal: principal
  unique byConversationPrincipal: conversationId, principal
  by byPrincipal: principal, conversationId, id
  cap 50 by conversationId
  immutable conversationId, principal
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer] or created conversations[.conversationId]
  sync
mutation create():
  c = insert conversations { creator: viewer }
  insert members { conversationId: c.id, principal: viewer }
  return { id: c.id }
"#;
    let bound = compile(source);
    let mut engine = engine(&bound);
    let result = engine.mutate("create", Some("create"), Context::new("dev:alice", BTreeMap::new()).at(1).with_ids(["c1".into(), "m1".into()])).unwrap();
    assert!(matches!(result.state, snapback4_core::WriteState::Sent { .. }));
    assert_eq!(engine.snapshot_at("dev:alice", 2).unwrap().0.len(), 2);
    assert!(engine.snapshot_at("dev:bob", 2).unwrap().0.is_empty());
}

#[test]
fn server_sites_prevent_prediction_and_explicit_online_only_never_syncs() {
    let bound = compile(&format!("{CLIQUE}\nmutation seen():\n  require exists connected[viewer] else NOT_CONNECTED\n  return null\n"));
    let program = &bound.programs.iter().find(|p| p.program.name == "seen").unwrap().program;
    let why = snapback4_core::engine::local::predict(&MemoryRows::new(), &bound.schema, program, Context::new("dev:alice", BTreeMap::new()).at(1), Ceilings::default()).unwrap_err().refusal();
    assert_eq!(why.code, "E_PREDICT");
    assert!(why.message.contains("connected"));
    assert_eq!(bound.schema.operations["seen"].predicts.as_deref(), Some("never"));
    let malformed = format!("{CLIQUE}\nmaintain broken: count posts by missing\n  read <- allow\n");
    assert!(!snapback4_lang::compile(&[("schema.q".into(), malformed)]).diagnostics.is_empty());
    for source in ["table t:\n  public 't'\n  online only\n  sync\n", "table t:\n  public 't'\n  sync\n  online only\n"] {
        assert!(snapback4_lang::compile(&[("schema.q".into(), source.into())]).diagnostics.iter().any(|d| d.code == "E_SYNC"));
    }
}

#[test]
fn service_read_grants_preserve_the_device_audience_snapshot_and_stream_bytes() {
    let plain = inferred();
    for grants in [" or viewer = 'service:pusher'", " or viewer = 'service:pusher' or viewer = 'service:archive'"] {
        let extended = plain.replace("read <- exists memberships[.conversationId, viewer]", &format!("read <- exists memberships[.conversationId, viewer]{grants}"));
        let (before, after) = (compile(&plain), compile(&extended));
        let line = residency::table_line(&after.schema, "messages");
        assert!(line.contains("service grants:") && line.contains("service:pusher"), "{line}");
        for table in before.schema.tables.keys() { assert_eq!(before.schema.tables[table].sync, after.schema.tables[table].sync); }
        let (mut a, mut b) = (engine(&before), engine(&after));
        let seed = vec![
            ("conversations".into(), object([("id", id("c1")), ("creatorId", id("dev:alice"))])),
            ("memberships".into(), object([("id", id("member")), ("conversationId", id("c1")), ("principal", id("dev:alice")), ("role", Value::String("admin".into()))])),
            ("messages".into(), object([("id", id("m1")), ("conversationId", id("c1")), ("senderId", id("dev:alice")), ("text", Value::String("hi".into())), ("sequence", Value::Int(1)), ("at", Value::Int(1))])),
        ];
        a.seed(seed.clone()).unwrap(); b.seed(seed).unwrap();
        for viewer in ["dev:alice", "dev:bob", "dev:outsider"] {
            assert_eq!(serde_json::to_vec(&a.snapshot_at(viewer, 1000).unwrap()).unwrap(), serde_json::to_vec(&b.snapshot_at(viewer, 1000).unwrap()).unwrap());
            assert_eq!(serde_json::to_vec(&a.stream(viewer, 0, 1000).unwrap()).unwrap(), serde_json::to_vec(&b.stream(viewer, 0, 1000).unwrap()).unwrap());
            let mut cursor = None;
            loop {
                let left = a.snapshot_page_with_groups_at(viewer, cursor.as_deref(), 1, 1000).unwrap();
                let right = b.snapshot_page_with_groups_at(viewer, cursor.as_deref(), 1, 1000).unwrap();
                assert_eq!(serde_json::to_vec(&left).unwrap(), serde_json::to_vec(&right).unwrap());
                cursor = left.2;
                if cursor.is_none() { break; }
            }
        }
        assert!(!a.stream("dev:alice", 0, 1000).unwrap().events.is_empty());
        let args = BTreeMap::from([("conversationId".into(), id("c1")), ("c".into(), Value::Null)]);
        assert_eq!(a.query("history", Context::new("service:pusher", args.clone()).at(1000)).unwrap().data, Value::Array(vec![]));
        assert!(!b.query("history", Context::new("service:pusher", args).at(1000)).unwrap().data.as_array().unwrap().is_empty());
    }
    let invalid = plain.replace("read <- exists memberships[.conversationId, viewer]", "read <- exists memberships[.conversationId, viewer] or viewer = 'dev:pusher'");
    let bound = snapback4_lang::compile(&[("schema.q".into(), invalid)]);
    assert!(bound.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.rewrite == "use one invertible read rule, or remove sync (online only)"));
    for (rule, explicit) in [("public", "sync public"), (".principal = viewer", "sync to .principal")] {
        for sync in ["sync", explicit] {
            for extra in ["viewer = 'service:a'", "'service:a' = viewer or viewer = 'service:b'"] {
                compile(&format!("table t:\n  principal: principal\n  by byPrincipal: principal, id\n  read <- {rule} or {extra}\n  {sync}\n"));
            }
        }
    }
}

#[test]
fn upsert_residency_explains_insert_prediction_without_changing_eligibility() {
    let source = "table likes:\n  post: text <=30\n  principal: principal\n  on: bool\n  unique byPostPrincipal: post, principal\n  by byPrincipal: principal, post, id\n  read <- .principal = viewer\n  insert <- .principal = viewer\n  update <- .principal = viewer\n  sync\nmutation vote(post: text <=30):\n  upsert likes[post, viewer] {on: true}\n";
    for (source, reason) in [
        (source.to_owned(), "upsert insert into likes: absence is provable when the group and insert image are held and readable"),
        (source.replace("  sync\n", "  sync last 1 by byPrincipal\n"), "upsert insert queues without a row: likes has horizon last 1 by byPrincipal (principal, post, id)"),
        (source.replace("post, principal\n", "post\n").replace("likes[post, viewer]", "likes[post = post]").replace("{on: true}", "{principal: viewer, on: true}"), "upsert insert queues without a row: likes read rule `.principal = viewer` is not decided by key byPostPrincipal (post); unpinned: principal"),
    ] {
        let bound = compile(&source);
        let fact = &bound.schema.operations["vote"];
        assert_eq!(fact.predicts.as_deref(), Some("eligible"));
        assert!(residency::operation_lines("vote", fact).contains(reason), "{}", residency::operation_lines("vote", fact));
    }
}
