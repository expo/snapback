//! The two blind reviews of LLP 3000 decision 4 (llp/reviews/3000-partition-
//! inversion.gpt.md, 3000-meter-cut.grok.md), each finding reproduced as
//! the scenario the reviewer gave, against the fix.

use snapback4_core::engine::{Context, Engine, WriteState};
use snapback4_core::error::{MeterKind, RuntimeError};
use snapback4_core::meter::Ceilings;
use snapback4_core::partition::holdings;
use snapback4_core::value::{Value, object};
use snapback4_sim::chat::{CHAT, chat_engine, chat_engine_from};
use std::collections::BTreeMap;

fn id(s: &str) -> Value {
    Value::Id(s.into())
}

fn args(pairs: &[(&str, Value)]) -> BTreeMap<String, Value> {
    pairs.iter().map(|(k, v)| ((*k).to_owned(), v.clone())).collect()
}

fn sent(engine: &mut Engine, op: &str, viewer: &str, name: &str, a: &[(&str, Value)], ids: &[&str]) -> u64 {
    let outcome = engine.mutate(name, Some(op), Context::new(viewer, args(a)).at(5_000).with_ids(ids.iter().map(|s| (*s).to_owned()))).unwrap();
    match outcome.state {
        WriteState::Sent { seq, .. } => seq,
        WriteState::Failed { why, .. } => panic!("{name} failed: {why:?}"),
    }
}

// ---- partition inversion (gpt) ----

/// Finding 1: a membership for a principal literally named `public` must
/// deliver to that principal alone, never to the partition every device holds.
#[test]
fn p1_a_principal_named_public_is_only_itself() {
    let mut engine = chat_engine(&["dev:alice", "dev:bob"]);
    sent(&mut engine, "s1", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("secret".into()))], &["m-secret"]);
    let before = engine.seq().unwrap();
    sent(&mut engine, "i1", "dev:alice", "addMember", &[("conversationId", id("c1")), ("principal", id("public"))], &["mem-public"]);
    // A stranger's stream carries nothing of c1; the principal named public holds it.
    let stranger = engine.stream("dev:charlie", before, 1_000).unwrap();
    assert!(stranger.events.is_empty(), "{:?}", stranger.events);
    let (events, _) = engine.snapshot("dev:charlie").unwrap();
    assert!(!holdings(&events).contains_key("messages"));
    let (events, _) = engine.snapshot("public").unwrap();
    assert!(holdings(&events)["messages"].contains("m-secret"));
}

/// Finding 3: a commit larger than the page is delivered whole, so a leave's
/// scopes land with its puts instead of being skipped for good.
#[test]
fn p3_a_commit_larger_than_the_page_streams_whole() {
    let mut engine = chat_engine(&["dev:alice", "dev:bob"]);
    sent(&mut engine, "s1", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("hi".into()))], &["m1"]);
    let before = engine.seq().unwrap();
    let seq = sent(&mut engine, "l1", "dev:bob", "leave", &[("conversationId", id("c1"))], &[]);
    let page = engine.stream("dev:bob", before, 1).unwrap();
    assert!(page.events.len() >= 4, "the whole commit: {:?}", page.events);
    assert!(page.events.iter().all(|e| e.seq == seq));
    assert_eq!(page.watermark, seq);
    assert!(!page.more);
    let scoped: Vec<&str> = page.events.iter().filter(|e| e.kind == "scope").map(|e| e.table.as_str()).collect();
    assert!(scoped.contains(&"messages") && scoped.contains(&"conversations"), "{scoped:?}");
}

/// Finding 4: a membership inserted and deleted within one mutation was never
/// an authority; the rows it would have bootstrapped never cross the wire.
#[test]
fn p4_a_grant_that_ends_in_its_commit_delivers_nothing() {
    let source = format!(
        "{CHAT}\nmutation blip(conversationId: conversations, principal: principal):\n  require exists memberships[conversationId, viewer, 'admin'] else NOT_ADMIN\n  row = insert memberships {{ conversationId, principal, role: 'member', joinedAt: now }}\n  delete memberships[row]\n  return null\n"
    );
    let mut engine = chat_engine_from(&source, &["dev:alice", "dev:bob"]);
    sent(&mut engine, "s1", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("secret".into()))], &["m-secret"]);
    let before = engine.seq().unwrap();
    sent(&mut engine, "b1", "dev:alice", "blip", &[("conversationId", id("c1")), ("principal", id("dev:mallory"))], &["mem-mallory"]);
    // Nothing at all: no row, and no scope naming the group mallory never
    // held at a commit boundary (issues/closed/20260923-snapback4-in-commit-grant-names-ids.md).
    let page = engine.stream("dev:mallory", before, 1_000).unwrap();
    assert!(page.events.is_empty(), "a temporary grant reached its grantee: {:?}", page.events);
    let (events, _) = engine.snapshot("dev:mallory").unwrap();
    assert!(holdings(&events).values().all(|ids| ids.is_empty()), "{:?}", holdings(&events));
    // The members' partitions never saw the blip's membership row, nor its id.
    let page = engine.stream("dev:bob", before, 1_000).unwrap();
    assert!(page.events.iter().all(|e| e.id != "mem-mallory"), "{:?}", page.events);
}

/// Findings 2, 5, 7, 8: the validator refuses an audience the read rule does
/// not establish exactly, a non-unique audience index, a recipient column
/// other than the probe's, and an aggregate delivered wider than its source.
#[test]
fn p2_p5_p7_p8_the_validator_refuses_unsound_audiences() {
    let refused = |source: String, expect: &str| {
        let bound = snapback4_lang::compile(&[("schema.q".to_owned(), source)]);
        let messages: Vec<String> = bound.diagnostics.iter().map(|d| d.message.clone()).collect();
        assert!(messages.iter().any(|m| m.contains(expect)), "expected a diagnostic containing {expect:?}; got {messages:?}");
    };
    // 8: a second disjunct admits viewers the sync never delivers to.
    refused(CHAT.replace("  read <- exists memberships[.conversationId, viewer]\n  insert <- .authorId = viewer and", "  read <- .authorId = viewer or exists memberships[.conversationId, viewer]\n  insert <- .authorId = viewer and"), "sync cannot infer an audience");
    // 7: a non-unique audience index would revoke a group another row still grants.
    refused(CHAT.replace("unique byConversationPrincipal: conversationId, principal", "by byConversationPrincipal: conversationId, principal"), "must be unique");
    // 2: the recipient column is the probe's, not any principal column of the target.
    refused(
        CHAT.replace("  role: enum('member', 'admin')\n", "  role: enum('member', 'admin')\n  invitedBy: principal\n")
            .replace("sync  ", "sync by .principal  ")
            .replace("sync     -- and the roster", "sync by .principal     -- and the roster")
            .replace("sync last 500 by byConvTime", "sync by .invitedBy last 500 by byConvTime")
            .replace("insert memberships { conversationId, principal, role: 'member', joinedAt: now } if absent", "insert memberships { conversationId, principal, invitedBy: viewer, role: 'member', joinedAt: now } if absent"),
        "binds viewer to memberships.principal",
    );
    // The Clique lane at M4: `check` accepted a synced table without an index
    // to take a group's rows from; the first `/sync` then failed E_SCHEMA.
    refused(CHAT.replace("  by byConvTime: conversationId, at, id\n  immutable conversationId, authorId", "  immutable conversationId, authorId").replace("sync last 500 by byConvTime", "sync"), "leading with conversationId");
    // 5: an aggregate delivered wider than its source, at the core boundary.
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut schema = bound.schema.clone();
    schema.tables.get_mut("messageCounts").unwrap().sync = Some(snapback4_core::schema::Sync { audience: snapback4_core::schema::Audience::Public, horizon: None });
    schema.tables.get_mut("messageCounts").unwrap().rules.read = snapback4_core::schema::RuleExpr::Allow;
    let issues = snapback4_core::schema::validate(&schema);
    assert!(issues.iter().any(|i| i.message.contains("syncs to an audience its source")), "{issues:?}");
}

// ---- the meter's cut (grok) ----

const NOTES: &str = "use personas alice, bob

table notes:
  owner: principal
  day: int
  at: time
  body: text <=100
  by byDayTime: day, at, id
  by byOwnerTime: owner, at, id
  read <- .owner = viewer
  insert <- .owner = viewer
  update <- deny
  delete <- deny

query feed(day: int, c: cursor ?):
  return notes[day] after c last 5 by byDayTime

query theirs(owner: principal, c: cursor ?):
  return notes[owner] after c last 5 by byOwnerTime

query one(noteId: notes):
  return notes[noteId]
";

fn notes_engine(rows: &[(&str, &str, i64)]) -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), NOTES.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let rows: Vec<(String, Value)> = rows.iter().enumerate().map(|(n, (id_, owner, day))| ("notes".to_owned(), object([("id", id(id_)), ("owner", id(owner)), ("day", Value::Int(*day)), ("at", Value::Int(n as i64)), ("body", Value::String("n".into()))]))).collect();
    engine.seed(rows).unwrap();
    engine
}

fn feed(engine: &mut Engine, viewer: &str, day: i64, cursor: Option<String>) -> snapback4_core::engine::QueryOutcome {
    engine.query("feed", Context::new(viewer, args(&[("day", Value::Int(day)), ("c", cursor.map(Value::String).unwrap_or(Value::Null))]))).unwrap()
}

/// H1: a scan the prefix does not decide is capped whatever the meter found,
/// and its `next` continues from the last visible row (or ends on an empty
/// page) whether or not hidden rows follow: the hidden population is not
/// on the card.
#[test]
fn h1_a_non_uniform_scan_is_capped_whatever_the_meter_found() {
    let mut empty = notes_engine(&[]);
    let none = feed(&mut empty, "dev:alice", 1, None);
    let bobs: Vec<(String, String, i64)> = (0..100).map(|n| (format!("b{n}"), "dev:bob".to_owned(), 1)).collect();
    let bobs_ref: Vec<(&str, &str, i64)> = bobs.iter().map(|(a, b, c)| (a.as_str(), b.as_str(), *c)).collect();
    let mut hidden = notes_engine(&bobs_ref);
    let all_hidden = feed(&mut hidden, "dev:alice", 1, None);
    for outcome in [&none, &all_hidden] {
        assert!(!outcome.complete);
        assert_eq!(outcome.data, Value::Array(Vec::new()));
        assert_eq!(outcome.next, None);
    }
    // Three visible rows (the newest, so the page meets them first) then a
    // hidden run, at a ceiling the run exceeds and at one it does not: the
    // same card either way.
    let mut mixed_rows = bobs_ref.clone();
    mixed_rows.extend([("a1", "dev:alice", 1), ("a2", "dev:alice", 1), ("a3", "dev:alice", 1)]);
    for ceiling in [8_192, 20] {
        let mut mixed = notes_engine(&mixed_rows);
        mixed.set_ceilings(Ceilings { examined: ceiling, ..Ceilings::default() });
        let first = feed(&mut mixed, "dev:alice", 1, None);
        assert!(!first.complete);
        assert_eq!(first.data.as_array().ok().map(|a| a.len()), Some(3));
        assert!(first.next.is_some(), "a capped page continues from its last visible row");
        let second = feed(&mut mixed, "dev:alice", 1, first.next.clone());
        assert!(!second.complete);
        assert_eq!(second.data, Value::Array(Vec::new()));
        assert_eq!(second.next, None, "an empty capped page is the end");
    }
}

/// The compiler says which pages are never complete, and why, before any
/// data exists; the chat schema's pages are all decided by their prefixes.
#[test]
fn h1_check_notes_a_page_that_is_never_complete() {
    let notes = snapback4_lang::compile(&[("schema.q".to_owned(), NOTES.to_owned())]);
    assert!(notes.diagnostics.is_empty(), "{:?}", notes.diagnostics);
    let messages: Vec<String> = notes.notes.iter().map(|n| n.message.clone()).collect();
    assert!(messages.iter().any(|m| m.contains("query feed") && m.contains("never `complete`") && m.contains(".owner")), "{messages:?}");
    assert!(!messages.iter().any(|m| m.contains("query theirs")), "a prefix that pins the rule's column is decided: {messages:?}");
    let chat = snapback4_lang::compile(&[("schema.q".to_owned(), CHAT.to_owned())]);
    let never: Vec<&str> = chat.notes.iter().filter(|n| n.code == "N_NEVER_COMPLETE").map(|n| n.message.as_str()).collect();
    assert!(never.is_empty(), "{never:?}");
    // `inbox` returns a page with no cursor: the compiler says so too.
    assert!(chat.notes.iter().any(|n| n.code == "N_NO_CURSOR" && n.message.contains("query inbox")), "{:?}", chat.notes.iter().map(|n| n.message.clone()).collect::<Vec<_>>());
}

/// H4: a point read of an absent row and of a hidden one cost the same.
#[test]
fn h4_a_miss_and_a_hidden_hit_cost_the_same() {
    let mut engine = notes_engine(&[("b1", "dev:bob", 1)]);
    // Caller-owned argument copies are charged too. Keep the input identical
    // and vary only the store, so the comparison measures hidden state alone.
    let mut empty = notes_engine(&[]);
    let miss = empty.query("one", Context::new("dev:alice", args(&[("noteId", id("b1"))]))).unwrap();
    let hidden = engine.query("one", Context::new("dev:alice", args(&[("noteId", id("b1"))]))).unwrap();
    assert_eq!(miss.data, Value::Null);
    assert_eq!(hidden.data, Value::Null);
    assert_eq!(miss.metered, hidden.metered, "the meter told them apart");
    assert_eq!(miss.complete, hidden.complete);
}

/// M1: a range the prefix decides false costs what an empty range costs.
#[test]
fn m1_a_hoisted_false_range_costs_what_an_empty_one_costs() {
    let bobs: Vec<(String, String, i64)> = (0..50).map(|n| (format!("b{n}"), "dev:bob".to_owned(), 1)).collect();
    let bobs_ref: Vec<(&str, &str, i64)> = bobs.iter().map(|(a, b, c)| (a.as_str(), b.as_str(), *c)).collect();
    let mut engine = notes_engine(&bobs_ref);
    let theirs = engine.query("theirs", Context::new("dev:alice", args(&[("owner", id("dev:bob")), ("c", Value::Null)]))).unwrap();
    let mut empty = notes_engine(&[]);
    let nobody = empty.query("theirs", Context::new("dev:alice", args(&[("owner", id("dev:bob")), ("c", Value::Null)]))).unwrap();
    assert_eq!(theirs.data, Value::Array(Vec::new()));
    assert_eq!(theirs.complete, nobody.complete);
    assert_eq!(theirs.next, nobody.next);
    assert_eq!(theirs.metered, nobody.metered, "the meter told a hidden range from an empty one");
    assert_eq!(theirs.metered.examined, 0);
}

/// M3: a refusal at the ceiling names the ceiling, never the count.
#[test]
fn m3_e_bound_names_the_ceiling_not_the_count() {
    let refusal = RuntimeError::Bound { kind: MeterKind::Examined, actual: 8_193, ceiling: 8_192, site: "m.sweep:2".into() }.refusal();
    assert_eq!(refusal.code, "E_BOUND");
    assert!(!refusal.message.contains("8193"), "{}", refusal.message);
    assert!(refusal.message.contains("8192"), "{}", refusal.message);
}

#[test]
// @ref LLP 3000#7-decisions-during-execution — a revoked grant cannot retrieve server history, while its scope still reaches held replicas.
fn a_closed_membership_suppresses_join_time_history() {
    let mut engine = chat_engine(&["dev:alice"]);
    sent(&mut engine, "before", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("before join".into()))], &["old"]);
    let from = engine.seq().unwrap();
    sent(&mut engine, "invite", "dev:alice", "addMember", &[("conversationId", id("c1")), ("principal", id("dev:bob"))], &["bob"]);
    sent(&mut engine, "leave", "dev:bob", "leave", &[("conversationId", id("c1"))], &[]);
    sent(&mut engine, "edit-after-leave", "dev:alice", "edit", &[("messageId", id("old")), ("body", Value::String("private edit after leave".into()))], &[]);
    sent(&mut engine, "after", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("private new row".into()))], &["new"]);
    for limit in [1, 1000] {
        let mut watermark = from;
        let mut messages = Vec::new();
        let mut scoped = false;
        loop {
            let page = engine.stream("dev:bob", watermark, limit).unwrap();
            scoped |= page.events.iter().any(|event| event.table == "messages" && event.kind == "scope");
            messages.extend(page.events.into_iter().filter(|e| e.table == "messages" && e.kind == "put"));
            assert!(page.watermark >= watermark);
            watermark = page.watermark;
            if !page.more { break; }
        }
        assert!(messages.is_empty(), "revoked authority retrieved server history: {messages:?}");
        assert!(scoped, "the revocation must still withdraw held messages");
    }
}

#[test]
fn a_truncated_own_page_never_grants_a_later_membership_early() {
    let mut engine = chat_engine(&["dev:alice"]);
    let watermark = engine.seq().unwrap();
    sent(&mut engine, "before", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("secret until invited".into()))], &["before-invite"]);
    // Populate an earlier own-partition page with an unrelated group join.
    engine.seed([
        ("conversations".into(), object([("id", id("c2")), ("title", Value::String("Other".into())), ("creatorId", id("dev:alice"))])),
        ("memberships".into(), object([("id", id("other")), ("conversationId", id("c2")), ("principal", id("dev:bob")), ("role", Value::String("member".into())), ("joinedAt", Value::Int(1))])),
    ]).unwrap();
    let join = sent(&mut engine, "invite", "dev:alice", "addMember", &[("conversationId", id("c1")), ("principal", id("dev:bob"))], &["bob"]);
    let mut from = watermark;
    loop {
        let page = engine.stream("dev:bob", from, 1).unwrap();
        assert!(page.events.iter().all(|e| e.table != "messages" || e.seq >= join), "early disclosure: {:?}", page.events);
        from = page.watermark;
        if !page.more { break; }
    }
}

// ---- grants born and undone inside one commit, with renewals ----

const EXPIRING: &str = "table members:
  group: text <=10
  person: principal
  until: time ?
  unique byGroupPerson: group, person
  by byPerson: person, group
  by byExpiry: until
  expire at .until
  immutable group, person
  read <- .person = viewer
  insert <- exists members[.group, viewer]
  update <- .person = viewer
  sync to .person
table notes:
  group: text <=10
  body: text <=10
  by byGroup: group, id
  read <- exists members[.group, viewer]
  insert <- allow
  sync to members[.group]
mutation join(person: principal):
  return insert members {group: 'g', person, until: 100}
mutation add():
  insert notes {group: 'g', body: 'n'}
  return null
mutation blink(person: principal):
  row = insert members {group: 'g', person, until: 100}
  update members[row] {until: 200}
  delete members[row]
  return null
mutation renewThenRevoke(m: members):
  update members[m] {until: 200}
  delete members[m]
  return null
mutation revokeRegrantRevoke(m: members, person: principal):
  delete members[m]
  row = insert members {group: 'g', person, until: 100}
  delete members[row]
  return null
mutation replaceThenUndo(old: members, person: principal):
  temporary = insert members {group: 'g', person, until: 300}
  upsert members[old] {group: 'h', person, until: 300}
  delete members[old]
  delete members[temporary]
  return null
mutation blinkTwice(person: principal):
  expired = insert members {group: 'g', person, until: 0}
  first = insert members {group: 'g', person, until: 300}
  delete members[first]
  second = insert members {group: 'g', person, until: 300}
  upsert members[expired] {group: 'h', person, until: 300}
  delete members[expired]
  delete members[second]
  return null
mutation retireTwoExpired(person: principal):
  a = insert members {group: 'g', person, until: 0}
  b = insert members {group: 'g', person, until: 0}
  upsert members[a] {group: 'h', person, until: 300}
  delete members[a]
  upsert members[b] {group: 'h', person, until: 300}
  delete members[b]
  return null
mutation expireRecreateRevoke(person: principal):
  row = insert members {group: 'g', person, until: 100}
  update members[row] {until: 0}
  upsert members[row] {group: 'g', person, until: 200}
  delete members[row]
  return null
";

fn expiring() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), EXPIRING.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap()
}

fn at(engine: &mut Engine, op: &str, name: &str, a: &[(&str, Value)], ids: &[&str], now: i64) -> u64 {
    let outcome = engine.mutate(name, Some(op), Context::new(snapback4_core::SYSTEM_PRINCIPAL, args(a)).at(now).with_ids(ids.iter().map(|s| (*s).to_owned()))).unwrap();
    match outcome.state {
        WriteState::Sent { seq, .. } => seq,
        WriteState::Failed { why, .. } => panic!("{name} failed: {why:?}"),
    }
}

/// A fresh grant renewed and revoked in one commit was never held at a
/// commit boundary: its grantee's stream carries nothing, not even a scope.
#[test]
fn a_grant_born_renewed_and_revoked_in_one_commit_reaches_nobody() {
    let mut engine = expiring();
    at(&mut engine, "n1", "add", &[], &["note"], 5);
    let before = engine.seq().unwrap();
    at(&mut engine, "b1", "blink", &[("person", id("dev:alice"))], &["m-alice"], 6);
    let page = engine.stream_at("dev:alice", before, 1_000, 7).unwrap();
    assert!(page.events.is_empty(), "{:?}", page.events);
}

/// A renewal is not a new grant: a grant held before the commit, renewed and
/// revoked inside it, still revokes.
#[test]
fn a_held_grant_renewed_and_revoked_in_one_commit_still_revokes() {
    let mut engine = expiring();
    at(&mut engine, "j1", "join", &[("person", id("dev:alice"))], &["m-alice"], 5);
    at(&mut engine, "n1", "add", &[], &["note"], 6);
    let held = engine.seq().unwrap();
    at(&mut engine, "r1", "renewThenRevoke", &[("m", id("m-alice"))], &[], 7);
    let page = engine.stream_at("dev:alice", held, 1_000, 8).unwrap();
    assert!(page.events.iter().any(|e| e.kind == "scope" && e.table == "notes"), "the revocation was dropped: {:?}", page.events);
    assert!(page.events.iter().any(|e| e.kind == "del" && e.id == "m-alice"), "{:?}", page.events);
}

/// Revoking a held grant, granting it afresh and revoking that in one commit
/// leaves exactly the first revocation: the fresh grant is withdrawn whole.
#[test]
fn revoke_regrant_revoke_in_one_commit_revokes_once() {
    let mut engine = expiring();
    at(&mut engine, "j1", "join", &[("person", id("dev:alice"))], &["m-alice"], 5);
    at(&mut engine, "n1", "add", &[], &["note"], 6);
    let held = engine.seq().unwrap();
    at(&mut engine, "r1", "revokeRegrantRevoke", &[("m", id("m-alice")), ("person", id("dev:alice"))], &["m-again"], 7);
    let page = engine.stream_at("dev:alice", held, 1_000, 8).unwrap();
    let scopes = page.events.iter().filter(|e| e.kind == "scope" && e.table == "notes").count();
    assert_eq!(scopes, 1, "{:?}", page.events);
    assert!(page.events.iter().all(|e| e.id != "m-again"), "the transient grant's row crossed the wire: {:?}", page.events);
    let (events, _) = engine.snapshot_at("dev:alice", 8).unwrap();
    assert!(holdings(&events).values().all(|ids| ids.is_empty()), "{:?}", holdings(&events));
}

// Astra's review of the first fix (NOT READY, three findings), each as its
// reproduction.

/// A grant born in the commit, shortened to expiry, re-created and revoked,
/// stays born throughout: no scope reaches its grantee.
#[test]
fn a_born_grant_expired_recreated_and_revoked_reaches_nobody() {
    let mut engine = expiring();
    at(&mut engine, "n1", "add", &[], &["note"], 5);
    let before = engine.seq().unwrap();
    at(&mut engine, "e1", "expireRecreateRevoke", &[("person", id("dev:alice"))], &["m-alice"], 6);
    let page = engine.stream_at("dev:alice", before, 1_000, 7).unwrap();
    assert!(page.events.is_empty(), "{:?}", page.events);
}

/// A row that existed before the commit, deleted, re-created under its id
/// and deleted again, still reaches its readers as a deletion. A maintained
/// count has a deterministic id, so a churn of its only source does this.
#[test]
fn a_recreated_row_keeps_the_deletion_of_its_first_incarnation() {
    let source = format!("{CHAT}\nmutation churn(m: messages, c: conversations):\n  delete messages[m]\n  row = insert messages {{ conversationId: c, authorId: viewer, body: 'temp', at: now }}\n  delete messages[row]\n  return null\n");
    let mut engine = chat_engine_from(&source, &["dev:alice", "dev:bob"]);
    sent(&mut engine, "s1", "dev:alice", "send", &[("conversationId", id("c1")), ("body", Value::String("only".into()))], &["original"]);
    let before = engine.seq().unwrap();
    let (events, _) = engine.snapshot("dev:bob").unwrap();
    assert!(holdings(&events)["messageCounts"].len() == 1, "{:?}", holdings(&events));
    sent(&mut engine, "c1", "dev:alice", "churn", &[("m", id("original")), ("c", id("c1"))], &["temporary"]);
    let page = engine.stream_at("dev:bob", before, 1_000, 5_000).unwrap();
    assert!(page.events.iter().any(|e| e.table == "messageCounts" && e.kind == "del"), "the count's deletion was lost: {:?}", page.events);
    assert!(page.events.iter().all(|e| e.id != "temporary"), "{:?}", page.events);
}

/// A row born in the commit and moved to another recipient before the
/// commit ends reaches only its final recipient: the first learns nothing.
#[test]
fn a_born_row_moved_to_another_recipient_reaches_only_it() {
    let schema = "table docs:\n  owner: principal\n  by byOwner: owner, id\n  read <- .owner = viewer\n  insert <- allow\n  update <- allow\n  sync to .owner\nmutation reroute():\n  row = insert docs {owner: 'dev:alice'}\n  update docs[row] {owner: 'dev:bob'}\n  return null\n";
    let bound = snapback4_lang::compile(&[("schema.q".to_owned(), schema.to_owned())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    let before = engine.seq().unwrap();
    at(&mut engine, "r1", "reroute", &[], &["transient"], 6);
    let alice = engine.stream_at("dev:alice", before, 1_000, 7).unwrap();
    assert!(alice.events.is_empty(), "{:?}", alice.events);
    let bob = engine.stream_at("dev:bob", before, 1_000, 7).unwrap();
    assert!(bob.events.iter().any(|e| e.kind == "put" && e.id == "transient"), "{:?}", bob.events);
}

// Astra's delta review (round 2, NOT READY): a new High.

/// A temporary replacement of an expired, unswept grant is not a birth: the
/// predecessor's revocation is still owed, so undoing the replacement leaves
/// it in the log, at either page size.
#[test]
fn undoing_a_replacement_keeps_the_predecessors_revocation() {
    let mut engine = expiring();
    at(&mut engine, "j1", "join", &[("person", id("dev:alice"))], &["old-member"], 5);
    at(&mut engine, "n1", "add", &[], &["note"], 6);
    let held = engine.seq().unwrap();
    let (events, _) = engine.snapshot_at("dev:alice", 7).unwrap();
    assert!(holdings(&events)["notes"].contains("note"), "{:?}", holdings(&events));
    at(&mut engine, "u1", "replaceThenUndo", &[("old", id("old-member")), ("person", id("dev:alice"))], &["temporary"], 150);
    for limit in [1, 1_000] {
        let mut from = held;
        let mut scoped = false;
        loop {
            let page = engine.stream_at("dev:alice", from, limit, 151).unwrap();
            scoped |= page.events.iter().any(|e| e.kind == "scope" && e.table == "notes");
            from = page.watermark;
            if !page.more { break; }
        }
        assert!(scoped, "the expired grant's revocation was lost at limit {limit}");
    }
}

// Astra's second delta review (round 3, NOT READY): a new Medium.

/// An expired sibling born earlier in the same commit is no predecessor: it
/// held no authority before the commit, so a grant beside it is still born,
/// and undoing everything leaves its grantee nothing.
#[test]
fn a_same_commit_expired_sibling_is_no_predecessor() {
    let mut engine = expiring();
    let before = engine.seq().unwrap();
    at(&mut engine, "b1", "blinkTwice", &[("person", id("dev:alice"))], &["expired", "first", "second"], 150);
    for limit in [1, 1_000] {
        let page = engine.stream_at("dev:alice", before, limit, 151).unwrap();
        assert!(page.events.is_empty(), "limit {limit}: {:?}", page.events);
    }
}

// Astra's third delta review (round 4, NOT READY): a residual Medium.

/// Two expired siblings born in one commit share one key's birth: retiring
/// the first keeps it for the second, so its grantee learns nothing.
#[test]
fn two_born_siblings_share_their_birth() {
    let mut engine = expiring();
    let before = engine.seq().unwrap();
    at(&mut engine, "t1", "retireTwoExpired", &[("person", id("dev:alice"))], &["a", "b", "a2", "b2"], 150);
    for limit in [1, 1_000] {
        let page = engine.stream_at("dev:alice", before, limit, 151).unwrap();
        assert!(page.events.is_empty(), "limit {limit}: {:?}", page.events);
    }
}
