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

// @ref LLP 3000.036.001#15 — total membership points admit metered discovery; a cursor answers the current remaining range after membership changes.
#[test]
fn owner_or_membership_cursor_observes_revocation_and_acquisition_after_its_position() {
    let source = "table page_members:
  parent: text <=40
  principal: principal
  unique parent, principal
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
    assert!(compiled.schema.required_capabilities().contains("branch-membership-v2"));
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

// @ref LLP 3000.036.001#18 — simulator execution covers the PAGE5 fixed
// point guard beside a per-row membership and exact vacancy exhaustion.
#[test]
fn page5_product_fixed_membership_and_vacancy_publish_complete_pages() {
    let product = bound("table items:
  owner: principal
  helper: principal
  status: text <=10
  at: int
  read <- (.owner = viewer or .helper = viewer) and (.status = 'open' or .status = 'active')
  online only
query page():
  return items first 10 by .at
");
    assert!(!product.schema.required_capabilities().contains("branch-pages-v4"));
    let mut engine = Engine::memory(product.schema, product.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("items".into(), snapback4_core::value::object([("id", id("a")), ("owner", id("alice")), ("helper", id("bob")), ("status", Value::String("open".into())), ("at", Value::Int(1))])),
        ("items".into(), snapback4_core::value::object([("id", id("b")), ("owner", id("bob")), ("helper", id("alice")), ("status", Value::String("active".into())), ("at", Value::Int(2))])),
        ("items".into(), snapback4_core::value::object([("id", id("c")), ("owner", id("alice")), ("helper", id("bob")), ("status", Value::String("closed".into())), ("at", Value::Int(3))])),
    ]).unwrap();
    let result = engine.query("page", context("alice", &[])).unwrap();
    assert!(result.complete && result.next.is_none(), "{result:?}");
    let ids: Vec<_> = result.data.as_array().unwrap().iter().map(|row| row.field("id").unwrap().clone()).collect();
    assert_eq!(ids, [id("a"), id("b")]);

    let fixed = bound("table chapters:
  bucket: int
  principal: principal
  unique bucket, principal
  read <- .principal = viewer
  online only
table seats:
  bucket: int
  principal: principal
  unique bucket, principal
  read <- .principal = viewer
  online only
table access:
  item: items
  bucket: int
  principal: principal
  unique item, bucket, principal
  read <- .principal = viewer
  online only
table items:
  bucket: int
  at: int
  read <- (exists chapters[.bucket, viewer] and exists seats[.bucket, viewer]) and exists access[.id, .bucket, viewer]
  online only
query page(bucket: int, c: cursor ?):
  return items where .bucket = bucket first 1 by .at after c
");
    assert!(fixed.schema.required_capabilities().contains("branch-pages-v4"));
    let mut engine = Engine::memory(fixed.schema, fixed.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("chapters".into(), snapback4_core::value::object([("id", id("chapter")), ("bucket", Value::Int(1)), ("principal", id("alice"))])),
        ("seats".into(), snapback4_core::value::object([("id", id("seat")), ("bucket", Value::Int(1)), ("principal", id("alice"))])),
        ("access".into(), snapback4_core::value::object([("id", id("access")), ("item", id("visible")), ("bucket", Value::Int(1)), ("principal", id("alice"))])),
        ("items".into(), snapback4_core::value::object([("id", id("visible")), ("bucket", Value::Int(1)), ("at", Value::Int(1))])),
        ("items".into(), snapback4_core::value::object([("id", id("hidden")), ("bucket", Value::Int(1)), ("at", Value::Int(2))])),
    ]).unwrap();
    let result = engine.query("page", context("alice", &[("bucket", Value::Int(1)), ("c", Value::Null)])).unwrap();
    assert!(result.complete && result.next.is_none(), "{result:?}");
    assert_eq!(result.data.as_array().unwrap()[0].field("id").unwrap(), &id("visible"));

    let vacancy = bound("table holds:
  item: designs
  owner: principal
  unique item
  read <- .owner = viewer
  online only
table designs:
  owner: principal
  read <- not exists holds[item = .id] or .owner = viewer
  online only
query available(c: cursor ?):
  return designs first 1 by .id after c
");
    assert!(vacancy.schema.required_capabilities().contains("branch-pages-v4"));
    let mut engine = Engine::memory(vacancy.schema, vacancy.programs.into_iter().map(|p| p.program)).unwrap();
    engine.seed([
        ("holds".into(), snapback4_core::value::object([("id", id("hold")), ("item", id("held")), ("owner", id("alice"))])),
        ("designs".into(), snapback4_core::value::object([("id", id("free")), ("owner", id("alice"))])),
        ("designs".into(), snapback4_core::value::object([("id", id("held")), ("owner", id("alice"))])),
    ]).unwrap();
    let result = engine.query("available", context("bob", &[("c", Value::Null)])).unwrap();
    assert!(result.complete && result.next.is_none(), "{result:?}");
    assert_eq!(result.data.as_array().unwrap()[0].field("id").unwrap(), &id("free"));
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

// @ref LLP 3000.036.001#14 — a total one-row source yields its implicit id, but only while that row is live.
#[test]
fn owner_or_total_unique_source_id_expires_as_one_complete_lane() {
    let source = "table groups:
  principal: principal
  until: time ?
  unique principal
  cap 16 by principal
  by byExpiry: until
  expire at .until
  read <- .principal = viewer
  online only
table documents:
  owner: principal
  parent: id
  at: int
  read <- .owner = viewer or exists groups[id = .parent, principal = viewer]
  online only
query documents(c: cursor ?):
  return documents last 10 by .at after c
";
    let compiled = bound(source);
    assert!(snapback4_core::ir::body_merges(&compiled.programs[0].program.body)
        .into_iter().any(|merge| merge.lanes.iter().any(|lane| lane.membership())));
    let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|program| program.program)).unwrap();
    engine.seed([
        ("groups".into(), snapback4_core::value::object([
            ("id", id("g1")), ("principal", id("alice")), ("until", Value::Int(5)),
        ])),
        ("documents".into(), snapback4_core::value::object([
            ("id", id("owned")), ("owner", id("alice")), ("parent", id("g0")), ("at", Value::Int(1)),
        ])),
        ("documents".into(), snapback4_core::value::object([
            ("id", id("shared")), ("owner", id("bob")), ("parent", id("g1")), ("at", Value::Int(2)),
        ])),
    ]).unwrap();
    let ids = |out: &snapback4_core::QueryOutcome| out.data.as_array().unwrap().iter()
        .map(|row| row.field("id").unwrap().as_str().unwrap().to_owned()).collect::<Vec<_>>();
    let before = engine.query("documents", context("alice", &[("c", Value::Null)]).at(4)).unwrap();
    assert_eq!(ids(&before), ["shared", "owned"]); assert!(before.complete && before.next.is_none());
    let after = engine.query("documents", context("alice", &[("c", Value::Null)]).at(6)).unwrap();
    assert_eq!(ids(&after), ["owned"]); assert!(after.complete && after.next.is_none());
    assert_eq!(engine.store().count("groups").unwrap(), 1, "expired source remains physically unswept");
}

// @ref LLP 3000.036.001#16 — each new read observes current grants/status,
// while a continuation stays after its original shared position.
#[test]
fn page3_compound_status_and_role_revocation_preserve_current_authority() {
    let source = "table staff:
  principal: principal
  unique principal
  read <- .principal = viewer
  delete <- allow
  online only
table documents:
  owner: principal
  open: bool
  read <- .owner = viewer or (exists staff[viewer] and .open = true)
  update <- allow
  online only
query documents(c: cursor ?):
  return documents first 1 by .id after c
mutation close(document: documents):
  update documents[document] { open: false }
mutation revoke(principal: principal):
  delete staff[principal = principal]
";
    let compiled = bound(source);
    let mut engine = Engine::memory(compiled.schema, compiled.programs.into_iter().map(|p| p.program)).unwrap();
    let row = |id_: &str, owner: &str, open: bool| ("documents".into(), snapback4_core::value::object([
        ("id", id(id_)), ("owner", id(owner)), ("open", Value::Bool(open))]));
    engine.seed([( "staff".into(), snapback4_core::value::object([("id", id("s")), ("principal", id("alice"))])),
        row("a", "bob", true), row("b", "bob", false), row("c", "alice", false), row("d", "bob", true)]).unwrap();
    let first = engine.query("documents", context("alice", &[("c", Value::Null)])).unwrap();
    assert!(first.complete); assert_eq!(first.data.as_array().unwrap()[0].field("id").unwrap(), &id("a"));
    let cursor = first.next.unwrap();
    let mut cx = Context::system(); cx.args.insert("document".into(), id("d"));
    engine.mutate("close", None, cx).unwrap();
    let mut cx = Context::system(); cx.args.insert("principal".into(), id("alice"));
    engine.mutate("revoke", None, cx).unwrap();
    let next = engine.query("documents", context("alice", &[("c", Value::String(cursor))])).unwrap();
    assert!(next.complete && next.next.is_none());
    assert_eq!(next.data.as_array().unwrap().iter().map(|r| r.field("id").unwrap().as_str().unwrap()).collect::<Vec<_>>(), ["c"]);
    let outsider = engine.query("documents", context("erin", &[("c", Value::Null)])).unwrap();
    assert!(outsider.complete && outsider.data.as_array().unwrap().is_empty());
}

// @ref LLP 3000.036.001#17 — each live continuation re-evaluates all
// audiences; membership revocation and closing public status remove rows.
#[test]
fn page4_mixed_audiences_revoke_between_pages_without_dropping_owned_rows() {
    let source=format!("{}\nmutation revoke(group: int, principal: principal):\n  delete members[group, principal]\nmutation close(doc: docs):\n  update docs[doc] {{ open: false }}\n",include_str!("../../snapback4-lang/tests/fixtures/page4-union.q").replace("  online only","  delete <- allow\n  update <- allow\n  online only"));
    let b=bound(&source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let row=|name:&str,owner:&str,group,open| ("docs".into(),snapback4_core::value::object([("id",id(name)),("owner",id(owner)),("group",Value::Int(group)),("open",Value::Bool(open)),("at",Value::Int(if name=="a" {1}else if name=="b" {2}else if name=="c" {3}else{4}))]));
    e.seed([("members".into(),snapback4_core::value::object([("id",id("m")),("group",Value::Int(2)),("principal",id("alice"))])),row("a","alice",1,false),row("b","bob",2,false),row("c","bob",3,true),row("d","alice",2,true)]).unwrap();
    let first=e.query("list",context("alice",&[("c",Value::Null)])).unwrap();assert!(first.complete);
    let token=first.next.unwrap();let mut cx=Context::system();cx.args=context("alice", &[("group",Value::Int(2)),("principal",id("alice"))]).args;
    e.mutate("revoke",None,cx).unwrap();let mut cx=Context::system();cx.args=context("alice", &[("doc",id("c"))]).args;e.mutate("close",None,cx).unwrap();
    let next=e.query("list",context("alice",&[("c",Value::String(token))])).unwrap();assert!(next.complete&&next.next.is_none());assert_eq!(next.data.as_array().unwrap()[0].field("id").unwrap(),&id("d"));
    let scoped=e.query("scoped",context("alice",&[("c",Value::Null)])).unwrap();assert!(scoped.complete&&scoped.data.as_array().unwrap().is_empty());
}

// Shared conformance cases run every PAGE4 family in the simulator test host.
// The live revocation schedule above exercises changing audiences between pages.
#[path = "../../snapback4-lang/tests/page4.rs"]
mod page4_conformance;
