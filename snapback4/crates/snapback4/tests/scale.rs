//! Certificates are tested against compiled programs and actual meter work.
#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};
use snapback4_core::{Context, Engine, Value};
use snapback4_lang::{Bound, compile, guide};
use std::{collections::BTreeMap, fs, process::Command};

fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:#?}", b.diagnostics);
    b
}
fn classes(b: &Bound) -> BTreeMap<String, Class> {
    b.programs.iter().map(|p| (p.program.name.clone(), analyze(&b.schema, &p.program).class)).collect()
}

#[test]
fn default_text_and_explicit_bound_have_identical_scale_certificates() {
    let source = "table notes:\n  owner: principal\n  title: text\n  read <- .owner = viewer\n  insert <- .owner = viewer\n  update <- .owner = viewer\nmutation add(title: text):\n  return insert notes { owner: viewer, title }\nmutation edit(key: notes, title: text):\n  return update notes[key] { title }\nquery page(c: cursor ?):\n  return notes where .owner = viewer first 10 after c\n";
    let default = bound(source);
    let explicit = bound(&source.replace(": text", ": text <=10000"));
    for (a, b) in default.programs.iter().zip(&explicit.programs) {
        assert_eq!(serde_json::to_value(analyze(&default.schema, &a.program)).unwrap(),
            serde_json::to_value(analyze(&explicit.schema, &b.program)).unwrap());
    }
}
fn pin(b: &Bound, constant: &[&str], grows: &[&str]) {
    let expected = constant.iter().map(|n| (n.to_string(), Class::Constant))
        .chain(grows.iter().map(|n| (n.to_string(), Class::Grows))).collect();
    assert_eq!(classes(b), expected);
}

#[test]
fn language_operation_classes() {
    let b = bound(&guide::language());
    // The new written-order example truncates at intrinsic id: one public,
    // non-expiring scan with no residual can examine at most page size + 1.
    let ids = &b.programs.iter().find(|p| p.program.name == "intentIds").unwrap().program;
    let scans = snapback4_core::ir::scans(ids);
    assert_eq!(scans.len(), 1);
    assert_eq!(scans[0].index, "byId");
    assert!(scans[0].filter.is_none());
    assert_eq!(analyze(&b.schema, ids).bounds.rows_examined, 21);
    // Calendar calls and arithmetic without an overflow proof stay residual:
    // the scan's work can grow with the room even though its page is bounded.
    for name in ["roomHour", "roomWindow"] {
        let program = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        let scan = snapback4_core::ir::scans(program)[0];
        assert!(scan.range.is_none() && scan.filter.is_some());
    }
    // Expiring messages require live filtering and maintained recounts;
    // search expands words; meter domains discover uncapped membership lanes;
    // Following/Trending have residuals. Native bodies have no static proof.
    pin(&b, &["ancestors", "anchoredKeys", "calendar", "checkin", "chips", "createRoom", "daily", "digestToday", "edit", "heldRoom", "helperRows", "join", "leave", "mentions", "mostLiked", "nightly", "online", "pagePass", "post", "react", "registerProfile", "room", "sendBrief", "split", "spreadProfile", "spreadObjects", "spreadChoice", "intentBoard", "intentCount", "intentDeliveriesFor", "intentDeliveriesPage", "intentDurations", "intentGlobal", "intentIds", "intentPage", "intentSubject", "today", "tokenDigest", "wholeRoster"],
        &["digest", "everywhere", "groupedMessages", "hasMessages", "inbox", "memberTotal", "personalizeNative", "rescoreNative", "roomHour", "roomWindow", "search", "thread", "intentDaily", "intentSearch"]);
}

#[test]
fn chat_operation_classes() {
    let b = bound(include_str!("../../../apps/chat/snapback/schema.q"));
    // The external invite handler has no Quarry body to certify. Message
    // counts are non-expiring; membership caps bound authored write loops.
    pin(&b, &["addMember", "edit", "inbox", "leave", "markRead", "room", "send", "sendPhoto", "thread", "unsend"], &["invite"]);
}

#[test]
fn clique_operation_classes() {
    let b = bound(include_str!("../../../examples/clique-03/snapback/schema.q"));
    // Following rejects removed events; Trending filters exact timestamps
    // and removal inside hour lanes. A page limit does not bound those skips.
    pin(&b, &["follow", "insights", "like", "post", "register", "remove", "reply", "repost", "thread", "unfollow", "unlike", "unrepost"], &["following", "trending"]);
    let certificate = |name: &str| analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program);
    let trending = certificate("trending").line();
    assert!(trending.contains("not .removed") && trending.contains(".at") && !trending.contains("$bool"), "{trending}");
    assert!(certificate("following").line().contains("Following `feed` entries"));
    let like = certificate("like").line();
    assert!(like.contains("recorded-attribution point reads") && like.contains("`posts.likeCount`: at most 4 derived writes"), "{like}");
}

const READS: &str = r#"
table posts:
  author: principal
  removed: bool
  amount: int
  by byAuthor: author, id
  by byRemoved: removed, id
  public
  online only
query page(c: cursor ?):
  return posts after c first 20 by byId
query one(id: posts):
  return posts[id]
query global(c: cursor ?):
  return posts after c first 20 by byId where not .removed
query pinned(c: cursor ?):
  return posts[false] after c first 20 by byRemoved
query population():
  n = 0
  for p in posts[] by byId:
    n = n + 1
  return n
query nested(c: cursor ?):
  return posts after c first 5 by byId { *, related: posts[.id] }
query shaped(c: cursor ?):
  return posts after c first 5 by byId { *, related: posts[.author] first 3 by byAuthor }
query lanes(people: [principal] <=4, c: cursor ?):
  return merge posts after c first 3 by byAuthor:
    [p] for p in people
query discovered(c: cursor ?):
  return merge posts after c first 3 by byAuthor:
    [p.author] for p in posts[] by byId
query dataRange(id: posts):
  p = posts[id] ! else MISSING
  n = 0
  for i in range(0, p.amount):
    n = n + 1
  return n
query inputRange(n: int):
  for i in range(0, n):
    p = posts['x']
  return n
job sweep():
  chunk p in posts first 4 by byId:
    update posts[p.id] { amount: p.amount + 1 }
"#;

#[test]
fn residual_domains_lane_discovery_and_input_bounds() {
    let b = bound(READS);
    pin(&b, &["page", "one", "pinned", "nested", "shaped", "lanes", "inputRange", "sweep"],
        &["global", "population", "discovered", "dataRange"]);
    let certificates: BTreeMap<_, _> = b.programs.iter().map(|p| (p.program.name.as_str(), analyze(&b.schema, &p.program))).collect();
    assert_eq!(certificates["page"].bounds.rows_examined, 21);
    assert!(scale::summary(&b.programs.iter().map(|p| analyze(&b.schema, &p.program)).collect::<Vec<_>>()).contains("4 grow with data"));
    assert_eq!(certificates["one"].bounds.rows_examined, 1);
    assert_eq!(certificates["lanes"].bounds.lanes, Some(4));
    assert_eq!(certificates["lanes"].bounds.arguments["people"], 4);
    assert_eq!(certificates["discovered"].bounds.lanes, None);
    assert!(certificates["global"].line().contains("posts skipped by `not .removed` before 20 match"));
    assert!(certificates["population"].growth_sites[0].reason.contains("domain `posts`"));
    assert!(certificates["sweep"].per_chunk);
    assert!(certificates["sweep"].line().starts_with("scale: per chunk — constant"));
    assert!(certificates["sweep"].line().contains("whole job grows with rows visited/written by the sweep over `posts`"));
    assert!(certificates["global"].growth_sites.iter().all(|g| !g.site.is_empty() && !g.rewrite.is_empty()));
}

#[test]
fn bounds_cover_nested_work_and_cursor_pages_on_growing_data() {
    let b = bound(READS);
    let certs: BTreeMap<_, _> = b.programs.iter().map(|p| (p.program.name.clone(), analyze(&b.schema, &p.program))).collect();
    let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
    for n in [100, 1200] {
        let start = if n == 100 { 0 } else { 100 };
        engine.seed((start..n).map(|i| ("posts".into(), Value::Row(BTreeMap::from([
            ("id".into(), Value::Id(format!("p{i:04}"))), ("author".into(), Value::Id("alice".into())),
            ("removed".into(), Value::Bool(true)), ("amount".into(), Value::Int(i)),
        ]).into())))).unwrap();
        for op in ["page", "pinned", "nested", "shaped"] {
            let mut cursor = Value::Null;
            for _ in 0..50 {
                let read = engine.query(op, Context::new("alice", BTreeMap::from([("c".into(), cursor)]))).unwrap();
                assert!(read.metered.examined <= certs[op].bounds.rows_examined, "{op}: {:?} > {:?}", read.metered, certs[op].bounds);
                assert!(read.metered.rule_probes <= certs[op].bounds.probes);
                cursor = read.next.map(Value::String).unwrap_or(Value::Null);
            }
        }
        let sparse = engine.query("global", Context::new("alice", BTreeMap::from([("c".into(), Value::Null)]))).unwrap();
        assert!(sparse.data.as_array().unwrap().is_empty());
        assert!(sparse.metered.examined >= n as u64);
        let population = engine.query("population", Context::new("alice", BTreeMap::new())).unwrap();
        assert_eq!(population.data, Value::Int(n));
        assert!(population.metered.examined >= n as u64);
    }
}

#[test]
fn text_and_json_preserve_cost_lines_and_add_a_summary() {
    let dir = std::env::temp_dir().join(format!("sb4-scale-{}", std::process::id()));
    fs::create_dir_all(dir.join("snapback")).unwrap();
    fs::write(dir.join("snapback/schema.q"), READS).unwrap();
    let run = |args: &[&str]| Command::new(env!("CARGO_BIN_EXE_snapback4")).args(args).current_dir(&dir).output().unwrap();
    let plain = run(&["check"]);
    assert!(plain.status.success(), "{plain:?}");
    let plain = String::from_utf8(plain.stdout).unwrap();
    assert!(plain.contains("scale: 8 of 12 operations are constant; 4 grow with data"), "{plain}");
    let cost = run(&["check", "--cost"]);
    assert!(cost.status.success());
    let cost = String::from_utf8(cost.stdout).unwrap();
    assert!(cost.contains("  query page:\n    scale: constant — at most 21 rows examined, 0 probes, 0 lanes"));
    assert!(cost.contains("scan posts.byId first 20 — rule decided by the prefix: no probes"));
    assert!(cost.contains("filter over ≤ examined ceiling (8192)"));
    let json = run(&["check", "--json", "--cost"]);
    assert!(json.status.success());
    let json: serde_json::Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(json["scale"].as_array().unwrap().len(), 12);
    assert!(json["scaleSummary"].as_str().unwrap().starts_with("scale: 8 of 12"));
    let global = json["scale"].as_array().unwrap().iter().find(|c| c["operation"] == "global").unwrap();
    assert_eq!(global["class"], "grows");
    assert!(global["bounds"]["meters"]["steps"].is_u64());
    assert!(global["growth_sites"][0]["reason"].as_str().unwrap().contains("not .removed"));
    fs::remove_dir_all(dir).unwrap();
}

#[test]
fn hidden_rows_expiry_rule_probes_and_live_aggregates_are_not_constant() {
    let b = bound(r#"
table privateRows:
  owner: principal
  by byOwner: owner, id
  read <- .owner = viewer
  online only
table leases:
  room: id
  principal: principal
  expiresAt: time
  unique byPair: room, principal
  by byExpiry: expiresAt, id
  expire at .expiresAt
  public
  online only
maintain leaseCounts: count leases by room
  read <- allow
  online only
table documents:
  room: id
  by byRoom: room, id
  read <- exists leases[.room, viewer]
  online only
query hidden(c: cursor ?):
  return privateRows after c first 10 by byId
query mine(c: cursor ?):
  return privateRows[viewer] after c first 10 by byOwner
query authorized(room: id, c: cursor ?):
  return documents[room] after c first 10 by byRoom
query countLive(room: id):
  return leaseCounts[room]
query leasePoint(id: leases):
  return leases[id]
query leaseKey(room: id):
  return leases[room, viewer]
"#);
    pin(&b, &["mine", "leasePoint"], &["hidden", "authorized", "countLive", "leaseKey"]);
    let c = |name: &str| analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program);
    assert!(c("hidden").line().contains("per-row read rule"));
    assert!(c("authorized").line().contains("expired leases rows"));
    assert!(c("countLive").line().contains("live leases rows in the group"));
    assert_eq!(c("mine").bounds.probes, 0);
}

#[test]
fn schema_caps_and_argument_pages_survive_ir_index_renaming() {
    use snapback4_core::ir::{self, Expr, Stmt};
    let mut b = bound(&READS.replace("  public\n", "  cap 100\n  public\n"));
    let population = b.programs.iter().find(|p| p.program.name == "population").unwrap();
    assert_eq!(analyze(&b.schema, &population.program).class, Class::Constant);
    let mut page = b.programs.iter().find(|p| p.program.name == "page").unwrap().program.clone();
    let Stmt::Return(Expr::Scan(scan)) = &mut page.body[0] else { panic!("plain page") };
    // Lane A can synthesize an index and an argument bound: classification
    // depends on the resulting IR/schema, never an authored index spelling.
    scan.index = "synthesized_123".into();
    scan.take = ir::Bound::Arg { name: "size".into(), max: 37 };
    let table = b.schema.tables.get_mut("posts").unwrap();
    table.indexes.insert("synthesized_123".into(), table.indexes["byId"].clone());
    let c = analyze(&b.schema, &page);
    assert_eq!(c.class, Class::Constant);
    assert_eq!(c.bounds.rows_examined, 38);
    assert_eq!(c.bounds.arguments["size"], 37);
}

#[test]
fn bounds_card_examples_compile_without_notes_and_pin_both_classes() {
    for source in guide::quarry(guide::card("bounds").unwrap()) {
        let b = bound(&source);
        assert!(b.notes.is_empty(), "{:?}", b.notes);
        pin(&b, &["scalePage"], &["scalePopulation"]);
    }
}

#[path = "scale/witnesses.rs"]
mod witnesses;
