//! The ceremony bar's natural membership table, without a second directory.

#[path = "common/membership.rs"]
mod fixture;

use fixture::*;
use snapback4_core::engine::rules::{Visibility, deciding_fields, scan_visibility};
use snapback4_core::{Context, Engine, Value};
use snapback4_lang::{Bound, compile};
use std::collections::{BTreeMap, BTreeSet};

fn bound(source: &str) -> Bound {
    let bound = compile(&[("schema.q".into(), source.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    bound
}

fn engine(bound: &Bound) -> Engine {
    let mut engine = Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
    engine.seed(rows()).unwrap();
    engine
}

fn context(viewer: &str, args: &[(&str, Value)]) -> Context {
    Context::new(viewer, args.iter().map(|(k, v)| ((*k).into(), v.clone())).collect::<BTreeMap<_, _>>()).at(1)
}

fn visibility(bound: &Bound, query: &str) -> Visibility {
    let program = &bound.programs.iter().find(|p| p.program.name == query).unwrap().program;
    scan_visibility(&bound.schema, snapback4_core::ir::scans(program)[0])
}

fn fields(bound: &Bound) -> BTreeSet<String> {
    let table = bound.schema.table("memberships").unwrap();
    deciding_fields("memberships", table, &table.rules.read)
}

#[test]
fn self_witness_roster_and_directory_are_complete_without_disclosing_other_chats() {
    for rule in [RULE, "viewer = .principal or exists memberships[.chatKey, viewer]", "exists memberships[.chatKey, viewer] or .principal = viewer"] {
        let bound = bound(&SOURCE.replace(RULE, rule));
        assert!(!bound.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE"), "{:?}", bound.notes);
        assert_eq!(fields(&bound), BTreeSet::from(["chatKey".into()]));
        assert_eq!(visibility(&bound, "roster"), Visibility { uniform: true, decided_true: false });
        assert_eq!(visibility(&bound, "directory"), Visibility { uniform: true, decided_true: true });
        let mut engine = engine(&bound);
        // Alice is the sampled row; Bob and Carol are later in the prefix.
        // Mallory belongs to gamma only, so a grant in another chat cannot leak alpha.
        for viewer in ["dev:alice", "dev:bob", "dev:carol", "dev:mallory", "dev:nobody"] {
            let member = matches!(viewer, "dev:alice" | "dev:bob" | "dev:carol");
            let roster = engine.query("roster", context(viewer, &[("chatKey", text("alpha"))])).unwrap();
            let principals: Vec<_> = roster.data.as_array().unwrap().iter().map(|row| row.field("principal").unwrap().as_str().unwrap()).collect();
            assert_eq!(principals, if member { vec!["dev:alice", "dev:bob", "dev:carol"] } else { vec![] }, "{viewer}: {rule}");
            assert!(roster.complete && roster.next.is_none(), "{viewer}: {roster:?}");
            // The prefix verdict costs its one static probe on either outcome,
            // before any candidate (even the viewer's own first row).
            assert_eq!(roster.metered.rule_probes, 1, "{viewer}: {rule}");
            let empty = engine.query("roster", context(viewer, &[("chatKey", text("empty"))])).unwrap();
            assert!(empty.complete && empty.data.as_array().unwrap().is_empty());
            if !member { assert_eq!(roster.metered.examined, empty.metered.examined); }
            let directory = engine.query("directory", context(viewer, &[])).unwrap();
            let chats: Vec<_> = directory.data.as_array().unwrap().iter().map(|row| {
                assert_eq!(row.field("principal").unwrap(), &id(viewer));
                row.field("chatKey").unwrap().as_str().unwrap()
            }).collect();
            assert_eq!(chats, match viewer { "dev:alice" | "dev:carol" => vec!["alpha"], "dev:bob" => vec!["alpha", "beta"], "dev:mallory" => vec!["gamma"], _ => vec![] });
            assert!(directory.complete && directory.next.is_none(), "{directory:?}");
            assert_eq!(directory.metered.rule_probes, 0);
        }
    }
}

#[test]
fn self_witness_receipt_aggregate_is_complete_through_delivery_read_and_leave() {
    let bound = bound(SOURCE);
    let mut engine = engine(&bound);
    let check = |engine: &mut Engine, expected: &str| {
        for viewer in ["dev:alice", "dev:bob", "dev:carol"] {
            let receipt = engine.query("receipt", context(viewer, &[("messageId", id("msg"))])).unwrap();
            assert!(receipt.complete, "{viewer}: {receipt:?}");
            assert_eq!(receipt.data.field("state").unwrap(), &text(expected));
        }
        for viewer in ["dev:mallory", "dev:nobody"] {
            let hidden = engine.query("receipt", context(viewer, &[("messageId", id("msg"))])).unwrap();
            assert_eq!(hidden.data, Value::Null);
            assert!(hidden.complete && hidden.next.is_none());
        }
    };
    check(&mut engine, "sent");
    engine.seed([acknowledgment("dev:bob", "delivered")]).unwrap();
    check(&mut engine, "sent");
    engine.seed([acknowledgment("dev:carol", "delivered")]).unwrap();
    check(&mut engine, "delivered");
    engine.seed([acknowledgment("dev:bob", "read")]).unwrap();
    check(&mut engine, "delivered");
    engine.seed([acknowledgment("dev:carol", "read")]).unwrap();
    check(&mut engine, "read");
    engine.seed([acknowledgment("dev:carol", "delivered")]).unwrap();
    engine.seed_delete("memberships", "alpha-dev:carol").unwrap();
    let receipt = engine.query("receipt", context("dev:bob", &[("messageId", id("msg"))])).unwrap();
    assert!(receipt.complete);
    assert_eq!(receipt.data.field("state").unwrap(), &text("read"));
    assert_eq!(engine.query("receipt", context("dev:carol", &[("messageId", id("msg"))])).unwrap().data, Value::Null);
}

#[test]
fn literal_and_other_table_probes_do_not_absorb_membership_equality() {
    for source in [literal_source(), other_table_source()] {
        let bound = bound(&source);
        assert_eq!(fields(&bound), BTreeSet::from(["chatKey".into(), "principal".into()]));
        assert_eq!(visibility(&bound, "roster"), Visibility { uniform: false, decided_true: false });
        // @ref LLP 3000.036#18 — a readable pinned guard is conditional completeness; self-key absorption is unchanged.
        assert!(bound.notes.iter().any(|n| n.code == "N_CONDITIONAL_COMPLETE" && n.message.contains("query roster:")), "{:?}", bound.notes);
        let mut engine = engine(&bound);
        let roster = engine.query("roster", context("dev:bob", &[("chatKey", text("alpha"))])).unwrap();
        let rows = roster.data.as_array().unwrap();
        assert_eq!(rows.len(), 1, "{roster:?}");
        assert_eq!(rows[0].field("principal").unwrap(), &id("dev:bob"));
        assert!(!roster.complete && roster.next.is_none());
        let hidden = engine.query("roster", context("dev:mallory", &[("chatKey", text("alpha"))])).unwrap();
        assert!(hidden.data.as_array().unwrap().is_empty() && !hidden.complete);
        let directory = engine.query("directory", context("dev:bob", &[])).unwrap();
        assert!(directory.complete && directory.data.as_array().unwrap().len() == 2);
        if source.contains("byChatPrincipalRole") {
            let admin = engine.query("roster", context("dev:alice", &[("chatKey", text("alpha"))])).unwrap();
            assert_eq!(admin.data.as_array().unwrap().len(), 3);
            // LLP 3000.036 §16.3: the admin probe's row column (`.chatKey`) is
            // pinned and the admin may read their own membership row, so it
            // decides the page for the admin once, as a grant would.
            assert!(admin.complete, "the pinned admin probe decides the admin's page");
        }
    }
}

#[test]
fn absorption_is_local_to_or_and_requires_a_total_unique_plain_self_key() {
    use snapback4_core::schema::{ColumnType, IndexComponent, RuleExpr, RuleTerm};
    let bound = bound(SOURCE);
    let table = bound.schema.table("memberships").unwrap();
    let RuleExpr::Or(terms) = &table.rules.read else { panic!("or") };
    let equality = terms[0].clone();
    let probe = terms[1].clone();
    let principal = BTreeSet::from(["chatKey".into(), "principal".into()]);
    let chat = BTreeSet::from(["chatKey".into()]);
    let and = RuleExpr::And(vec![table.rules.read.clone(), RuleExpr::Allow]);
    assert_eq!(deciding_fields("memberships", table, &and), chat);
    let nested_or = RuleExpr::Or(vec![equality.clone(), RuleExpr::Or(vec![probe.clone()])]);
    assert_eq!(deciding_fields("memberships", table, &nested_or), chat);
    for rule in [
        RuleExpr::Or(vec![RuleExpr::And(vec![equality.clone(), RuleExpr::Allow]), probe.clone()]),
        RuleExpr::Or(vec![equality.clone(), RuleExpr::And(vec![probe.clone(), RuleExpr::Allow])]),
        RuleExpr::Or(vec![RuleExpr::Ne(RuleTerm::Field("principal".into()), RuleTerm::Viewer), probe.clone()]),
    ] { assert_eq!(deciding_fields("memberships", table, &rule), principal); }
    for variant in ["nonunique", "optional", "words", "short", "literal", "wrong-field", "missing-column", "other-viewer"] {
        let mut table = table.clone();
        match variant {
            "nonunique" => table.indexes.get_mut("byChatPrincipal").unwrap().unique = false,
            "optional" => { table.columns.insert("chatKey".into(), ColumnType::Optional(Box::new(table.columns["chatKey"].clone()))); }
            "words" => table.indexes.get_mut("byChatPrincipal").unwrap().components[0] = IndexComponent::WordPrefixes { fields: vec!["chatKey".into()], contract: serde_json::Value::Null },
            _ => {
                let RuleExpr::Or(terms) = &mut table.rules.read else { unreachable!() };
                let RuleExpr::Exists { key, .. } = &mut terms[1] else { unreachable!() };
                match variant {
                    "short" => { key.pop(); }
                    "literal" => key[0] = RuleTerm::Literal(text("alpha")),
                    "wrong-field" => key[0] = RuleTerm::Field("role".into()),
                    "missing-column" => { table.indexes.get_mut("byChatPrincipal").unwrap().components[1] = IndexComponent::Column("role".into()); }
                    "other-viewer" => key[0] = RuleTerm::Viewer,
                    _ => unreachable!(),
                }
            }
        }
        let mut raw = BTreeSet::new();
        table.rules.read.fields(&mut raw);
        assert_eq!(deciding_fields("memberships", &table, &table.rules.read), raw, "{variant}");
    }
}

#[test]
fn extra_equalities_are_deciding_fields_and_cannot_bless_a_self_probe() {
    for (rule, expected_fields, roster_uniform, directory_true) in [
        (".principal = viewer or exists memberships[chatKey = .chatKey, principal = viewer]", vec!["chatKey"], true, true),
        (".principal = viewer or exists memberships[chatKey = .chatKey, principal = viewer, role = 'admin']", vec!["chatKey", "principal"], false, true),
        ("exists memberships[chatKey = .chatKey, principal = viewer, role = 'admin']", vec!["chatKey"], true, false),
        ("exists memberships[chatKey = .chatKey, principal = viewer, role = .role]", vec!["chatKey", "role"], false, true),
    ] {
        let compiled = bound(&SOURCE.replace(RULE, rule));
        assert_eq!(fields(&compiled), expected_fields.into_iter().map(String::from).collect());
        assert_eq!(visibility(&compiled, "roster").uniform, roster_uniform, "{rule}");
        assert_eq!(visibility(&compiled, "directory").decided_true, directory_true, "{rule}");
        let mut engine = engine(&compiled);
        for viewer in ["dev:alice", "dev:bob", "dev:nobody"] {
            let result = engine.query("roster", context(viewer, &[("chatKey", text("alpha"))])).unwrap();
            // LLP 3000.036 §16.3: a disjunct the chat pin decides (the admin
            // probe on literals) is a page guard for the admin it admits.
            let guarded = rule.contains("role = 'admin'") && viewer == "dev:alice";
            assert_eq!(result.complete, roster_uniform || guarded, "{rule}: {result:?}");
            let directory = engine.query("directory", context(viewer, &[])).unwrap();
            assert_eq!(directory.complete, directory_true, "{rule}: {directory:?}");
            if rule.ends_with("role = 'admin']") && !rule.starts_with(".principal") && viewer == "dev:bob" {
                assert!(directory.data.as_array().unwrap().is_empty(), "the total unique key must not skip the admin equality");
            }
        }
    }
    let source = SOURCE.replace(RULE, "exists memberships[chatKey = .chatKey, principal = viewer, role = .role]")
        .replace("  by byPrincipalChat:", "  by byChatRole: chatKey, role, id\n  by byPrincipalChat:")
        .replace("query roster(chatKey: text 1..40):\n  return memberships[chatKey] first 16 by byChatPrincipal", "query roster(chatKey: text 1..40):\n  return memberships[chatKey, 'member'] first 16 by byChatRole");
    let compiled = bound(&source);
    assert!(visibility(&compiled, "roster").uniform);
    let result = engine(&compiled).query("roster", context("dev:bob", &[("chatKey", text("alpha"))])).unwrap();
    assert!(result.complete);
    assert_eq!(result.data.as_array().unwrap().len(), 2);
    assert_eq!(result.metered.rule_probes, 1);
}

// @ref LLP 3000.036.001#14 — a cursor answers the current remaining range when membership changes between pages.
#[test]
fn owner_or_membership_cursor_observes_revocation_and_acquisition_after_its_position() {
    let source = "table page_members:
  parent: text <=40
  principal: principal
  unique parent, principal
  cap 16 by principal
  read <- .principal = viewer
  insert <- .principal = viewer
  delete <- .principal = viewer
  online only
table page_docs:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists page_members[.parent, viewer]
  online only
query page_docs(c: cursor ?):
  return page_docs last 1 by .at after c
";
    let compiled = bound(source);
    let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("page_members".into(), snapback4_core::value::object([("id", id("m1")), ("parent", text("p1")), ("principal", id("alice"))])),
        ("page_docs".into(), snapback4_core::value::object([("id", id("owner")), ("owner", id("alice")), ("parent", text("p0")), ("at", Value::Int(5))])),
        ("page_docs".into(), snapback4_core::value::object([("id", id("old-member")), ("owner", id("bob")), ("parent", text("p1")), ("at", Value::Int(4))])),
        ("page_docs".into(), snapback4_core::value::object([("id", id("new-member")), ("owner", id("bob")), ("parent", text("p2")), ("at", Value::Int(3))])),
    ]).unwrap();
    let first = engine.query("page_docs", context("alice", &[("c", Value::Null)])).unwrap();
    assert_eq!(first.data.as_array().unwrap()[0].field("id").unwrap(), &id("owner"));
    let cursor = first.next.expect("remaining readable row");
    engine.seed_delete("page_members", "m1").unwrap();
    engine.seed([("page_members".into(), snapback4_core::value::object([("id", id("m2")), ("parent", text("p2")), ("principal", id("alice"))]))]).unwrap();
    let second = engine.query("page_docs", context("alice", &[("c", Value::String(cursor))])).unwrap();
    assert_eq!(second.data.as_array().unwrap()[0].field("id").unwrap(), &id("new-member"));
    assert!(second.complete && second.next.is_none());
}
// @ref LLP 3000.036.001#14 — only live memberships may synthesize PAGE target lanes.
#[test]
fn owner_or_membership_page_ignores_an_expired_unswept_witness() {
    let source = "table page_members:
  parent: text <=40
  principal: principal
  until: time ?
  unique parent, principal
  cap 16 by principal
  by byExpiry: until
  expire at .until
  read <- .principal = viewer
  online only
table page_docs:
  owner: principal
  parent: text <=40
  at: int
  read <- .owner = viewer or exists page_members[.parent, viewer]
  online only
query page_docs(c: cursor ?):
  return page_docs last 10 by .at after c
";
    let compiled = bound(source);
    let program = &compiled
        .programs
        .iter()
        .find(|program| program.program.name == "page_docs")
        .unwrap()
        .program;
    assert!(
        snapback4_core::ir::body_merges(&program.body)
            .iter()
            .any(|merge| merge.lanes.iter().any(|lane| lane.membership()))
    );
    let mut engine = Engine::memory(
        compiled.schema,
        compiled.programs.into_iter().map(|p| p.program),
    )
    .unwrap();
    engine
        .seed([
            (
                "page_members".into(),
                snapback4_core::value::object([
                    ("id", id("expired")),
                    ("parent", text("p1")),
                    ("principal", id("alice")),
                    ("until", Value::Int(5)),
                ]),
            ),
            (
                "page_members".into(),
                snapback4_core::value::object([
                    ("id", id("live")),
                    ("parent", text("p2")),
                    ("principal", id("alice")),
                    ("until", Value::Null),
                ]),
            ),
            (
                "page_docs".into(),
                snapback4_core::value::object([
                    ("id", id("owner")),
                    ("owner", id("alice")),
                    ("parent", text("p0")),
                    ("at", Value::Int(1)),
                ]),
            ),
            (
                "page_docs".into(),
                snapback4_core::value::object([
                    ("id", id("expired-target")),
                    ("owner", id("bob")),
                    ("parent", text("p1")),
                    ("at", Value::Int(2)),
                ]),
            ),
            (
                "page_docs".into(),
                snapback4_core::value::object([
                    ("id", id("live-target")),
                    ("owner", id("bob")),
                    ("parent", text("p2")),
                    ("at", Value::Int(3)),
                ]),
            ),
        ])
        .unwrap();
    let before = engine
        .query("page_docs", context("alice", &[("c", Value::Null)]).at(4))
        .unwrap();
    assert_eq!(
        before
            .data
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row.field("id").unwrap().as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["live-target", "expired-target", "owner"]
    );
    let after = engine
        .query("page_docs", context("alice", &[("c", Value::Null)]).at(6))
        .unwrap();
    assert_eq!(
        after
            .data
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row.field("id").unwrap().as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["live-target", "owner"]
    );
    assert!(after.complete && after.next.is_none());
    assert_eq!(
        engine.store().count("page_members").unwrap(),
        2,
        "the witness remains physically unswept"
    );
}
