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
            // One probe for a later member serves all three rows. A hoisted
            // false prefix restores the empty-range meter and discloses no cursor.
            assert_eq!(roster.metered.rule_probes, u64::from(member && (viewer != "dev:alice" || rule.starts_with("exists"))), "{viewer}: {rule}");
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
        assert!(bound.notes.iter().any(|n| n.code == "N_NEVER_COMPLETE" && n.message.contains("query roster:")), "{:?}", bound.notes);
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
            assert!(!admin.complete, "a non-uniform class stays incomplete even for an admin");
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
