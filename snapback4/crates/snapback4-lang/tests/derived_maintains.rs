//! Intent defaults lower to the existing admitted, metered maintain machinery.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, schema::RuleExpr, wire};

const CLIQUE: &str = include_str!("fixtures/derived-clique.q");
#[path = "derived_maintains/disclosure.rs"]
mod disclosure;
const PRIVATE: &str = r#"table members:
  conversationId: id
  principal: principal
  role: text <=10
  unique byConversationPrincipal: conversationId, principal
  by byPrincipalConversation: principal, conversationId, id
  read <- exists members[.conversationId, viewer]
  insert <- exists members[.conversationId, viewer]
  delete <- .principal = viewer
  sync to members[.conversationId]
table messages:
  conversationId: id
  senderId: principal
  at: time
  by byConversation: conversationId, at, id
  read <- exists members[.conversationId, viewer]
  insert <- .senderId = viewer and exists members[.conversationId, viewer]
  sync to members[.conversationId] last 10 by byConversation
maintain messageCount: count messages by conversationId
maintain dailyCount: count messages by conversationId, day(.at)
query total(conversationId: id):
  return messageCount[conversationId]
query ranked():
  return messageCount last 10 by byGroup
mutation leave(conversationId: id):
  delete members[conversationId, viewer]
mutation send(id: id, conversationId: id):
  insert messages { id, conversationId, senderId: viewer, at: now }
"#;

fn compile(source: &str) -> snapback4_lang::Bound {
    snapback4_lang::compile(&[("schema.q".into(), source.into())])
}
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = compile(source);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
fn engine(source: &str) -> Engine {
    let b = bound(source);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn id(s: &str) -> Value { Value::Id(s.into()) }
fn semantics<T: serde::Serialize>(value: &T) -> serde_json::Value {
    fn scrub(value: &mut serde_json::Value) {
        match value {
            serde_json::Value::Object(fields) => { fields.remove("site"); for value in fields.values_mut() { scrub(value); } }
            serde_json::Value::Array(values) => for value in values { scrub(value); },
            _ => {}
        }
    }
    let mut value = serde_json::to_value(value).unwrap();
    scrub(&mut value);
    value
}
fn ctx(who: &str, args: &[(&str, Value)]) -> Context {
    Context::new(who, args.iter().map(|(k,v)| (k.to_string(),v.clone())).collect()).at(86_400_010)
}
fn write(e: &mut Engine, op: &str, who: &str, args: &[(&str, Value)]) -> Value {
    let outcome = e.mutate(op, None, ctx(who,args)).unwrap();
    match outcome.state { WriteState::Sent { result, .. } => result, other => panic!("{op}: {other:?}") }
}

#[test]
fn clique_nine_aggregates_and_inferred_columns_run_against_contributions() {
    let b = bound(CLIQUE);
    assert_eq!(b.notes.iter().filter(|note| note.code == "N_REFERENCE_UNCHECKED").count(), 3, "{:?}", b.notes);
    assert!(b.notes.iter().all(|note| note.code == "N_REFERENCE_UNCHECKED"), "{:?}", b.notes);
    assert_eq!(b.schema.maintains.iter().filter(|m| m.private.is_none()).count(), 9);
    assert!(b.schema.maintain_for("posts").is_none(), "self-reference is an ordinary source");
    for m in b.schema.maintains.iter().filter(|m| m.private.is_none()) {
        assert_eq!(b.schema.tables[&m.target].rules.read, RuleExpr::Allow);
        assert!(b.schema.tables[&m.target].sync.is_none());
    }
    let mut e = engine(CLIQUE);
    for (name, who, parent, at) in [("p","alice",Value::Null,0), ("r","bob",id("p"),86_400_001), ("rr","carol",id("r"),86_400_002), ("q","alice",Value::Null,86_400_003)] {
        let result = write(&mut e,"post",who,&[("id",id(name)),("parentId",parent),("at",Value::Int(at))]);
        assert!(result.field("likeCount").is_err() && result.field("repostCount").is_err());
    }
    for (name,who,post,at) in [("l1","bob","p",0),("l2","carol","p",86_400_001),("l3","alice","r",86_400_002)] {
        write(&mut e,"like",who,&[("id",id(name)),("postId",id(post)),("at",Value::Int(at)),("weight",Value::Int(3))]);
    }
    write(&mut e,"repost","bob",&[("id",id("rp")),("postId",id("p")),("at",Value::Int(86_400_004))]);
    for (name, who, owner) in [("f1","bob","alice"),("f2","carol","alice"),("f3","alice","bob")] {
        write(&mut e,"follow",who,&[("id",id(name)),("owner",id(owner))]);
    }
    let check = |e: &mut Engine, owner: &str, post: &str, expected: serde_json::Value| {
        // A bystander sees every public summary; the source's read policy is derived.
        let answer = e.query("totals", ctx("stranger",&[("owner",id(owner)),("postId",id(post)),("day",Value::Int(1))])).unwrap();
        assert!(answer.complete && answer.cut.is_none());
        let mut actual = wire::to_json(&answer.data);
        let row = actual.as_object_mut().unwrap().remove("post").unwrap();
        assert_eq!(actual,expected);
        row
    };
    let row = check(&mut e,"alice","p",json!({"replies":1,"followers":2,"following":1,"likes":2,"dailyLikes":1,"receivedReplies":1,"reposts":1,"posts":2,"dailyPosts":1}));
    assert_eq!((row["likeCount"].as_i64(),row["repostCount"].as_i64()),(Some(2),Some(1)));
    check(&mut e,"bob","r",json!({"replies":1,"followers":1,"following":1,"likes":1,"dailyLikes":1,"receivedReplies":1,"reposts":0,"posts":0,"dailyPosts":0}));
    check(&mut e,"nobody","missing",json!({"replies":0,"followers":0,"following":0,"likes":0,"dailyLikes":0,"receivedReplies":0,"reposts":0,"posts":0,"dailyPosts":0}));
    write(&mut e,"unlike","carol",&[("id",id("l2"))]);
    write(&mut e,"removePost","bob",&[("id",id("r"))]);
    let row = check(&mut e,"alice","p",json!({"replies":0,"followers":2,"following":1,"likes":1,"dailyLikes":0,"receivedReplies":0,"reposts":1,"posts":2,"dailyPosts":1}));
    assert_eq!(row["likeCount"],1);
    // Deleting the target does not rewrite the captured credit of its replies/likes.
    check(&mut e,"bob","r",json!({"replies":1,"followers":1,"following":1,"likes":1,"dailyLikes":1,"receivedReplies":1,"reposts":0,"posts":0,"dailyPosts":0}));
}

#[test]
fn dotted_keys_and_explicit_defaults_produce_the_same_schema_and_programs() {
    let plain = bound(CLIQUE);
    let dotted = CLIQUE.replace("by parentId", "by .parentId").replace("by followedId", "by .followedId")
        .replace("by followerId", "by .followerId").replace("by postId.authorId", "by .postId.authorId").replace("by authorId", "by .authorId");
    let explicit = CLIQUE.lines().map(|line| {
        if line.starts_with("maintain ") { format!("{line}\n  read <- allow") }
        else { line.replace("likeCount: count likes", "likeCount: count likes by postId").replace("repostCount: count reposts", "repostCount: count reposts by postId") }
    }).collect::<Vec<_>>().join("\n");
    for source in [&dotted,&explicit] {
        let b = bound(source);
        assert_eq!(semantics(&plain.schema),semantics(&b.schema));
        assert_eq!(plain.programs.iter().map(|p|semantics(&p.program)).collect::<Vec<_>>(),b.programs.iter().map(|p|semantics(&p.program)).collect::<Vec<_>>());
    }
}

#[test]
fn uniformly_readable_rules_derive_allow_and_return_nonzero_totals() {
    let source = CLIQUE.replace("public 'Public posts'", "read <- allow").replace("public 'Public likes'", "read <- allow");
    let b = bound(&source);
    for m in b.schema.maintains.iter().filter(|m| m.private.is_none()) {
        assert_eq!(b.schema.tables[&m.target].rules.read, RuleExpr::Allow, "{}", m.target);
    }
    let mut e = engine(&source);
    write(&mut e,"post","alice",&[("id",id("p")),("parentId",Value::Null),("at",Value::Int(86_400_001))]);
    write(&mut e,"like","bob",&[("id",id("l")),("postId",id("p")),("at",Value::Int(86_400_002)),("weight",Value::Int(3))]);
    let answer = e.query("totals",ctx("stranger",&[("owner",id("alice")),("postId",id("p")),("day",Value::Int(1))])).unwrap();
    assert!(answer.complete && answer.cut.is_none());
    for field in ["posts","dailyPosts","likes","dailyLikes"] {
        assert_eq!(answer.data.field(field).unwrap(),&Value::Int(1),"{field}");
    }
}

#[test]
fn failed_maintain_generation_does_not_infer_a_rule_on_an_ordinary_table() {
    let b = snapback4_lang::compile(&[
        ("a.q".into(),"maintain totals: count missing by owner".into()),
        ("b.q".into(),"table totals:\n  owner: principal\n  public".into()),
    ]);
    assert!(b.diagnostics.iter().any(|d|d.code == "E_QUARRY_UNKNOWN" && d.message.contains("unknown source table missing") && d.site.file == "a.q"),"{:?}",b.diagnostics);
    assert!(b.schema.tables["totals"].rules.read.is_public());
    assert!(b.schema.maintains.is_empty());
}

#[test]
fn dotted_sum_column_matches_legacy_spelling_and_runs() {
    let source = "table orders:\n  shopId: principal\n  amount: int\n  read <- allow\n  insert <- .shopId = viewer\nmaintain revenue: sum orders of .amount by shopId\nquery total(owner: principal):\n  return revenue[owner]\nmutation order(id: id, amount: int):\n  insert orders { id, shopId: viewer, amount }\n";
    let dotted = bound(source);
    let plain = bound(&source.replace("of .amount","of amount"));
    assert_eq!(semantics(&dotted.schema),semantics(&plain.schema));
    assert_eq!(dotted.programs.iter().map(|p|semantics(&p.program)).collect::<Vec<_>>(),plain.programs.iter().map(|p|semantics(&p.program)).collect::<Vec<_>>());
    let mut e = engine(source);
    for (name,amount) in [("a",13),("b",-3)] {
        write(&mut e,"order","alice",&[("id",id(name)),("amount",Value::Int(amount))]);
    }
    let answer = e.query("total",ctx("stranger",&[("owner",id("alice"))])).unwrap();
    assert!(answer.complete && answer.cut.is_none());
    assert_eq!(answer.data,Value::Int(10));
    assert!(compile(&source.replace("of .amount","of ..amount")).diagnostics.iter().any(|d|d.code == "E_QUARRY_SYNTAX"));
}

#[test]
fn read_derivation_refuses_lost_fields_and_preserves_explicit_policy() {
    for (rule, key, missing) in [(".senderId = viewer","conversationId",".senderId"),
        (".at != 0","day(.at)",".at"), (".postId != null","postId.authorId",".postId")] {
        let source = if key.contains("postId") {
            CLIQUE.replace("public 'Public likes'",&format!("read <- {rule}"))
        } else {
            format!("{}\nmaintain privateCount: count messages by {key}\n", PRIVATE.split("maintain messageCount:").next().unwrap().replace("read <- exists members[.conversationId, viewer]\n  insert <- .senderId",&format!("read <- {rule}\n  insert <- .senderId")).replace("  sync to members[.conversationId] last 10 by byConversation\n", ""))
        };
        let b = compile(&source);
        let d = b.diagnostics.iter().find(|d|d.code == "E_MAINTAIN_READ_RULE").unwrap_or_else(||panic!("{rule}: {:?}",b.diagnostics));
        assert!(d.message.contains(missing) && d.rewrite.contains("read <- deny"));
        assert!(d.site.line > 0 && d.guide == "maintains");
    }
    let source = "table entries:\n  owner: principal\n  category: int\n  read <- .owner = viewer\nmaintain totals: count entries by category\n  read <- deny\n";
    assert_eq!(bound(source).schema.tables["totals"].rules.read,RuleExpr::Deny);
    assert_eq!(bound(&source.replace("read <- deny", "read <- allow")).schema.tables["totals"].rules.read,RuleExpr::Allow);
    // No read declaration on a source is deny, never an inferred public grant.
    let source = "table entries:\n  category: int\nmaintain totals: count entries by category\n";
    assert_eq!(bound(source).schema.tables["totals"].rules.read,RuleExpr::Deny);
}

#[test]
fn inferred_column_reference_handles_sums_optional_refs_and_ambiguity() {
    let source = CLIQUE.replace("repostCount: count reposts", "repostCount: count reposts\n  weight: sum likes of .weight");
    let mut e = engine(&source);
    write(&mut e,"post","alice",&[("id",id("p")),("parentId",Value::Null),("at",Value::Int(0))]);
    for (name,weight) in [("a",7),("b",-2)] {
        write(&mut e,"like",name,&[("id",id(name)),("postId",id("p")),("at",Value::Int(0)),("weight",Value::Int(weight))]);
    }
    assert_eq!(e.store().rows("posts").unwrap()[0].field("weight").unwrap(),&Value::Int(5));
    let optional = "table posts:\n  n: count likes\n  public\ntable likes:\n  postId: posts ?\n  public\n";
    assert_eq!(bound(optional).schema.maintains[0].by,["postId"]);
    for (fields,candidates) in [("  principal: principal", vec!["none"]), ("  first: posts\n  second: posts ?",vec!["first","second"])] {
        let source = format!("table posts:\n  n: count likes\n  public\ntable likes:\n{fields}\n  public\n");
        let b = compile(&source);
        let d = b.diagnostics.iter().find(|d|d.code == "E_MAINTAINED_COLUMN_REFERENCE").unwrap();
        for name in candidates { assert!(d.message.contains(name)); }
        assert!(d.rewrite.contains("count likes by ") && d.site.line == 2);
        if fields.contains("first") { bound(&source.replace("n: count likes", "n: count likes by .second")); }
    }
    for code in ["E_MAINTAIN_READ_RULE","E_MAINTAINED_COLUMN_REFERENCE"] {
        assert_eq!(snapback4_lang::diag::guide_for(code),"maintains");
        assert!(snapback4_lang::guide::explain_code(code).is_some());
    }
}

#[test]
fn keyed_maintain_hides_hits_and_misses_without_turning_them_into_zero() {
    let source = r#"
table meetings:
  chair: principal
  read <- allow
table recusals:
  meeting: meetings
  read <- allow
table officers:
  principal: principal
  unique principal
  read <- .principal = viewer
table hiddenBans:
  principal: principal
  unique principal
  read <- deny
table readableBans:
  principal: principal
  unique principal
  read <- .principal = viewer
table banParents:
  read <- deny
table throughBans:
  parent: banParents
  principal: principal
  immutable parent
  unique principal
  read through .parent
table inboxItems:
  meeting: meetings
  principal: principal
  read <- .principal = viewer
view recusalCounts: count recusals by .meeting
  read <- exists meetings[.meeting, chair = viewer] or exists officers[viewer]
  online only
view chairedMeetingCounts: count meetings by .chair
  read <- .chair = viewer
  online only
view inheritedCounts: count inboxItems by .meeting, .principal
view hiddenUnbannedCounts: count meetings by .chair
  read <- not exists hiddenBans[viewer]
  online only
view readableUnbannedCounts: count meetings by .chair
  read <- not exists readableBans[viewer]
  online only
view throughUnbannedCounts: count meetings by .chair
  read <- not exists throughBans[viewer]
  online only
query bare(meeting: meetings):
  return recusalCounts[meeting]
query guarded(meeting: meetings):
  require exists meetings[meeting, chair = viewer] or exists officers[viewer] else NOT_CHAIR
  return recusalCounts[meeting]
query unrelated(meeting: meetings):
  require true else IMPOSSIBLE
  return recusalCounts[meeting]
query selfAuthorized():
  return chairedMeetingCounts[viewer]
query inheritedSelfAuthorized(meeting: meetings):
  return inheritedCounts[meeting, viewer]
query hiddenAbsence(owner: principal):
  require not exists hiddenBans[viewer] else BANNED
  return hiddenUnbannedCounts[owner]
query readableAbsence(owner: principal):
  require not exists readableBans[viewer] else BANNED
  return readableUnbannedCounts[owner]
query throughAbsence(owner: principal):
  require not exists throughBans[viewer] else BANNED
  return throughUnbannedCounts[owner]
query rebound(a: principal, b: principal):
  key = a
  require key = viewer else NOT_OWNER
  key = b
  return chairedMeetingCounts[key]
query nestedReturn(a: principal, b: principal, choose: bool):
  key = a
  require key = viewer else NOT_OWNER
  if choose:
    key = b
    return chairedMeetingCounts[key]
  return null
query branchRebound(a: principal, b: principal, choose: bool):
  key = a
  require key = viewer else NOT_OWNER
  if choose:
    key = b
  return chairedMeetingCounts[key]
query loopRebound(a: principal, b: principal):
  key = a
  require key = viewer else NOT_OWNER
  for ignored in [true]:
    key = b
  return chairedMeetingCounts[key]
query loopCarriedReturn(a: principal, b: principal):
  key = a
  require key = viewer else NOT_OWNER
  for i in range(0, 2):
    if i = 1:
      return chairedMeetingCounts[key]
    key = b
  return null
query stableBranch(a: principal, b: principal, choose: bool):
  key = a
  require key = viewer else NOT_OWNER
  if choose:
    other = b
  return chairedMeetingCounts[key]
query stableLoop(a: principal, b: principal):
  key = a
  require key = viewer else NOT_OWNER
  for ignored in [true]:
    other = b
  return chairedMeetingCounts[key]
"#;
    let b = bound(source);
    let notes: Vec<_> = b.notes.iter().filter(|note| note.code == "N_MAINTAIN_AUTHORIZATION").collect();
    assert_eq!(notes.len(), 9, "unrelated, stale, and visibility-only requirements must not suppress the note: {:#?}", b.notes);
    for name in ["bare", "unrelated", "hiddenAbsence", "throughAbsence", "rebound", "nestedReturn", "branchRebound", "loopRebound", "loopCarriedReturn"] {
        assert!(notes.iter().any(|note| note.message.contains(&format!("query {name}"))), "{name}: {notes:#?}");
    }
    assert!(!notes.iter().any(|note| note.message.contains("query inheritedSelfAuthorized")), "{notes:#?}");
    assert!(!notes.iter().any(|note| note.message.contains("query readableAbsence")
        || note.message.contains("query stableBranch") || note.message.contains("query stableLoop")), "{notes:#?}");
    let mut e = Engine::memory(b.schema, b.programs.into_iter().map(|program| program.program)).unwrap();
    e.seed_at([
        ("meetings".into(), snapback4_core::value::object([("id", id("with")), ("chair", id("alice"))])),
        ("meetings".into(), snapback4_core::value::object([("id", id("empty")), ("chair", id("alice"))])),
        ("recusals".into(), snapback4_core::value::object([("id", id("r")), ("meeting", id("with"))])),
        ("officers".into(), snapback4_core::value::object([("id", id("o")), ("principal", id("carol"))])),
    ], 500).unwrap();
    let read = |e: &mut Engine, query: &str, who: &str, meeting: &str| {
        e.query(query, ctx(who, &[("meeting", id(meeting))])).map(|answer| answer.data)
    };
    assert_eq!(read(&mut e, "bare", "alice", "with").unwrap(), Value::Int(1));
    assert_eq!(read(&mut e, "bare", "alice", "empty").unwrap(), Value::Int(0));
    assert_eq!(read(&mut e, "bare", "carol", "with").unwrap(), Value::Int(1));
    assert_eq!(read(&mut e, "bare", "carol", "empty").unwrap(), Value::Int(0));
    assert_eq!(read(&mut e, "bare", "bob", "with").unwrap(), Value::Null, "hidden stored group");
    assert_eq!(read(&mut e, "bare", "bob", "empty").unwrap(), Value::Null, "hidden absent group");
    assert_eq!(read(&mut e, "guarded", "bob", "with").unwrap_err().code, "NOT_CHAIR");
}

#[test]
fn expiring_source_and_system_misses_use_the_same_maintain_authorization_as_hits() {
    let source = r#"
table events:
  owner: principal
  until: time
  immutable owner, until
  expire at .until
  read <- allow
  online only
view liveCounts: count events by .owner
  read <- .owner = viewer
  online only
view deniedCounts: count events by .owner
  read <- deny
  online only
query live(owner: principal):
  return liveCounts[owner]
query denied(owner: principal):
  return deniedCounts[owner]
"#;
    let mut e = engine(source);
    assert_eq!(e.query("live", ctx("alice", &[("owner", id("alice"))])).unwrap().data, Value::Int(0));
    assert_eq!(e.query("live", ctx("bob", &[("owner", id("alice"))])).unwrap().data, Value::Null);
    let mut system = Context::system().at(86_400_010);
    system.args.insert("owner".into(), id("alice"));
    assert_eq!(e.query("denied", system).unwrap().data, Value::Int(0));
}

#[test]
fn maintain_authorization_notes_distinguish_lexicals_from_rule_constants() {
    let source = r#"
table boolEntries:
  flag: bool
  read <- allow
  online only
view trueTotals: count boolEntries by .flag
  read <- .flag
  online only
table stateEntries:
  state: enum('visible', 'hidden')
  read <- allow
  online only
view stateTotals: count stateEntries by .state
  read <- .state = 'visible'
  online only
query bareAllow(allow: bool):
  return trueTotals[allow]
query barePublic(public: bool):
  return trueTotals[public]
query bareDeny(deny: bool):
  return trueTotals[deny]
query aliasAllow(key: bool):
  allow = key
  return trueTotals[allow]
query aliasPublic(key: bool):
  public = key
  return trueTotals[public]
query aliasDeny(key: bool):
  deny = key
  return trueTotals[deny]
query loopAllow():
  for allow in [false]:
    return trueTotals[allow]
  return 0
query loopPublic():
  for public in [false]:
    return trueTotals[public]
  return 0
query loopDeny():
  for deny in [false]:
    return trueTotals[deny]
  return 0
query enumCollision(visible: enum('visible', 'hidden')):
  return stateTotals[visible]
query guardedAllow(allow: bool):
  require allow else NOT_ALLOWED
  return trueTotals[allow]
query guardedPublic(public: bool):
  require public else NOT_ALLOWED
  return trueTotals[public]
query guardedDeny(deny: bool):
  require deny else NOT_ALLOWED
  return trueTotals[deny]
query guardedEnum(visible: enum('visible', 'hidden')):
  require visible = 'visible' else NOT_ALLOWED
  return stateTotals[visible]
"#;
    let b = bound(source);
    let notes: Vec<_> = b
        .notes
        .iter()
        .filter(|note| note.code == "N_MAINTAIN_AUTHORIZATION")
        .collect();
    let expected = [
        "bareAllow",
        "barePublic",
        "bareDeny",
        "aliasAllow",
        "aliasPublic",
        "aliasDeny",
        "loopAllow",
        "loopPublic",
        "loopDeny",
        "enumCollision",
    ];
    assert_eq!(notes.len(), expected.len(), "{notes:#?}");
    for name in expected {
        assert!(
            notes.iter().any(|note| note.message.contains(&format!("query {name}"))),
            "{name}: {notes:#?}"
        );
    }
    for name in ["guardedAllow", "guardedPublic", "guardedDeny", "guardedEnum"] {
        assert!(
            !notes.iter().any(|note| note.message.contains(&format!("query {name}"))),
            "{name}: {notes:#?}"
        );
    }
}
